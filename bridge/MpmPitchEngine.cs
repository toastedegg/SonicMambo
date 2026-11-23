using System.Numerics;
using System.Runtime.CompilerServices;

namespace SonicMamboBridge;

public readonly record struct PitchTelemetryFrame(
    double TimeMs,
    float Rms,
    float? RawHz,
    float? SmoothedHz,
    float? Midi,
    float? CentsOffset,
    string? Label,
    float Confidence,
    float TuningOffsetCents);

/// <summary>
/// Vectorized (AVX2/SSE `Vector&lt;float&gt;`) McLeod Pitch Method (MPM) + Goertzel harmonic octave guard
/// + Semitone Median Smoother running on a dedicated worker thread outside the ASIO callback.
/// </summary>
public sealed class MpmPitchEngine
{
    private static readonly string[] NoteNames =
        ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    private const int FrameSize = 2048;
    private const int HopSize = 256;
    private const float MinFreq = 70f;
    private const float MaxFreq = 1400f;
    private const float ClarityThreshold = 0.88f;
    private const float MinConfidence = 0.58f;

    private readonly float[] _ring = new float[FrameSize];
    private readonly float[] _frame = new float[FrameSize];
    private readonly float[] _windowed = new float[FrameSize];
    private readonly float[] _hann = new float[FrameSize];
    private readonly float[] _nsdf = new float[FrameSize];
    private int _ringWrite = 0;
    private int _filled = 0;
    private int _sinceHop = 0;

    // 60 Hz 2nd-order High-Pass Biquad
    private float _hpZ1 = 0f, _hpZ2 = 0f;

    // Semitone median smoother
    private readonly List<float> _midiWindow = new(4);
    private float? _lastSmoothedMidi = null;
    private double _lastGoodMs = -1e9;
    private float? _pendingJumpMidi = null;
    private string? _stableLabel = null;

    // Rolling session tuning offset
    private readonly List<float> _tuningDeviations = new(128);
    private float _tuningOffsetCents = 0f;

    private volatile float _rmsThreshold = 0.008f;

    public MpmPitchEngine()
    {
        for (int i = 0; i < FrameSize; i++)
        {
            _hann[i] = 0.5f - 0.5f * MathF.Cos(MathF.Tau * i / (FrameSize - 1));
        }
    }

    public void SetRmsThreshold(float threshold)
    {
        _rmsThreshold = Math.Clamp(threshold, 0.002f, 0.08f);
    }

    public void Reset()
    {
        Array.Clear(_ring);
        _ringWrite = 0;
        _filled = 0;
        _sinceHop = 0;
        _hpZ1 = _hpZ2 = 0f;
        _midiWindow.Clear();
        _lastSmoothedMidi = null;
        _pendingJumpMidi = null;
        _stableLabel = null;
        _tuningDeviations.Clear();
        _tuningOffsetCents = 0f;
    }

