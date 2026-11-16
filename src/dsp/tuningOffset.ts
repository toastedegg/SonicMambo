import { medianOf } from './pitchSmoother.ts';

/**
 * Tracks a guitarist's global session tuning offset (e.g., guitar uniformly -10 cents flat)
 * so relative intonation is judged fairly without excusing genuinely out-of-tune notes.
 */
export class SessionTuningTracker {
  private readonly maxSamples: number;
  private readonly minSamplesToActivate: number;
  private readonly maxAbsSampleCents: number;
  private readonly maxCompensationCents: number;
  private samples: number[] = [];
  private lastRecordedMidi: number | null = null;

  constructor(options: {
    maxSamples?: number;
    minSamplesToActivate?: number;
    maxAbsSampleCents?: number;
    maxCompensationCents?: number;
  } = {}) {
    this.maxSamples = options.maxSamples ?? 30;
    this.minSamplesToActivate = options.minSamplesToActivate ?? 5;
    this.maxAbsSampleCents = options.maxAbsSampleCents ?? 35;
    this.maxCompensationCents = options.maxCompensationCents ?? 25;
  }

  observe(smoothedMidi: number | null, confidence: number): void {
    if (smoothedMidi == null || !Number.isFinite(smoothedMidi) || confidence < 0.75) {
      this.lastRecordedMidi = null;
      return;
    }
    const rounded = Math.round(smoothedMidi);
    if (rounded === this.lastRecordedMidi) return;

    const cents = (smoothedMidi - rounded) * 100;
    if (Math.abs(cents) <= this.maxAbsSampleCents) {
      this.lastRecordedMidi = rounded;
      this.samples.push(cents);
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }
    }
  }

  getOffsetCents(): number {
    if (this.samples.length < this.minSamplesToActivate) return 0;
    const med = medianOf(this.samples);
    return Math.max(-this.maxCompensationCents, Math.min(this.maxCompensationCents, med));
  }

  reset(): void {
    this.samples = [];
    this.lastRecordedMidi = null;
  }
}
