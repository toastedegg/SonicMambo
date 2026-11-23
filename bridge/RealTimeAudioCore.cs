using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace SonicMamboBridge;

public enum SynthVoiceKind : int
{
    None = 0,
    Kick = 1,
    Snare = 2,
    HiHatClosed = 3,
    HiHatOpen = 4,
    Click = 5,
    ClickAccent = 6,
    Guitar = 7,
}

public struct ScheduledVoiceEvent
{
    public SynthVoiceKind Kind;
    public int DelaySamples;
    public float FrequencyHz;
    public float DurationSec;
    public float Velocity;
    public int SlideIn;
    public int Vibrato;
}

/// <summary>
/// 100% unmanaged-memory, zero-GC real-time ASIO DSP core:
/// 1. Auto-detects active guitar input channel (Ch 1 / Ch 2 / Sum) -> feeds lock-free SPSC dry ring buffer for MPM pitch detection.
/// 2. Inline zero-latency Tube Preamp + 12" Speaker Cab Biquad + Stereo Studio Room reflections (~3 microseconds/block).
/// 3. Lock-free 24-voice sample-accurate Drum Groove & Plucked Guitar Synthesizer mixed directly into ASIO stereo output.
/// </summary>
public sealed unsafe class RealTimeAudioCore : IDisposable
{
    private const int MaxBlockSize = 4096;
    private const int DryRingSize = 65536; // power of 2
    private const int DryRingMask = DryRingSize - 1;
    private const int DelaySize = 4096;
    private const int DelayMask = DelaySize - 1;
    private const int MaxVoices = 24;
    private const int EventQueueSize = 128;
    private const int EventQueueMask = EventQueueSize - 1;

    public readonly float* ScratchIn0;
    public readonly float* ScratchIn1;
    public readonly float* ScratchOutL;
    public readonly float* ScratchOutR;

    private readonly float* _dryRing;
    private volatile int _dryWritePos = 0;
    private volatile int _dryReadPos = 0;

    private readonly float* _roomDelayL;
    private readonly float* _roomDelayR;
    private int _roomIdx = 0;

    // Amp DSP state (Cascaded 3-stage 12AX7 tube preamp + 4x12" speaker cab + Haas room)
    private float _gateEnv = 0;
    private float _hpPrevIn = 0;
    private float _hpPrevOut = 0;
    private float _interLp = 0;
    private float _interHpIn = 0;
    private float _interHpOut = 0;
    private float _z01 = 0, _z02 = 0; // 4x12 116Hz speaker cabinet thump biquad
    private float _z11 = 0, _z12 = 0; // Interactive Tone/Bite presence biquad
    private float _z21 = 0, _z22 = 0; // Cabinet 12" cone lowpass stage 1
    private float _z31 = 0, _z32 = 0; // Cabinet 12" cone lowpass stage 2 (24dB/oct anti-fizz!)
    private float _lpRoomL = 0, _lpRoomR = 0;
    private float _smoothStage1 = 8.0f;
    private float _smoothMaster = 0.85f;

    // Atomic amp parameters
    private volatile bool _ampEnabled = false;
    private volatile bool _inputGated = false;
    private volatile int _channelMode = -1; // -1 = auto, -2 = sum, 0 = Ch1, 1 = Ch2
    private volatile int _activeChannel = 0;
    private volatile float _masterMixVol = 0.78f;

    private float _gateFloor = 0.0004f;
    private float _gateInvSpan = 600f;
    private float _hpCoeff = 0.988f;
    private float _interLpCoeff = 0.48f;
    private float _interHpCoeff = 0.994f;
    private int _tubeStages = 2;
    private float _stage1Gain = 18.0f;
    private float _stage2Gain = 2.4f;
    private float _stage3Gain = 1.4f;
    private float _postMakeup = 0.65f;
    private float _b00 = 1, _b01 = 0, _b02 = 0, _a01 = 0, _a02 = 0;
    private float _b10 = 1, _b11 = 0, _b12 = 0, _a11 = 0, _a12 = 0;
    private float _b20 = 1, _b21 = 0, _b22 = 0, _a21 = 0, _a22 = 0;
    private float _roomWet = 0.14f;
    private float _roomFb = 0.25f;
    private float _ampMaster = 0.95f;

