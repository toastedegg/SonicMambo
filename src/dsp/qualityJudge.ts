import {
  centsBetween,
  midiToFrequency,
  noteLabelToMidi,
} from '../utils/noteFromFrequency.ts';
import { goertzelMagnitude } from './pitchDetector.ts';
import { medianOf } from './pitchSmoother.ts';
import type { NoteEvent, PitchFrame } from './types.ts';

export interface AntiOverfitQualityGates {
  maxCentsTolerance: number;
  minClarity: number;
  maxPitchJitterCents: number;
  minSustainRatio: number;
  maxNeighborBleedRatio: number;
  maxTimingErrorMs: number | null;
  requireFreshOnsetOnRepeat: boolean;
}

export const DEFAULT_QUALITY_GATES: AntiOverfitQualityGates = {
  maxCentsTolerance: 38,
  minClarity: 0.8,
  maxPitchJitterCents: 16,
  minSustainRatio: 0.5,
  maxNeighborBleedRatio: 0.28,
  maxTimingErrorMs: 85,
  requireFreshOnsetOnRepeat: true,
};

export type NonGoodRejectionReason =
  | 'clean-hit'
  | 'missing-pitch'
  | 'intonation-off'
  | 'fret-buzz-low-clarity'
  | 'unstable-pitch-jitter'
  | 'choked-short-sustain'
  | 'unmuted-neighbor-bleed'
  | 'timing-outside-pocket'
  | 'missing-repeat-pluck';

export interface NoteQualityVerdict {
  accepted: boolean;
  reason: NonGoodRejectionReason;
  medianCents: number | null;
  meanClarity: number;
  pitchJitterCents: number;
  sustainRatio: number;
  neighborBleedRatio: number;
  timingErrorMs: number | null;
}

/**
 * Schema for live user practice / calibration audio takes saved in browser
 * ("Calibration & Dataset Recorder Mode") and replayed offline in `scripts/eval-pipeline.ts`
 * to prevent overfitting (optimizing TPR on `good` takes while keeping FAR ~ 0% on `non-good` takes).
 */
export interface LiveCapturedTakeManifest {
  version: 1;
  takeId: string;
  recordedAtIso: string;
  courseSeed: string;
  sampleRate: number;
  wavFileName: string;
  deviceProfile: 'interface' | 'laptop-mic' | 'micd-amp' | 'unknown';
  calibratedRmsThreshold: number;
  gatesSnapshot: AntiOverfitQualityGates;
  labeledNotes: Array<{
    noteId: string;
    targetLabel: string;
    expectedStartMs: number;
    expectedDurationMs: number;
    /** Self-tag or adversarial drill prompt label used to measure False Accept Rate (FAR). */
    groundTruthQuality:
      | 'good'
      | 'fret-buzz'
      | 'choked'
      | 'neighbor-bleed'
      | 'intonation-off'
      | 'late-panic'
      | 'skipped-repluck';
  }>;
}

const OPEN_STRING_MIDIS = [40, 45, 50, 55, 59, 64] as const; // E2, A2, D3, G3, B3, E4

/**
 * Evaluates a candidate played note against `AntiOverfitQualityGates` so sloppy, buzzing,
 * choked, unmuted-bleed, or un-replucked notes are NOT falsely counted as good inputs.
 */