    public List<PitchTelemetryFrame> PushSamples(ReadOnlySpan<float> samples, double sampleRate, double currentAudioMs)
    {
        var results = new List<PitchTelemetryFrame>();
        float sr = (float)sampleRate;

        // 60 Hz high-pass coefficients
        float w0 = MathF.Tau * 60f / sr;
        float cosW = MathF.Cos(w0);
        float alpha = MathF.Sin(w0) / (2f * 0.7071f);
        float a0 = 1f + alpha;
        float b0 = ((1f + cosW) * 0.5f) / a0;
        float b1 = -(1f + cosW) / a0;
        float b2 = ((1f + cosW) * 0.5f) / a0;
        float a1 = (-2f * cosW) / a0;
        float a2 = (1f - alpha) / a0;

        for (int i = 0; i < samples.Length; i++)
        {
            float x = samples[i];
            float y = b0 * x + _hpZ1;
            _hpZ1 = b1 * x - a1 * y + _hpZ2;
            _hpZ2 = b2 * x - a2 * y;

            _ring[_ringWrite] = y;
            _ringWrite = (_ringWrite + 1) & (FrameSize - 1);
            if (_filled < FrameSize) _filled++;
            _sinceHop++;

            if (_filled == FrameSize && _sinceHop >= HopSize)
            {
                _sinceHop = 0;
                int tail = FrameSize - _ringWrite;
                Array.Copy(_ring, _ringWrite, _frame, 0, tail);
                if (_ringWrite > 0)
                {
                    Array.Copy(_ring, 0, _frame, tail, _ringWrite);
                }

                var (rawHz, conf, rms) = DetectMpm(_frame, sr);
                var frameOut = SmoothAndFormat(rawHz, conf, rms, currentAudioMs);
                results.Add(frameOut);
            }
        }

        return results;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private (float? pitchHz, float confidence, float rms) DetectMpm(float[] frame, float sampleRate)
    {
        float sumSq = 0f;
        for (int i = 0; i < FrameSize; i++) sumSq += frame[i] * frame[i];
        float rms = MathF.Sqrt(sumSq / FrameSize);
        if (rms < _rmsThreshold)
        {
            return (null, 0f, rms);
        }

        int maxLag = Math.Min((int)MathF.Ceiling(sampleRate / MinFreq), FrameSize - 3);
        int minLag = Math.Max(2, (int)MathF.Floor(sampleRate / MaxFreq));

        float m = 2f * sumSq;
        _nsdf[0] = 1f;

        int vecWidth = Vector<float>.Count;
        for (int tau = 1; tau <= maxLag + 1; tau++)
        {
            int len = FrameSize - tau;
            int idx = 0;
            var vAcc = Vector<float>.Zero;
            for (; idx <= len - vecWidth; idx += vecWidth)
            {
                var va = new Vector<float>(frame, idx);
                var vb = new Vector<float>(frame, idx + tau);
                vAcc += va * vb;
            }
            float r = Vector.Dot(vAcc, Vector<float>.One);
            for (; idx < len; idx++)
            {
                r += frame[idx] * frame[idx + tau];
            }

            float prevTail = frame[tau - 1] * frame[tau - 1] + frame[FrameSize - tau] * frame[FrameSize - tau];
            m -= prevTail;
            _nsdf[tau] = m > 1e-12f ? (2f * r) / m : 0f;
        }

        int startLag = 1;
        while (startLag < maxLag && _nsdf[startLag] > 0f) startLag++;
        if (startLag < minLag) startLag = minLag;

        Span<int> peaks = stackalloc int[64];
        int peakCount = 0;
        bool inPos = false;
        int bestIdx = -1;
        float bestVal = -1f;
        float globalMax = 0f;

        for (int i = startLag; i <= maxLag; i++)
        {
            float v = _nsdf[i];
            if (v > 0f)
            {
                if (!inPos)
                {
                    inPos = true;
                    bestIdx = i;
                    bestVal = v;
                }
                else if (v > bestVal)
                {
                    bestIdx = i;
                    bestVal = v;
                }
            }
            else if (inPos)
            {
                inPos = false;
                if (bestIdx >= minLag && bestIdx < maxLag && peakCount < peaks.Length)
                {
                    peaks[peakCount++] = bestIdx;
                    if (bestVal > globalMax) globalMax = bestVal;
                }
            }
        }
        if (inPos && bestIdx >= minLag && bestIdx < maxLag && peakCount < peaks.Length)
        {
            peaks[peakCount++] = bestIdx;
            if (bestVal > globalMax) globalMax = bestVal;
        }

        if (peakCount == 0 || globalMax < MinConfidence)
        {
            return (null, globalMax, rms);
        }

        float cutoff = ClarityThreshold * globalMax;
        int chosenLag = peaks[0];
        for (int p = 0; p < peakCount; p++)
        {
            if (_nsdf[peaks[p]] >= cutoff)
            {
                chosenLag = peaks[p];
                break;
            }
        }

        // Parabolic refinement
        float yL = _nsdf[chosenLag - 1];
        float yC = _nsdf[chosenLag];
        float yR = _nsdf[chosenLag + 1];
        float denom = 2f * yC - yL - yR;
        float delta = MathF.Abs(denom) > 1e-9f ? Math.Clamp(0.5f * (yR - yL) / denom, -0.5f, 0.5f) : 0f;
        float refinedLag = chosenLag + delta;
        float candHz = sampleRate / refinedLag;
        float conf = Math.Clamp(yC, 0f, 1f);

        // Harmonic octave guard (prevents subharmonic 1/2 drops and wound-string 2*f0 jumps)
        for (int i = 0; i < FrameSize; i++) _windowed[i] = frame[i] * _hann[i];
        float a1 = GoertzelMag(_windowed, candHz, sampleRate);
        float a2 = GoertzelMag(_windowed, candHz * 2f, sampleRate);
        if (candHz * 2f <= MaxFreq && a2 > a1 * 2.8f)
        {
            int halfLag = (int)MathF.Round(refinedLag * 0.5f);
            if (halfLag >= minLag && _nsdf[halfLag] >= conf * 0.86f)
            {
                candHz *= 2f;
            }
        }
        else if (candHz * 0.5f >= MinFreq)
        {
            float aHalf = GoertzelMag(_windowed, candHz * 0.5f, sampleRate);
            int dblLag = (int)MathF.Round(refinedLag * 2f);
            if (dblLag <= maxLag && aHalf > a1 * 0.52f && _nsdf[dblLag] >= conf * 0.90f)
            {
                candHz *= 0.5f;
            }
        }

        return (candHz, conf, rms);
    }

    private static float GoertzelMag(float[] windowed, float targetHz, float sr)
    {
        if (targetHz <= 0f || targetHz >= sr * 0.48f) return 0f;
        float omega = MathF.Tau * targetHz / sr;
        float coeff = 2f * MathF.Cos(omega);
        float s1 = 0f, s2 = 0f;
        for (int i = 0; i < windowed.Length; i++)
        {
            float s0 = windowed[i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        float power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
        return power > 0f ? MathF.Sqrt(power) / windowed.Length : 0f;
    }

    private PitchTelemetryFrame SmoothAndFormat(float? rawHz, float conf, float rms, double nowMs)
    {
        bool valid = rawHz.HasValue && rawHz.Value > 0f && conf >= MinConfidence;
        if (!valid)
        {
            if (_lastSmoothedMidi.HasValue && (nowMs - _lastGoodMs) <= 95.0)
            {
                float heldMidi = _lastSmoothedMidi.Value;
                float heldHz = 440f * MathF.Pow(2f, (heldMidi - 69f) / 12f);
                int near = (int)MathF.Round(heldMidi);
                return new PitchTelemetryFrame(
                    nowMs, rms, null, heldHz, heldMidi, (heldMidi - near) * 100f, _stableLabel, conf, _tuningOffsetCents);
            }
            _midiWindow.Clear();
            _lastSmoothedMidi = null;
            _pendingJumpMidi = null;
            _stableLabel = null;
            return new PitchTelemetryFrame(nowMs, rms, null, null, null, null, null, conf, _tuningOffsetCents);
        }

        float rawMidi = 69f + 12f * MathF.Log2(rawHz!.Value / 440f);
        if (_lastSmoothedMidi.HasValue && MathF.Abs(rawMidi - _lastSmoothedMidi.Value) >= 0.85f)
        {
            if (_pendingJumpMidi.HasValue && MathF.Abs(rawMidi - _pendingJumpMidi.Value) <= 0.6f)
            {
                _midiWindow.Clear();
                _pendingJumpMidi = null;
            }
            else
            {
                _pendingJumpMidi = rawMidi;
                float heldHz = 440f * MathF.Pow(2f, (_lastSmoothedMidi.Value - 69f) / 12f);
                int near = (int)MathF.Round(_lastSmoothedMidi.Value);
                return new PitchTelemetryFrame(
                    nowMs, rms, rawHz, heldHz, _lastSmoothedMidi.Value,
                    (_lastSmoothedMidi.Value - near) * 100f, _stableLabel, conf, _tuningOffsetCents);
            }
        }
        else
        {
            _pendingJumpMidi = null;
        }

        _midiWindow.Add(rawMidi);
        if (_midiWindow.Count > 3) _midiWindow.RemoveAt(0);

        float smMidi = _midiWindow.Count switch
        {
            1 => _midiWindow[0],
            2 => 0.5f * (_midiWindow[0] + _midiWindow[1]),
            _ => Median3(_midiWindow[0], _midiWindow[1], _midiWindow[2]),
        };

        _lastSmoothedMidi = smMidi;
        _lastGoodMs = nowMs;

        int nearestInt = (int)MathF.Round(smMidi);
        float cents = (smMidi - nearestInt) * 100f;

        if (conf >= 0.82f && MathF.Abs(cents) <= 35f)
        {
            _tuningDeviations.Add(cents);
            if (_tuningDeviations.Count > 90) _tuningDeviations.RemoveAt(0);
            if (_tuningDeviations.Count >= 12)
            {
                var copy = _tuningDeviations.ToArray();
                Array.Sort(copy);
                _tuningOffsetCents = Math.Clamp(copy[copy.Length / 2], -30f, 30f);
            }
        }

        string nextLabel = MidiToLabel(nearestInt);
        if (_stableLabel == null)
        {
            _stableLabel = nextLabel;
        }
        else
        {
            int curStableMidi = LabelToMidi(_stableLabel);
            if (MathF.Abs(smMidi - curStableMidi) > 0.58f)
            {
                _stableLabel = nextLabel;
            }
        }

        float smHz = 440f * MathF.Pow(2f, (smMidi - 69f) / 12f);
        return new PitchTelemetryFrame(
            nowMs, rms, rawHz, smHz, smMidi, cents, _stableLabel, conf, _tuningOffsetCents);
    }

    private static float Median3(float a, float b, float c)
    {
        if (a > b) (a, b) = (b, a);
        if (b > c) b = c;
        return a > b ? a : b;
    }

    private static string MidiToLabel(int midi)
    {
        int oct = (midi / 12) - 1;
        int semi = ((midi % 12) + 12) % 12;
        return $"{NoteNames[semi]}{oct}";
    }

    private static int LabelToMidi(string label)
    {
        for (int i = NoteNames.Length - 1; i >= 0; i--)
        {
            if (label.StartsWith(NoteNames[i], StringComparison.Ordinal))
            {
                if (int.TryParse(label.AsSpan(NoteNames[i].Length), out int oct))
                {
                    return (oct + 1) * 12 + i;
                }
            }
        }
        return 60;
    }
}
