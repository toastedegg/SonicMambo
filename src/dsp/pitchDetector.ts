import { Autocorrelator } from 'pitchy';
import type { PitchDetectionResult, PitchDetectorBackend } from './types.ts';

export interface MpmDetectorOptions {
  frameSize?: number;
  minFrequency?: number;
  maxFrequency?: number;
  rmsThreshold?: number;
  /** MPM peak-picking constant k in (0.80..0.96). Higher prefers shorter lag / higher fundamental. */
  clarityThreshold?: number;
  /** Minimum NSDF clarity (0..1) to report a valid pitch. */
  minConfidence?: number;
}

/**
 * Compute single-bin spectral magnitude at `targetHz` on an already-windowed frame
 * via Goertzel's algorithm (pure multiply-add loop, zero trig inside the loop, zero allocations).
 */
export function goertzelWindowedMagnitude(
  windowedFrame: Float32Array,
  targetHz: number,
  sampleRate: number,
): number {
  const n = windowedFrame.length;
  if (n < 4 || targetHz <= 0 || targetHz >= sampleRate * 0.48) return 0;

  const omega = (2 * Math.PI * targetHz) / sampleRate;
  const coeff = 2 * Math.cos(omega);

  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i += 1) {
    const s0 = windowedFrame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power > 0 ? Math.sqrt(power) / n : 0;
}

/**
 * Convenience wrapper applying a Hann window for standalone callers/tests.
 */
export function goertzelMagnitude(
  frame: Float32Array,
  targetHz: number,
  sampleRate: number,
): number {
  const n = frame.length;
  if (n < 4 || targetHz <= 0 || targetHz >= sampleRate * 0.48) return 0;
  const twoPiOverN = (2 * Math.PI) / (n - 1);
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    windowed[i] = (0.5 - 0.5 * Math.cos(twoPiOverN * i)) * frame[i];
  }
  return goertzelWindowedMagnitude(windowed, targetHz, sampleRate);
}

/**
 * Guitar-tuned Lag-Bounded McLeod Pitch Method (MPM) detector with multi-harmonic
 * spectral verification.
 *
 * Why lag-bounded MPM + Goertzel verification beats stock YIN / stock pitchy on guitar:
 * 1. Bounding NSDF search to `[sampleRate/maxFreq .. sampleRate/minFreq]` prevents
 *    near-frame-end low-overlap spikes (~20–30 Hz) from inflating `nMax`.
 * 2. Checking integer multiples `m = 2..8` via Goertzel eliminates 1/2, 1/3, 1/4, 1/5
 *    missing-fundamental subharmonic drops caused by adjacent-string ringover.
 * 3. Checking `f/2` + `1.5f` catches 2nd-harmonic octave slips on wound bass strings (E2/A2).
 */
export class MpmPitchDetector implements PitchDetectorBackend {
  readonly name = 'mpm-harmonic';

  private frameSize: number;
  private autocorrelator: Autocorrelator<Float32Array>;
  private fastAutocorrelator: Autocorrelator<Float32Array>;
  private nsdfBuffer: Float32Array;
  private fastNsdfBuffer: Float32Array;
  private hannWeights: Float32Array;
  private fastHannWeights: Float32Array;
  private windowedFrame: Float32Array;
  private fastWindowedFrame: Float32Array;
  private readonly minFrequency: number;
  private readonly maxFrequency: number;
  private rmsThreshold: number;
  private readonly clarityThreshold: number;
  private readonly minConfidence: number;
  private readonly harmonicAmps = new Float32Array(9);

  constructor(options: MpmDetectorOptions = {}) {
    this.frameSize = options.frameSize ?? 2048;
    const fastSize = Math.max(512, this.frameSize >> 1);
    this.minFrequency = options.minFrequency ?? 70;
    this.maxFrequency = options.maxFrequency ?? 1400;
    this.rmsThreshold = options.rmsThreshold ?? 0.008;
    this.clarityThreshold = options.clarityThreshold ?? 0.88;
    this.minConfidence = options.minConfidence ?? 0.58;
    this.autocorrelator = Autocorrelator.forFloat32Array(this.frameSize);
    this.fastAutocorrelator = Autocorrelator.forFloat32Array(fastSize);
    this.nsdfBuffer = new Float32Array(this.frameSize);
    this.fastNsdfBuffer = new Float32Array(fastSize);
    this.hannWeights = buildHannWeights(this.frameSize);
    this.fastHannWeights = buildHannWeights(fastSize);
    this.windowedFrame = new Float32Array(this.frameSize);
    this.fastWindowedFrame = new Float32Array(fastSize);
  }

  setRmsThreshold(threshold: number): void {
    this.rmsThreshold = threshold;
  }

  private ensureFrameSize(length: number): void {
    if (length === this.frameSize) return;
    this.frameSize = length;
    const fastSize = Math.max(512, length >> 1);
    this.autocorrelator = Autocorrelator.forFloat32Array(length);
    this.fastAutocorrelator = Autocorrelator.forFloat32Array(fastSize);
    this.nsdfBuffer = new Float32Array(length);
    this.fastNsdfBuffer = new Float32Array(fastSize);
    this.hannWeights = buildHannWeights(length);
    this.fastHannWeights = buildHannWeights(fastSize);
    this.windowedFrame = new Float32Array(length);
    this.fastWindowedFrame = new Float32Array(fastSize);
  }

