import { AUDIO, SCORING } from '../config/staff.ts';
import type { LessonNoteStatus, LessonTimelineNote } from '../types/lesson.ts';
import { centsBetween, noteLabelToFrequency } from '../utils/noteFromFrequency.ts';
import { medianOf } from './pitchSmoother.ts';

export interface NoteScoreSummary {
  noteId: string;
  label: string;
  status: LessonNoteStatus;
  maxHoldMs: number;
  requiredHoldMs: number;
  timingOffsetMs: number | null;
  medianCents: number | null;
}

export interface ScorerStepOutput {
  activeTargetLabel: string | null;
  statusChanged: boolean;
  hits: number;
  misses: number;
}

export function isLiveMatching(
  targetLabel: string | null,
  detectedHz: number | null,
  confidence: number = 1,
  tuningOffsetCents: number = 0,
  centsTolerance: number = SCORING.matchCentsTolerance,
): { isMatch: boolean; cents: number | null } {
  if (!targetLabel || detectedHz == null || confidence < AUDIO.minConfidence) {
    return { isMatch: false, cents: null };
  }
  const targetHz = noteLabelToFrequency(targetLabel);
  if (targetHz == null) return { isMatch: false, cents: null };
  const rawCents = centsBetween(detectedHz, targetHz);
  if (!Number.isFinite(rawCents)) return { isMatch: false, cents: null };
  const compensated = rawCents - tuningOffsetCents;
  return {
    isMatch: Math.abs(compensated) <= centsTolerance,
    cents: compensated,
  };
}

interface InternalNoteState {
  note: LessonTimelineNote;
  targetHz: number | null;
  windowStartMs: number;
  windowEndMs: number;
  requiredHoldMs: number;
  currentHoldMs: number;
  maxHoldMs: number;
  dropoutMs: number;
  firstMatchOffsetMs: number | null;
  centsSamples: number[];
  status: LessonNoteStatus;
}

/**
 * Cents-based, hold-duration note scorer.
 * Promotes a note to `'hit'` immediately once the target pitch is held within
 * `±matchCentsTolerance` for `requiredHoldMs` inside `[windowStartMs, windowEndMs]`.
 */
export class HoldNoteScorer {
  private readonly states: InternalNoteState[];
  private readonly latencyMs: number;
  private readonly centsTolerance: number;

  constructor(
    timelineNotes: readonly LessonTimelineNote[],
    beatMs: number,
    options: {
      latencyMs?: number;
      centsTolerance?: number;
      holdDurationMs?: number;
    } = {},
  ) {
    this.latencyMs = options.latencyMs ?? 0;
    this.centsTolerance = options.centsTolerance ?? SCORING.matchCentsTolerance;
    const holdCap = options.holdDurationMs ?? SCORING.holdDurationMs;

    const earlyPadMs = Math.min(140, Math.max(55, SCORING.earlyToleranceBeats * beatMs));
    const latePadMs = Math.min(210, Math.max(75, SCORING.lateToleranceBeats * beatMs));

    this.states = timelineNotes.map((note, idx) => {
      const scaledHold = note.durationMs * SCORING.minHoldDurationRatio;
      const requiredHoldMs = Math.max(
        SCORING.minHoldFloorMs,
        Math.min(holdCap, scaledHold),
      );
      const nextNote = timelineNotes[idx + 1];
      const rawEndMs = note.startMs + note.durationMs + latePadMs;
      const clampedEndMs =
        nextNote != null
          ? Math.min(rawEndMs, nextNote.startMs + Math.min(125, nextNote.durationMs * 0.65))
          : rawEndMs;
      return {
        note,
        targetHz: noteLabelToFrequency(note.label),
        windowStartMs: note.startMs - earlyPadMs,
        windowEndMs: Math.max(note.startMs + note.durationMs, clampedEndMs),
        requiredHoldMs,
        currentHoldMs: 0,
        maxHoldMs: 0,
        dropoutMs: 0,
        firstMatchOffsetMs: null,
        centsSamples: [],
        status: 'pending',
      };
    });
  }

