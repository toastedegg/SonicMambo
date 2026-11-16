import type { LessonNoteDefinition } from '../types/lesson.ts';
import { noteLabelToMidi } from '../utils/noteFromFrequency.ts';
import { medianOf } from './pitchSmoother.ts';
import type { NoteEvent } from './types.ts';

export interface ScoreNoteState {
  index: number;
  note: LessonNoteDefinition;
  midi: number;
}

export interface AlignedScoreEvent {
  event: NoteEvent;
  scoreIndex: number;
  scoreNote: LessonNoteDefinition;
  kind: 'matched' | 'wrong-pitch' | 'ornament-extra' | 'restarted';
  centsError: number;
  timingDriftMs: number;
}

export interface ScoreFollowReport {
  alignments: AlignedScoreEvent[];
  skippedIndices: number[];
  estimatedTempoBpm: number;
  accuracyPct: number;
  meanTimingDriftMs: number;
  meanAbsCentsError: number;
  teacherSummary: string;
}

interface StepTrace {
  event: NoteEvent;
  costs: Float64Array;
  backPtrs: Int32Array;
  bestState: number;
}

const RESTART_PAUSE_MS = 1200;

/**
 * Online causal HMM / DTW score follower for Sensei Mode.
 * Tracks a player's live `NoteEvent` stream silently from memory, tolerating
 * tempo drift (0.5x..2.0x), skipped notes, ornament extras, and mid-phrase restarts.
 */
export class OnlineScoreFollower {
  readonly scoreStates: ScoreNoteState[];
  readonly nominalBeatMs: number;

  private currentCosts: Float64Array;
  private traces: StepTrace[] = [];
  private estimatedBeatMs: number;
  private recentIoiRatios: number[] = [];
  private prevEvent: NoteEvent | null = null;
  private prevMatchedScoreIdx: number | null = null;
  private currentScoreIdx = 0;

  constructor(notes: readonly LessonNoteDefinition[], nominalBpm: number) {
    this.nominalBeatMs = 60_000 / Math.max(30, nominalBpm);
    this.estimatedBeatMs = this.nominalBeatMs;
    this.scoreStates = notes.map((note, index) => ({
      index,
      note,
      midi: noteLabelToMidi(note.label) ?? 60,
    }));

    const m = Math.max(1, this.scoreStates.length);
    this.currentCosts = new Float64Array(m);
    for (let j = 0; j < m; j += 1) {
      // Small penalty for skipping opening notes
      this.currentCosts[j] = j * 1.8;
    }
  }

  getCurrentScoreIndex(): number {
    return this.currentScoreIdx;
  }

  getEstimatedBpm(): number {
    return Math.round(60_000 / this.estimatedBeatMs);
  }

  step(event: NoteEvent): number {
    const m = this.scoreStates.length;
    if (m === 0) return 0;

    const nextCosts = new Float64Array(m);
    const backPtrs = new Int32Array(m);
    const pauseMs = this.prevEvent ? event.onsetMs - this.prevEvent.onsetMs : 0;
    const isFirstEvent = this.traces.length === 0;

    for (let j = 0; j < m; j += 1) {
      const semiDiff = Math.abs(event.midi - this.scoreStates[j].midi);
      const emissionCost = semiDiff === 0 ? 0 : semiDiff === 12 ? 1.5 : Math.min(3, semiDiff);

      if (isFirstEvent) {
        // First note alignment: prefer j=0, penalize starting late
        nextCosts[j] = j * 1.8 + emissionCost;
        backPtrs[j] = -1;
        continue;
      }

      let bestPrev = j;
      let bestTransCost = this.currentCosts[j] + 1.2; // stay (extra/ornament note)

      if (j >= 1) {
        const normalCost = this.currentCosts[j - 1] + 0; // normal step j-1 -> j
        if (normalCost < bestTransCost) {
          bestTransCost = normalCost;
          bestPrev = j - 1;
        }
      }

      if (j >= 2) {
        const skipCost = this.currentCosts[j - 2] + 1.8; // skipped note j-2 -> j
        if (skipCost < bestTransCost) {
          bestTransCost = skipCost;
          bestPrev = j - 2;
        }
      }

      // Phrase restart j -> 0 after a noticeable pause > 1200ms
      if (j === 0 && pauseMs > RESTART_PAUSE_MS) {
        let minAny = Infinity;
        let minIdx = 0;
        for (let k = 0; k < m; k += 1) {
          if (this.currentCosts[k] < minAny) {
            minAny = this.currentCosts[k];
            minIdx = k;
          }
        }
        const restartCost = minAny + 2.2;
        if (restartCost < bestTransCost) {
          bestTransCost = restartCost;
          bestPrev = minIdx;
        }
      }

      nextCosts[j] = bestTransCost + emissionCost;
      backPtrs[j] = bestPrev;
    }

    let bestState = 0;
    let minCost = Infinity;
    for (let j = 0; j < m; j += 1) {
      if (nextCosts[j] < minCost) {
        minCost = nextCosts[j];
        bestState = j;
      }
    }

    // Update running tempo estimate from inter-onset intervals when progressing cleanly
    if (
      this.prevEvent != null &&
      this.prevMatchedScoreIdx != null &&
      bestState > this.prevMatchedScoreIdx &&
      Math.abs(event.midi - this.scoreStates[bestState].midi) === 0
    ) {
      const deltaBeats =
        this.scoreStates[bestState].note.startBeat -
        this.scoreStates[this.prevMatchedScoreIdx].note.startBeat;
      const ioiMs = event.onsetMs - this.prevEvent.onsetMs;
      if (deltaBeats > 0 && ioiMs > 60) {
        const impliedBeatMs = ioiMs / deltaBeats;
        const clampedBeatMs = Math.max(
          0.5 * this.nominalBeatMs,
          Math.min(2.0 * this.nominalBeatMs, impliedBeatMs),
        );
        this.recentIoiRatios.push(clampedBeatMs);
        if (this.recentIoiRatios.length > 8) this.recentIoiRatios.shift();
        this.estimatedBeatMs = medianOf(this.recentIoiRatios);
      }
    }

    this.currentCosts = nextCosts;
    this.traces.push({ event, costs: nextCosts, backPtrs, bestState });
    this.prevEvent = event;
    this.prevMatchedScoreIdx = bestState;
    this.currentScoreIdx = bestState;
    return bestState;
  }