    private double _sampleRate = 48000.0;
    private long _totalSamplesProcessed = 0;
    private uint _rngState = 0x9E3779B9u;

    // Lock-free SPSC voice event queue (WebSocket thread -> ASIO thread)
    private readonly ScheduledVoiceEvent* _eventQueue;
    private volatile int _evWrite = 0;
    private volatile int _evRead = 0;

    private struct ActiveVoice
    {
        public SynthVoiceKind Kind;
        public int CountdownSamples;
        public int AgeSamples;
        public int TotalSamples;
        public float FreqHz;
        public float TargetFreqHz;
        public float Phase1;
        public float Phase2;
        public float Velocity;
        public float FilterState1;
        public float FilterState2;
        public int SlideIn;
        public int Vibrato;
    }

    private readonly ActiveVoice* _voices;

    public int ActiveInputChannel => _activeChannel;
    public double SampleRate => _sampleRate;
    public double AudioTimeMs => (_totalSamplesProcessed / _sampleRate) * 1000.0;
    public bool IsInputGated => _inputGated;

    public RealTimeAudioCore()
    {
        ScratchIn0 = (float*)NativeMemory.AllocZeroed(MaxBlockSize, sizeof(float));
        ScratchIn1 = (float*)NativeMemory.AllocZeroed(MaxBlockSize, sizeof(float));
        ScratchOutL = (float*)NativeMemory.AllocZeroed(MaxBlockSize, sizeof(float));
        ScratchOutR = (float*)NativeMemory.AllocZeroed(MaxBlockSize, sizeof(float));
        _dryRing = (float*)NativeMemory.AllocZeroed(DryRingSize, sizeof(float));
        _roomDelayL = (float*)NativeMemory.AllocZeroed(DelaySize, sizeof(float));
        _roomDelayR = (float*)NativeMemory.AllocZeroed(DelaySize, sizeof(float));
        _eventQueue = (ScheduledVoiceEvent*)NativeMemory.AllocZeroed(EventQueueSize, (nuint)sizeof(ScheduledVoiceEvent));
        _voices = (ActiveVoice*)NativeMemory.AllocZeroed(MaxVoices, (nuint)sizeof(ActiveVoice));

        UpdateAmpParameters(false, "british-crunch", 0.68f, 0.24f, 0.78f, 0.64f);
    }

    public void Configure(double sampleRate, int _bufferSize)
    {
        _sampleRate = sampleRate > 8000 ? sampleRate : 48000.0;
        UpdateAmpParameters(_ampEnabled, _lastPreset, _lastDrive, _lastReverb, _lastVol, _lastTone);
    }

    private string _lastPreset = "british-crunch";
    private float _lastDrive = 0.68f;
    private float _lastReverb = 0.24f;
    private float _lastVol = 0.78f;
    private float _lastTone = 0.64f;

    public void SetChannelMode(string mode)
    {
        _channelMode = mode switch
        {
            "0" => 0,
            "1" => 1,
            "sum" => -2,
            _ => -1,
        };
    }

    public void SetInputGated(bool gated) => _inputGated = gated;
    public void SetMasterMixVolume(float vol) => _masterMixVol = Math.Clamp(vol, 0f, 1.2f);

    public void ClearScheduledVoices()
    {
        _evRead = _evWrite;
        for (int v = 0; v < MaxVoices; v++)
        {
            _voices[v].Kind = SynthVoiceKind.None;
        }
    }

    public void EnqueueVoice(ScheduledVoiceEvent ev)
    {
        int w = _evWrite;
        int next = (w + 1) & EventQueueMask;
        if (next == _evRead) return; // queue full
        _eventQueue[w] = ev;
        Thread.MemoryBarrier();
        _evWrite = next;
    }