  step(
    elapsedMs: number,
    dtMs: number,
    detectedHz: number | null,
    confidence: number,
    tuningOffsetCents: number = 0,
    statusRecord?: Record<string, LessonNoteStatus>,
  ): ScorerStepOutput {
    const effectiveMs = elapsedMs - this.latencyMs;
    const clampedDt = Math.max(0, Math.min(dtMs, 60));

    let activeTargetLabel: string | null = null;
    let statusChanged = false;
    let hits = 0;
    let misses = 0;

    for (let i = 0; i < this.states.length; i += 1) {
      const st = this.states[i];
      const { note } = st;

      if (effectiveMs >= note.startMs && effectiveMs < note.startMs + note.durationMs) {
        activeTargetLabel = note.label;
      }

      if (st.status !== 'pending') {
        if (st.status === 'hit') hits += 1;
        else misses += 1;
        continue;
      }

      if (effectiveMs >= st.windowStartMs && effectiveMs < st.windowEndMs) {
        let matched = false;
        let cents = 0;
        if (
          detectedHz != null &&
          st.targetHz != null &&
          confidence >= AUDIO.minConfidence
        ) {
          const rawCents = centsBetween(detectedHz, st.targetHz);
          if (Number.isFinite(rawCents)) {
            cents = rawCents - tuningOffsetCents;
            matched = Math.abs(cents) <= this.centsTolerance;
          }
        }

        if (matched) {
          st.dropoutMs = 0;
          st.currentHoldMs += clampedDt;
          if (st.currentHoldMs > st.maxHoldMs) {
            st.maxHoldMs = st.currentHoldMs;
          }
          if (st.firstMatchOffsetMs == null) {
            st.firstMatchOffsetMs = effectiveMs - note.startMs;
          }
          st.centsSamples.push(cents);

          if (st.maxHoldMs >= st.requiredHoldMs) {
            st.status = 'hit';
            if (statusRecord) statusRecord[note.id] = 'hit';
            statusChanged = true;
            hits += 1;
          }
        } else {
          st.dropoutMs += clampedDt;
          if (st.dropoutMs > SCORING.dropoutGraceMs) {
            st.currentHoldMs = 0;
          }
        }
      } else if (effectiveMs >= st.windowEndMs) {
        const finalStatus: LessonNoteStatus =
          st.maxHoldMs >= st.requiredHoldMs ? 'hit' : 'miss';
        st.status = finalStatus;
        if (statusRecord) statusRecord[note.id] = finalStatus;
        statusChanged = true;
        if (finalStatus === 'hit') hits += 1;
        else misses += 1;
      }
    }

    return { activeTargetLabel, statusChanged, hits, misses };
  }

  finalizeAll(statusRecord?: Record<string, LessonNoteStatus>): {
    hits: number;
    misses: number;
    summaries: NoteScoreSummary[];
  } {
    let hits = 0;
    let misses = 0;
    const summaries: NoteScoreSummary[] = [];

    for (let i = 0; i < this.states.length; i += 1) {
      const st = this.states[i];
      if (st.status === 'pending') {
        st.status = st.maxHoldMs >= st.requiredHoldMs ? 'hit' : 'miss';
        if (statusRecord) statusRecord[st.note.id] = st.status;
      }
      if (st.status === 'hit') hits += 1;
      else misses += 1;

      summaries.push({
        noteId: st.note.id,
        label: st.note.label,
        status: st.status,
        maxHoldMs: st.maxHoldMs,
        requiredHoldMs: st.requiredHoldMs,
        timingOffsetMs: st.firstMatchOffsetMs,
        medianCents: st.centsSamples.length > 0 ? medianOf(st.centsSamples) : null,
      });
    }

    return { hits, misses, summaries };
  }
}