export function judgeNoteQuality(params: {
  targetLabel: string;
  expectedStartMs: number;
  expectedDurationMs: number;
  isRepeatedSamePitch: boolean;
  framesInWindow: readonly PitchFrame[];
  noteEventsInWindow: readonly NoteEvent[];
  audioSlice?: { samples: Float32Array; sampleRate: number };
  tuningOffsetCents?: number;
  gates: AntiOverfitQualityGates;
}): NoteQualityVerdict {
  const {
    targetLabel,
    expectedStartMs,
    expectedDurationMs,
    isRepeatedSamePitch,
    framesInWindow,
    noteEventsInWindow,
    audioSlice,
    tuningOffsetCents = 0,
    gates,
  } = params;

  const targetMidi = noteLabelToMidi(targetLabel);
  if (targetMidi == null || framesInWindow.length === 0) {
    return emptyReject('missing-pitch');
  }
  const targetHz = midiToFrequency(targetMidi);

  // Collect voiced frames reasonably near the target semitone (within ±120c so we measure actual intonation/jitter!)
  const candidateCents: number[] = [];
  const clarities: number[] = [];
  let inToleranceFrameCount = 0;

  for (let i = 0; i < framesInWindow.length; i += 1) {
    const f = framesInWindow[i];
    if (f.smoothedHz == null || f.confidence < 0.35) continue;
    const c = centsBetween(f.smoothedHz, targetHz) - tuningOffsetCents;
    if (Math.abs(c) <= 120) {
      candidateCents.push(c);
      clarities.push(f.confidence);
      if (Math.abs(c) <= gates.maxCentsTolerance && f.confidence >= gates.minClarity) {
        inToleranceFrameCount += 1;
      }
    }
  }

  if (candidateCents.length < 2) {
    return emptyReject('missing-pitch');
  }

  const medianCents = medianOf(candidateCents);
  const meanClarity = clarities.reduce((s, v) => s + v, 0) / clarities.length;

  // Frame-to-frame pitch jitter (std-dev around medianCents, skipping first attack frame).
  const steadyCents = candidateCents.length > 3 ? candidateCents.slice(1) : candidateCents;
  const variance =
    steadyCents.reduce((s, c) => s + (c - medianCents) * (c - medianCents), 0) /
    steadyCents.length;
  const pitchJitterCents = Math.sqrt(variance);

  // Estimate frame hop dt from frame timestamps.
  const avgDtMs =
    framesInWindow.length >= 2
      ? (framesInWindow[framesInWindow.length - 1].timeMs - framesInWindow[0].timeMs) /
        (framesInWindow.length - 1)
      : 12;
  const cleanHeldMs = inToleranceFrameCount * Math.max(4, avgDtMs);
  const sustainRatio = Math.min(1, cleanHeldMs / Math.max(40, expectedDurationMs));

  // Optional spectral neighbor-bleed check on raw PCM audio slice:
  // Checks open strings that are NOT harmonically related to targetMidi.
  let neighborBleedRatio = 0;
  if (audioSlice && audioSlice.samples.length >= 1024) {
    const midStart = Math.floor(audioSlice.samples.length * 0.25);
    const sliceLen = Math.min(2048, audioSlice.samples.length - midStart);
    if (sliceLen >= 512) {
      const sub = audioSlice.samples.subarray(midStart, midStart + sliceLen);
      const targetAmp = goertzelMagnitude(sub, targetHz, audioSlice.sampleRate);
      if (targetAmp > 1e-5) {
        let maxBleedAmp = 0;
        for (const openMidi of OPEN_STRING_MIDIS) {
          const semiDiff = Math.abs(openMidi - targetMidi);
          // Skip same note, exact octave (12, 24), or twelfth (19) harmonic overlap
          if (semiDiff === 0 || semiDiff === 12 || semiDiff === 19 || semiDiff === 24) {
            continue;
          }
          const openHz = midiToFrequency(openMidi);
          // Also ensure targetHz is not an integer multiple of openHz unless openHz itself is booming
          const amp = goertzelMagnitude(sub, openHz, audioSlice.sampleRate);
          if (amp > maxBleedAmp) maxBleedAmp = amp;
        }
        neighborBleedRatio = maxBleedAmp / targetAmp;
      }
    }
  }

  // Timing & repeated-note re-articulation check
  const matchingOnset = noteEventsInWindow.find(
    (e) => Math.abs(e.midi - targetMidi) <= 1,
  );
  const timingErrorMs =
    matchingOnset != null ? matchingOnset.onsetMs - expectedStartMs : null;

  if (Math.abs(medianCents) > gates.maxCentsTolerance) {
    return {
      accepted: false,
      reason: 'intonation-off',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (meanClarity < gates.minClarity) {
    return {
      accepted: false,
      reason: 'fret-buzz-low-clarity',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (pitchJitterCents > gates.maxPitchJitterCents) {
    return {
      accepted: false,
      reason: 'unstable-pitch-jitter',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (isRepeatedSamePitch && gates.requireFreshOnsetOnRepeat && matchingOnset == null) {
    return {
      accepted: false,
      reason: 'missing-repeat-pluck',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (
    gates.maxTimingErrorMs != null &&
    timingErrorMs != null &&
    Math.abs(timingErrorMs) > gates.maxTimingErrorMs
  ) {
    return {
      accepted: false,
      reason: 'timing-outside-pocket',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (neighborBleedRatio > gates.maxNeighborBleedRatio) {
    return {
      accepted: false,
      reason: 'unmuted-neighbor-bleed',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  if (sustainRatio < gates.minSustainRatio) {
    return {
      accepted: false,
      reason: 'choked-short-sustain',
      medianCents,
      meanClarity,
      pitchJitterCents,
      sustainRatio,
      neighborBleedRatio,
      timingErrorMs,
    };
  }

  return {
    accepted: true,
    reason: 'clean-hit',
    medianCents,
    meanClarity,
    pitchJitterCents,
    sustainRatio,
    neighborBleedRatio,
    timingErrorMs,
  };
}

function emptyReject(reason: NonGoodRejectionReason): NoteQualityVerdict {
  return {
    accepted: false,
    reason,
    medianCents: null,
    meanClarity: 0,
    pitchJitterCents: 0,
    sustainRatio: 0,
    neighborBleedRatio: 0,
    timingErrorMs: null,
  };
}
