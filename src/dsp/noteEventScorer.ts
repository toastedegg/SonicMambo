import { AUDIO, SCORING } from '../config/staff.ts';
import type { LessonNoteStatus, LessonTimelineNote, NoteAttemptResult } from '../types/lesson.ts';
import {
  centsBetween,
  noteLabelToFrequency,
  noteLabelToMidi,
} from '../utils/noteFromFrequency.ts';
import { medianOf } from './pitchSmoother.ts';
import type { NoteEvent } from './types.ts';

interface InternalEventNoteState {
  note: LessonTimelineNote;
  targetMidi: number | null;
  targetHz: number | null;
  isRepeatOfPrev: boolean;
  windowStartMs: number;
  windowEndMs: number;
  requiredHoldMs: number;
  currentHoldMs: number;
  maxHoldMs: number;
  dropoutMs: number;
  freshOnsetSeen: boolean;
  onsetTimingOffsetMs: number | null;
  firstMatchOffsetMs: number | null;
  centsSamples: number[];
  status: LessonNoteStatus;
}

export interface NoteEventScorerStepOutput {
  activeTargetLabel: string | null;
  statusChanged: boolean;
  hits: number;
  misses: number;
}

/**
 * Combines live `HoldNoteScorer` responsiveness (immediate green promotion after `requiredHoldMs`)
 * with `NoteEvent` onset alignment so:
 * - Repeated notes (`E4 -> E4`) require a fresh onset pluck (holding one note across two beats misses the 2nd).
 * - Per-note `timingOffsetMs` (compensated by `latencyMs`) and `meanCents` are captured accurately.
 */
export class NoteEventScorer {
  private readonly states: InternalEventNoteState[];
  private readonly latencyMs: number;
  private readonly centsTolerance: number;
  private readonly consumedOnsetIds = new Set<string>();

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
      const targetMidi = noteLabelToMidi(note.label);
      const prevNote = idx > 0 ? timelineNotes[idx - 1] : null;
      const prevMidi = prevNote ? noteLabelToMidi(prevNote.label) : null;
      const isRepeatOfPrev =
        targetMidi != null && prevMidi != null && targetMidi === prevMidi;

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
        targetMidi,
        targetHz: noteLabelToFrequency(note.label),
        isRepeatOfPrev,
        windowStartMs: note.startMs - earlyPadMs,
        windowEndMs: Math.max(note.startMs + note.durationMs, clampedEndMs),
        requiredHoldMs,
        currentHoldMs: 0,
        maxHoldMs: 0,
        dropoutMs: 0,
        freshOnsetSeen: !isRepeatOfPrev,
        onsetTimingOffsetMs: null,
        firstMatchOffsetMs: null,
        centsSamples: [],
        status: 'pending',
      };
    });
  }

  /**
   * Supply a `NoteEvent` (with `onsetMs` already shifted relative to lesson start).
   */
  observeNoteEvent(event: NoteEvent, statusRecord?: Record<string, LessonNoteStatus>): boolean {
    if (this.consumedOnsetIds.has(event.id)) return false;

    const compensatedOnsetMs = event.onsetMs - this.latencyMs;

    for (let i = 0; i < this.states.length; i += 1) {
      const st = this.states[i];
      if (st.targetMidi == null) continue;
      if (Math.abs(event.midi - st.targetMidi) > 1) continue;
      if (compensatedOnsetMs < st.windowStartMs || compensatedOnsetMs > st.windowEndMs) {
        continue;
      }
      if (st.isRepeatOfPrev && !st.freshOnsetSeen) {
        st.freshOnsetSeen = true;
        st.onsetTimingOffsetMs = compensatedOnsetMs - st.note.startMs;
        this.consumedOnsetIds.add(event.id);
        if (
          st.status === 'pending' &&
          st.maxHoldMs >= st.requiredHoldMs
        ) {
          st.status = 'hit';
          if (statusRecord) statusRecord[st.note.id] = 'hit';
          return true;
        }
        return false;
      }
      if (st.onsetTimingOffsetMs == null) {
        st.onsetTimingOffsetMs = compensatedOnsetMs - st.note.startMs;
        this.consumedOnsetIds.add(event.id);
        return false;
      }
    }
    return false;
  }

  step(
    elapsedMs: number,
    dtMs: number,
    detectedHz: number | null,
    confidence: number,
    tuningOffsetCents: number = 0,
    statusRecord?: Record<string, LessonNoteStatus>,
  ): NoteEventScorerStepOutput {
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

          if (st.maxHoldMs >= st.requiredHoldMs && st.freshOnsetSeen) {
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
          st.maxHoldMs >= st.requiredHoldMs && st.freshOnsetSeen ? 'hit' : 'miss';
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
    results: NoteAttemptResult[];
  } {
    let hits = 0;
    let misses = 0;
    const results: NoteAttemptResult[] = [];

    for (let i = 0; i < this.states.length; i += 1) {
      const st = this.states[i];
      if (st.status === 'pending') {
        st.status =
          st.maxHoldMs >= st.requiredHoldMs && st.freshOnsetSeen ? 'hit' : 'miss';
        if (statusRecord) statusRecord[st.note.id] = st.status;
      }
      if (st.status === 'hit') hits += 1;
      else misses += 1;

      const meanCents =
        st.centsSamples.length > 0
          ? Math.round(medianOf(st.centsSamples) * 10) / 10
          : null;

      const timingOffsetMs =
        st.onsetTimingOffsetMs != null
          ? Math.round(st.onsetTimingOffsetMs)
          : st.firstMatchOffsetMs != null
            ? Math.round(st.firstMatchOffsetMs)
            : null;

      results.push({
        noteId: st.note.id,
        targetLabel: st.note.label,
        status: st.status,
        timingOffsetMs,
        meanCents,
        holdDurationMs: Math.round(st.maxHoldMs),
      });
    }

    return { hits, misses, results };
  }
}
