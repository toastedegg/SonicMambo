import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackingTransport,
  GROOVE_STYLE_META,
  soundGenerator,
  type GrooveStyleId,
  type GuideGuitarLevel,
} from '../audio/backingTrackEngine';
import { AMP_PRESETS, type AmpPresetId } from '../audio/guitarAmpRig';
import { useAudioEngineControl } from '../context/AudioEngineContext';
import {
  getChapterForCourse,
  type CoursePracticeMode,
  type CourseTabNote,
  type GuitarCourse,
} from '../data/guitarCourses';
import { HoldNoteScorer } from '../dsp/holdScorer';
import { savePracticeSession } from '../storage/db';
import type { LessonNoteStatus, LessonTimelineNote } from '../types/lesson';
import { PASS_ACCURACY_THRESHOLD, type CourseMasteryRecord } from '../utils/courseProgress';
import {
  MinimalScoreCanvasPixi,
  type HiddenDifficulty,
  type NotationMode,
  type StageMotionSnapshot,
} from './MinimalScoreCanvasPixi';

export interface AttemptOutcome {
  passed: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  newlyUnlockedCourse: GuitarCourse | null;
}

interface CourseStageViewProps {
  course: GuitarCourse;
  initialMode?: CoursePracticeMode;
  mastery: CourseMasteryRecord | undefined;
  nextCourse: GuitarCourse | null;
  isNextUnlocked: boolean;
  onRecordAttempt: (params: {
    courseId: string;
    mode: CoursePracticeMode;
    accuracy: number;
  }) => AttemptOutcome;
  onSelectCourse: (course: GuitarCourse, mode?: CoursePracticeMode) => void;
  onBackToRoadmap: () => void;
}

interface StageRunSummary {
  mode: CoursePracticeMode;
  hits: number;
  misses: number;
  accuracy: number;
  meanCents: number | null;
  passed: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  newlyUnlockedCourse: GuitarCourse | null;
}

const NOTATION_STORAGE_KEY = 'sonicmambo:notationMode';

function readNotationMode(): NotationMode {
  try {
    const raw = window.localStorage.getItem(NOTATION_STORAGE_KEY);
    return raw === 'tab' ? 'tab' : 'staff';
  } catch {
    return 'staff';
  }
}

function writeNotationMode(m: NotationMode): void {
  try {
    window.localStorage.setItem(NOTATION_STORAGE_KEY, m);
  } catch {
    // ignore
  }
}

const MODE_ITEMS: ReadonlyArray<{ id: CoursePracticeMode; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'loop', label: 'Loop' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'hidden', label: 'Hidden' },
];

const INITIAL_MOTION: StageMotionSnapshot = {
  running: false,
  previewing: false,
  inCountIn: false,
  countInNumber: 4,
  shadowPhase: 'idle',
  courseBeat: 0,
  beatInBar: 0,
  activeTargetNoteId: null,
  focusStartBeat: 0,
};

