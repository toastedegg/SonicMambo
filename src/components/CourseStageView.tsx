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
import { MamboCoachCard, MamboMascotSvg } from './MamboMascot';
import {
  MinimalScoreCanvasPixi,
  type HiddenDifficulty,
  type NotationMode,
  type StageMotionSnapshot,
} from './MinimalScoreCanvasPixi';
import { NeoArcadeStage } from './NeoArcadeStage';

export interface AttemptOutcome {
  passed: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  newlyUnlockedCourse: GuitarCourse | null;
}

interface CourseStageViewProps {
  course: GuitarCourse;
  initialMode?: CoursePracticeMode;
  initialDetailOpen?: boolean;
  demoMode?: boolean;
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

type StageSurfaceMode = 'arcade' | 'staff' | 'tab';

const MODE_ITEMS: ReadonlyArray<{ id: CoursePracticeMode; label: string; color: string }> = [
  { id: 'play', label: 'PLAY', color: '#D8FF2E' },
  { id: 'loop', label: 'LOOP', color: '#FF8A00' },
  { id: 'shadow', label: 'SHADOW', color: '#2B59FF' },
  { id: 'hidden', label: 'HIDDEN', color: '#FF3B7F' },
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

interface StompboxDef {
  id: AmpPresetId;
  name: string;
  tag: string;
  bg: string;
  text: string;
  led: string;
  knobA: string;
  knobB: string;
}

const STOMPBOXES: readonly StompboxDef[] = [
  {
    id: 'clean-studio',
    name: 'TWIN CLEAN',
    tag: '6L6 SPARKLE',
    bg: '#2B59FF',
    text: '#FFFFFF',
    led: '#D8FF2E',
    knobA: 'GAIN 24%',
    knobB: 'AIR 42%',
  },
  {
    id: 'blues-breakup',
    name: 'TWEED CRUNCH',
    tag: 'WARM SAG',
    bg: '#FF8A00',
    text: '#121212',
    led: '#FF3B7F',
    knobA: 'GAIN 56%',
    knobB: 'BITE 68%',
  },
  {
    id: 'british-crunch',
    name: 'PLEXI LEAD',
    tag: 'EL34 ROAR',
    bg: '#FF3B7F',
    text: '#FFFFFF',
    led: '#D8FF2E',
    knobA: 'GAIN 82%',
    knobB: 'PUSH 74%',
  },
];

export function CourseStageView({
  course,
  initialMode = 'play',
  initialDetailOpen = false,
  demoMode = false,
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

  const [surfaceMode, setSurfaceMode] = useState<StageSurfaceMode>('arcade');
  const [mode, setMode] = useState<CoursePracticeMode>(initialMode);
  const [bpm, setBpm] = useState<number>(course.tempoBpm);
  const [grooveStyle, setGrooveStyle] = useState<GrooveStyleId>(course.defaultGroove);
  const [guideGuitar, setGuideGuitar] = useState<GuideGuitarLevel>('off');
  const [volumePct, setVolumePct] = useState<number>(() =>
    Math.round(soundGenerator.getVolume() * 100),
  );
  const [detailOpen, setDetailOpen] = useState<boolean>(initialDetailOpen);
  const [activeStomp, setActiveStomp] = useState<AmpPresetId>('blues-breakup');

  const [loopRange, setLoopRange] = useState<
    'all' | { startBar: number; endBar: number }
  >('all');
  const [autoSpeedUp, setAutoSpeedUp] = useState<boolean>(true);
  const [shadowBarsPerPhrase, setShadowBarsPerPhrase] = useState<1 | 2>(2);
  const [hiddenDifficulty, setHiddenDifficulty] =
    useState<HiddenDifficulty>('ghost-passing');

  const [runState, setRunState] = useState<'idle' | 'running' | 'preview' | 'results'>('idle');
  const [loopPassMeta, setLoopPassMeta] = useState<{
    passes: number;
    lastAccuracy: number | null;
  }>({ passes: 0, lastAccuracy: null });
  const [summary, setSummary] = useState<StageRunSummary | null>(null);

  const motionRef = useRef<StageMotionSnapshot>({ ...INITIAL_MOTION });
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const transportRef = useRef<BackingTransport | null>(null);
  const rafRef = useRef<number>(0);
  const scorerRef = useRef<HoldNoteScorer | null>(null);
  const shadowCancelledRef = useRef<boolean>(false);

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
    setDetailOpen(initialDetailOpen);
    setLoopPassMeta({ passes: 0, lastAccuracy: null });
    noteStatusRef.current = {};
    motionRef.current = { ...INITIAL_MOTION };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, initialMode, initialDetailOpen]);

  useEffect(() => {
    return () => {
      shadowCancelledRef.current = true;
      transportRef.current?.stop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setInputGated(false);
    };
  }, [setInputGated]);

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

  const handleSelectStomp = (presetId: AmpPresetId) => {
    setActiveStomp(presetId);
    const exists = AMP_PRESETS.some((p) => p.id === presetId);
    if (exists) {
      void updateAmpSettings({ enabled: true, preset: presetId });
    }
  };

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
          if (pos.elapsedBeats >= n.startBeat && pos.elapsedBeats < n.startBeat + n.durationBeats) {
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

  const handlePrimaryStart = () => {
    void startTimedRun();
  };

  const completedModes = mastery?.completedModes ?? [];
  const activeGrooveShort =
    GROOVE_STYLE_META.find((g) => g.id === grooveStyle)?.shortLabel ?? 'Beat';
  const pixiNotation: NotationMode = surfaceMode === 'tab' ? 'tab' : 'staff';

  return (
    <div className="min-h-full bg-[#FFFBF0] riso-dots-subtle px-5 md:px-8 py-5">
      <div className="max-w-[1440px] mx-auto space-y-4">
        {/* ROW 1: Bold Zine Stage Header + Surface Switch + 4-Mode Chunky Pills */}
        <header className="neo-card bg-white px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-[#D8FF2E] border-[2.5px] border-[#121212] shadow-brutal-xs flex flex-col items-center justify-center shrink-0">
              <span className="font-mono text-[9px] font-bold leading-none text-[#121212]">
                STG
              </span>
              <span className="font-syne text-lg font-extrabold leading-none text-[#121212]">
                {String(course.order).padStart(2, '0')}
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="neo-stamp bg-[#2B59FF] text-white">
                  {course.styleLabel}
                </span>
                <span className="neo-stamp bg-[#FFF4D8] text-[#121212]">
                  {course.keySignature} &middot; {course.totalBars} BARS
                </span>
                <span className="neo-stamp bg-[#D8FF2E] text-[#121212]">
                  14&times; GROOVE FLOW
                </span>
              </div>
              <h1 className="font-syne text-2xl md:text-[26px] font-extrabold text-[#121212] tracking-tight truncate mt-0.5">
                {course.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Arcade / Staff / TAB Switcher */}
            <div className="inline-flex items-center gap-1 p-1 rounded-2xl bg-[#FFF4D8] border-2 border-[#121212]">
              {(
                [
                  { id: 'arcade', label: 'ARCADE' },
                  { id: 'staff', label: 'STAFF' },
                  { id: 'tab', label: 'TAB' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSurfaceMode(opt.id)}
                  className={`px-3 py-1 rounded-xl font-mono text-[11px] font-bold transition-all ${
                    surfaceMode === opt.id
                      ? 'bg-[#121212] text-[#D8FF2E] shadow-brutal-xs'
                      : 'text-[#423E37] hover:text-[#121212]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* 4-Mode Tactile Pills */}
            <div className="inline-flex items-center gap-1.5">
              {MODE_ITEMS.map((item) => {
                const selected = mode === item.id;
                const done = completedModes.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSwitchMode(item.id)}
                    className={`px-3 py-1.5 rounded-xl border-2 border-[#121212] font-mono text-[11px] font-bold transition-all inline-flex items-center gap-1.5 ${
                      selected
                        ? 'shadow-brutal-xs -translate-y-[1px]'
                        : 'bg-white text-[#121212] hover:bg-[#FFF4D8]'
                    }`}
                    style={
                      selected
                        ? {
                            backgroundColor: item.color,
                            color: item.id === 'shadow' || item.id === 'hidden' ? '#FFFFFF' : '#121212',
                          }
                        : undefined
                    }
                  >
                    <span>{item.label}</span>
                    {done && (
                      <span className="w-2 h-2 rounded-full bg-[#1CE088] border border-[#121212]" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Interactive Detail / Stompbox & Mastery Drawer Toggle */}
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className={`px-3.5 py-1.5 text-xs font-mono uppercase ${
                detailOpen ? 'neo-btn-magenta' : 'neo-btn-amber'
              }`}
            >
              {detailOpen ? '✕ CLOSE RACK' : '⚡ PEDALS & MASTERY'}
            </button>
          </div>
        </header>

        {/* ROW 2: Main Musical Instrument Stage + Right Mascot / Detail Split */}
        {detailOpen ? (
          /* ══════════ INTERACTIVE DETAIL VIEW: 3-PEDAL STOMPBOX RACK + STAGE CLEARED MASTERY STAMP ══════════ */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Left 7 cols: Duolingo-meets-Risograph Stage Cleared Celebration + Weekly Groove Quests */}
            <section className="lg:col-span-7 neo-card-lg bg-[#D8FF2E] p-5 relative overflow-hidden flex flex-col justify-between gap-4">
              {/* Risograph burst pattern accent */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-10 w-52 h-52 rounded-full bg-[#FF3B7F]/25 border-[2.5px] border-dashed border-[#121212]"
              />

              <div className="relative flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                      ★ STAGE CLEARED!
                    </span>
                    <span className="neo-stamp bg-[#FF3B7F] text-white">
                      CHAPTER II UNLOCKED
                    </span>
                  </div>
                  <h2 className="font-syne text-3xl font-extrabold text-[#121212] leading-tight">
                    94% IN POCKET!
                  </h2>
                  <p className="font-display font-bold text-sm text-[#121212]/80 max-w-md">
                    {course.title} mastered with 3/3 Plectrum Stars — zero streak guilt, pure groove continuity!
                  </p>
                </div>

                {/* Big 3-Star Plectrum Stamp */}
                <div className="neo-card bg-white px-4 py-3 text-center shrink-0 rotate-2">
                  <div className="flex items-center justify-center gap-1 text-2xl leading-none">
                    <span className="text-[#FF8A00]">★</span>
                    <span className="text-[#FF3B7F] -translate-y-1">★</span>
                    <span className="text-[#2B59FF]">★</span>
                  </div>
                  <div className="font-mono text-[10px] font-bold text-[#121212] mt-1">
                    3 / 3 PLECTRUMS
                  </div>
                </div>
              </div>

              {/* 4 Telemetry Punch Tiles */}
              <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: 'ACCURACY', value: '94%', bg: '#FFFFFF', accent: '#2B59FF' },
                  { label: 'MEAN PITCH', value: '+2.1c', bg: '#FFFFFF', accent: '#1CE088' },
                  { label: 'BEST FLOW', value: '14×', bg: '#FFFFFF', accent: '#FF3B7F' },
                  { label: 'RECOVERY', value: '100%', bg: '#FFFFFF', accent: '#FF8A00' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border-[2.5px] border-[#121212] p-3 shadow-brutal-xs"
                    style={{ backgroundColor: stat.bg }}
                  >
                    <div className="font-mono text-[10px] font-bold text-[#57534A]">
                      {stat.label}
                    </div>
                    <div
                      className="font-syne text-2xl font-extrabold leading-tight mt-0.5"
                      style={{ color: stat.accent }}
                    >
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Mascot Celebration Speech + Weekly Groove Quest Progress */}
              <div className="relative grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                <div className="md:col-span-7 neo-card bg-white p-3.5 flex items-center gap-3">
                  <MamboMascotSvg mood="celebrate" size={76} className="shrink-0" />
                  <div className="space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-[#FF3B7F] text-white font-mono text-[10px] font-bold border border-[#121212]">
                      MAMBO BUDDY HYPE
                    </span>
                    <p className="font-display font-extrabold text-sm text-[#121212] leading-snug">
                      &ldquo;DEAD CENTER +2.1c! That vibrato on Bar 3 melted the wax — ready for Arena Rock?!&rdquo;
                    </p>
                  </div>
                </div>

                {/* Weekly Groove Quest Meter (No-Punishment Duolingo Twist) */}
                <div className="md:col-span-5 neo-card bg-[#FFF4D8] p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase text-[#121212]">
                      WEEKLY GROOVE QUEST
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#2B59FF]">
                      142 / 180 MIN
                    </span>
                  </div>
                  <div className="h-4 rounded-full bg-white border-2 border-[#121212] p-0.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#2B59FF]"
                      style={{ width: '79%' }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold text-[#57534A]">
                    <span>+14m THIS TAKE</span>
                    <span className="text-[#121212]">NO STREAK GUILT</span>
                  </div>
                </div>
              </div>

              {/* Next Stage Unlock Action Strip */}
              <div className="relative flex items-center justify-between gap-3 flex-wrap pt-1">
                <div className="flex items-center gap-2">
                  <span className="neo-stamp bg-white text-[#121212]">
                    NEXT: #{nextCourse ? String(nextCourse.order).padStart(2, '0') : '04'}{' '}
                    {nextCourse?.title ?? 'Backstage E5 Power Riff'}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDetailOpen(false)}
                    className="neo-btn-paper px-4 py-2 text-xs font-mono"
                  >
                    REPLAY STAGE
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      nextCourse ? onSelectCourse(nextCourse, 'play') : onBackToRoadmap()
                    }
                    className="neo-btn-cobalt px-5 py-2 text-xs font-mono"
                  >
                    UNLOCK NEXT STAGE &rarr;
                  </button>
                </div>
              </div>
            </section>

            {/* Right 5 cols: Interactive 3-Pedal Guitar Stompbox Rack + Groove Beat Mixer */}
            <section className="lg:col-span-5 neo-card-lg bg-[#FFF4D8] p-5 flex flex-col justify-between gap-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                    TACTILE AMP PEDALBOARD
                  </span>
                  <h3 className="font-syne text-xl font-extrabold text-[#121212] mt-1">
                    3-Pedal Stompbox Rack
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
                  className={`px-3 py-1.5 text-[11px] font-mono ${
                    ampSettings.enabled || demoMode ? 'neo-btn-lime' : 'neo-btn-paper'
                  }`}
                >
                  {ampSettings.enabled || demoMode ? '● RIG LIVE' : '○ BYPASS'}
                </button>
              </div>

              {/* 3 Chunky Stompbox Pedals */}
              <div className="grid grid-cols-3 gap-2.5">
                {STOMPBOXES.map((pedal) => {
                  const isActive = activeStomp === pedal.id;
                  return (
                    <button
                      key={pedal.id}
                      type="button"
                      onClick={() => handleSelectStomp(pedal.id)}
                      className={`rounded-2xl border-[2.5px] border-[#121212] p-3 text-left flex flex-col justify-between gap-3 transition-all ${
                        isActive
                          ? 'shadow-brutal -translate-y-1 ring-2 ring-[#121212]'
                          : 'shadow-brutal-xs opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: pedal.bg, color: pedal.text }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="w-3 h-3 rounded-full border-2 border-[#121212]"
                          style={{
                            backgroundColor: isActive ? pedal.led : 'rgba(255,255,255,0.3)',
                          }}
                        />
                        <span className="font-mono text-[9px] font-bold uppercase opacity-90">
                          {isActive ? 'ON' : 'OFF'}
                        </span>
                      </div>

                      {/* Two mini rotary knobs */}
                      <div className="flex items-center justify-around py-1">
                        {[0, 1].map((k) => (
                          <div
                            key={k}
                            className="w-7 h-7 rounded-full bg-[#121212] border-2 border-white/80 flex items-start justify-center pt-1"
                            style={{ transform: k === 0 ? 'rotate(-30deg)' : 'rotate(35deg)' }}
                          >
                            <span className="w-1 h-2.5 rounded-full bg-[#D8FF2E]" />
                          </div>
                        ))}
                      </div>

                      <div>
                        <div className="font-syne text-xs font-extrabold leading-tight">
                          {pedal.name}
                        </div>
                        <div className="font-mono text-[9px] font-bold opacity-85 mt-0.5">
                          {pedal.tag}
                        </div>
                      </div>

                      {/* 3D Metal Footswitch Cap */}
                      <div className="w-full py-1 rounded-xl bg-white/90 text-[#121212] border-2 border-[#121212] font-mono text-[9px] font-bold text-center">
                        {isActive ? 'STOMPED ✓' : 'STOMP'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Groove Beat Selector + Master Volume */}
              <div className="neo-card bg-white p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] font-bold uppercase text-[#57534A]">
                    BACKING GROOVE ENGINE
                  </span>
                  <span className="font-mono text-[10px] font-bold text-[#2B59FF]">
                    {activeGrooveShort.toUpperCase()} &middot; {bpm} BPM
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {GROOVE_STYLE_META.slice(0, 5).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGrooveStyle(g.id)}
                      className={`px-2.5 py-1 rounded-lg border-2 border-[#121212] font-mono text-[10px] font-bold transition-all ${
                        grooveStyle === g.id
                          ? 'bg-[#D8FF2E] text-[#121212] shadow-brutal-xs'
                          : 'bg-[#FFFBF0] text-[#423E37] hover:bg-white'
                      }`}
                    >
                      {g.shortLabel}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <span className="font-mono text-[10px] font-bold text-[#121212] shrink-0">
                    MIX {volumePct}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volumePct}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full accent-[#2B59FF]"
                    aria-label="Backing mix volume"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setGuideGuitar((g) => (g === 'off' ? 'soft' : g === 'soft' ? 'full' : 'off'))
                    }
                    className="px-2.5 py-1 rounded-lg border-2 border-[#121212] bg-[#FFF4D8] font-mono text-[10px] font-bold shrink-0"
                  >
                    GUIDE: {guideGuitar.toUpperCase()}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* ══════════ ACTIVE PRACTICE STAGE: NEO-ARCADE RIFF HIGHWAY + LIVE MAMBO COACH ══════════ */
          <div className="space-y-4">
            {surfaceMode === 'arcade' ? (
              <NeoArcadeStage
                notes={course.notes}
                barChords={course.barChords}
                totalBars={course.totalBars}
                beatsPerBar={course.beatsPerBar}
                practiceMode={mode}
                hiddenDifficulty={hiddenDifficulty}
                loopRange={loopRange}
                motionRef={motionRef}
                detectionRef={detectionRef}
                noteStatusRef={noteStatusRef}
                onSelectBar={handleSelectBar}
                demoShowcase={demoMode}
              />
            ) : (
              <div className="neo-card-lg bg-[#121212] p-3">
                <MinimalScoreCanvasPixi
                  notes={course.notes}
                  barChords={course.barChords}
                  totalBars={course.totalBars}
                  beatsPerBar={course.beatsPerBar}
                  accentHex={chapter.accentHex}
                  notationMode={pixiNotation}
                  practiceMode={mode}
                  hiddenDifficulty={hiddenDifficulty}
                  loopRange={loopRange}
                  motionRef={motionRef}
                  detectionRef={detectionRef}
                  noteStatusRef={noteStatusRef}
                  onSelectBar={handleSelectBar}
                />
              </div>
            )}

            {/* Bottom Duo Row: Left Mambo Coach Card + Right Chunky 3D Transport Deck */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              <div className="lg:col-span-5">
                <MamboCoachCard
                  mood="groove"
                  badgeText="LIVE PITCH COACH · +2c"
                  quote="DEAD CENTER +2c! Hold that vibrato on Fret 3 — zero buzz, pure blues pocket!"
                  subline="RECOVERY CONTINUITY: 14× UNBROKEN · NO STREAK PENALTY"
                  compact
                />
              </div>

              <div className="lg:col-span-7 neo-card bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {runState === 'running' ? (
                    <button
                      type="button"
                      onClick={stopEverything}
                      className="neo-btn-magenta px-6 py-3 text-sm font-syne tracking-wide"
                    >
                      ■ STOP RUN
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePrimaryStart}
                      className="neo-btn-lime px-6 py-3 text-sm font-syne tracking-wide"
                    >
                      ▶ {mode === 'play' ? 'START GROOVE' : mode === 'loop' ? 'START LOOP' : mode === 'shadow' ? 'START SHADOW' : 'START HIDDEN'}
                    </button>
                  )}

                  {runState === 'preview' ? (
                    <button
                      type="button"
                      onClick={stopEverything}
                      className="neo-btn-amber px-4 py-3 text-xs font-mono"
                    >
                      ■ STOP HEAR
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={runState === 'running'}
                      onClick={startSoundPreview}
                      className="neo-btn-paper px-4 py-3 text-xs font-mono"
                    >
                      ♫ HEAR
                    </button>
                  )}
                </div>

                {/* Tactile BPM Stepper */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-[#FFF4D8] border-2 border-[#121212]">
                  <button
                    type="button"
                    disabled={runState === 'running'}
                    onClick={() => setBpm((b) => Math.max(40, b - 5))}
                    className="w-8 h-8 rounded-xl bg-white border-2 border-[#121212] font-mono font-bold hover:bg-[#D8FF2E]"
                  >
                    −
                  </button>
                  <div className="text-center min-w-[66px]">
                    <div className="font-syne text-lg font-extrabold leading-none text-[#121212]">
                      {bpm}
                    </div>
                    <div className="font-mono text-[9px] font-bold text-[#57534A]">
                      BPM
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={runState === 'running'}
                    onClick={() => setBpm((b) => Math.min(160, b + 5))}
                    className="w-8 h-8 rounded-xl bg-white border-2 border-[#121212] font-mono font-bold hover:bg-[#D8FF2E]"
                  >
                    +
                  </button>
                </div>

                {/* Contextual Mode Control + Groove Chip */}
                <div className="flex items-center gap-2 flex-wrap">
                  {mode === 'loop' && (
                    <button
                      type="button"
                      onClick={() => setAutoSpeedUp((v) => !v)}
                      className={`px-3 py-2 rounded-xl border-2 border-[#121212] font-mono text-[11px] font-bold ${
                        autoSpeedUp ? 'bg-[#1CE088] text-[#121212]' : 'bg-white text-[#57534A]'
                      }`}
                    >
                      +5% AUTO {loopPassMeta.passes > 0 ? `· P${loopPassMeta.passes}` : ''}
                    </button>
                  )}
                  {mode === 'shadow' && (
                    <button
                      type="button"
                      onClick={() => setShadowBarsPerPhrase((p) => (p === 2 ? 1 : 2))}
                      className="px-3 py-2 rounded-xl border-2 border-[#121212] bg-[#2B59FF] text-white font-mono text-[11px] font-bold"
                    >
                      {shadowBarsPerPhrase}-BAR ECHO
                    </button>
                  )}
                  {mode === 'hidden' && (
                    <button
                      type="button"
                      onClick={() =>
                        setHiddenDifficulty((d) =>
                          d === 'ghost-passing'
                            ? 'bar-anchors'
                            : d === 'bar-anchors'
                              ? 'full-blackout'
                              : 'ghost-passing',
                        )
                      }
                      className="px-3 py-2 rounded-xl border-2 border-[#121212] bg-[#FF3B7F] text-white font-mono text-[11px] font-bold"
                    >
                      MASK: {hiddenDifficulty === 'ghost-passing' ? '50%' : hiddenDifficulty === 'bar-anchors' ? '75%' : '100%'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setDetailOpen(true)}
                    className="neo-btn-cobalt px-3.5 py-2 text-[11px] font-mono"
                  >
                    🥁 {activeGrooveShort.toUpperCase()} · PEDALS
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Live Run Results Banner (when real take completes) */}
        {summary && (
          <div className="neo-card bg-[#D8FF2E] p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                {summary.passed ? 'PASSED ★' : 'KEEP GROOVING'}
              </span>
              <span className="font-syne font-extrabold text-lg text-[#121212]">
                {Math.round(summary.accuracy * 100)}% ({summary.hits}/{summary.hits + summary.misses})
              </span>
              {summary.meanCents != null && (
                <span className="font-mono text-xs font-bold text-[#121212]">
                  {summary.meanCents >= 0 ? `+${summary.meanCents}` : summary.meanCents}c
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrimaryStart}
                className="neo-btn-paper px-4 py-1.5 text-xs font-mono"
              >
                PLAY AGAIN
              </button>
              {nextCourse && isNextUnlocked && (
                <button
                  type="button"
                  onClick={() => onSelectCourse(nextCourse, 'play')}
                  className="neo-btn-cobalt px-4 py-1.5 text-xs font-mono"
                >
                  NEXT STAGE &rarr;
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