  reconstructAlignment(): ScoreFollowReport {
    const kLen = this.traces.length;
    const m = this.scoreStates.length;
    if (kLen === 0 || m === 0) {
      return {
        alignments: [],
        skippedIndices: this.scoreStates.map((s) => s.index),
        estimatedTempoBpm: this.getEstimatedBpm(),
        accuracyPct: 0,
        meanTimingDriftMs: 0,
        meanAbsCentsError: 0,
        teacherSummary: 'No notes detected. Play freely from memory whenever you are ready.',
      };
    }

    // Viterbi backtrace from best terminal state
    const path = new Int32Array(kLen);
    let curState = this.traces[kLen - 1].bestState;
    for (let t = kLen - 1; t >= 0; t -= 1) {
      path[t] = curState;
      const prev = this.traces[t].backPtrs[curState];
      if (t > 0 && prev >= 0) curState = prev;
    }

    const firstOnsetMs = this.traces[0].event.onsetMs;
    const firstBeat = this.scoreStates[path[0]].note.startBeat;
    const visitedScoreIndices = new Set<number>();

    const alignments: AlignedScoreEvent[] = [];
    const absCentsList: number[] = [];
    const driftList: number[] = [];
    let matchedCount = 0;

    for (let t = 0; t < kLen; t += 1) {
      const sIdx = path[t];
      const st = this.scoreStates[sIdx];
      const ev = this.traces[t].event;
      const prevIdx = t > 0 ? path[t - 1] : -1;

      const isRestart = t > 0 && sIdx === 0 && prevIdx > 0;
      const isStay = t > 0 && sIdx === prevIdx && !isRestart;
      const pitchMatch = ev.midi === st.midi;

      let kind: AlignedScoreEvent['kind'] = 'matched';
      if (isRestart) {
        kind = 'restarted';
      } else if (isStay) {
        kind = 'ornament-extra';
      } else if (!pitchMatch) {
        kind = 'wrong-pitch';
      }

      if (kind === 'matched') matchedCount += 1;
      visitedScoreIndices.add(sIdx);

      const expectedMs =
        firstOnsetMs + (st.note.startBeat - firstBeat) * this.estimatedBeatMs;
      const timingDriftMs = Math.round(ev.onsetMs - expectedMs);
      const centsError = Math.round((ev.midi + ev.pitchCents / 100 - st.midi) * 100);

      if (pitchMatch) absCentsList.push(Math.abs(centsError));
      driftList.push(timingDriftMs);

      alignments.push({
        event: ev,
        scoreIndex: sIdx,
        scoreNote: st.note,
        kind,
        centsError,
        timingDriftMs,
      });
    }

    const skippedIndices = this.scoreStates
      .map((s) => s.index)
      .filter((idx) => !visitedScoreIndices.has(idx));

    const accuracyPct = Math.round((matchedCount / m) * 100);
    const meanTimingDriftMs =
      driftList.length > 0
        ? Math.round(driftList.reduce((s, v) => s + v, 0) / driftList.length)
        : 0;
    const meanAbsCentsError =
      absCentsList.length > 0
        ? Math.round(absCentsList.reduce((s, v) => s + v, 0) / absCentsList.length)
        : 0;

    const estBpm = this.getEstimatedBpm();
    const wrongNotes = alignments.filter((a) => a.kind === 'wrong-pitch');
    const teacherSummary =
      wrongNotes.length === 0 && skippedIndices.length === 0
        ? `Clean run at ~${estBpm} BPM! Intonation within ${meanAbsCentsError}c.`
        : `Followed you at ~${estBpm} BPM: ${matchedCount}/${m} target notes matched, ${wrongNotes.length} wrong pitches, ${skippedIndices.length} skipped.`;

    return {
      alignments,
      skippedIndices,
      estimatedTempoBpm: estBpm,
      accuracyPct,
      meanTimingDriftMs,
      meanAbsCentsError,
      teacherSummary,
    };
  }
}
