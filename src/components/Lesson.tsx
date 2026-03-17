import { useEffect, useMemo, useRef, useState } from 'react';
import { LessonStaffPixi } from './LessonStaffPixi';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { AudioFeedback } from './BottomBar';
import type { Lesson as LessonType, LessonTimelineNote } from '../types/lesson';

const TOLERANCE_MS = 100;
const HIT_RATIO = 0.6;

interface LessonProps {
  lesson: LessonType;
  onAudioUpdate: (feedback: AudioFeedback) => void;
}

export function Lesson({ lesson, onAudioUpdate }: LessonProps) {
  const { isListening, currentNote, frequency, loudness, error, start, stop } = useAudioEngine();
  const [isLessonRunning, setIsLessonRunning] = useState(false);
  const [lessonNotes, setLessonNotes] = useState<LessonTimelineNote[]>([]);
  const [lessonElapsedMs, setLessonElapsedMs] = useState(0);
  const [lessonStartedAt, setLessonStartedAt] = useState<number | null>(null);
  const detectedLabelRef = useRef<string | null>(null);
  const noteAccumulatorRef = useRef<Map<string, { matchFrames: number; totalFrames: number }>>(new Map());

  const beatMs = 60_000 / lesson.tempoBpm;
  const lessonDurationMs = useMemo(
    () =>
      lesson.notes.reduce((max, note) => {
        const noteEnd = (note.startBeat + note.durationBeats) * beatMs;
        return Math.max(max, noteEnd);
      }, 0),
    [beatMs, lesson.notes]
  );

  useEffect(() => {
    detectedLabelRef.current = currentNote?.label ?? null;
  }, [currentNote?.label]);

  const startLesson = async () => {
    await start();
    noteAccumulatorRef.current = new Map();
    const seedNotes: LessonTimelineNote[] = lesson.notes.map((note) => ({
      ...note,
      startMs: note.startBeat * beatMs,
      durationMs: note.durationBeats * beatMs,
      status: 'pending',
    }));
    setLessonNotes(seedNotes);
    setLessonElapsedMs(0);
    setLessonStartedAt(performance.now());
    setIsLessonRunning(true);
  };

  const stopLesson = () => {
    setIsLessonRunning(false);
    setLessonStartedAt(null);
    setLessonElapsedMs(0);
    stop();
  };

  useEffect(() => {
    if (!isLessonRunning || lessonStartedAt == null) return undefined;

    let rafId = 0;
    const accumulators = noteAccumulatorRef.current;

    const loop = () => {
      const elapsed = performance.now() - lessonStartedAt;
      setLessonElapsedMs(elapsed);

      const detectedLabel = detectedLabelRef.current;

      setLessonNotes((prev) =>
        prev.map((note) => {
          if (note.status !== 'pending') return note;

          const noteOpen = note.startMs - TOLERANCE_MS;
          const noteClose = note.startMs + note.durationMs + TOLERANCE_MS;

          if (elapsed >= noteOpen && elapsed <= noteClose) {
            let acc = accumulators.get(note.id);
            if (!acc) {
              acc = { matchFrames: 0, totalFrames: 0 };
              accumulators.set(note.id, acc);
            }
            acc.totalFrames++;
            if (detectedLabel === note.label) {
              acc.matchFrames++;
            }
            return note;
          }

          if (elapsed > noteClose) {
            const acc = accumulators.get(note.id);
            const ratio = acc && acc.totalFrames > 0 ? acc.matchFrames / acc.totalFrames : 0;
            return { ...note, status: ratio >= HIT_RATIO ? 'hit' : 'miss' };
          }

          return note;
        })
      );

      if (elapsed > lessonDurationMs + 600) {
        setIsLessonRunning(false);
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isLessonRunning, lessonDurationMs, lessonStartedAt]);

  const activeTargetNote = useMemo(() => {
    if (!isLessonRunning) return null;
    return lessonNotes.find((note) => lessonElapsedMs >= note.startMs && lessonElapsedMs <= note.startMs + note.durationMs) ?? null;
  }, [isLessonRunning, lessonElapsedMs, lessonNotes]);

  const scoringTargetNote = useMemo(() => {
    if (!isLessonRunning) return null;
    return lessonNotes.find((note) =>
      note.status === 'pending'
      && lessonElapsedMs >= note.startMs - TOLERANCE_MS
      && lessonElapsedMs <= note.startMs + note.durationMs + TOLERANCE_MS
    ) ?? null;
  }, [isLessonRunning, lessonElapsedMs, lessonNotes]);

  const stats = useMemo(() => {
    const hits = lessonNotes.filter((note) => note.status === 'hit').length;
    const misses = lessonNotes.filter((note) => note.status === 'miss').length;
    return { hits, misses };
  }, [lessonNotes]);

  useEffect(() => {
    const isMatch = scoringTargetNote && currentNote?.label
      ? currentNote.label === scoringTargetNote.label
      : null;

    onAudioUpdate({
      detectedLabel: currentNote?.label ?? null,
      frequency: frequency ?? null,
      loudness,
      isListening,
      targetLabel: activeTargetNote?.label ?? null,
      isMatch,
      hits: stats.hits,
      misses: stats.misses,
    });
  }, [currentNote?.label, frequency, loudness, isListening, activeTargetNote, scoringTargetNote, stats, onAudioUpdate]);

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
          {activeTargetNote ? activeTargetNote.label : 'Press Start'}
        </p>
      </section>

      <LessonStaffPixi
        notes={lessonNotes}
        currentTimeMs={lessonElapsedMs}
        durationMs={lessonDurationMs}
        detectedNoteLabel={currentNote?.label ?? null}
      />

      {error && (
        <p className="text-brand-red font-semibold text-center text-sm">{error}</p>
      )}
    </div>
  );
}