  detect(frame: Float32Array, sampleRate: number): PitchDetectionResult {
    const n = frame.length;
    if (n < 64 || sampleRate <= 0) {
      return { pitchHz: null, confidence: 0, rms: 0 };
    }

    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      sumSq += frame[i] * frame[i];
    }
    const rms = Math.sqrt(sumSq / n);
    if (rms < this.rmsThreshold) {
      return { pitchHz: null, confidence: 0, rms };
    }

    this.ensureFrameSize(n);

    // 1. Full-frame detection (covers 70..1400 Hz including low E2/A2/D3 strings).
    const full = this.runMpmOnWindow(
      frame,
      sampleRate,
      this.minFrequency,
      this.maxFrequency,
      this.autocorrelator,
      this.nsdfBuffer,
      this.hannWeights,
      this.windowedFrame,
    );

    // 2. Fast half-window (center N/2 = 23 ms) check ONLY for high-pitch (>= 220 Hz) transitions:
    // Never run the >=200 Hz half-window when the full 2048-sample frame already found a bass
    // fundamental (< 220 Hz), otherwise the half-window's 200 Hz floor would lock onto 2*f0!
    const halfLen = n >> 1;
    if (
      halfLen >= 512 &&
      (full.pitchHz == null || (full.pitchHz >= 220 && full.confidence < 0.84))
    ) {
      const recentStart = n >> 2;
      const subFrame = frame.subarray(recentStart, recentStart + halfLen);
      const fast = this.runMpmOnWindow(
        subFrame,
        sampleRate,
        Math.max(220, this.minFrequency),
        this.maxFrequency,
        this.fastAutocorrelator,
        this.fastNsdfBuffer,
        this.fastHannWeights,
        this.fastWindowedFrame,
      );
      if (
        fast.pitchHz != null &&
        fast.confidence >= 0.80 &&
        (full.pitchHz == null || fast.confidence > full.confidence + 0.05)
      ) {
        // Guard against 2nd-harmonic promotion of a true bass note (< 220 Hz) during full-frame dip:
        const subHalfHz = fast.pitchHz * 0.5;
        let isBassSecondHarmonic = false;
        if (subHalfHz >= this.minFrequency && subHalfHz < 220) {
          for (let i = 0; i < n; i += 1) {
            this.windowedFrame[i] = frame[i] * this.hannWeights[i];
          }
          const aSub = goertzelWindowedMagnitude(this.windowedFrame, subHalfHz, sampleRate);
          const aFast = goertzelWindowedMagnitude(this.windowedFrame, fast.pitchHz, sampleRate);
          if (aSub > 0.35 * aFast) {
            isBassSecondHarmonic = true;
          }
        }
        if (!isBassSecondHarmonic) {
          return { pitchHz: fast.pitchHz, confidence: fast.confidence, rms };
        }
      }
    }