    public void UpdateAmpParameters(bool enabled, string preset, float drive, float reverb, float volume, float tone = 0.62f)
    {
        _lastPreset = preset;
        float d = Math.Clamp(drive, 0f, 1f);
        float t = Math.Clamp(tone, 0f, 1f);
        _lastDrive = d;
        _lastReverb = Math.Clamp(reverb, 0f, 1f);
        _lastVol = Math.Clamp(volume, 0f, 1f);
        _lastTone = t;

        // Exponential perceptual pot taper so 50% already bites hard and 85-100% goes full molten!
        float dCurve = d * d * 0.65f + d * 0.35f;

        float preHpHz = 120f;
        float thumpDb = 3.2f;
        float midFreq = 1100f + t * 1150f;
        float midDb = 1.5f + t * 5.5f;
        float cabLpHz = 3400f + t * 1500f;
        int stages = 2;
        float g1 = 10f, g2 = 2.0f, g3 = 1.0f;
        float makeup = 0.62f;
        float gateFloor = 0.00025f;
        float gateSpan = 0.0014f;

        switch (preset)
        {
            case "clean-studio":
                preHpHz = 75f;
                thumpDb = 2.2f;
                midFreq = 1400f + t * 1300f;
                midDb = -0.5f + t * 4.2f;
                cabLpHz = 4200f + t * 1600f;
                stages = 1;
                g1 = 3.5f + dCurve * 14.5f;
                g2 = 1.0f;
                g3 = 1.0f;
                makeup = 0.72f / (1f + dCurve * 0.32f);
                gateFloor = 0.0001f;
                gateSpan = 0.0006f;
                break;

            case "velvet-jazz":
                preHpHz = 70f;
                thumpDb = 2.8f;
                midFreq = 520f + t * 700f;
                midDb = 1.2f + t * 3.0f;
                cabLpHz = 2500f + t * 1100f;
                stages = 1;
                g1 = 3.0f + dCurve * 9.0f;
                makeup = 0.74f / (1f + dCurve * 0.25f);
                gateFloor = 0.0001f;
                gateSpan = 0.0006f;
                break;

            case "blues-breakup":
                // Hot Tube Screamer -> pushed Fender/Marshall breakup (+20dB .. +45dB)
                preHpHz = 135f;
                thumpDb = 3.6f;
                midFreq = 880f + t * 1100f;
                midDb = 2.4f + t * 5.8f;
                cabLpHz = 3400f + t * 1450f;
                stages = 2;
                g1 = 7.5f + dCurve * 38.0f;
                g2 = 1.45f + dCurve * 3.8f;
                g3 = 1.0f;
                makeup = 0.62f / (1f + dCurve * 0.22f);
                gateFloor = 0.0003f;
                gateSpan = 0.0014f;
                break;

            case "british-crunch":
                // Hot-rodded JCM800 3-stage 12AX7 roar (+34dB .. +63dB)
                preHpHz = 215f;
                thumpDb = 4.8f;
                midFreq = 1050f + t * 1250f;
                midDb = 3.2f + t * 6.4f;
                cabLpHz = 3300f + t * 1350f;
                stages = 3;
                g1 = 16.0f + dCurve * 72.0f;
                g2 = 2.3f + dCurve * 6.2f;
                g3 = 1.5f + dCurve * 2.6f;
                makeup = 0.56f / (1f + dCurve * 0.16f);
                gateFloor = 0.00055f;
                gateSpan = 0.0020f;
                break;

            case "insane-lead":
            default:
                // NITRO 5150 / Dual-Rectifier / Shred Lead (+48dB .. +76dB cascaded saturation!)
                preHpHz = 310f;
                thumpDb = 5.8f;
                midFreq = 1180f + t * 1380f;
                midDb = 3.8f + t * 7.2f;
                cabLpHz = 3250f + t * 1300f;
                stages = 3;
                g1 = 36.0f + dCurve * 145.0f;
                g2 = 3.6f + dCurve * 8.8f;
                g3 = 2.2f + dCurve * 4.2f;
                makeup = 0.54f / (1f + dCurve * 0.12f);
                gateFloor = 0.00085f;
                gateSpan = 0.0026f;
                break;
        }

        float sr = (float)_sampleRate;
        // Closed-back 4x12" speaker resonant low-end chest thump at 116 Hz
        ComputePeakingBiquad(116f, 1.30f, thumpDb, sr, out float b00, out float b01, out float b02, out float a01, out float a02);
        // Interactive Tone/Bite mid-presence shaping
        ComputePeakingBiquad(midFreq, 0.90f, midDb, sr, out float b10, out float b11, out float b12, out float a11, out float a12);
        // 4th-order (2x cascaded 12dB/oct = 24dB/oct) Celestion V30 speaker cone roll-off (zero digital fizz!)
        ComputeLowpassBiquad(cabLpHz, 0.78f, sr, out float b20, out float b21, out float b22, out float a21, out float a22);

        _hpCoeff = MathF.Exp(-2f * MathF.PI * preHpHz / sr);
        _interLpCoeff = 1f - MathF.Exp(-2f * MathF.PI * 5400f / sr);
        _interHpCoeff = MathF.Exp(-2f * MathF.PI * 48f / sr);
        _gateFloor = gateFloor;
        _gateInvSpan = 1f / Math.Max(0.0002f, gateSpan);
        _tubeStages = stages;
        _stage1Gain = g1;
        _stage2Gain = g2;
        _stage3Gain = g3;
        _postMakeup = makeup;
        _b00 = b00; _b01 = b01; _b02 = b02; _a01 = a01; _a02 = a02;
        _b10 = b10; _b11 = b11; _b12 = b12; _a11 = a11; _a12 = a12;
        _b20 = b20; _b21 = b21; _b22 = b22; _a21 = a21; _a22 = a22;
        _roomWet = _lastReverb * 0.42f;
        _roomFb = 0.16f + _lastReverb * 0.25f;
        _ampMaster = _lastVol * 1.55f;
        _ampEnabled = enabled;
    }

