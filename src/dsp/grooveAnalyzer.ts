import { medianOf } from './pitchSmoother.ts';
import type { NoteEvent } from './types.ts';

export interface GrooveReport {
  onsetCount: number;
  meanOffsetMs: number; // negative = rush, positive = drag
  stdDevMs: number;
  iqrMs: number;
  perBeatMeanMs: [number | null, number | null, number | null, number | null];
  swingRatio: number | null; // ~1.0 straight, ~1.5-1.7 jazz swing, ~2.0 shuffle
  summaryText: string;
}

/**
 * Analyzes onset-only timing against a regular quarter-note grid (`tempoBpm`),
 * reporting global rush/drag, per-beat breakdown (Beats 1–4), timing spread, and swing ratio.
 */
export function analyzeGroove(
  events: readonly NoteEvent[],
  tempoBpm: number,
): GrooveReport {
  if (events.length === 0 || tempoBpm <= 0) {
    return {
      onsetCount: 0,
      meanOffsetMs: 0,
      stdDevMs: 0,
      iqrMs: 0,
      perBeatMeanMs: [null, null, null, null],
      swingRatio: null,
      summaryText: 'Play muted strums or single notes along with the visual pulse.',
    };
  }

  const beatMs = 60_000 / tempoBpm;
  const beatOffsets: [number[], number[], number[], number[]] = [[], [], [], []];
  const allOffsets: number[] = [];

  for (const ev of events) {
    const nearestBeat = Math.round(ev.onsetMs / beatMs);
    const beatPosMs = nearestBeat * beatMs;
    const offset = ev.onsetMs - beatPosMs;
    // Only count beats near the quarter-note pulse (within ±35% of beat) for beat pocket stats
    if (Math.abs(offset) <= beatMs * 0.35) {
      allOffsets.push(offset);
      const beatInBar = ((nearestBeat % 4) + 4) % 4;
      beatOffsets[beatInBar].push(offset);
    }
  }

  // Compute Jazz Swing Ratio from eighth-note triplets/upbeats:
  // Look for triples (downbeat_i, upbeat_i, downbeat_{i+1}) spanning 1 beat
  const swingRatios: number[] = [];
  for (let i = 0; i + 2 < events.length; i += 1) {
    const t0 = events[i].onsetMs;
    const t1 = events[i + 1].onsetMs;
    const t2 = events[i + 2].onsetMs;
    const totalSpan = t2 - t0;
    if (totalSpan >= beatMs * 0.75 && totalSpan <= beatMs * 1.25) {
      const firstHalf = t1 - t0;
      const secondHalf = t2 - t1;
      if (firstHalf > beatMs * 0.25 && secondHalf > beatMs * 0.2) {
        const ratio = firstHalf / secondHalf;
        if (ratio >= 0.7 && ratio <= 3.0) {
          swingRatios.push(ratio);
        }
      }
    }
  }

  const meanOffsetMs =
    allOffsets.length > 0
      ? Math.round(allOffsets.reduce((s, v) => s + v, 0) / allOffsets.length)
      : 0;

  let stdDevMs = 0;
  let iqrMs = 0;
  if (allOffsets.length >= 2) {
    const variance =
      allOffsets.reduce((s, v) => s + (v - meanOffsetMs) * (v - meanOffsetMs), 0) /
      allOffsets.length;
    stdDevMs = Math.round(Math.sqrt(variance));
    const sorted = [...allOffsets].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
    iqrMs = Math.round(q3 - q1);
  }

  const perBeatMeanMs = beatOffsets.map((arr) =>
    arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null,
  ) as [number | null, number | null, number | null, number | null];

  const swingRatio =
    swingRatios.length >= 2 ? Math.round(medianOf(swingRatios) * 100) / 100 : null;

  const globalDesc =
    Math.abs(meanOffsetMs) <= 8
      ? 'Locked in the center of the beat'
      : meanOffsetMs < 0
        ? `You rush by ${Math.abs(meanOffsetMs)} ms overall`
        : `You drag by ${meanOffsetMs} ms overall`;

  let worstBeatDesc = '';
  let maxBeatMag = 0;
  perBeatMeanMs.forEach((val, idx) => {
    if (val != null && Math.abs(val) > maxBeatMag && Math.abs(val) >= 12) {
      maxBeatMag = Math.abs(val);
      worstBeatDesc = ` and ${val < 0 ? 'rush' : 'drag'} ${Math.abs(val)} ms on Beat ${idx + 1}`;
    }
  });

  const swingDesc =
    swingRatio != null
      ? ` \u2022 Swing ratio ${swingRatio.toFixed(2)}:1 (${
          swingRatio >= 1.85 ? 'triplet shuffle' : swingRatio >= 1.35 ? 'jazz swing' : 'straight'
        })`
      : '';

  return {
    onsetCount: events.length,
    meanOffsetMs,
    stdDevMs,
    iqrMs,
    perBeatMeanMs,
    swingRatio,
    summaryText: `${globalDesc}${worstBeatDesc}.${swingDesc}`,
  };
}
