import { AUDIO } from '../config/staff.ts';
import { DEFAULT_AUDIO_CONFIG } from '../types/audio.ts';
import { HighPassBiquad } from './biquad.ts';
import { NoteSegmenter } from './noteSegmenter.ts';
import { OnsetDetector } from './onsetDetector.ts';
import { MpmPitchDetector } from './pitchDetector.ts';
import { SemitoneMedianSmoother } from './pitchSmoother.ts';
import { SessionTuningTracker } from './tuningOffset.ts';
import type { NoteEvent, PitchDetectorBackend, PitchFrame } from './types.ts';

export interface DspPipelineOptions {
  sampleRate?: number;
  frameSize?: number;
  hopSize?: number;
  rmsThreshold?: number;
  detector?: PitchDetectorBackend;
}

/**
 * End-to-end streaming guitar DSP pipeline usable identically in:
 * - Web Worker / AudioWorklet real-time capture
 * - Offline Node WAV / MP4 evaluation (`scripts/eval-pipeline.ts`)
 */
export class DspPipeline {
  private readonly sampleRate: number;
  private readonly frameSize: number;
  private readonly hopSize: number;
  private readonly highPass: HighPassBiquad;
  private detector: PitchDetectorBackend;
  private readonly smoother: SemitoneMedianSmoother;
  private readonly tuningTracker: SessionTuningTracker;
  private readonly onsetDetector: OnsetDetector;
  private readonly segmenter: NoteSegmenter;

  private readonly ringBuffer: Float32Array;
  private readonly analysisFrame: Float32Array;
  private readonly filteredScratch: Float32Array;
  private ringWritePos = 0;
  private samplesFilled = 0;
  private hopsSinceLastAnalysis = 0;
  private totalSamplesProcessed = 0;

  constructor(options: DspPipelineOptions = {}) {
    this.sampleRate = options.sampleRate ?? 44100;
    this.frameSize = options.frameSize ?? DEFAULT_AUDIO_CONFIG.fftSize;
    this.hopSize = options.hopSize ?? 256;
    const rmsThreshold = options.rmsThreshold ?? DEFAULT_AUDIO_CONFIG.rmsThreshold;

    this.highPass = new HighPassBiquad(AUDIO.highPassCutoffHz);
    this.detector =
      options.detector ??
      new MpmPitchDetector({
        frameSize: this.frameSize,
        minFrequency: DEFAULT_AUDIO_CONFIG.minFrequency,
        maxFrequency: DEFAULT_AUDIO_CONFIG.maxFrequency,
        rmsThreshold,
      });
    this.smoother = new SemitoneMedianSmoother();
    this.tuningTracker = new SessionTuningTracker();
    this.onsetDetector = new OnsetDetector({
      frameSize: this.frameSize,
      rmsThreshold,
    });
    this.segmenter = new NoteSegmenter({ rmsThreshold });

    this.ringBuffer = new Float32Array(this.frameSize);
    this.analysisFrame = new Float32Array(this.frameSize);
    this.filteredScratch = new Float32Array(4096);
  }

  setRmsThreshold(threshold: number): void {
    this.detector.setRmsThreshold?.(threshold);
    this.onsetDetector.setRmsThreshold(threshold);
    this.segmenter.setRmsThreshold(threshold);
  }

  setDetector(detector: PitchDetectorBackend): void {
    this.detector.dispose?.();
    this.detector = detector;
  }

  getTuningOffsetCents(): number {
    return this.tuningTracker.getOffsetCents();
  }

  pushSamples(
    rawChunk: Float32Array,
    chunkStartSec?: number,
  ): { frames: PitchFrame[]; noteEvents: NoteEvent[] } {
    const frames: PitchFrame[] = [];
    const noteEvents: NoteEvent[] = [];

    let filtered: Float32Array;
    if (rawChunk.length <= this.filteredScratch.length) {
      filtered = this.filteredScratch.subarray(0, rawChunk.length);
    } else {
      filtered = new Float32Array(rawChunk.length);
    }
    this.highPass.process(rawChunk, filtered, this.sampleRate);

    const baseSampleIndex =
      chunkStartSec != null
        ? Math.round(chunkStartSec * this.sampleRate)
        : this.totalSamplesProcessed;

    for (let i = 0; i < filtered.length; i += 1) {
      this.ringBuffer[this.ringWritePos] = filtered[i];
      this.ringWritePos = (this.ringWritePos + 1) % this.frameSize;
      if (this.samplesFilled < this.frameSize) {
        this.samplesFilled += 1;
      }
      this.hopsSinceLastAnalysis += 1;
      this.totalSamplesProcessed += 1;

      if (
        this.samplesFilled === this.frameSize &&
        this.hopsSinceLastAnalysis >= this.hopSize
      ) {
        this.hopsSinceLastAnalysis = 0;

        // Unwrap circular ringBuffer into contiguous analysisFrame (oldest -> newest).
        const tailLen = this.frameSize - this.ringWritePos;
        this.analysisFrame.set(this.ringBuffer.subarray(this.ringWritePos), 0);
        if (this.ringWritePos > 0) {
          this.analysisFrame.set(
            this.ringBuffer.subarray(0, this.ringWritePos),
            tailLen,
          );
        }

        // Timestamp at the center of the analysis window for minimal bias.
        const endSample = baseSampleIndex + i + 1;
        const centerSample = endSample - (this.frameSize >> 1);
        const timeMs = Math.max(0, (centerSample / this.sampleRate) * 1000);

        const det = this.detector.detect(this.analysisFrame, this.sampleRate);
        const sm = this.smoother.update(det.pitchHz, det.confidence, timeMs);
        this.tuningTracker.observe(sm.smoothedMidi, det.confidence);

        const onset = this.onsetDetector.processFrame(
          this.analysisFrame,
          det.rms,
          timeMs,
          sm.smoothedMidi,
          this.segmenter.getActiveMedianMidi(),
          det.confidence,
        );

        const emitted = this.segmenter.step(
          timeMs,
          det.rms,
          sm.smoothedMidi,
          det.confidence,
          onset,
        );
        for (let e = 0; e < emitted.length; e += 1) {
          noteEvents.push(emitted[e]);
        }

        frames.push({
          timeMs,
          rms: det.rms,
          rawHz: det.pitchHz,
          smoothedHz: sm.smoothedHz,
          midi: sm.smoothedMidi,
          centsOffset: sm.centsOffset,
          label: sm.label,
          confidence: det.confidence,
        });
      }
    }

    return { frames, noteEvents };
  }

  flush(endTimeMs?: number): NoteEvent | null {
    const fallbackMs = (this.totalSamplesProcessed / this.sampleRate) * 1000;
    return this.segmenter.flush(endTimeMs ?? fallbackMs);
  }

  reset(): void {
    this.highPass.reset();
    this.smoother.reset();
    this.tuningTracker.reset();
    this.onsetDetector.reset();
    this.segmenter.reset();
    this.ringBuffer.fill(0);
    this.ringWritePos = 0;
    this.samplesFilled = 0;
    this.hopsSinceLastAnalysis = 0;
    this.totalSamplesProcessed = 0;
  }
}
