// @ts-ignore - fft.js ships CJS without bundled TS declarations
import FFT from 'fft.js';
import { medianOf } from './pitchSmoother.ts';

export interface OnsetCandidate {
  timeMs: number;
  isLegato: boolean;
  flux: number;
  rms: number;
}

export interface OnsetDetectorOptions {
  frameSize?: number;
  rmsThreshold?: number;
  minInterOnsetMs?: number;
  fluxHistoryFrames?: number;
  fluxMultiplier?: number;
  fluxFloor?: number;
}

/**
 * Stateful log-spectral flux + RMS envelope + legato pitch-step onset detector.
 * Uses pure JS radix-4 FFT (`fft.js`) with pre-allocated typed arrays (zero per-frame GC).
 */
export class OnsetDetector {
  private readonly frameSize: number;
  private readonly fft: any;
  private readonly windowWeights: Float32Array;
  private readonly windowedInput: Float32Array;
  private readonly complexOut: Float32Array;
  private readonly prevLogMag: Float32Array;
  private hasPrevSpectrum = false;

  private rmsThreshold: number;
  private readonly minInterOnsetMs: number;
  private readonly fluxHistoryFrames: number;
  private readonly fluxMultiplier: number;
  private readonly fluxFloor: number;

  private fluxHistory: number[] = [];
  private prevRms = 0;
  private lastOnsetMs = -Infinity;

  constructor(options: OnsetDetectorOptions = {}) {
    this.frameSize = options.frameSize ?? 2048;
    this.rmsThreshold = options.rmsThreshold ?? 0.008;
    this.minInterOnsetMs = options.minInterOnsetMs ?? 65;
    this.fluxHistoryFrames = options.fluxHistoryFrames ?? 24;
    this.fluxMultiplier = options.fluxMultiplier ?? 1.9;
    this.fluxFloor = options.fluxFloor ?? 1.8;

    this.fft = new FFT(this.frameSize);
    this.windowWeights = new Float32Array(this.frameSize);
    for (let i = 0; i < this.frameSize; i += 1) {
      this.windowWeights[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.frameSize - 1));
    }
    this.windowedInput = new Float32Array(this.frameSize);
    this.complexOut = new Float32Array(this.frameSize * 2);
    this.prevLogMag = new Float32Array((this.frameSize >> 1) + 1);
  }

  setRmsThreshold(threshold: number): void {
    this.rmsThreshold = threshold;
  }

  processFrame(
    frame: Float32Array,
    rms: number,
    timeMs: number,
    smoothedMidi: number | null,
    activeSegmentMidi: number | null,
    confidence: number,
  ): OnsetCandidate | null {
    const n = Math.min(frame.length, this.frameSize);
    for (let i = 0; i < n; i += 1) {
      this.windowedInput[i] = frame[i] * this.windowWeights[i];
    }
    for (let i = n; i < this.frameSize; i += 1) {
      this.windowedInput[i] = 0;
    }

    this.fft.realTransform(this.complexOut, this.windowedInput);

    // Half-wave rectified log-compressed spectral flux over bins 1..N/2 (up to ~8 kHz).
    const numBins = Math.min((this.frameSize >> 1) + 1, 380);
    let flux = 0;
    const invN = 1 / this.frameSize;

    for (let k = 1; k < numBins; k += 1) {
      const re = this.complexOut[2 * k] * invN;
      const im = this.complexOut[2 * k + 1] * invN;
      const mag = Math.sqrt(re * re + im * im);
      const logMag = Math.log1p(25 * mag);
      if (this.hasPrevSpectrum) {
        const diff = logMag - this.prevLogMag[k];
        if (diff > 0) flux += diff;
      }
      this.prevLogMag[k] = logMag;
    }
    this.hasPrevSpectrum = true;

    let adaptiveThreshold = this.fluxFloor;
    if (this.fluxHistory.length >= 5) {
      const med = medianOf(this.fluxHistory);
      const absDevs = this.fluxHistory.map((v) => Math.abs(v - med));
      const mad = medianOf(absDevs);
      adaptiveThreshold = med + this.fluxMultiplier * Math.max(mad, 0.25) + this.fluxFloor;
    }

    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.fluxHistoryFrames) {
      this.fluxHistory.shift();
    }

    const sinceLastOnset = timeMs - this.lastOnsetMs;
    const prevRms = this.prevRms;
    this.prevRms = rms;

    if (sinceLastOnset < this.minInterOnsetMs || rms < this.rmsThreshold * 1.2) {
      return null;
    }

    // 1. Picked transient onset (spectral flux spike + positive energy rise or silence-to-sound attack)
    const fromSilence = prevRms < this.rmsThreshold * 0.9 && rms >= this.rmsThreshold * 1.4;
    const pickedTransient =
      flux > adaptiveThreshold && (rms > prevRms * 1.08 || fromSilence);

    if (pickedTransient) {
      this.lastOnsetMs = timeMs;
      return { timeMs, isLegato: false, flux, rms };
    }

    // 2. Legato hammer-on / pull-off / slide step onset (clean pitch step without strong pick transient)
    if (
      smoothedMidi != null &&
      activeSegmentMidi != null &&
      confidence >= 0.68 &&
      Math.abs(smoothedMidi - activeSegmentMidi) >= 0.85
    ) {
      this.lastOnsetMs = timeMs;
      return { timeMs, isLegato: true, flux, rms };
    }

    return null;
  }

  reset(): void {
    this.hasPrevSpectrum = false;
    this.prevLogMag.fill(0);
    this.fluxHistory = [];
    this.prevRms = 0;
    this.lastOnsetMs = -Infinity;
  }
}
