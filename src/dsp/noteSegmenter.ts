import { midiToFrequency, midiToNoteLabel } from '../utils/noteFromFrequency.ts';
import { medianOf } from './pitchSmoother.ts';
import type { OnsetCandidate } from './onsetDetector.ts';
import type { NoteEvent } from './types.ts';

export interface NoteSegmenterOptions {
  rmsThreshold?: number;
  /** Skip pick-attack pitch chaos for picked notes (ms). */
  pickedAttackSkipMs?: number;
  /** Skip brief transition for legato notes (ms). */
  legatoAttackSkipMs?: number;
  /** Silence hold duration before closing an active note (ms). */
  releaseHoldMs?: number;
  /** Minimum total duration for a valid NoteEvent (ms). */
  minNoteDurationMs?: number;
}

/**
 * Segments continuous pitch + onset stream into discrete `NoteEvent`s:
 * `onset -> skip attack transient -> collect steady MIDI samples -> emit on release or next onset`.
 */
export class NoteSegmenter {
  private rmsThreshold: number;
  private readonly pickedAttackSkipMs: number;
  private readonly legatoAttackSkipMs: number;
  private readonly releaseHoldMs: number;
  private readonly minNoteDurationMs: number;

  private active = false;
  private onsetMs = 0;
  private isLegato = false;
  private attackEndMs = 0;
  private belowFloorSinceMs: number | null = null;
  private peakRms = 0;
  private midiSamples: number[] = [];
  private confSamples: number[] = [];
  private nextEventIndex = 1;

  constructor(options: NoteSegmenterOptions = {}) {
    this.rmsThreshold = options.rmsThreshold ?? 0.008;
    this.pickedAttackSkipMs = options.pickedAttackSkipMs ?? 28;
    this.legatoAttackSkipMs = options.legatoAttackSkipMs ?? 12;
    this.releaseHoldMs = options.releaseHoldMs ?? 40;
    this.minNoteDurationMs = options.minNoteDurationMs ?? 45;
  }

  setRmsThreshold(threshold: number): void {
    this.rmsThreshold = threshold;
  }

  getActiveMedianMidi(): number | null {
    if (!this.active || this.midiSamples.length < 2) return null;
    return medianOf(this.midiSamples);
  }

  step(
    timeMs: number,
    rms: number,
    smoothedMidi: number | null,
    confidence: number,
    onset: OnsetCandidate | null,
  ): NoteEvent[] {
    const emitted: NoteEvent[] = [];

    if (onset != null) {
      if (this.active) {
        const finalized = this.finalize(onset.timeMs);
        if (finalized) emitted.push(finalized);
      }
      this.startSegment(onset.timeMs, onset.isLegato, rms);
    } else if (
      !this.active &&
      rms >= this.rmsThreshold * 1.5 &&
      smoothedMidi != null &&
      confidence >= 0.72
    ) {
      // Catch soft fade-in notes that gradually rose above threshold without a sharp flux spike.
      this.startSegment(timeMs, true, rms);
    }

    if (!this.active) return emitted;

    if (rms > this.peakRms) this.peakRms = rms;

    if (rms < this.rmsThreshold * 0.8) {
      if (this.belowFloorSinceMs == null) {
        this.belowFloorSinceMs = timeMs;
      } else if (timeMs - this.belowFloorSinceMs >= this.releaseHoldMs) {
        const finalized = this.finalize(this.belowFloorSinceMs);
        if (finalized) emitted.push(finalized);
        return emitted;
      }
    } else {
      this.belowFloorSinceMs = null;
      if (timeMs >= this.attackEndMs && smoothedMidi != null && Number.isFinite(smoothedMidi)) {
        this.midiSamples.push(smoothedMidi);
        this.confSamples.push(confidence);
      }
    }

    return emitted;
  }

  flush(endTimeMs: number): NoteEvent | null {
    if (!this.active) return null;
    return this.finalize(endTimeMs);
  }

  reset(): void {
    this.active = false;
    this.midiSamples = [];
    this.confSamples = [];
    this.belowFloorSinceMs = null;
    this.peakRms = 0;
  }

  private startSegment(timeMs: number, isLegato: boolean, initialRms: number): void {
    this.active = true;
    this.onsetMs = timeMs;
    this.isLegato = isLegato;
    this.attackEndMs =
      timeMs + (isLegato ? this.legatoAttackSkipMs : this.pickedAttackSkipMs);
    this.belowFloorSinceMs = null;
    this.peakRms = initialRms;
    this.midiSamples = [];
    this.confSamples = [];
  }

  private finalize(endTimeMs: number): NoteEvent | null {
    this.active = false;
    const durationMs = endTimeMs - this.onsetMs;
    if (durationMs < this.minNoteDurationMs || this.midiSamples.length < 2) {
      this.midiSamples = [];
      this.confSamples = [];
      return null;
    }

    const medianContinuousMidi = medianOf(this.midiSamples);
    const midi = Math.round(medianContinuousMidi);
    const label = midiToNoteLabel(midi);
    if (!label) return null;

    const pitchCents = (medianContinuousMidi - midi) * 100;
    const medianHz = midiToFrequency(medianContinuousMidi);
    const meanConfidence =
      this.confSamples.reduce((acc, c) => acc + c, 0) / this.confSamples.length;
    const velocity = Math.min(1, Math.max(0.05, this.peakRms / 0.25));

    const event: NoteEvent = {
      id: `ne-${this.nextEventIndex++}`,
      onsetMs: this.onsetMs,
      durationMs,
      midi,
      medianHz,
      pitchCents,
      label,
      velocity,
      confidence: meanConfidence,
      isLegato: this.isLegato,
    };

    this.midiSamples = [];
    this.confSamples = [];
    return event;
  }
}