export function CourseStageView({
  course,
  initialMode = 'play',
  mastery,
  nextCourse,
  isNextUnlocked,
  onRecordAttempt,
  onSelectCourse,
  onBackToRoadmap,
}: CourseStageViewProps) {
  const {
    isListening,
    audioLatencyMs,
    ampSettings,
    detectionRef,
    start,
    updateAmpSettings,
    setInputGated,
    resetDsp,
  } = useAudioEngineControl();

  const chapter = useMemo(() => getChapterForCourse(course), [course]);

  const [notationMode, setNotationMode] = useState<NotationMode>(() =>
    readNotationMode(),
  );
  const [mode, setMode] = useState<CoursePracticeMode>(initialMode);
  const [bpm, setBpm] = useState<number>(course.tempoBpm);
  const [grooveStyle, setGrooveStyle] = useState<GrooveStyleId>(course.defaultGroove);
  const [guideGuitar, setGuideGuitar] = useState<GuideGuitarLevel>('off');
  const [volumePct, setVolumePct] = useState<number>(() =>
    Math.round(soundGenerator.getVolume() * 100),
  );
  const [soundMenuOpen, setSoundMenuOpen] = useState<boolean>(false);

  // Mode micro-settings
  const [loopRange, setLoopRange] = useState<
    'all' | { startBar: number; endBar: number }
  >('all');
  const [autoSpeedUp, setAutoSpeedUp] = useState<boolean>(true);
  const [shadowBarsPerPhrase, setShadowBarsPerPhrase] = useState<1 | 2>(2);
  const [hiddenDifficulty, setHiddenDifficulty] =
    useState<HiddenDifficulty>('ghost-passing');

  // Discrete UI state ONLY (never mutated at 60/120fps!)
  const [runState, setRunState] = useState<'idle' | 'running' | 'preview' | 'results'>('idle');
  const [loopPassMeta, setLoopPassMeta] = useState<{
    passes: number;
    lastAccuracy: number | null;
  }>({ passes: 0, lastAccuracy: null });
  const [summary, setSummary] = useState<StageRunSummary | null>(null);

  // High-frequency refs read directly by Pixi.js WebGL ticker (0 React renders per frame!)
  const motionRef = useRef<StageMotionSnapshot>({ ...INITIAL_MOTION });
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const transportRef = useRef<BackingTransport | null>(null);
  const rafRef = useRef<number>(0);
  const scorerRef = useRef<HoldNoteScorer | null>(null);
  const shadowCancelledRef = useRef<boolean>(false);
  const soundMenuRef = useRef<HTMLDivElement | null>(null);

  const stopEverything = useCallback(() => {
    shadowCancelledRef.current = true;
    transportRef.current?.stop();
    transportRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setInputGated(false);
    motionRef.current.running = false;
    motionRef.current.previewing = false;
    motionRef.current.inCountIn = false;
    motionRef.current.shadowPhase = 'idle';
    motionRef.current.activeTargetNoteId = null;
    setRunState((prev) => (prev === 'results' ? 'results' : 'idle'));
  }, [setInputGated]);

  useEffect(() => {
    stopEverything();
    setMode(initialMode);
    setBpm(course.tempoBpm);
    setGrooveStyle(course.defaultGroove);
    setLoopRange('all');
    setSummary(null);
    setLoopPassMeta({ passes: 0, lastAccuracy: null });
    noteStatusRef.current = {};
    motionRef.current = { ...INITIAL_MOTION };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, initialMode]);

  useEffect(() => {
    return () => {
      shadowCancelledRef.current = true;
      transportRef.current?.stop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setInputGated(false);
    };
  }, [setInputGated]);

  // Close sound popover on outside click
  useEffect(() => {
    if (!soundMenuOpen) return undefined;
    const onDocClick = (ev: MouseEvent) => {
      if (soundMenuRef.current && !soundMenuRef.current.contains(ev.target as Node)) {
        setSoundMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocClick);
    return () => window.removeEventListener('mousedown', onDocClick);
  }, [soundMenuOpen]);

  // Live update groove & guide guitar on active transport
  useEffect(() => {
    if (runState === 'running' && motionRef.current.shadowPhase !== 'listen') {
      transportRef.current?.updateLiveOptions({ grooveStyle, guideGuitar });
    } else if (runState === 'preview') {
      transportRef.current?.updateLiveOptions({ grooveStyle, guideGuitar: 'full' });
    }
  }, [grooveStyle, guideGuitar, runState]);

  const activeCycle = useMemo(() => {
    const startBar =
      mode === 'loop' && loopRange !== 'all' ? loopRange.startBar : 1;
    const endBar =
      mode === 'loop' && loopRange !== 'all' ? loopRange.endBar : course.totalBars;

    const startBeatOffset = (startBar - 1) * course.beatsPerBar;
    const totalBeats = (endBar - startBar + 1) * course.beatsPerBar;
    const cycleNotes: CourseTabNote[] = course.notes
      .filter((n) => n.bar >= startBar && n.bar <= endBar)
      .map((n) => ({
        ...n,
        startBeat: n.startBeat - startBeatOffset,
      }));

    return { startBar, endBar, startBeatOffset, totalBeats, notes: cycleNotes };
  }, [course.beatsPerBar, course.notes, course.totalBars, loopRange, mode]);

  const handleToggleNotation = (next: NotationMode) => {
    setNotationMode(next);
    writeNotationMode(next);
  };

  const handleSwitchMode = (nextMode: CoursePracticeMode) => {
    stopEverything();
    setSummary(null);
    noteStatusRef.current = {};
    setMode(nextMode);
    if (nextMode === 'loop') {
      setBpm(Math.max(50, Math.round(course.tempoBpm * 0.85)));
    } else {
      setBpm(course.tempoBpm);
      setLoopRange('all');
      motionRef.current.focusStartBeat = 0;
    }
  };

  const handleSelectBar = useCallback(
    (barNum: number) => {
      if (mode === 'loop') {
        if (runState === 'running') return;
        setLoopRange((prev) => {
          if (prev !== 'all' && prev.startBar === barNum && prev.endBar === barNum) {
            motionRef.current.focusStartBeat = 0;
            return 'all';
          }
          motionRef.current.focusStartBeat = (barNum - 1) * course.beatsPerBar;
          return { startBar: barNum, endBar: barNum };
        });
      } else if (runState === 'idle' || runState === 'results') {
        motionRef.current.focusStartBeat = (barNum - 1) * course.beatsPerBar;
      }
    },
    [course.beatsPerBar, mode, runState],
  );

  const handleVolumeChange = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    setVolumePct(clamped);
    soundGenerator.setVolume(clamped / 100);
  };

  /* ─────────────── SOUND GENERATOR PREVIEW ("HEAR") ─────────────── */
  const startSoundPreview = useCallback(() => {
    stopEverything();
    shadowCancelledRef.current = false;
    setSummary(null);
    noteStatusRef.current = {};
    setInputGated(true);

    const previewStyle: GrooveStyleId =
      grooveStyle === 'off' ? course.defaultGroove : grooveStyle;

    const transport = new BackingTransport({
      bpm,
      beatsPerBar: course.beatsPerBar,
      totalBeats: activeCycle.totalBeats,
      countInBeats: 0,
      loop: false,
      grooveStyle: previewStyle,
      guideGuitar: 'full',
      notes: activeCycle.notes,
      onComplete: () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setInputGated(false);
        motionRef.current.previewing = false;
        motionRef.current.activeTargetNoteId = null;
        setRunState('idle');
      },
    });

    transportRef.current = transport;
    motionRef.current.previewing = true;
    motionRef.current.running = false;
    motionRef.current.courseBeat = activeCycle.startBeatOffset;
    setRunState('preview');
    transport.start();

    const tick = () => {
      if (!transport.isRunning()) return;
      const pos = transport.getPosition();
      motionRef.current.courseBeat = activeCycle.startBeatOffset + pos.elapsedBeats;
      motionRef.current.beatInBar = pos.beatInBar;

      let activeId: string | null = null;
      for (let i = 0; i < activeCycle.notes.length; i += 1) {
        const n = activeCycle.notes[i];
        if (pos.elapsedBeats >= n.startBeat && pos.elapsedBeats < n.startBeat + n.durationBeats) {
          activeId = n.id;
          break;
        }
      }
      motionRef.current.activeTargetNoteId = activeId;

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [activeCycle, bpm, course.beatsPerBar, course.defaultGroove, grooveStyle, setInputGated, stopEverything]);

  /* ─────────────── PLAY / HIDDEN / LOOP RUNNER (ZERO REACT RE-RENDERS!) ─────────────── */
  const startTimedRun = useCallback(
    async (overrideBpm?: number, skipCountIn: boolean = false) => {
      if (!isListening) {
        await start();
      } else {
        resetDsp();
      }

      stopEverything();
      shadowCancelledRef.current = false;
      setSummary(null);

      const effectiveBpm = overrideBpm ?? bpm;
      const beatMs = 60_000 / Math.max(35, effectiveBpm);
      const isLoopMode = mode === 'loop';

      const timelineNotes: LessonTimelineNote[] = activeCycle.notes.map((n) => ({
        id: n.id,
        label: n.label,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats,
        startMs: n.startBeat * beatMs,
        durationMs: n.durationBeats * beatMs,
        status: 'pending',
      }));

      noteStatusRef.current = {};
      scorerRef.current = new HoldNoteScorer(timelineNotes, beatMs, {
        latencyMs: audioLatencyMs,
      });

      const finalizeFullRun = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        const scorer = scorerRef.current;
        if (!scorer) return;
        const final = scorer.finalizeAll(noteStatusRef.current);

        const total = Math.max(1, final.hits + final.misses);
        const accuracy = final.hits / total;
        const centsVals = final.summaries
          .map((s) => s.medianCents)
          .filter((v): v is number => v != null);
        const meanCents =
          centsVals.length > 0
            ? Math.round(centsVals.reduce((a, b) => a + b, 0) / centsVals.length)
            : null;

        const outcome = onRecordAttempt({
          courseId: course.id,
          mode,
          accuracy,
        });

        void savePracticeSession({
          id: `course-${course.id}-${mode}-${Date.now()}`,
          mode: 'course',
          title: `${course.title} (${mode.toUpperCase()})`,
          startedAtIso: new Date().toISOString(),
          durationSec: Math.round((activeCycle.totalBeats * beatMs) / 1000),
          tempoBpm: effectiveBpm,
          hits: final.hits,
          misses: final.misses,
          accuracy,
          meanTimingOffsetMs: null,
          meanCentsError: meanCents,
          noteResults: final.summaries.map((s) => ({
            noteId: s.noteId,
            targetLabel: s.label,
            status: s.status === 'hit' ? 'hit' : 'miss',
            holdDurationMs: Math.round(s.maxHoldMs),
            timingOffsetMs: s.timingOffsetMs != null ? Math.round(s.timingOffsetMs) : null,
            meanCents: s.medianCents != null ? Math.round(s.medianCents) : null,
          })),
        });

        motionRef.current.running = false;
        motionRef.current.inCountIn = false;
        motionRef.current.activeTargetNoteId = null;

        setSummary({
          mode,
          hits: final.hits,
          misses: final.misses,
          accuracy,
          meanCents,
          passed: outcome.passed,
          starsEarned: outcome.starsEarned,
          newlyUnlockedCourse: outcome.newlyUnlockedCourse,
        });
        setRunState('results');
      };

      const handleLoopRevolutionEnd = () => {
        const scorer = scorerRef.current;
        if (!scorer) return;
        const passRes = scorer.finalizeAll(noteStatusRef.current);
        const total = Math.max(1, passRes.hits + passRes.misses);
        const passAcc = passRes.hits / total;

        if (passAcc >= PASS_ACCURACY_THRESHOLD) {
          onRecordAttempt({ courseId: course.id, mode: 'loop', accuracy: passAcc });
        }

        const clean = passAcc >= 0.85;
        let nextBpmToRestart: number | null = null;
        if (autoSpeedUp && clean && effectiveBpm < Math.round(course.tempoBpm * 1.25)) {
          nextBpmToRestart = Math.min(
            Math.round(course.tempoBpm * 1.25),
            Math.max(effectiveBpm + 2, Math.round(effectiveBpm * 1.05)),
          );
        }

        setLoopPassMeta((prev) => ({
          passes: prev.passes + 1,
          lastAccuracy: passAcc,
        }));

        if (nextBpmToRestart != null) {
          const targetBpm = nextBpmToRestart;
          setBpm(targetBpm);
          window.setTimeout(() => {
            void startTimedRun(targetBpm, true);
          }, 0);
          return;
        }

        noteStatusRef.current = {};
        scorerRef.current = new HoldNoteScorer(timelineNotes, beatMs, {
          latencyMs: audioLatencyMs,
        });
      };

      const transport = new BackingTransport({
        bpm: effectiveBpm,
        beatsPerBar: course.beatsPerBar,
        totalBeats: activeCycle.totalBeats,
        countInBeats: skipCountIn ? 0 : 4,
        loop: isLoopMode,
        grooveStyle,
        guideGuitar,
        notes: activeCycle.notes,
        onLoopWrap: isLoopMode ? handleLoopRevolutionEnd : undefined,
        onComplete: !isLoopMode ? finalizeFullRun : undefined,
      });

      transportRef.current = transport;
      motionRef.current.running = true;
      motionRef.current.previewing = false;
      motionRef.current.shadowPhase = 'idle';
      motionRef.current.courseBeat = activeCycle.startBeatOffset;
      setRunState('running');
      transport.start();

      let lastTickPerf = performance.now();

      // Pure ref mutation loop — ZERO setState calls inside RAF!
      const tick = () => {
        if (!transport.isRunning()) return;
        const nowPerf = performance.now();
        const dtMs = nowPerf - lastTickPerf;
        lastTickPerf = nowPerf;

        const pos = transport.getPosition();
        const m = motionRef.current;
        m.inCountIn = pos.inCountIn;
        m.countInNumber = pos.countInNumber;
        m.beatInBar = pos.beatInBar;

        if (pos.inCountIn) {
          m.courseBeat = activeCycle.startBeatOffset;
          m.activeTargetNoteId = activeCycle.notes[0]?.id ?? null;
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        m.courseBeat = activeCycle.startBeatOffset + pos.elapsedBeats;

        let activeId: string | null = null;
        for (let i = 0; i < activeCycle.notes.length; i += 1) {
          const n = activeCycle.notes[i];
          if (
            pos.elapsedBeats >= n.startBeat &&
            pos.elapsedBeats < n.startBeat + n.durationBeats
          ) {
            activeId = n.id;
            break;
          }
        }
        m.activeTargetNoteId = activeId;

        const det = detectionRef.current;
        scorerRef.current?.step(
          pos.elapsedMs,
          dtMs,
          det.hz,
          det.confidence,
          det.tuningOffsetCents,
          noteStatusRef.current,
        );

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [
      activeCycle,
      audioLatencyMs,
      autoSpeedUp,
      bpm,
      course.beatsPerBar,
      course.id,
      course.tempoBpm,
      course.title,
      detectionRef,
      grooveStyle,
      guideGuitar,
      isListening,
      mode,
      onRecordAttempt,
      resetDsp,
      start,
      stopEverything,
    ],
  );

  /* ─────────────── SHADOWING MODE (ZERO REACT RE-RENDERS!) ─────────────── */
  const startShadowingRun = useCallback(async () => {
    if (!isListening) {
      await start();
    } else {
      resetDsp();
    }

    stopEverything();
    shadowCancelledRef.current = false;
    setSummary(null);
    noteStatusRef.current = {};

    const phrases: Array<{ startBar: number; endBar: number }> = [];
    for (let b = 1; b <= course.totalBars; b += shadowBarsPerPhrase) {
      phrases.push({
        startBar: b,
        endBar: Math.min(course.totalBars, b + shadowBarsPerPhrase - 1),
      });
    }

    const beatMs = 60_000 / Math.max(35, bpm);
    const effectiveGroove: GrooveStyleId =
      grooveStyle === 'off' ? course.defaultGroove : grooveStyle;

    motionRef.current.running = true;
    motionRef.current.previewing = false;
    setRunState('running');

    let totalHits = 0;
    let totalMisses = 0;
    const allCents: number[] = [];

    const runPhasePromise = (
      phrase: { startBar: number; endBar: number },
      phaseKind: 'listen' | 'respond',
      isVeryFirst: boolean,
    ): Promise<void> =>
      new Promise((resolve) => {
        if (shadowCancelledRef.current) {
          resolve();
          return;
        }

        const startBeatOffset = (phrase.startBar - 1) * course.beatsPerBar;
        const phraseBeats = (phrase.endBar - phrase.startBar + 1) * course.beatsPerBar;
        const phraseNotes: CourseTabNote[] = course.notes
          .filter((n) => n.bar >= phrase.startBar && n.bar <= phrase.endBar)
          .map((n) => ({
            ...n,
            startBeat: n.startBeat - startBeatOffset,
          }));

        motionRef.current.shadowPhase = phaseKind;
        motionRef.current.courseBeat = startBeatOffset;

        if (phaseKind === 'listen') {
          setInputGated(true);
        } else {
          setInputGated(false);
          resetDsp();
        }

        const phraseTimeline: LessonTimelineNote[] = phraseNotes.map((n) => ({
          id: n.id,
          label: n.label,
          startBeat: n.startBeat,
          durationBeats: n.durationBeats,
          startMs: n.startBeat * beatMs,
          durationMs: n.durationBeats * beatMs,
          status: 'pending',
        }));

        const phraseScorer =
          phaseKind === 'respond'
            ? new HoldNoteScorer(phraseTimeline, beatMs, { latencyMs: audioLatencyMs })
            : null;

        const transport = new BackingTransport({
          bpm,
          beatsPerBar: course.beatsPerBar,
          totalBeats: phraseBeats,
          countInBeats: isVeryFirst ? 4 : 0,
          loop: false,
          grooveStyle: effectiveGroove,
          guideGuitar: phaseKind === 'listen' ? 'full' : 'off',
          notes: phraseNotes,
          onComplete: () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (phraseScorer) {
              const res = phraseScorer.finalizeAll(noteStatusRef.current);
              totalHits += res.hits;
              totalMisses += res.misses;
              res.summaries.forEach((s) => {
                if (s.medianCents != null) allCents.push(s.medianCents);
              });
            }
            resolve();
          },
        });

        transportRef.current = transport;
        transport.start();

        let lastPerf = performance.now();
        const tick = () => {
          if (shadowCancelledRef.current || !transport.isRunning()) return;
          const nowPerf = performance.now();
          const dtMs = nowPerf - lastPerf;
          lastPerf = nowPerf;

          const pos = transport.getPosition();
          const m = motionRef.current;
          m.inCountIn = pos.inCountIn;
          m.countInNumber = pos.countInNumber;
          m.beatInBar = pos.beatInBar;

          if (pos.inCountIn) {
            m.courseBeat = startBeatOffset;
            m.activeTargetNoteId = phraseNotes[0]?.id ?? null;
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          m.courseBeat = startBeatOffset + pos.elapsedBeats;

          let activeId: string | null = null;
          for (let i = 0; i < phraseNotes.length; i += 1) {
            const n = phraseNotes[i];
            if (
              pos.elapsedBeats >= n.startBeat &&
              pos.elapsedBeats < n.startBeat + n.durationBeats
            ) {
              activeId = n.id;
              break;
            }
          }
          m.activeTargetNoteId = activeId;

          if (phraseScorer) {
            const det = detectionRef.current;
            phraseScorer.step(
              pos.elapsedMs,
              dtMs,
              det.hz,
              det.confidence,
              det.tuningOffsetCents,
              noteStatusRef.current,
            );
          }

          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      });

    for (let i = 0; i < phrases.length; i += 1) {
      if (shadowCancelledRef.current) return;
      await runPhasePromise(phrases[i], 'listen', i === 0);
      if (shadowCancelledRef.current) return;
      await runPhasePromise(phrases[i], 'respond', false);
    }

    if (shadowCancelledRef.current) return;

    setInputGated(false);
    motionRef.current.running = false;
    motionRef.current.shadowPhase = 'idle';
    motionRef.current.activeTargetNoteId = null;

    const total = Math.max(1, totalHits + totalMisses);
    const accuracy = totalHits / total;
    const meanCents =
      allCents.length > 0
        ? Math.round(allCents.reduce((a, b) => a + b, 0) / allCents.length)
        : null;

    const outcome = onRecordAttempt({
      courseId: course.id,
      mode: 'shadow',
      accuracy,
    });

    void savePracticeSession({
      id: `course-${course.id}-shadow-${Date.now()}`,
      mode: 'shadow',
      title: `${course.title} (Shadowing)`,
      startedAtIso: new Date().toISOString(),
      durationSec: Math.round((course.totalBars * course.beatsPerBar * 2 * beatMs) / 1000),
      tempoBpm: bpm,
      hits: totalHits,
      misses: totalMisses,
      accuracy,
      meanTimingOffsetMs: null,
      meanCentsError: meanCents,
      noteResults: [],
    });

    setSummary({
      mode: 'shadow',
      hits: totalHits,
      misses: totalMisses,
      accuracy,
      meanCents,
      passed: outcome.passed,
      starsEarned: outcome.starsEarned,
      newlyUnlockedCourse: outcome.newlyUnlockedCourse,
    });
    setRunState('results');
  }, [
    audioLatencyMs,
    bpm,
    course.beatsPerBar,
    course.defaultGroove,
    course.id,
    course.notes,
    course.title,
    course.totalBars,
    detectionRef,
    grooveStyle,
    isListening,
    onRecordAttempt,
    resetDsp,
    setInputGated,
    shadowBarsPerPhrase,
    start,
    stopEverything,
  ]);

  const handlePrimaryStart = () => {
    if (mode === 'shadow') {
      void startShadowingRun();
    } else {
      void startTimedRun();
    }
  };

  const completedModes = mastery?.completedModes ?? [];
  const activeGrooveShort =
    GROOVE_STYLE_META.find((g) => g.id === grooveStyle)?.shortLabel ?? 'Beat';

  return (
    <div className="min-h-full flex flex-col justify-center px-6 md:px-12 py-8 max-w-5xl mx-auto gap-7">
      {/* Row 1: Calm Minimalist Stage Header + Staff/TAB Switch + Segmented Mode Pill */}
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 text-xs font-semibold text-sp-text-muted">
            <span style={{ color: chapter.accentHex }} className="font-extrabold">
              {String(course.order).padStart(2, '0')}
            </span>
            <span>&middot;</span>
            <span>{course.styleLabel}</span>
            <span>&middot;</span>
            <span>{course.keySignature}</span>
            <span>&middot;</span>
            <span>{course.totalBars} Bars</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {course.title}
          </h1>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Staff | TAB Switch Button */}
          <div
            className="inline-flex items-center p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]"
            role="group"
            aria-label="Notation view"
          >
            {(
              [
                { id: 'staff', label: 'Staff' },
                { id: 'tab', label: 'TAB' },
              ] as const
            ).map((opt) => {
              const active = notationMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleToggleNotation(opt.id)}
                  className={`px-3.5 py-1 rounded-full text-xs font-bold transition-colors ${
                    active
                      ? 'bg-white text-black'
                      : 'text-sp-text-sub hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Compact 4-Mode Segmented Pill */}
          <div
            className="inline-flex items-center p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]"
            role="group"
            aria-label="Practice mode"
          >
            {MODE_ITEMS.map((item) => {
              const selected = mode === item.id;
              const done = completedModes.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSwitchMode(item.id)}
                  className={`px-3.5 py-1 rounded-full text-xs font-bold transition-colors inline-flex items-center gap-1.5 ${
                    selected
                      ? 'text-black'
                      : 'text-sp-text-sub hover:text-white'
                  }`}
                  style={
                    selected ? { backgroundColor: chapter.accentHex } : undefined
                  }
                >
                  <span>{item.label}</span>
                  {done && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        selected ? 'bg-black/70' : 'bg-sp-green'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Row 2: Fluid 120fps Pixi.js v8 Musical Canvas (Staff or TAB) */}
      <MinimalScoreCanvasPixi
        notes={course.notes}
        barChords={course.barChords}
        totalBars={course.totalBars}
        beatsPerBar={course.beatsPerBar}
        accentHex={chapter.accentHex}
        notationMode={notationMode}
        practiceMode={mode}
        hiddenDifficulty={hiddenDifficulty}
        loopRange={loopRange}
        motionRef={motionRef}
        detectionRef={detectionRef}
        noteStatusRef={noteStatusRef}
        onSelectBar={handleSelectBar}
      />

      {/* Row 3: Single Centered Minimalist Floating Transport Capsule */}
      <div className="flex items-center justify-center">
        <div className="relative inline-flex items-center gap-2 px-3 py-2 rounded-full bg-[#11151e] border border-white/[0.08] shadow-xl flex-wrap justify-center">
          {/* Play / Stop */}
          {runState === 'running' ? (
            <button
              type="button"
              onClick={stopEverything}
              className="px-5 py-1.5 rounded-full text-xs font-extrabold bg-rose-500 text-white hover:brightness-110 transition"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePrimaryStart}
              className="px-5 py-1.5 rounded-full text-xs font-extrabold text-black transition-transform hover:scale-[1.02]"
              style={{ backgroundColor: chapter.accentHex }}
            >
              {mode === 'play'
                ? 'Start'
                : mode === 'loop'
                  ? 'Start Loop'
                  : mode === 'shadow'
                    ? 'Start Shadow'
                    : 'Start Hidden'}
            </button>
          )}

          {/* Hear Preview */}
          {runState === 'preview' ? (
            <button
              type="button"
              onClick={stopEverything}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-400 text-black"
            >
              Stop Hear
            </button>
          ) : (
            <button
              type="button"
              disabled={runState === 'running'}
              onClick={startSoundPreview}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold text-sp-text-sub hover:text-white hover:bg-white/[0.06] disabled:opacity-35 transition-colors inline-flex items-center gap-1.5"
              title="Listen to guitar synth + drum beat"
            >
              <span>&#9834;</span>
              <span>Hear</span>
            </button>
          )}

          <span className="h-4 w-px bg-white/[0.08]" aria-hidden />

          {/* Minimal BPM Control */}
          <div className="inline-flex items-center gap-1 text-xs">
            <button
              type="button"
              disabled={runState === 'running'}
              onClick={() => setBpm((b) => Math.max(40, b - 5))}
              className="w-6 h-6 rounded-full text-sp-text-muted hover:text-white hover:bg-white/[0.06] disabled:opacity-35 font-bold"
              aria-label="Decrease tempo"
            >
              &minus;
            </button>
            <span className="font-bold text-white tabular-nums px-1 min-w-[58px] text-center">
              {bpm} BPM
            </span>
            <button
              type="button"
              disabled={runState === 'running'}
              onClick={() => setBpm((b) => Math.min(160, b + 5))}
              className="w-6 h-6 rounded-full text-sp-text-muted hover:text-white hover:bg-white/[0.06] disabled:opacity-35 font-bold"
              aria-label="Increase tempo"
            >
              +
            </button>
          </div>

          {/* Contextual Single Micro-Chip for Active Mode */}
          {mode === 'loop' && (
            <>
              <span className="h-4 w-px bg-white/[0.08]" aria-hidden />
              {loopRange !== 'all' && (
                <button
                  type="button"
                  disabled={runState === 'running'}
                  onClick={() => setLoopRange('all')}
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/10 text-white hover:bg-white/15"
                >
                  Bar {loopRange.startBar} &times;
                </button>
              )}
              <button
                type="button"
                onClick={() => setAutoSpeedUp((v) => !v)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                  autoSpeedUp
                    ? 'bg-sp-green/15 text-sp-green'
                    : 'text-sp-text-muted hover:text-white'
                }`}
                title="Automatically increase BPM by +5% after each clean loop"
              >
                +5% Auto
              </button>
              {loopPassMeta.passes > 0 && (
                <span className="text-[11px] font-semibold text-sp-text-muted tabular-nums px-1">
                  Pass {loopPassMeta.passes} &middot;{' '}
                  {Math.round((loopPassMeta.lastAccuracy ?? 0) * 100)}%
                </span>
              )}
            </>
          )}

          {mode === 'shadow' && (
            <>
              <span className="h-4 w-px bg-white/[0.08]" aria-hidden />
              <button
                type="button"
                disabled={runState === 'running'}
                onClick={() => setShadowBarsPerPhrase((p) => (p === 2 ? 1 : 2))}
                className="px-2.5 py-1 rounded-full text-[11px] font-bold text-sky-300 bg-sky-400/10 hover:bg-sky-400/20 disabled:opacity-40"
              >
                {shadowBarsPerPhrase === 2 ? '2-Bar Echo' : '1-Bar Echo'}
              </button>
            </>
          )}

          {mode === 'hidden' && (
            <>
              <span className="h-4 w-px bg-white/[0.08]" aria-hidden />
              {(
                [
                  { id: 'ghost-passing', label: '50%' },
                  { id: 'bar-anchors', label: '75%' },
                  { id: 'full-blackout', label: '100%' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setHiddenDifficulty(opt.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                    hiddenDifficulty === opt.id
                      ? 'bg-white/15 text-white'
                      : 'text-sp-text-muted hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </>
          )}

          <span className="h-4 w-px bg-white/[0.08]" aria-hidden />

          {/* Clean Sound / Beat Popover Trigger */}
          <div ref={soundMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setSoundMenuOpen((o) => !o)}
              className="px-3 py-1 rounded-full text-xs font-semibold text-sp-text-sub hover:text-white hover:bg-white/[0.06] transition-colors inline-flex items-center gap-1.5"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  grooveStyle === 'off' ? 'bg-white/25' : 'bg-sp-green'
                }`}
              />
              <span>{activeGrooveShort}</span>
            </button>

            {soundMenuOpen && (
              <div className="absolute bottom-full right-0 mb-3 w-72 rounded-2xl bg-[#131823] border border-white/12 p-4 shadow-2xl space-y-4 z-30 text-xs">
                {/* Input Guitar Amplifier Section */}
                <div className="space-y-2.5 pb-3.5 border-b border-white/[0.08]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                      Input Guitar Amp
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void updateAmpSettings({ enabled: !ampSettings.enabled })
                      }
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors ${
                        ampSettings.enabled
                          ? 'bg-amber-400 text-black'
                          : 'bg-white/10 text-sp-text-sub hover:text-white'
                      }`}
                    >
                      {ampSettings.enabled ? 'On' : 'Off'}
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    {AMP_PRESETS.map((p) => {
                      const sel = ampSettings.preset === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            void updateAmpSettings({
                              preset: p.id as AmpPresetId,
                              drive: p.defaultDrive,
                              reverb: p.defaultReverb,
                            })
                          }
                          className={`py-1 rounded-md text-[11px] font-bold transition-colors ${
                            sel
                              ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                              : 'bg-black/40 text-sp-text-muted hover:text-white border border-white/[0.06]'
                          }`}
                        >
                          {p.shortLabel}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex items-center justify-between text-[10px] text-sp-text-muted">
                      <span>Drive</span>
                      <span>{Math.round(ampSettings.drive * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(ampSettings.drive * 100)}
                      onChange={(e) =>
                        void updateAmpSettings({ drive: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-amber-400 cursor-pointer h-1"
                    />

                    <div className="flex items-center justify-between text-[10px] text-sp-text-muted">
                      <span>Room Air</span>
                      <span>{Math.round(ampSettings.reverb * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(ampSettings.reverb * 100)}
                      onChange={(e) =>
                        void updateAmpSettings({ reverb: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-amber-400 cursor-pointer h-1"
                    />

                    <div className="flex items-center justify-between text-[10px] text-sp-text-muted">
                      <span>Amp Level</span>
                      <span>{Math.round(ampSettings.volume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(ampSettings.volume * 100)}
                      onChange={(e) =>
                        void updateAmpSettings({ volume: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-amber-400 cursor-pointer h-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
                    Drum Groove
                  </label>
                  <select
                    value={grooveStyle}
                    onChange={(e) => setGrooveStyle(e.target.value as GrooveStyleId)}
                    className="w-full bg-black/50 text-white font-semibold px-2.5 py-1.5 rounded-lg border border-white/12 focus:outline-none"
                  >
                    {GROOVE_STYLE_META.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-sp-text-muted mb-1.5">
                    Guide Guitar Synth
                  </label>
                  <select
                    value={guideGuitar}
                    onChange={(e) => setGuideGuitar(e.target.value as GuideGuitarLevel)}
                    className="w-full bg-black/50 text-white font-semibold px-2.5 py-1.5 rounded-lg border border-white/12 focus:outline-none"
                  >
                    <option value="off">Off (Mic Only)</option>
                    <option value="soft">Soft Guide</option>
                    <option value="full">Full Synth</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-sp-text-muted mb-1">
                    <span>Mix Volume</span>
                    <span>{volumePct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volumePct}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Minimalist Results & Stage Unlock Card (only visible after run completes) */}
      {runState === 'results' && summary && (
        <section className="rounded-2xl border border-white/10 bg-[#111620] p-5 flex items-center justify-between gap-6 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl font-extrabold text-white tabular-nums">
                {Math.round(summary.accuracy * 100)}%
              </span>
              <span className="text-xs font-semibold text-sp-text-sub">
                {summary.hits}/{summary.hits + summary.misses} notes
                {summary.meanCents != null
                  ? ` · ${summary.meanCents >= 0 ? `+${summary.meanCents}c` : `${summary.meanCents}c`}`
                  : ''}
              </span>
              <span className="text-sm tracking-widest text-amber-400">
                {'★'.repeat(summary.starsEarned)}
                <span className="text-white/15">
                  {'★'.repeat(3 - summary.starsEarned)}
                </span>
              </span>
            </div>

            {summary.newlyUnlockedCourse ? (
              <p className="text-xs font-bold text-amber-300">
                Unlocked Stage #{summary.newlyUnlockedCourse.order}:{' '}
                {summary.newlyUnlockedCourse.title}
              </p>
            ) : (
              <p className="text-xs text-sp-text-muted">
                {summary.passed
                  ? 'Stage cleared — try Shadow or Hidden mode to master it.'
                  : 'Reach 60% accuracy to clear this stage and unlock the next.'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handlePrimaryStart}
              className="px-4 py-1.5 rounded-full text-xs font-bold bg-white/10 text-white hover:bg-white/15 transition"
            >
              Replay
            </button>
            {nextCourse && (isNextUnlocked || summary.newlyUnlockedCourse != null) && (
              <button
                type="button"
                onClick={() => onSelectCourse(nextCourse, 'play')}
                className="px-4 py-1.5 rounded-full text-xs font-extrabold text-black transition-transform hover:scale-[1.02]"
                style={{ backgroundColor: chapter.accentHex }}
              >
                Next Stage &rarr;
              </button>
            )}
            <button
              type="button"
              onClick={onBackToRoadmap}
              className="px-3 py-1.5 rounded-full text-xs font-semibold text-sp-text-muted hover:text-white"
            >
              Roadmap
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
