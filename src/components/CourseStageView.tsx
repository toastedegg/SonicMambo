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
import { MamboMascotSvg } from './MamboMascot';
import {
  MinimalScoreCanvasPixi,
  type HiddenDifficulty,
  type NotationMode,
  type StageMotionSnapshot,
} from './MinimalScoreCanvasPixi';
import { RisoEngravedScore, type VanishPass } from './RisoEngravedScore';
import { RisoPerspectiveNeck } from './RisoPerspectiveNeck';

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
  onRunningChange?: (running: boolean) => void;
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

type StageSurfaceMode = 'riso' | 'staff' | 'tab';

const MODE_ITEMS: ReadonlyArray<{ id: CoursePracticeMode; label: string }> = [
  { id: 'play', label: 'PLAY' },
  { id: 'loop', label: 'LOOP' },
  { id: 'shadow', label: 'SHADOW' },
  { id: 'hidden', label: 'BLACKOUT' },
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
  drivePct: number;
  roomPct: number;
}

const STOMPBOXES: readonly StompboxDef[] = [
  {
    id: 'clean-studio',
    name: 'TWIN CLEAN',
    tag: '6L6 HEADROOM',
    bg: '#2B59FF',
    text: '#FFFFFF',
    led: '#D8FF2E',
    drivePct: 24,
    roomPct: 42,
  },
  {
    id: 'blues-breakup',
    name: 'TWEED CRUNCH',
    tag: 'WARM SAG',
    bg: '#FF8A00',
    text: '#121212',
    led: '#D8FF2E',
    drivePct: 56,
    roomPct: 36,
  },
  {
    id: 'british-crunch',
    name: 'PLEXI LEAD',
    tag: 'EL34 BITE',
    bg: '#FF3B7F',
    text: '#FFFFFF',
    led: '#D8FF2E',
    drivePct: 82,
    roomPct: 28,
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
  onRunningChange,
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

  const [surfaceMode, setSurfaceMode] = useState<StageSurfaceMode>('riso');
  const [mode, setMode] = useState<CoursePracticeMode>(initialMode);
  const [bpm, setBpm] = useState<number>(course.tempoBpm);
  const [grooveStyle, setGrooveStyle] = useState<GrooveStyleId>(course.defaultGroove);
  const [guideGuitar, setGuideGuitar] = useState<GuideGuitarLevel>('off');
  const [volumePct, setVolumePct] = useState<number>(() =>
    Math.round(soundGenerator.getVolume() * 100),
  );
  const [detailOpen, setDetailOpen] = useState<boolean>(initialDetailOpen);
  const [activeStomp, setActiveStomp] = useState<AmpPresetId>('blues-breakup');
  const [windowStartBar, setWindowStartBar] = useState<number>(1);
  const [vanishPass, setVanishPass] = useState<VanishPass>(1);

  const [loopRange, setLoopRange] = useState<
    'all' | { startBar: number; endBar: number }
  >('all');
  const [autoSpeedUp, setAutoSpeedUp] = useState<boolean>(true);
  const [hiddenDifficulty, setHiddenDifficulty] =
    useState<HiddenDifficulty>('ghost-passing');

  const [runState, setRunState] = useState<'idle' | 'running' | 'preview' | 'results'>('idle');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [summary, setSummary] = useState<StageRunSummary | null>(null);

  const motionRef = useRef<StageMotionSnapshot>({ ...INITIAL_MOTION });
  const noteStatusRef = useRef<Record<string, LessonNoteStatus>>({});
  const transportRef = useRef<BackingTransport | null>(null);
  const rafRef = useRef<number>(0);
  const scorerRef = useRef<HoldNoteScorer | null>(null);
  const shadowCancelledRef = useRef<boolean>(false);

  // Direct DOM refs for live cents needle (zero per-frame React re-renders)
  const liveNoteTextRef = useRef<HTMLSpanElement | null>(null);
  const liveCentsTextRef = useRef<HTMLSpanElement | null>(null);
  const centsNeedleDotRef = useRef<HTMLSpanElement | null>(null);

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
    onRunningChange?.(runState === 'running');
  }, [onRunningChange, runState]);

  useEffect(() => {
    stopEverything();
    setMode(initialMode);
    setBpm(course.tempoBpm);
    setGrooveStyle(course.defaultGroove);
    setLoopRange('all');
    setWindowStartBar(1);
    setVanishPass(initialMode === 'hidden' ? 2 : 1);
    setSummary(null);
    setDetailOpen(initialDetailOpen);
    setActiveNoteId(null);
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
      onRunningChange?.(false);
    };
  }, [onRunningChange, setInputGated]);

  // Direct DOM cents needle update at 15Hz when live listening
  useEffect(() => {
    if (!isListening || runState !== 'running') return undefined;
    const id = window.setInterval(() => {
      const det = detectionRef.current;
      if (liveNoteTextRef.current) {
        liveNoteTextRef.current.textContent = det.label ?? '—';
      }
      if (liveCentsTextRef.current) {
        const c = Math.round(det.centsOffset ?? 0);
        liveCentsTextRef.current.textContent = det.label ? `${c >= 0 ? '+' : ''}${c}¢` : '0¢';
      }
      if (centsNeedleDotRef.current) {
        const clamped = Math.max(-50, Math.min(50, det.centsOffset ?? 0));
        centsNeedleDotRef.current.style.left = `${50 + clamped * 0.86}%`;
      }
    }, 66);
    return () => window.clearInterval(id);
  }, [detectionRef, isListening, runState]);

  useEffect(() => {
    if (runState === 'running' && motionRef.current.shadowPhase !== 'listen') {
      // Respect App Sound Policy: mute melodic guide guitar during live mic scoring
      transportRef.current?.updateLiveOptions({ grooveStyle, guideGuitar: 'off' });
    } else if (runState === 'preview') {
      transportRef.current?.updateLiveOptions({ grooveStyle, guideGuitar: 'full' });
    }
  }, [grooveStyle, runState]);

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
    if (nextMode === 'hidden') {
      setVanishPass(2);
      setHiddenDifficulty('ghost-passing');
    } else {
      setVanishPass(1);
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
    if (AMP_PRESETS.some((p) => p.id === presetId)) {
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
        setActiveNoteId(null);
        setRunState('idle');
      },
    });

    transportRef.current = transport;
    motionRef.current.previewing = true;
    motionRef.current.running = false;
    motionRef.current.courseBeat = activeCycle.startBeatOffset;
    setRunState('preview');
    transport.start();

    let lastActiveId: string | null = null;
    const tick = () => {
      if (!transport.isRunning()) return;
      const pos = transport.getPosition();
      motionRef.current.courseBeat = activeCycle.startBeatOffset + pos.elapsedBeats;
      motionRef.current.beatInBar = pos.beatInBar;
      let nextActive: string | null = null;
      for (let i = 0; i < activeCycle.notes.length; i += 1) {
        const n = activeCycle.notes[i];
        if (pos.elapsedBeats >= n.startBeat && pos.elapsedBeats < n.startBeat + n.durationBeats) {
          nextActive = n.id;
          break;
        }
      }
      motionRef.current.activeTargetNoteId = nextActive;
      if (nextActive !== lastActiveId) {
        lastActiveId = nextActive;
        setActiveNoteId(nextActive);
      }
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
      setDetailOpen(false);

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
        setActiveNoteId(null);

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
        setDetailOpen(true);
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
        if (autoSpeedUp && clean && effectiveBpm < Math.round(course.tempoBpm * 1.25)) {
          const nextBpm = Math.min(
            Math.round(course.tempoBpm * 1.25),
            Math.max(effectiveBpm + 2, Math.round(effectiveBpm * 1.05)),
          );
          setBpm(nextBpm);
          window.setTimeout(() => {
            void startTimedRun(nextBpm, true);
          }, 0);
          return;
        }

        noteStatusRef.current = {};
        scorerRef.current = new HoldNoteScorer(timelineNotes, beatMs, {
          latencyMs: audioLatencyMs,
        });
      };

      // App Sound Policy: never mix melodic guide guitar with live mic scoring
      const transport = new BackingTransport({
        bpm: effectiveBpm,
        beatsPerBar: course.beatsPerBar,
        totalBeats: activeCycle.totalBeats,
        countInBeats: skipCountIn ? 0 : 4,
        loop: isLoopMode,
        grooveStyle,
        guideGuitar: 'off',
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
      let lastActiveId: string | null = null;
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
          const firstId = activeCycle.notes[0]?.id ?? null;
          m.activeTargetNoteId = firstId;
          if (firstId !== lastActiveId) {
            lastActiveId = firstId;
            setActiveNoteId(firstId);
          }
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        m.courseBeat = activeCycle.startBeatOffset + pos.elapsedBeats;
        let nextActive: string | null = null;
        for (let i = 0; i < activeCycle.notes.length; i += 1) {
          const n = activeCycle.notes[i];
          if (pos.elapsedBeats >= n.startBeat && pos.elapsedBeats < n.startBeat + n.durationBeats) {
            nextActive = n.id;
            break;
          }
        }
        m.activeTargetNoteId = nextActive;
        // Discrete state update ONLY on note transitions (zero per-frame re-renders!)
        if (nextActive !== lastActiveId) {
          lastActiveId = nextActive;
          setActiveNoteId(nextActive);
        }

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
      isListening,
      mode,
      onRecordAttempt,
      resetDsp,
      start,
      stopEverything,
    ],
  );

  // Determine active, next, and upcoming notes for Tier B 3D Perspective Neck
  const neckNotes = useMemo(() => {
    const windowEndBar = Math.min(course.totalBars, windowStartBar + 3);
    const inWin = course.notes.filter(
      (n) => n.bar >= windowStartBar && n.bar <= windowEndBar,
    );
    if (inWin.length === 0) {
      return { active: null, next: null, upcoming: [] as CourseTabNote[] };
    }

    let activeIdx = -1;
    if (activeNoteId) {
      activeIdx = inWin.findIndex((n) => n.id === activeNoteId);
    }
    if (activeIdx < 0 && demoMode && runState === 'idle') {
      // Showcase Bar 3 Gmaj7 anchor (Fret 7 B3 -> Fret 5 B3 -> Fret 4 G3)
      activeIdx = inWin.findIndex((n) => n.bar === windowStartBar + 2);
    }
    if (activeIdx < 0) activeIdx = 0;

    const active = inWin[activeIdx] ?? null;
    const next = inWin[activeIdx + 1] ?? inWin[0] ?? null;
    const upcoming = inWin.slice(activeIdx + 2);
    return { active, next, upcoming };
  }, [activeNoteId, course.notes, course.totalBars, demoMode, runState, windowStartBar]);

  const completedModes = mastery?.completedModes ?? [];
  const pixiNotation: NotationMode = surfaceMode === 'tab' ? 'tab' : 'staff';
  const isPlayingChromeDimmed = runState === 'running';

  const accuracyPct = summary ? Math.round(summary.accuracy * 100) : 94;
  const displayStars = summary ? summary.starsEarned : 3;

  return (
    <div className="h-[calc(100vh-56px)] w-full bg-[#FFFBF0] riso-paper-grain px-4 md:px-6 py-3 flex flex-col overflow-hidden">
      <div className="max-w-[1380px] w-full mx-auto flex-1 min-h-0 flex flex-col gap-3">
        {detailOpen ? (
          /* ══════════════════════════════════════════════════════════════════════════════════
             SCREEN 03: FORENSIC PITCH RIBBON OVER RE-MATERIALIZED SCORE + 3-PEDAL STOMPBOX RACK
             ══════════════════════════════════════════════════════════════════════════════════ */
          <>
            {/* Compact Celebration Stamp Strip + Tiny Mambo Buddy Sticker (<= 8 words!) */}
            <header className="neo-card bg-[#D8FF2E] px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap shrink-0">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                    ★ {accuracyPct}% IN POCKET!
                  </span>
                  <span className="neo-stamp bg-white text-[#121212]">
                    {'★'.repeat(displayStars)}{'☆'.repeat(3 - displayStars)} {displayStars}/3 PLECTRUMS
                  </span>
                  <span className="neo-stamp bg-[#2B59FF] text-white">
                    +2.1¢ · 14× FLOW
                  </span>
                </div>

                {/* Mambo Buddy Post-Take Sticker (strictly <= 8 words!) */}
                <div className="hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-2xl bg-white border-2 border-[#121212] shadow-brutal-xs">
                  <MamboMascotSvg mood="celebrate" size={34} className="shrink-0" />
                  <span className="font-display text-xs font-extrabold text-[#121212]">
                    &ldquo;Bar 3 vibrato: pure butter (+2¢)!&rdquo;
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  className="neo-btn-paper px-3.5 py-1.5 text-[11px] font-mono uppercase"
                >
                  ↻ Replay
                </button>
                <button
                  type="button"
                  onClick={() =>
                    nextCourse && (isNextUnlocked || demoMode)
                      ? onSelectCourse(nextCourse, 'play')
                      : onBackToRoadmap()
                  }
                  className="neo-btn-cobalt px-4 py-1.5 text-[11px] font-mono uppercase"
                >
                  Next Island &rarr;
                </button>
              </div>
            </header>

            {/* Upper Panel: Re-Materialized 4-Bar Score with Continuous Played Pitch & Timing Ribbon */}
            <div className="h-[345px] shrink-0">
              <RisoEngravedScore
                course={course}
                practiceMode="play"
                hiddenDifficulty="ghost-passing"
                vanishPass={1}
                loopRange="all"
                selectedWindowStartBar={windowStartBar}
                onChangeWindowStartBar={setWindowStartBar}
                onSelectBar={handleSelectBar}
                runState="idle"
                motionRef={motionRef}
                noteStatusRef={noteStatusRef}
                demoMode={demoMode}
                forensicMode
              />
            </div>

            {/* Lower Panel: 03's Signature 3-Pedal Stompbox Rack + Compact Groove Selector */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
              {/* Left 8 cols: 3 Clickable 3D Guitar Stompboxes */}
              <section className="lg:col-span-8 neo-card bg-[#F4ECDC] p-3.5 flex flex-col justify-between gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                      3-PEDAL STOMPBOX RACK
                    </span>
                    <span className="font-mono text-[11px] font-bold text-[#121212]">
                      WASM AMP MONITOR
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
                    className={`px-3 py-1 text-[10px] font-mono uppercase ${
                      ampSettings.enabled || demoMode ? 'neo-btn-lime' : 'neo-btn-paper'
                    }`}
                  >
                    {ampSettings.enabled || demoMode ? '● RIG LIVE' : '○ BYPASS'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 flex-1">
                  {STOMPBOXES.map((pedal) => {
                    const isActive = activeStomp === pedal.id;
                    return (
                      <button
                        key={pedal.id}
                        type="button"
                        onClick={() => handleSelectStomp(pedal.id)}
                        className={`rounded-2xl border-[2.5px] border-[#121212] p-3 text-left flex flex-col justify-between gap-2 transition-all ${
                          isActive
                            ? 'shadow-brutal -translate-y-0.5 ring-2 ring-[#121212]'
                            : 'shadow-brutal-xs opacity-90 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: pedal.bg, color: pedal.text }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="w-3 h-3 rounded-full border-2 border-[#121212]"
                            style={{
                              backgroundColor: isActive ? pedal.led : 'rgba(255,255,255,0.35)',
                            }}
                          />
                          <span className="font-mono text-[9px] font-bold uppercase">
                            {isActive ? 'ACTIVE' : 'BYPASS'}
                          </span>
                        </div>

                        {/* Tactile Rotary Drive & Room Knobs */}
                        <div className="flex items-center justify-around py-0.5">
                          {[
                            { label: 'DRV', val: pedal.drivePct, rot: -45 + pedal.drivePct * 1.1 },
                            { label: 'AIR', val: pedal.roomPct, rot: -45 + pedal.roomPct * 1.1 },
                          ].map((k) => (
                            <div key={k.label} className="flex flex-col items-center gap-1">
                              <div
                                className="w-8 h-8 rounded-full bg-[#121212] border-2 border-[#FFFBF0] flex items-start justify-center pt-1"
                                style={{ transform: `rotate(${Math.round(k.rot)}deg)` }}
                              >
                                <span className="w-1 h-2.5 rounded-full bg-[#D8FF2E]" />
                              </div>
                              <span className="font-mono text-[8.5px] font-bold opacity-90">
                                {k.label} {k.val}%
                              </span>
                            </div>
                          ))}
                        </div>

                        <div>
                          <div className="font-syne text-sm font-extrabold leading-tight">
                            {pedal.name}
                          </div>
                          <div className="font-mono text-[9px] font-bold opacity-85">
                            {pedal.tag}
                          </div>
                        </div>

                        <div className="w-full py-1 rounded-xl bg-[#FFFBF0] text-[#121212] border-2 border-[#121212] font-mono text-[10px] font-bold text-center">
                          {isActive ? 'STOMPED ✓' : 'STOMP'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Right 4 cols: Compact Backing Groove Engine & Mix */}
              <section className="lg:col-span-4 neo-card bg-white p-3.5 flex flex-col justify-between gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="neo-stamp bg-[#2B59FF] text-white">BACKING GROOVE</span>
                  <span className="font-mono text-[11px] font-bold text-[#121212]">
                    {bpm} BPM
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {GROOVE_STYLE_META.slice(0, 6).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGrooveStyle(g.id)}
                      className={`px-2.5 py-2 rounded-xl border-2 border-[#121212] font-mono text-[10px] font-bold text-left transition-all ${
                        grooveStyle === g.id
                          ? 'bg-[#D8FF2E] text-[#121212] shadow-brutal-xs'
                          : 'bg-[#FFFBF0] text-[#423E37] hover:bg-[#F4ECDC]'
                      }`}
                    >
                      {g.shortLabel}
                    </button>
                  ))}
                </div>

                <div className="space-y-2 pt-1 border-t-2 border-dashed border-[#121212]/20">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold">
                    <span>MIX {volumePct}%</span>
                    <button
                      type="button"
                      onClick={() =>
                        setGuideGuitar((g) => (g === 'off' ? 'soft' : g === 'soft' ? 'full' : 'off'))
                      }
                      className="px-2 py-0.5 rounded-lg border-2 border-[#121212] bg-[#F4ECDC] text-[#121212]"
                    >
                      GUIDE: {guideGuitar.toUpperCase()}
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volumePct}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full accent-[#2B59FF]"
                    aria-label="Backing mix level"
                  />
                </div>
              </section>
            </div>
          </>
        ) : (
          /* ══════════════════════════════════════════════════════════════════════════════════
             SCREEN 02: THE TWO-TIER HARMONIZED SOUNDSTAGE (0 SENTENCES · 0 MAMBO CHAT)
             ══════════════════════════════════════════════════════════════════════════════════ */
          <>
            {/* Compact Stage Header (Auto-dims to 25% opacity during live play!) */}
            <header
              className={`flex items-center justify-between gap-3 flex-wrap shrink-0 transition-opacity duration-300 ${
                isPlayingChromeDimmed ? 'opacity-25 hover:opacity-100' : 'opacity-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="neo-stamp bg-[#121212] text-[#D8FF2E]">
                  STG {String(course.order).padStart(2, '0')}
                </span>
                <h1 className="font-syne text-xl md:text-2xl font-extrabold text-[#121212] tracking-tight truncate">
                  {course.title}
                </h1>
                <span className="hidden sm:inline-flex neo-stamp bg-[#F4ECDC] text-[#121212]">
                  {course.keySignature} &middot; {course.totalBars}B
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Live Pitch Cents Gauge Pill (Direct DOM Ref) */}
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border-2 border-[#121212] shadow-brutal-xs">
                  <span
                    ref={liveNoteTextRef}
                    className="font-syne text-xs font-extrabold text-[#121212] w-7"
                  >
                    {neckNotes.active?.label ?? 'F#4'}
                  </span>
                  <span
                    ref={liveCentsTextRef}
                    className="font-mono text-[11px] font-bold text-[#1CE088] w-8 text-right tabular-nums"
                  >
                    +2¢
                  </span>
                  <div className="relative w-16 h-2 rounded-full bg-[#F4ECDC] border border-[#121212]">
                    <span className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#121212]/40 -translate-x-1/2" />
                    <span
                      ref={centsNeedleDotRef}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#D8FF2E] border-[1.8px] border-[#121212]"
                      style={{ left: '53%' }}
                    />
                  </div>
                </div>

                {/* Flow Continuity Stamp */}
                <span className="neo-stamp bg-[#D8FF2E] text-[#121212]">
                  14&times; FLOW
                </span>

                {/* Compact Riso / Pixi Surface Toggle */}
                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-[#F4ECDC] border-2 border-[#121212]">
                  {(
                    [
                      { id: 'riso', label: 'RISO' },
                      { id: 'staff', label: 'PIXI' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSurfaceMode(opt.id)}
                      className={`px-2.5 py-0.5 rounded-lg font-mono text-[10px] font-bold transition-colors ${
                        (opt.id === 'riso' && surfaceMode === 'riso') ||
                        (opt.id === 'staff' && surfaceMode !== 'riso')
                          ? 'bg-[#121212] text-[#D8FF2E]'
                          : 'text-[#57534A] hover:text-[#121212]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            {/* TIER A (52% H): Stationary 4-Bar Riso Engraved Contour Score */}
            <div className="flex-[52] min-h-0 flex flex-col justify-center">
              {surfaceMode === 'riso' ? (
                <RisoEngravedScore
                  course={course}
                  practiceMode={mode}
                  hiddenDifficulty={hiddenDifficulty}
                  vanishPass={vanishPass}
                  onChangeVanishPass={setVanishPass}
                  loopRange={loopRange}
                  selectedWindowStartBar={windowStartBar}
                  onChangeWindowStartBar={setWindowStartBar}
                  onSelectBar={handleSelectBar}
                  runState={runState}
                  motionRef={motionRef}
                  noteStatusRef={noteStatusRef}
                  demoMode={demoMode}
                />
              ) : (
                <div className="neo-card bg-[#121212] p-2.5">
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
            </div>

            {/* TIER B (36% H): 1:1 Risograph 3D Perspective Guitar Neck (Frets 0-17) */}
            <div className="flex-[36] min-h-0 flex flex-col justify-center">
              <RisoPerspectiveNeck
                course={course}
                activeNote={neckNotes.active}
                nextNote={neckNotes.next}
                upcomingNotes={neckNotes.upcoming}
                bleedStringNum={demoMode && runState === 'idle' ? 3 : null}
              />
            </div>

            {/* TIER C (12% H): Single Ultra-Clean Transport & Mode Strip */}
            <footer className="neo-card bg-white px-4 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
              {/* Left: Start / Hear / BPM */}
              <div className="flex items-center gap-2">
                {runState === 'running' ? (
                  <button
                    type="button"
                    onClick={stopEverything}
                    className="neo-btn-magenta px-5 py-2 text-xs font-syne tracking-wide"
                  >
                    ■ STOP
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startTimedRun()}
                    className="neo-btn-lime px-5 py-2 text-xs font-syne tracking-wide"
                  >
                    ▶ START
                  </button>
                )}

                {runState === 'preview' ? (
                  <button
                    type="button"
                    onClick={stopEverything}
                    className="neo-btn-amber px-3.5 py-2 text-[11px] font-mono"
                  >
                    ■ STOP
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={runState === 'running'}
                    onClick={startSoundPreview}
                    className="neo-btn-paper px-3.5 py-2 text-[11px] font-mono"
                  >
                    ♪ HEAR
                  </button>
                )}

                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl bg-[#F4ECDC] border-2 border-[#121212]">
                  <button
                    type="button"
                    disabled={runState === 'running'}
                    onClick={() => setBpm((b) => Math.max(40, b - 5))}
                    className="w-6 h-6 rounded-lg bg-white border-2 border-[#121212] font-mono font-bold text-xs hover:bg-[#D8FF2E]"
                    aria-label="Decrease BPM"
                  >
                    −
                  </button>
                  <span className="font-mono text-xs font-bold text-[#121212] tabular-nums min-w-[58px] text-center">
                    {bpm} BPM
                  </span>
                  <button
                    type="button"
                    disabled={runState === 'running'}
                    onClick={() => setBpm((b) => Math.min(160, b + 5))}
                    className="w-6 h-6 rounded-lg bg-white border-2 border-[#121212] font-mono font-bold text-xs hover:bg-[#D8FF2E]"
                    aria-label="Increase BPM"
                  >
                    +
                  </button>
                </div>

                {mode === 'loop' && (
                  <button
                    type="button"
                    onClick={() => setAutoSpeedUp((v) => !v)}
                    className={`px-2.5 py-1.5 rounded-xl border-2 border-[#121212] font-mono text-[10px] font-bold ${
                      autoSpeedUp ? 'bg-[#1CE088] text-[#121212]' : 'bg-white text-[#57534A]'
                    }`}
                  >
                    +5% AUTO
                  </button>
                )}
              </div>

              {/* Center: 4 Compact Practice Mode Pills */}
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#F4ECDC] border-2 border-[#121212]">
                {MODE_ITEMS.map((item) => {
                  const selected = mode === item.id;
                  const done = completedModes.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSwitchMode(item.id)}
                      className={`px-3 py-1 rounded-lg font-mono text-[11px] font-bold transition-all inline-flex items-center gap-1.5 ${
                        selected
                          ? 'bg-[#121212] text-[#D8FF2E] shadow-brutal-xs'
                          : 'text-[#423E37] hover:text-[#121212]'
                      }`}
                    >
                      <span>{item.label}</span>
                      {done && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#1CE088]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right: Pedals & Forensic Autopsy Drawer Toggle */}
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                className="neo-btn-cobalt px-4 py-2 text-[11px] font-mono uppercase"
              >
                🎛️ PEDALS &amp; RIG
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
