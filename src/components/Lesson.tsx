import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LESSON } from '../config/staff';
import { useSharedAudioEngine } from '../context/AudioEngineContext';
import { isLiveMatching } from '../dsp/holdScorer';
import { NoteEventScorer } from '../dsp/noteEventScorer';
import { savePracticeSession } from '../storage/db';
import type {
  Lesson as LessonType,
  LessonNoteStatus,
  LessonTimelineNote,
  NoteAttemptResult,
} from '../types/lesson';
import { readCalibration } from '../utils/calibrationStorage';
import type { AudioFeedback } from './BottomBar';
import { LessonResults } from './LessonResults';
import { LessonStaffPixi } from './LessonStaffPixi';

type LessonPhase = 'idle' | 'countdown' | 'playing' | 'results';

interface LessonProps {
  lesson: LessonType;
  onAudioUpdate: (feedback: AudioFeedback) => void;
  onSelectNextLesson?: () => void;
  onBackHome: () => void;
}

export function Lesson({
  lesson,
  onAudioUpdate,
  onSelectNextLesson,
  onBackHome,
}: LessonProps) {
  const {
    isListening,
    currentNote,
    frequency,
    loudness,
    error,
    audioLatencyMs,
    detectionRef,
    start,
    stop,
    subscribeNoteEvents,
    resetDsp,
  } = useSharedAudioEngine();

  const [phase, setPhase] = useState<LessonPhase>('idle');
  const [countdown, setCountdown] = useState<number>(LESSON.countdownSeconds);
  const [activeTargetLabel, setActiveTargetLabel] = useState<string | null>(null);
  const [stats, setStats] = useState({ hits: 0, misses: 0 });
  const [results, setResults] = useState<NoteAttemptResult[]>([]);
  const [seqStep, setSeqStep] = useState(0);

  const lessonStartedAtRef = useRef<number | null>(null);
  const lessonAudioStartMsRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const scorerRef = useRef<NoteEventScorer | null>(null);
  const activeTargetLabelRef = useRef<string | null>(null);

  const beatMs = 60_000 / lesson.tempoBpm;

  const lessonDurationMs = useMemo(
    () =>
      lesson.notes.reduce((max, note) => {
        const noteEnd = (note.startBeat + note.durationBeats) * beatMs;
        return Math.max(max, noteEnd);
      }, 0),
    [beatMs, lesson.notes],
  );

  const timelineNotes = useMemo<LessonTimelineNote[]>(
    () =>
      lesson.notes.map((note) => ({
        ...note,
        startMs: note.startBeat * beatMs,
        durationMs: note.durationBeats * beatMs,
        status: 'pending' as LessonNoteStatus,
      })),
    [beatMs, lesson.notes],
  );

  const resetScoringState = useCallback(() => {
    scorerRef.current = null;
    noteStatusRef.current = {};
    activeTargetLabelRef.current = null;
    setActiveTargetLabel(null);
    setStats({ hits: 0, misses: 0 });
    setResults([]);
    currentTimeRef.current = 0;
    lessonStartedAtRef.current = null;
    lessonAudioStartMsRef.current = null;
  }, []);

  const beginCountdown = useCallback(async () => {
    if (!isListening) {
      await start();
    } else {
      resetDsp();
    }
    resetScoringState();
    setSeqStep(0);
    setCountdown(LESSON.countdownSeconds);
    setPhase('countdown');
  }, [isListening, start, resetDsp, resetScoringState]);

  const beginPlaying = useCallback(() => {
    lessonStartedAtRef.current = performance.now();
    lessonAudioStartMsRef.current = detectionRef.current.audioTimeMs || 0;
    setPhase('playing');
  }, [detectionRef]);

  const stopLesson = useCallback(() => {
    setPhase('idle');
    lessonStartedAtRef.current = null;
    currentTimeRef.current = 0;
  }, []);

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

  // --- Guitar trigger: E3 → G3 → C4 starts or replays the lesson ---
  const seqIndexRef = useRef(0);
  const seqLastAtRef = useRef(0);

  useEffect(() => {
    if ((phase !== 'idle' && phase !== 'results') || !isListening) {
      seqIndexRef.current = 0;
      setSeqStep(0);
      return;
    }

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
      setSeqStep(seqIndexRef.current);

      if (seqIndexRef.current >= seq.length) {
        seqIndexRef.current = 0;
        setSeqStep(0);
        void beginCountdown();
      }
    } else if (label === seq[0]) {
      seqIndexRef.current = 1;
      seqLastAtRef.current = now;
      setSeqStep(1);
    } else if (seqIndexRef.current > 0 && label !== seq[seqIndexRef.current - 1]) {
      seqIndexRef.current = 0;
      setSeqStep(0);
    }
  }, [phase, isListening, currentNote?.label, beginCountdown]);

  // --- Subscribe NoteEvents for onset timing & repeated-note enforcement ---
  useEffect(() => {
    if (phase !== 'playing') return undefined;

    return subscribeNoteEvents((ev) => {
      const scorer = scorerRef.current;
      if (!scorer) return;
      const baseAudioMs = lessonAudioStartMsRef.current ?? 0;
      const shifted = { ...ev, onsetMs: ev.onsetMs - baseAudioMs };
      const changed = scorer.observeNoteEvent(shifted, noteStatusRef.current);
      if (changed) {
        setStats((prev) => ({ ...prev, hits: prev.hits + 1 }));
      }
    });
  }, [phase, subscribeNoteEvents]);

  // --- Scoring + time loop (playing phase only) ---
  useEffect(() => {
    if (phase !== 'playing' || lessonStartedAtRef.current == null) return undefined;

    const extraLatency = readCalibration()?.extraLatencyMs ?? 0;
    const totalLatencyMs = Math.max(0, audioLatencyMs + extraLatency);
    const scorer = new NoteEventScorer(timelineNotes, beatMs, {
      latencyMs: totalLatencyMs,
    });
    scorerRef.current = scorer;
    const statuses = noteStatusRef.current;

    let rafId = 0;
    let lastTickNow = performance.now();

    const loop = () => {
      const now = performance.now();
      const dtMs = now - lastTickNow;
      lastTickNow = now;

      const startedAt = lessonStartedAtRef.current ?? now;
      const elapsed = now - startedAt;
      currentTimeRef.current = elapsed;

      const det = detectionRef.current;
      const { activeTargetLabel: activeLabel, statusChanged, hits, misses } = scorer.step(
        elapsed,
        dtMs,
        det.hz,
        det.confidence,
        det.tuningOffsetCents,
        statuses,
      );

      if (statusChanged) {
        setStats({ hits, misses });
      }

      if (activeLabel !== activeTargetLabelRef.current) {
        activeTargetLabelRef.current = activeLabel;
        setActiveTargetLabel(activeLabel);
      }

      if (elapsed > lessonDurationMs + beatMs) {
        const final = scorer.finalizeAll(statuses);
        setStats({ hits: final.hits, misses: final.misses });
        setResults(final.results);
        setPhase('results');

        const timingVals = final.results
          .map((r) => r.timingOffsetMs)
          .filter((v): v is number => v != null);
        const centsVals = final.results
          .map((r) => r.meanCents)
          .filter((v): v is number => v != null);
        const total = final.hits + final.misses;

        void savePracticeSession({
          id: `lesson-${lesson.id}-${Date.now()}`,
          mode: 'lesson',
          title: lesson.title,
          startedAtIso: new Date().toISOString(),
          durationSec: Math.round((lessonDurationMs + beatMs) / 1000),
          tempoBpm: lesson.tempoBpm,
          hits: final.hits,
          misses: final.misses,
          accuracy: total > 0 ? final.hits / total : 0,
          meanTimingOffsetMs:
            timingVals.length > 0
              ? Math.round(timingVals.reduce((s, v) => s + v, 0) / timingVals.length)
              : null,
          meanCentsError:
            centsVals.length > 0
              ? Math.round(centsVals.reduce((s, v) => s + v, 0) / centsVals.length)
              : null,
          noteResults: final.results,
        });
        return;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [audioLatencyMs, beatMs, detectionRef, lesson, phase, lessonDurationMs, timelineNotes]);

  // Forward audio feedback to the bottom bar using cents-based matching.
  useEffect(() => {
    const det = detectionRef.current;
    const isMatch =
      activeTargetLabel && currentNote != null
        ? isLiveMatching(
            activeTargetLabel,
            currentNote.frequency,
            1,
            det.tuningOffsetCents,
          ).isMatch
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
  }, [currentNote, detectionRef, frequency, loudness, isListening, activeTargetLabel, stats, onAudioUpdate]);

  const seqLabels = LESSON.guitarStartSequence;

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl mx-auto">
      {phase === 'results' ? (
        <LessonResults
          lesson={lesson}
          results={results}
          onRetry={beginCountdown}
          onNextLesson={onSelectNextLesson}
          onBackHome={onBackHome}
          guitarSequenceStep={seqStep}
          guitarSequence={seqLabels}
          isListening={isListening}
        />
      ) : (
        <section className="sp-card-padded">
          {phase === 'idle' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button type="button" onClick={beginCountdown} className="sp-btn-primary">
                  Start Lesson
                </button>
              </div>

              <div className="p-3.5 rounded-lg bg-sp-elevated/70 border border-white/10 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted">
                    Hands-free guitar start
                  </div>
                  <p className="text-xs text-sp-text-sub mt-0.5">
                    {isListening
                      ? 'Play these three notes in order on your guitar to launch countdown:'
                      : 'Enable the mic to start hands-free by playing:'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {seqLabels.map((label, idx) => {
                    const lit = idx < seqStep;
                    const nextUp = isListening && idx === seqStep;
                    return (
                      <div key={label} className="flex items-center gap-2">
                        <span
                          className={`px-3 py-1 rounded-md text-xs font-extrabold border transition-colors ${
                            lit
                              ? 'bg-sp-green text-black border-sp-green'
                              : nextUp
                                ? 'bg-sp-green/15 text-sp-green border-sp-green/50'
                                : 'bg-sp-black/50 text-sp-text-sub border-white/15'
                          }`}
                        >
                          {label}
                        </span>
                        {idx < seqLabels.length - 1 && (
                          <span className="text-sp-text-muted text-xs">&rarr;</span>
                        )}
                      </div>
                    );
                  })}
                  {!isListening && (
                    <button
                      type="button"
                      onClick={() => void start()}
                      className="sp-btn-secondary ml-2 text-xs py-1.5 px-3"
                    >
                      Mic On
                    </button>
                  )}
                </div>
              </div>
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
              <p className="text-sm text-sp-text-sub font-semibold">
                Lesson in progress... ({lesson.tempoBpm} BPM)
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={stopLesson} className="sp-btn-secondary">
                  Stop
                </button>
                {isListening && (
                  <button type="button" onClick={stop} className="sp-btn-ghost text-xs">
                    Mic Off
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {phase !== 'results' && (
        <section className="sp-card-padded text-center">
          <p className="sp-section-label mb-2">Target note</p>
          <p className="text-4xl font-extrabold text-white">
            {phase === 'countdown'
              ? `Starting in ${countdown}...`
              : activeTargetLabel ?? (phase === 'playing' ? '...' : 'Press Start')}
          </p>
        </section>
      )}

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
