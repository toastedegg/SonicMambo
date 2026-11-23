import type { LessonNoteDefinition } from '../types/lesson.ts';
import { DspPipeline } from './pipeline.ts';
import { OnlineScoreFollower, type ScoreFollowReport } from './scoreFollower.ts';
import type { NoteEvent, PitchFrame } from './types.ts';

export interface TwoPassOfflineResult {
  frames: PitchFrame[];
  noteEvents: NoteEvent[];
  refinedReport: ScoreFollowReport;
  tuningOffsetCents: number;
}

/**
 * Two-Pass Offline Analyzer:
 * Runs high-resolution 128-sample hop (~2.9 ms) pitch/onset analysis + non-causal
 * Viterbi score-following over the complete recorded take buffer after performance ends.
 */
export function reanalyzeRecordedTakeOffline(
  samples: Float32Array,
  sampleRate: number,
  expectedNotes: readonly LessonNoteDefinition[],
  nominalBpm: number,
  rmsThreshold: number = 0.008,
): TwoPassOfflineResult {
  const pipeline = new DspPipeline({
    sampleRate,
    frameSize: 2048,
    hopSize: 128, // 2x finer temporal resolution than live pass!
    rmsThreshold,
  });

  const { frames, noteEvents } = pipeline.pushSamples(samples, 0);
  const flushed = pipeline.flush((samples.length / sampleRate) * 1000);
  if (flushed) noteEvents.push(flushed);

  const follower = new OnlineScoreFollower(expectedNotes, nominalBpm);
  for (const ev of noteEvents) {
    follower.step(ev);
  }
  const refinedReport = follower.reconstructAlignment();

  return {
    frames,
    noteEvents,
    refinedReport,
    tuningOffsetCents: pipeline.getTuningOffsetCents(),
  };
}