    public int ReadDrySamples(Span<float> dest)
    {
        int r = _dryReadPos;
        int w = _dryWritePos;
        int avail = (w - r) & DryRingMask;
        int toRead = Math.Min(avail, dest.Length);
        for (int i = 0; i < toRead; i++)
        {
            dest[i] = _dryRing[(r + i) & DryRingMask];
        }
        Thread.MemoryBarrier();
        _dryReadPos = (r + toRead) & DryRingMask;
        return toRead;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void ProcessAsioBlock(float* in0, float* in1, float* outL, float* outR, int frames)
    {
        // 1. Drain incoming voice trigger events into active voice pool
        int evR = _evRead;
        int evW = _evWrite;
        while (evR != evW)
        {
            var ev = _eventQueue[evR];
            SpawnVoice(in ev);
            evR = (evR + 1) & EventQueueMask;
        }
        _evRead = evR;

        // 2. Determine active input channel for dry pitch detection (auto-detects Scarlett Ch 2!)
        int mode = _channelMode;
        int chosenCh = _activeChannel;
        if (mode == 0) chosenCh = 0;
        else if (mode == 1) chosenCh = 1;
        else if (mode == -1)
        {
            float e0 = 0f, e1 = 0f;
            for (int i = 0; i < frames; i++)
            {
                e0 += in0[i] * in0[i];
                e1 += in1[i] * in1[i];
            }
            float curE = chosenCh == 0 ? e0 : e1;
            int bestCh = e1 > e0 ? 1 : 0;
            float bestE = bestCh == 0 ? e0 : e1;
            if (bestCh != chosenCh && (bestE / frames) > 1e-8f && bestE > curE * 1.35f)
            {
                chosenCh = bestCh;
                _activeChannel = chosenCh;
            }
        }

        // Push dry guitar into lock-free ring buffer for MPM pitch detector
        int dryW = _dryWritePos;
        bool gated = _inputGated;
        for (int i = 0; i < frames; i++)
        {
            float dry = gated
                ? 0f
                : mode == -2
                    ? (in0[i] + in1[i]) * 0.7071f
                    : (chosenCh == 1 ? in1[i] : in0[i]);
            _dryRing[(dryW + i) & DryRingMask] = dry;
        }
        Thread.MemoryBarrier();
        _dryWritePos = (dryW + frames) & DryRingMask;

        // 3. Inline Cascaded 3-Stage 12AX7 Tube Preamp + 4x12" Cabinet + Haas Room
        bool runAmp = _ampEnabled && !gated;
        if (runAmp)
        {
            float gateEnv = _gateEnv;
            float gateFloor = _gateFloor, gateInvSpan = _gateInvSpan;
            float hpIn = _hpPrevIn, hpOut = _hpPrevOut, hpC = _hpCoeff;
            float interLp = _interLp, interLpC = _interLpCoeff;
            float interHpIn = _interHpIn, interHpOut = _interHpOut, interHpC = _interHpCoeff;
            int stages = _tubeStages;
            float targetG1 = _stage1Gain, g2 = _stage2Gain, g3 = _stage3Gain, mk = _postMakeup;
            float smoothG1 = _smoothStage1;
            float b00 = _b00, b01 = _b01, b02 = _b02, a01 = _a01, a02 = _a02;
            float b10 = _b10, b11 = _b11, b12 = _b12, a11 = _a11, a12 = _a12;
            float b20 = _b20, b21 = _b21, b22 = _b22, a21 = _a21, a22 = _a22;
            float z01 = _z01, z02 = _z02;
            float z11 = _z11, z12 = _z12;
            float z21 = _z21, z22 = _z22;
            float z31 = _z31, z32 = _z32;
            float lpL = _lpRoomL, lpR = _lpRoomR;
            float wet = _roomWet, fb = _roomFb;
            float targetMaster = _ampMaster, smoothMaster = _smoothMaster;
            int rIdx = _roomIdx;
            int delaySamplesL = (int)(0.011 * _sampleRate);
            int delaySamplesR = (int)(0.017 * _sampleRate);

            for (int i = 0; i < frames; i++)
            {
                float x = mode == 0
                    ? in0[i]
                    : mode == 1
                        ? in1[i]
                        : mode == -2
                            ? (in0[i] + in1[i]) * 0.70710678f
                            : (chosenCh == 1 ? in1[i] : in0[i]);

                // Zipper-free parameter smoothing when turning knobs live
                smoothG1 += 0.008f * (targetG1 - smoothG1);
                smoothMaster += 0.008f * (targetMaster - smoothMaster);

                // Fast-attack / smooth-release studio noise gate (dead-silent high-gain stops!)
                float ax = MathF.Abs(x);
                gateEnv += (ax > gateEnv ? 0.16f : 0.00065f) * (ax - gateEnv);
                float gateGain = Math.Clamp((gateEnv - gateFloor) * gateInvSpan, 0f, 1f);
                gateGain *= gateGain;
                x *= gateGain;

                // Pre-drive bass-tightening high-pass (TS9 / Horizon tight chug filter)
                hpOut = x - hpIn + hpC * hpOut;
                hpIn = x;

                // Tube Stage 1: Warm asymmetric 12AX7 input triode
                float s = SoftTubeStage(hpOut * smoothG1, 0.84f);

                if (stages >= 2)
                {
                    // Interstage plate-load RC damper + coupling capacitor (prevents fizz & DC blocking)
                    interLp += interLpC * (s - interLp);
                    interHpOut = interLp - interHpIn + interHpC * interHpOut;
                    interHpIn = interLp;

                    // Tube Stage 2: Cold-clipper cathode-biased crunch stage (JCM800 / 5150 harmonic bite)
                    s = SoftTubeStage(interHpOut * g2, 0.68f);

                    if (stages >= 3)
                    {
                        // Tube Stage 3: Saturated EL34 / 6L6 power-amp compression & sustain
                        s = SoftTubeStage(s * g3, 0.92f);
                    }
                }

                float sat = s * mk;

                // Biquad 0: 4x12" Closed-back speaker cabinet 116 Hz chest thump
                float y0 = b00 * sat + z01;
                z01 = b01 * sat - a01 * y0 + z02;
                z02 = b02 * sat - a02 * y0;

                // Biquad 1: Interactive Tone/Bite upper-mid & presence voicing
                float y1 = b10 * y0 + z11;
                z11 = b11 * y0 - a11 * y1 + z12;
                z12 = b12 * y0 - a12 * y1;

                // Biquads 2 & 3: 4th-order (24 dB/oct) Celestion speaker cone roll-off
                float cab1 = b20 * y1 + z21;
                z21 = b21 * y1 - a21 * cab1 + z22;
                z22 = b22 * y1 - a22 * cab1;

                float cab = b20 * cab1 + z31;
                z31 = b21 * cab1 - a21 * cab + z32;
                z32 = b22 * cab1 - a22 * cab;

                float tapL = _roomDelayL[(rIdx - delaySamplesL) & DelayMask];
                float tapR = _roomDelayR[(rIdx - delaySamplesR) & DelayMask];
                lpL += 0.35f * (tapL - lpL);
                lpR += 0.35f * (tapR - lpR);

                _roomDelayL[rIdx] = cab + lpR * fb;
                _roomDelayR[rIdx] = cab + lpL * fb;
                rIdx = (rIdx + 1) & DelayMask;

                // Soft safety output ceiling so 100% Gain + 100% Master hits loud without harsh digital clipping
                outL[i] = SoftMasterLimit((cab + lpL * wet) * smoothMaster);
                outR[i] = SoftMasterLimit((cab + lpR * wet) * smoothMaster);
            }

            _gateEnv = gateEnv;
            _hpPrevIn = hpIn; _hpPrevOut = hpOut;
            _interLp = interLp; _interHpIn = interHpIn; _interHpOut = interHpOut;
            _smoothStage1 = smoothG1; _smoothMaster = smoothMaster;
            _z01 = z01; _z02 = z02;
            _z11 = z11; _z12 = z12;
            _z21 = z21; _z22 = z22;
            _z31 = z31; _z32 = z32;
            _lpRoomL = lpL; _lpRoomR = lpR; _roomIdx = rIdx;
        }
        else
        {
            new Span<float>(outL, frames).Clear();
            new Span<float>(outR, frames).Clear();
        }

        // 4. Mix sample-accurate Drum Groove & Guide/Preview Guitar Synth voices
        float srInv = (float)(1.0 / _sampleRate);
        float mixVol = _masterMixVol;
        for (int v = 0; v < MaxVoices; v++)
        {
            if (_voices[v].Kind == SynthVoiceKind.None) continue;
            RenderVoice(ref _voices[v], outL, outR, frames, srInv, mixVol);
        }

        _totalSamplesProcessed += frames;
    }

    private void SpawnVoice(in ScheduledVoiceEvent ev)
    {
        int slot = 0;
        int oldestAge = -1;
        for (int i = 0; i < MaxVoices; i++)
        {
            if (_voices[i].Kind == SynthVoiceKind.None)
            {
                slot = i;
                break;
            }
            if (_voices[i].AgeSamples > oldestAge)
            {
                oldestAge = _voices[i].AgeSamples;
                slot = i;
            }
        }

        float sr = (float)_sampleRate;
        int totalSamples = ev.Kind switch
        {
            SynthVoiceKind.Kick => (int)(0.21f * sr),
            SynthVoiceKind.Snare => (int)(0.14f * sr),
            SynthVoiceKind.HiHatClosed => (int)(0.045f * sr),
            SynthVoiceKind.HiHatOpen => (int)(0.16f * sr),
            SynthVoiceKind.Click or SynthVoiceKind.ClickAccent => (int)(0.04f * sr),
            SynthVoiceKind.Guitar => Math.Max((int)(0.12f * sr), (int)(ev.DurationSec * sr)),
            _ => 0,
        };

        _voices[slot] = new ActiveVoice
        {
            Kind = ev.Kind,
            CountdownSamples = Math.Max(0, ev.DelaySamples),
            AgeSamples = 0,
            TotalSamples = totalSamples,
            FreqHz = ev.SlideIn != 0 ? ev.FrequencyHz * 0.8908987f : ev.FrequencyHz,
            TargetFreqHz = ev.FrequencyHz,
            Phase1 = 0f,
            Phase2 = 0f,
            Velocity = ev.Velocity,
            FilterState1 = 0f,
            FilterState2 = 0f,
            SlideIn = ev.SlideIn,
            Vibrato = ev.Vibrato,
        };
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private float NextNoise()
    {
        _rngState = 1664525u * _rngState + 1013904223u;
        return (_rngState * (1.0f / 2147483648.0f)) - 1.0f;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void RenderVoice(ref ActiveVoice v, float* outL, float* outR, int frames, float srInv, float mixVol)
    {
        for (int i = 0; i < frames; i++)
        {
            if (v.CountdownSamples > 0)
            {
                v.CountdownSamples--;
                continue;
            }

            if (v.AgeSamples >= v.TotalSamples)
            {
                v.Kind = SynthVoiceKind.None;
                return;
            }

            float t = v.AgeSamples * srInv;
            v.AgeSamples++;
            float sample = 0f;

            switch (v.Kind)
            {
                case SynthVoiceKind.Kick:
                {
                    float freq = 42f + 115f * MathF.Exp(-t * 36f);
                    v.Phase1 += freq * srInv;
                    if (v.Phase1 >= 1f) v.Phase1 -= 1f;
                    float env = MathF.Exp(-t * 17f) * v.Velocity * 0.62f;
                    float click = t < 0.010f ? NextNoise() * (1f - t * 100f) * 0.14f * v.Velocity : 0f;
                    sample = MathF.Sin(v.Phase1 * MathF.Tau) * env + click;
                    break;
                }
                case SynthVoiceKind.Snare:
                {
                    float freq = 112f + 78f * MathF.Exp(-t * 42f);
                    v.Phase1 += freq * srInv;
                    if (v.Phase1 >= 1f) v.Phase1 -= 1f;
                    float body = MathF.Sin(v.Phase1 * MathF.Tau) * MathF.Exp(-t * 34f) * 0.24f;
                    float n = NextNoise();
                    v.FilterState1 += 0.35f * (n - v.FilterState1);
                    float hpNoise = (n - v.FilterState1) * MathF.Exp(-t * 24f) * 0.34f;
                    sample = (body + hpNoise) * v.Velocity;
                    break;
                }
                case SynthVoiceKind.HiHatClosed:
                case SynthVoiceKind.HiHatOpen:
                {
                    float decayRate = v.Kind == SynthVoiceKind.HiHatOpen ? 20f : 68f;
                    float n = NextNoise();
                    v.FilterState1 += 0.68f * (n - v.FilterState1);
                    sample = (n - v.FilterState1) * MathF.Exp(-t * decayRate) * 0.25f * v.Velocity;
                    break;
                }
                case SynthVoiceKind.Click:
                case SynthVoiceKind.ClickAccent:
                {
                    float baseHz = v.Kind == SynthVoiceKind.ClickAccent ? 1320f : 940f;
                    v.Phase1 += baseHz * srInv;
                    if (v.Phase1 >= 1f) v.Phase1 -= 1f;
                    float amp = v.Kind == SynthVoiceKind.ClickAccent ? 0.34f : 0.22f;
                    sample = MathF.Sin(v.Phase1 * MathF.Tau) * MathF.Exp(-t * 85f) * amp;
                    break;
                }
                case SynthVoiceKind.Guitar:
                {
                    if (v.SlideIn != 0)
                    {
                        v.FreqHz += (v.TargetFreqHz - v.FreqHz) * 0.0035f;
                    }
                    float vibratoMod = (v.Vibrato != 0 && t > 0.18f)
                        ? 1.0f + 0.006f * MathF.Sin(t * MathF.Tau * 5.4f)
                        : 1.0f;
                    float f = v.FreqHz * vibratoMod;

                    v.Phase1 += f * 0.998f * srInv;
                    if (v.Phase1 >= 1f) v.Phase1 -= 1f;
                    v.Phase2 += f * 1.002f * srInv;
                    if (v.Phase2 >= 1f) v.Phase2 -= 1f;

                    float saw = 2f * v.Phase1 - 1f;
                    float tri = 1f - 4f * MathF.Abs(v.Phase2 - 0.5f);
                    float raw = saw * 0.45f + tri * 0.65f;

                    // Dynamic pluck lowpass filter
                    float lpAlpha = Math.Clamp(0.08f + 0.42f * MathF.Exp(-t * 12f), 0.06f, 0.55f);
                    v.FilterState1 += lpAlpha * (raw - v.FilterState1);

                    float attack = Math.Min(1f, t * 140f);
                    float remSec = (v.TotalSamples - v.AgeSamples) * srInv;
                    float release = Math.Min(1f, remSec * 45f);
                    float decay = 0.38f + 0.62f * MathF.Exp(-t * 3.8f);
                    sample = v.FilterState1 * attack * decay * release * 0.24f * v.Velocity;
                    break;
                }
            }

            float scaled = sample * mixVol;
            outL[i] += scaled;
            outR[i] += scaled;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float SoftTubeStage(float u, float negAsymmetry)
    {
        if (u < 0f) u *= negAsymmetry;
        if (u >= 3.0f) return 1.0f;
        if (u <= -3.0f) return -1.0f;
        float u2 = u * u;
        return (u * (27f + u2)) / (27f + 9f * u2);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float SoftMasterLimit(float x)
    {
        if (x >= 2.8f) return 0.96f;
        if (x <= -2.8f) return -0.96f;
        float x2 = x * x;
        return 0.96f * (x * (27f + x2)) / (27f + 9f * x2);
    }

    private static void ComputePeakingBiquad(
        float freqHz, float q, float gainDb, float sr,
        out float b0, out float b1, out float b2, out float a1, out float a2)
    {
        float A = MathF.Pow(10f, gainDb / 40f);
        float w0 = MathF.Tau * freqHz / sr;
        float cosW = MathF.Cos(w0);
        float alpha = MathF.Sin(w0) / (2f * q);
        float a0 = 1f + alpha / A;
        b0 = (1f + alpha * A) / a0;
        b1 = (-2f * cosW) / a0;
        b2 = (1f - alpha * A) / a0;
        a1 = (-2f * cosW) / a0;
        a2 = (1f - alpha / A) / a0;
    }

    private static void ComputeLowpassBiquad(
        float cutoffHz, float q, float sr,
        out float b0, out float b1, out float b2, out float a1, out float a2)
    {
        float w0 = MathF.Tau * cutoffHz / sr;
        float cosW = MathF.Cos(w0);
        float alpha = MathF.Sin(w0) / (2f * q);
        float a0 = 1f + alpha;
        b0 = ((1f - cosW) * 0.5f) / a0;
        b1 = (1f - cosW) / a0;
        b2 = ((1f - cosW) * 0.5f) / a0;
        a1 = (-2f * cosW) / a0;
        a2 = (1f - alpha) / a0;
    }

    public void Dispose()
    {
        NativeMemory.Free(ScratchIn0);
        NativeMemory.Free(ScratchIn1);
        NativeMemory.Free(ScratchOutL);
        NativeMemory.Free(ScratchOutR);
        NativeMemory.Free(_dryRing);
        NativeMemory.Free(_roomDelayL);
        NativeMemory.Free(_roomDelayR);
        NativeMemory.Free(_eventQueue);
        NativeMemory.Free(_voices);
    }
}