    return { pitchHz: full.pitchHz, confidence: full.confidence, rms };
  }

  private runMpmOnWindow(
    frame: Float32Array,
    sampleRate: number,
    minFreq: number,
    maxFreq: number,
    autocorrelator: Autocorrelator<Float32Array>,
    nsdf: Float32Array,
    hannWeights: Float32Array,
    windowedBuf: Float32Array,
  ): { pitchHz: number | null; confidence: number } {
    const n = frame.length;
    autocorrelator.autocorrelate(frame, nsdf);

    const maxLag = Math.min(Math.ceil(sampleRate / minFreq), n - 3);
    const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
    if (minLag >= maxLag) {
      return { pitchHz: null, confidence: 0 };
    }

    let m = 2 * nsdf[0];
    let tau = 0;
    for (; tau <= maxLag + 1 && m > 0; tau += 1) {
      nsdf[tau] = (2 * nsdf[tau]) / m;
      const tail = n - 1 - tau;
      m -= frame[tau] * frame[tau] + frame[tail] * frame[tail];
    }
    for (; tau <= maxLag + 1; tau += 1) {
      nsdf[tau] = 0;
    }

    let startLag = 1;
    while (startLag < maxLag && nsdf[startLag] > 0) {
      startLag += 1;
    }
    if (startLag < minLag) startLag = minLag;

    const peakIndices: number[] = [];
    let inPositiveLobe = false;
    let bestIdx = -1;
    let bestVal = -Infinity;

    for (let i = startLag; i <= maxLag; i += 1) {
      const val = nsdf[i];
      if (val > 0) {
        if (!inPositiveLobe) {
          inPositiveLobe = true;
          bestIdx = i;
          bestVal = val;
        } else if (val > bestVal) {
          bestVal = val;
          bestIdx = i;
        }
      } else if (inPositiveLobe) {
        inPositiveLobe = false;
        if (bestIdx >= minLag) peakIndices.push(bestIdx);
      }
    }
    if (inPositiveLobe && bestIdx >= minLag) {
      peakIndices.push(bestIdx);
    }

    if (peakIndices.length === 0) {
      return { pitchHz: null, confidence: 0 };
    }

    let nMax = 0;
    for (let i = 0; i < peakIndices.length; i += 1) {
      const v = nsdf[peakIndices[i]];
      if (v > nMax) nMax = v;
    }
    if (nMax < this.minConfidence) {
      return { pitchHz: null, confidence: Math.max(0, nMax) };
    }

    const threshold = this.clarityThreshold * nMax;
    let chosenIdx = peakIndices[0];
    for (let i = 0; i < peakIndices.length; i += 1) {
      const idx = peakIndices[i];
      if (nsdf[idx] >= threshold) {
        chosenIdx = idx;
        break;
      }
    }

    const y0 = nsdf[chosenIdx - 1];
    const y1 = nsdf[chosenIdx];
    const y2 = nsdf[chosenIdx + 1];
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? Math.max(-1, Math.min(1, (y0 - y2) / (2 * denom))) : 0;
    const refinedLag = chosenIdx + delta;
    const confidence = Math.min(1, Math.max(0, y1 - 0.25 * (y0 - y2) * delta));

    if (confidence < this.minConfidence || refinedLag <= 0) {
      return { pitchHz: null, confidence };
    }

    const rawHz = sampleRate / refinedLag;
    const pitchHz = this.verifyHarmonics(frame, rawHz, sampleRate, hannWeights, windowedBuf);

    if (pitchHz < minFreq || pitchHz > maxFreq) {
      return { pitchHz: null, confidence: 0 };
    }

    return { pitchHz, confidence };
  }

  private verifyHarmonics(
    frame: Float32Array,
    candidateHz: number,
    sampleRate: number,
    weights: Float32Array,
    win: Float32Array,
  ): number {
    const n = frame.length;
    for (let i = 0; i < n; i += 1) {
      win[i] = frame[i] * weights[i];
    }

    const amps = this.harmonicAmps;
    amps.fill(0);
    amps[1] = goertzelWindowedMagnitude(win, candidateHz, sampleRate);

    let maxHarmonicAmp = amps[1];
    for (let mult = 2; mult <= 8; mult += 1) {
      const freq = candidateHz * mult;
      if (freq > this.maxFrequency) break;
      const a = goertzelWindowedMagnitude(win, freq, sampleRate);
      amps[mult] = a;
      if (a > maxHarmonicAmp) maxHarmonicAmp = a;
    }

    // 1. Divisor-aware Subharmonic & Dyad Ringover Disambiguation (m in 2..8):
    // A lower multiple `d * f` can only generate `mult * f` as an overtone if `d` DIVIDES `mult`
    // (`mult % d === 0`). Coprime multiples (like `3 * f` vs `4 * f` when two adjacent 4th-tuned
    // guitar strings ring together!) are independent strings, so we pick the strongest valid fundamental!
    let bestMult = 1;
    let bestScore = 0;

    for (let mult = 2; mult <= 8; mult += 1) {
      const targetFreq = candidateHz * mult;
      if (targetFreq > this.maxFrequency) break;
      const am = amps[mult];
      if (am <= 0 || am < 0.35 * maxHarmonicAmp) continue;

      let maxDivisorSubAmp = amps[1];
      for (let d = 2; d < mult; d += 1) {
        if (mult % d === 0 && amps[d] > maxDivisorSubAmp) {
          maxDivisorSubAmp = amps[d];
        }
      }

      // Bridge-pickup bass string guard: if candidate `f` has real fundamental energy (>= 12%)
      // AND strong 3rd harmonic `3*f` (which `2*f` can NEVER produce as an overtone!), `f` is genuine!
      if (mult === 2 && amps[1] >= 0.12 * am && amps[3] >= 0.20 * am) {
        continue;
      }

      if (amps[1] < 0.23 * am && maxDivisorSubAmp < 0.25 * am) {
        const overtone =
          targetFreq * 2 <= sampleRate * 0.46
            ? goertzelWindowedMagnitude(win, targetFreq * 2, sampleRate)
            : 0;
        const score = am + 0.35 * overtone;
        if (score > bestScore) {
          bestScore = score;
          bestMult = mult;
        }
      }
    }

    if (bestMult > 1) {
      return candidateHz * bestMult;
    }

    // 2. Wound bass-string 2nd-harmonic slip check (f -> f / 2):
    const halfHz = candidateHz * 0.5;
    if (halfHz >= this.minFrequency && amps[1] > 0) {
      const aHalf = goertzelWindowedMagnitude(win, halfHz, sampleRate);
      const aThreeHalf = goertzelWindowedMagnitude(win, candidateHz * 1.5, sampleRate);
      if (aHalf > 0.42 * amps[1] && aThreeHalf > 0.20 * amps[1]) {
        return halfHz;
      }
    }

    return candidateHz;
  }
}

function buildHannWeights(length: number): Float32Array {
  const weights = new Float32Array(length);
  const denom = Math.max(1, length - 1);
  for (let i = 0; i < length; i += 1) {
    weights[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom);
  }
  return weights;
}
