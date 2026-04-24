import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LessonStaffPixi } from './LessonStaffPixi';
import { useAudioEngine } from '../hooks/useAudioEngine';
import type { AudioFeedback } from './BottomBar';
import type { Lesson as LessonType, LessonNoteStatus, LessonTimelineNote } from '../types/lesson';
import { SCORING, LESSON } from '../config/staff';

type LessonPhase = 'idle' | 'countdown' | 'playing';

interface LessonProps {
  lesson: LessonType;
  onAudioUpdate: (feedback: AudioFeedback) => void;
}

export function Lesson({ lesson, onAudioUpdate }: LessonProps) {
  const { isListening, currentNote, frequency, loudness, error, detectionRef, start, stop } = useAudioEngine();
  const [phase, setPhase] = useState<LessonPhase>('idle');
  const [countdown, setCountdown] = useState<number>(LESSON.countdownSeconds);
  const [activeTargetLabel, setActiveTargetLabel] = useState<string | null>(null);
  const [stats, setStats] = useState({ hits: 0, misses: 0 });

  const lessonStartedAtRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const accumulatorsRef = useRef<Map<string, { matchFrames: number; totalFrames: number }>>(new Map());
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

  const resetScoringState = useCallback(() => {
    accumulatorsRef.current = new Map();
    noteStatusRef.current = {};
    activeTargetLabelRef.current = null;
    setActiveTargetLabel(null);
    setStats({ hits: 0, misses: 0 });
    currentTimeRef.current = 0;
    lessonStartedAtRef.current = null;
  }, []);

  const beginCountdown = useCallback(async () => {
    await start();
    resetScoringState();
    setCountdown(LESSON.countdownSeconds);
    setPhase('countdown');
  }, [start, resetScoringState]);

  const beginPlaying = useCallback(() => {
    lessonStartedAtRef.current = performance.now();
    setPhase('playing');
  }, []);

  const stopLesson = useCallback(() => {
    setPhase('idle');
    lessonStartedAtRef.current = null;
    currentTimeRef.current = 0;
    stop();
  }, [stop]);

  // --- Countdown timer ---
  useEffect(() => {
    if (phase !== 'countdown') return;

    if (countdown <= 0) {
      beginPlaying();
      return;
    }

    const t = window.setTimeout(() => {
      setCountdown((c) => c - 1);
    }, 1000);

    return () => window.clearTimeout(t);
  }, [phase, countdown, beginPlaying]);

  // --- Guitar trigger: E3 → G3 → C4 starts the lesson from idle ---
  const seqIndexRef = useRef(0);
  const seqLastAtRef = useRef(0);

  useEffect(() => {
    if (phase !== 'idle' || !isListening) return;

    const label = currentNote?.label ?? null;
    if (!label) return;

    const now = performance.now();
    const seq = LESSON.guitarStartSequence;
    const gap = LESSON.guitarStartSequenceGapMs;

    if (now - seqLastAtRef.current > gap) {
      seqIndexRef.current = 0;
    }

    if (label === seq[seqIndexRef.current]) {
      seqIndexRef.current += 1;
      seqLastAtRef.current = now;

      if (seqIndexRef.current >= seq.length) {
        seqIndexRef.current = 0;
        beginCountdown();
      }
    } else if (label === seq[0]) {
      seqIndexRef.current = 1;
      seqLastAtRef.current = now;
    } else {
      seqIndexRef.current = 0;
    }
  }, [phase, isListening, currentNote?.label, beginCountdown]);

  // --- Scoring + time loop (playing phase only) ---
  useEffect(() => {
    if (phase !== 'playing' || lessonStartedAtRef.current == null) return undefined;

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
          if (finalStatus === 'hit') newHits += 1;
          else newMisses += 1;
        }
      }

      if (statusChanged) {
        setStats({ hits: newHits, misses: newMisses });
      }

      if (activeLabel !== activeTargetLabelRef.current) {
        activeTargetLabelRef.current = activeLabel;
        setActiveTargetLabel(activeLabel);
      }

      if (elapsed > lessonDurationMs + beatMs) {
        setPhase('idle');
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [beatMs, detectionRef, phase, lessonDurationMs, timelineNotes]);

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

  const seqLabels = LESSON.guitarStartSequence;

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto">
      <section className="sp-card-padded">
        {phase === 'idle' && (
          <div>
            <button type="button" onClick={beginCountdown} className="sp-btn-primary">
              Start Lesson
            </button>
            {isListening && (
              <p className="text-xs text-sp-text-muted text-center mt-3">
                or play <span className="font-bold text-white">{seqLabels.join(' → ')}</span> on your guitar to start
              </p>
            )}
          </div>
        )}

        {phase === 'countdown' && (
          <div className="flex flex-col items-center gap-2 py-4">
            <p className="text-sm font-semibold text-sp-text-sub uppercase tracking-widest">Get ready</p>
            <p className="text-7xl font-extrabold text-sp-green tabular-nums">{countdown}</p>
          </div>
        )}

        {phase === 'playing' && (
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
          {phase === 'countdown'
            ? `Starting in ${countdown}...`
            : activeTargetLabel ?? (phase === 'playing' ? '...' : 'Press Start')}
        </p>
      </section>

      <LessonStaffPixi
        notes={timelineNotes}
        currentTimeRef={currentTimeRef}
        detectionRef={detectionRef}
        noteStatusRef={noteStatusRef}
      />

      {error && (
        <p className="text-brand-red font-semibold text-center text-sm">{error}</p>
      )}
    </div>
  );
}
