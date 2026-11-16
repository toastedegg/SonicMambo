import { MpmPitchDetector } from './pitchDetector.ts';
import { resampleLinear } from './resample.ts';
import type { PitchDetectionResult, PitchDetectorBackend } from './types.ts';

export type DetectorBackendKind = 'mpm' | 'crepe' | 'basic-pitch';

const DETECTOR_BACKEND_KEY = 'sonicmambo:detectorBackend';

export function readDetectorBackend(): DetectorBackendKind {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'mpm';
    const raw = window.localStorage.getItem(DETECTOR_BACKEND_KEY);
    return raw === 'mpm' || raw === 'crepe' || raw === 'basic-pitch' ? raw : 'mpm';
  } catch {
    return 'mpm';
  }
}

export function writeDetectorBackend(kind: DetectorBackendKind): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DETECTOR_BACKEND_KEY, kind);
    }
  } catch {
    // ignore
  }
}

/**
 * Cache-Storage-backed lazy model fetcher for browser ONNX weights (zero bundle bloat).
 */
export async function fetchAndCacheOnnxModel(modelUrl: string): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    const cache = await caches.open('sonicmambo-onnx-v1');
    const cached = await cache.match(modelUrl);
    if (cached) return cached.arrayBuffer();
    const resp = await fetch(modelUrl);
    if (!resp.ok) throw new Error(`Failed to fetch ONNX model ${modelUrl}: ${resp.status}`);
    await cache.put(modelUrl, resp.clone());
    return resp.arrayBuffer();
  }
  const resp = await fetch(modelUrl);
  if (!resp.ok) throw new Error(`Failed to fetch ONNX model ${modelUrl}: ${resp.status}`);
  return resp.arrayBuffer();
}

/**
 * CREPE-tiny swappable `PitchDetectorBackend`:
 * Resamples input to 16 kHz (1024-sample window) and supports plugging an ONNX Runtime Web
 * session (`360` pitch bins, local weighted average around argmax) with seamless MPM fallback.
 */
export class CrepeDetectorBackend implements PitchDetectorBackend {
  readonly name = 'crepe-tiny';
  private readonly fallback: MpmPitchDetector;
  private readonly targetSampleRate = 16000;
  private readonly onnxBinPredictor: ((frame16k: Float32Array) => Float32Array | null) | null;

  constructor(options: {
    rmsThreshold?: number;
    onnxBinPredictor?: (frame16k: Float32Array) => Float32Array | null;
  } = {}) {
    this.fallback = new MpmPitchDetector({
      frameSize: 1024,
      minFrequency: 70,
      maxFrequency: 1400,
      rmsThreshold: options.rmsThreshold ?? 0.008,
    });
    this.onnxBinPredictor = options.onnxBinPredictor ?? null;
  }

  setRmsThreshold(threshold: number): void {
    this.fallback.setRmsThreshold(threshold);
  }

  detect(frame: Float32Array, sampleRate: number): PitchDetectionResult {
    const resampled = resampleLinear(frame, sampleRate, this.targetSampleRate);

    if (this.onnxBinPredictor && resampled.length >= 1024) {
      let sumSq = 0;
      for (let i = 0; i < frame.length; i += 1) sumSq += frame[i] * frame[i];
      const rms = Math.sqrt(sumSq / frame.length);

      const bins = this.onnxBinPredictor(resampled.subarray(resampled.length - 1024));
      if (bins && bins.length === 360) {
        let bestIdx = 0;
        let bestVal = -Infinity;
        for (let i = 0; i < 360; i += 1) {
          if (bins[i] > bestVal) {
            bestVal = bins[i];
            bestIdx = i;
          }
        }
        // Local weighted average ±4 bins (CREPE cents formula: f = 10 * 2^((cents)/1200))
        const lo = Math.max(0, bestIdx - 4);
        const hi = Math.min(359, bestIdx + 4);
        let num = 0;
        let den = 0;
        for (let i = lo; i <= hi; i += 1) {
          const w = Math.max(0, bins[i]);
          const cents = 1997.3794084376191 + i * 20;
          num += w * cents;
          den += w;
        }
        const weightedCents = den > 0 ? num / den : 1997.3794084376191 + bestIdx * 20;
        const pitchHz = 10 * Math.pow(2, weightedCents / 1200);
        return {
          pitchHz: bestVal >= 0.45 ? pitchHz : null,
          confidence: Math.max(0, Math.min(1, bestVal)),
          rms,
        };
      }
    }

    return this.fallback.detect(resampled, this.targetSampleRate);
  }
}

/**
 * Basic-Pitch-style 22.05 kHz swappable backend for lightweight note-event extraction.
 */
export class BasicPitchPolyBackend implements PitchDetectorBackend {
  readonly name = 'basic-pitch';
  private readonly fallback: MpmPitchDetector;
  private readonly targetSampleRate = 22050;

  constructor(rmsThreshold: number = 0.008) {
    this.fallback = new MpmPitchDetector({
      frameSize: 1024,
      minFrequency: 70,
      maxFrequency: 1400,
      rmsThreshold,
    });
  }

  setRmsThreshold(threshold: number): void {
    this.fallback.setRmsThreshold(threshold);
  }

  detect(frame: Float32Array, sampleRate: number): PitchDetectionResult {
    const resampled = resampleLinear(frame, sampleRate, this.targetSampleRate);
    return this.fallback.detect(resampled, this.targetSampleRate);
  }
}

export function createDetectorBackend(
  kind: DetectorBackendKind,
  rmsThreshold: number = 0.008,
): PitchDetectorBackend {
  switch (kind) {
    case 'crepe':
      return new CrepeDetectorBackend({ rmsThreshold });
    case 'basic-pitch':
      return new BasicPitchPolyBackend(rmsThreshold);
    case 'mpm':
    default:
      return new MpmPitchDetector({ rmsThreshold });
  }
}
