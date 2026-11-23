import { AUDIO } from '../config/staff.ts';
import {
  frequencyToMidi,
  frequencyToNoteString,
  midiToFrequency,
  noteLabelToMidi,
} from '../utils/noteFromFrequency.ts';

export interface SmootherConfig {
  windowFrames?: number;
  jumpResetSemitones?: number;
  minConfidence?: number;
  pitchHoldMs?: number;
  /** Hysteresis deadband in semitones (> 0.5) preventing ±50c label boundary flicker. */
  labelHysteresisSemitones?: number;
}

export interface SmoothedPitchState {
  smoothedHz: number | null;
  smoothedMidi: number | null;
  label: string | null;
  centsOffset: number | null;
  jumped: boolean;
}

export function medianOf(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return NaN;
  if (n === 1) return values[0];
  if (n === 2) return 0.5 * (values[0] + values[1]);
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/**
 * Smooths detected pitch in logarithmic MIDI semitone space using a short median filter
 * and resets immediately (after 1 confirmation frame to reject single-frame glitches)
 * whenever pitch steps by more than `jumpResetSemitones`.
 */
export class SemitoneMedianSmoother {
  private readonly windowFrames: number;
  private readonly jumpResetSemitones: number;
  private readonly minConfidence: number;
  private readonly pitchHoldMs: number;
  private readonly labelHysteresisSemitones: number;

  private window: number[] = [];
  private lastSmoothedMidi: number | null = null;
  private lastGoodAtMs = -Infinity;
  private pendingJumpMidi: number | null = null;
  private stableLabel: string | null = null;

  constructor(config: SmootherConfig = {}) {
    this.windowFrames = config.windowFrames ?? AUDIO.medianWindowFrames;
    this.jumpResetSemitones = config.jumpResetSemitones ?? AUDIO.jumpResetSemitones;
    this.minConfidence = config.minConfidence ?? AUDIO.minConfidence;
    this.pitchHoldMs = config.pitchHoldMs ?? AUDIO.pitchHoldMs;
    this.labelHysteresisSemitones = config.labelHysteresisSemitones ?? 0.58;
  }

  update(rawHz: number | null, confidence: number, nowMs: number): SmoothedPitchState {
    const valid =
      rawHz != null &&
      Number.isFinite(rawHz) &&
      rawHz > 0 &&
      confidence >= this.minConfidence;

    if (!valid) {
      if (this.lastSmoothedMidi != null && nowMs - this.lastGoodAtMs <= this.pitchHoldMs) {
        const heldHz = midiToFrequency(this.lastSmoothedMidi);
        const nearestMidi = Math.round(this.lastSmoothedMidi);
        return {
          smoothedHz: heldHz,
          smoothedMidi: this.lastSmoothedMidi,
          label: this.stableLabel,
          centsOffset: (this.lastSmoothedMidi - nearestMidi) * 100,
          jumped: false,
        };
      }
      this.reset();
      return {
        smoothedHz: null,
        smoothedMidi: null,
        label: null,
        centsOffset: null,
        jumped: false,
      };
    }

    const rawMidi = frequencyToMidi(rawHz);
    if (Number.isNaN(rawMidi)) {
      return {
        smoothedHz: null,
        smoothedMidi: null,
        label: null,
        centsOffset: null,
        jumped: false,
      };
    }

    this.lastGoodAtMs = nowMs;
    let jumped = false;

    if (
      this.lastSmoothedMidi != null &&
      Math.abs(rawMidi - this.lastSmoothedMidi) > this.jumpResetSemitones
    ) {
      if (
        this.pendingJumpMidi != null &&
        Math.abs(rawMidi - this.pendingJumpMidi) <= 0.6
      ) {
        // Confirmed real note change — wipe old note history so there is zero glissando lag!
        this.window = [this.pendingJumpMidi, rawMidi];
        if (this.window.length > this.windowFrames) {
          this.window = this.window.slice(-this.windowFrames);
        }
        this.pendingJumpMidi = null;
        jumped = true;
      } else {
        // Guard against a 1-frame pitch glitch: hold current note for 1 frame while waiting to confirm.
        this.pendingJumpMidi = rawMidi;
        const heldHz = midiToFrequency(this.lastSmoothedMidi);
        const nearestMidi = Math.round(this.lastSmoothedMidi);
        return {
          smoothedHz: heldHz,
          smoothedMidi: this.lastSmoothedMidi,
          label: this.stableLabel,
          centsOffset: (this.lastSmoothedMidi - nearestMidi) * 100,
          jumped: false,
        };
      }
    } else {
      this.pendingJumpMidi = null;
      this.window.push(rawMidi);
      if (this.window.length > this.windowFrames) {
        this.window.shift();
      }
    }

    const smoothedMidi = medianOf(this.window);
    const smoothedHz = midiToFrequency(smoothedMidi);
    this.lastSmoothedMidi = smoothedMidi;

    const prevLabelMidi =
      this.stableLabel != null ? noteLabelToMidi(this.stableLabel) : null;
    if (
      prevLabelMidi == null ||
      Math.abs(smoothedMidi - prevLabelMidi) > this.labelHysteresisSemitones
    ) {
      this.stableLabel = frequencyToNoteString(smoothedHz);
    }

    const refMidi =
      this.stableLabel != null
        ? (noteLabelToMidi(this.stableLabel) ?? Math.round(smoothedMidi))
        : Math.round(smoothedMidi);

    return {
      smoothedHz,
      smoothedMidi,
      label: this.stableLabel,
      centsOffset: (smoothedMidi - refMidi) * 100,
      jumped,
    };
  }

  reset(): void {
    this.window = [];
    this.lastSmoothedMidi = null;
    this.lastGoodAtMs = -Infinity;
    this.pendingJumpMidi = null;
    this.stableLabel = null;
  }
}
