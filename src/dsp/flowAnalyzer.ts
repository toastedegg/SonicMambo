import type { NoteAttemptResult } from '../types/lesson.ts';

export interface KeepTheFlowReport {
  totalNotes: number;
  slipCount: number;
  recoveredWithinOneBeat: number;
  longestUnbrokenNotes: number;
  longestUnbrokenSec: number;
  recoverySummary: string;
}

/**
 * Keep the Flow analyzer: mistakes never stop the run.
 * Measures musical continuity (longest unbroken streak) and recovery speed
 * ("back on beat within 1 beat, X out of Y times").
 */
export function analyzeFlowContinuity(
  results: readonly NoteAttemptResult[],
  beatMs: number,
  noteStartBeats: readonly number[],
): KeepTheFlowReport {
  if (results.length === 0) {
    return {
      totalNotes: 0,
      slipCount: 0,
      recoveredWithinOneBeat: 0,
      longestUnbrokenNotes: 0,
      longestUnbrokenSec: 0,
      recoverySummary: 'No notes played yet.',
    };
  }

  let slipCount = 0;
  let recoveredWithinOneBeat = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let streakStartBeat = noteStartBeats[0] ?? 0;
  let longestStreakBeats = 0;

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const isClean =
      r.status === 'hit' &&
      (r.timingOffsetMs == null || Math.abs(r.timingOffsetMs) <= 120);

    if (isClean) {
      if (currentStreak === 0) streakStartBeat = noteStartBeats[i] ?? i;
      currentStreak += 1;
      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        const spanBeats = Math.max(1, (noteStartBeats[i] ?? i) - streakStartBeat + 1);
        if (spanBeats > longestStreakBeats) longestStreakBeats = spanBeats;
      }
    } else {
      slipCount += 1;
      currentStreak = 0;

      // Check recovery on next note within <= 1.25 beats
      const next = results[i + 1];
      const deltaBeat =
        (noteStartBeats[i + 1] ?? i + 1) - (noteStartBeats[i] ?? i);
      if (
        next &&
        next.status === 'hit' &&
        deltaBeat <= 1.25 &&
        (next.timingOffsetMs == null || Math.abs(next.timingOffsetMs) <= 55) &&
        (next.meanCents == null || Math.abs(next.meanCents) <= 45)
      ) {
        recoveredWithinOneBeat += 1;
      }
    }
  }

  const longestUnbrokenSec =
    Math.round(((longestStreakBeats * beatMs) / 1000) * 10) / 10;

  const recoverySummary =
    slipCount === 0
      ? `Unbroken flow! ${results.length}/${results.length} notes with zero slips.`
      : `Back on beat within 1 beat, ${recoveredWithinOneBeat} out of ${slipCount} times.`;

  return {
    totalNotes: results.length,
    slipCount,
    recoveredWithinOneBeat,
    longestUnbrokenNotes: longestStreak,
    longestUnbrokenSec,
    recoverySummary,
  };
}
