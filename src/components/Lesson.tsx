import { useEffect, useMemo, useRef, useState } from 'react';
import { LessonStaffPixi, type LessonStaffFlash } from './LessonStaffPixi';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { AudioFeedback } from './BottomBar';
import type { Lesson as LessonType, LessonTimelineNote, LessonNoteStatus } from '../types/lesson';
import { SCORING } from '../config/staff';

interface LessonProps {
  lesson: LessonType;
  onAudioUpdate: (feedback: AudioFeedback) => void;
}

export function Lesson({ lesson, onAudioUpdate }: LessonProps) {
  const { isListening, currentNote, frequency, loudness, error, detectionRef, start, stop } = useAudioEngine();
  const [isLessonRunning, setIsLessonRunning] = useState(false);
  const [lessonNotes, setLessonNotes] = useState<LessonTimelineNote[]>([]);
  const [activeTargetLabel, setActiveTargetLabel] = useState<string | null>(null);
  const [stats, setStats] = useState({ hits: 0, misses: 0 });

  const lessonStartedAtRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const accumulatorsRef = useRef<Map<string, { matchFrames: number; totalFrames: number }>>(new Map());
  const flashRef = useRef<LessonStaffFlash>({ status: null, token: 0 });
  const activeTargetLabelRef = useRef<string | null>(null);

  const beatMs = 60_000 / lesson.tempoBpm;

  const lessonDurationMs = useMemo(
    () =>
      lesson.notes.reduce((max, note) => {
        const noteEnd = (note.startBeat + note.durationBeats) * beatMs;
        return Math.max(max, noteEnd);
      }, 0),
    [beatMs, lesson.notes]
  );

  // Seed the immutable timeline notes once per lesson change.
  const timelineNotes = useMemo<LessonTimelineNote[]>(
    () =>
      lesson.notes.map((note) => ({
        ...note,
        startMs: note.startBeat * beatMs,
        durationMs: note.durationBeats * beatMs,
        status: 'pending' as LessonNoteStatus,
      })),
    [beatMs, lesson.notes]
  );

  const startLesson = async () => {
    await start();
    accumulatorsRef.current = new Map();
    noteStatusRef.current = {};
    flashRef.current = { status: null, token: 0 };
    activeTargetLabelRef.current = null;
    setLessonNotes(timelineNotes);
    setActiveTargetLabel(null);
    setStats({ hits: 0, misses: 0 });
    currentTimeRef.current = 0;
    lessonStartedAtRef.current = performance.now();
    setIsLessonRunning(true);
  };

  const stopLesson = () => {
    setIsLessonRunning(false);
    lessonStartedAtRef.current = null;
    currentTimeRef.current = 0;
    stop();
  };

  // Scoring + time loop. Runs only while a lesson is in progress.
  useEffect(() => {
    if (!isLessonRunning || lessonStartedAtRef.current == null) return undefined;

    const tolMs = SCORING.toleranceBeats * beatMs;
    const accumulators = accumulatorsRef.current;
    const statuses = noteStatusRef.current;

    let rafId = 0;

    const loop = () => {
      const startedAt = lessonStartedAtRef.current ?? performance.now();
      const elapsed = performance.now() - startedAt;
      currentTimeRef.current = elapsed;

      const detectedLabel = detectionRef.current.label;

      let activeLabel: string | null = null;
      let statusChanged = false;
      let newHits = 0;
      let newMisses = 0;

      for (const note of timelineNotes) {
        const prevStatus = statuses[note.id] ?? 'pending';
        const windowStart = note.startMs - tolMs;
        const windowEnd = note.startMs + note.durationMs + tolMs;

        // UI target: strictly within [start, end), regardless of tolerance.
        if (elapsed >= note.startMs && elapsed < note.startMs + note.durationMs) {
          activeLabel = note.label;
        }

        if (prevStatus !== 'pending') {
          if (prevStatus === 'hit') newHits += 1;
          else if (prevStatus === 'miss') newMisses += 1;
          continue;
        }

        if (elapsed >= windowStart && elapsed < windowEnd) {
          let acc = accumulators.get(note.id);
          if (!acc) {
            acc = { matchFrames: 0, totalFrames: 0 };
            accumulators.set(note.id, acc);
          }
          acc.totalFrames += 1;
          if (detectedLabel && detectedLabel === note.label) {
            acc.matchFrames += 1;
          }
        } else if (elapsed >= windowEnd) {
          const acc = accumulators.get(note.id);
          const ratio = acc && acc.totalFrames > 0 ? acc.matchFrames / acc.totalFrames : 0;
          const finalStatus: LessonNoteStatus = ratio >= SCORING.hitRatio ? 'hit' : 'miss';
          statuses[note.id] = finalStatus;
          statusChanged = true;
          flashRef.current = {
            status: finalStatus,
            token: flashRef.current.token + 1,
          };
          if (finalStatus === 'hit') newHits += 1;
          else newMisses += 1;
        }
      }

      if (statusChanged) {
        setLessonNotes((prev) =>
          prev.map((note) => {
            const next = statuses[note.id];
            if (!next || next === note.status) return note;
            return { ...note, status: next };
          })
        );
        setStats({ hits: newHits, misses: newMisses });
      }

      if (activeLabel !== activeTargetLabelRef.current) {
        activeTargetLabelRef.current = activeLabel;
        setActiveTargetLabel(activeLabel);
      }

      if (elapsed > lessonDurationMs + beatMs) {
        setIsLessonRunning(false);
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [beatMs, detectionRef, isLessonRunning, lessonDurationMs, timelineNotes]);

  // Forward audio feedback to the bottom bar.
  useEffect(() => {
    const isMatch = activeTargetLabel && currentNote?.label
      ? currentNote.label === activeTargetLabel
      : null;

    onAudioUpdate({
      detectedLabel: currentNote?.label ?? null,
      frequency: frequency ?? null,
      loudness,
      isListening,
      targetLabel: activeTargetLabel,
      isMatch,
      hits: stats.hits,
      misses: stats.misses,
    });
  }, [currentNote?.label, frequency, loudness, isListening, activeTargetLabel, stats, onAudioUpdate]);

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto">
      <section className="sp-card-padded">
        {!isLessonRunning ? (
          <button type="button" onClick={startLesson} className="sp-btn-primary">
            Start Lesson
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-sp-text-sub font-semibold">Lesson in progress...</p>
            <button type="button" onClick={stopLesson} className="sp-btn-secondary">
              Stop
            </button>
          </div>
        )}
      </section>

      <section className="sp-card-padded text-center">
        <p className="sp-section-label mb-2">Target note</p>
        <p className="text-4xl font-extrabold text-white">
          {activeTargetLabel ?? 'Press Start'}
        </p>
      </section>

      <LessonStaffPixi
        notes={lessonNotes.length > 0 ? lessonNotes : timelineNotes}
        beatMs={beatMs}
        currentTimeRef={currentTimeRef}
        detectionRef={detectionRef}
        noteStatusRef={noteStatusRef}
        flashRef={flashRef}
      />

      {error && (
        <p className="text-brand-red font-semibold text-center text-sm">{error}</p>
      )}
    </div>
  );
}
