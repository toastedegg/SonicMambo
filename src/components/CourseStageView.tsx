import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackingTransport,
  GROOVE_STYLE_META,
  soundGenerator,
  type GrooveStyleId,
  type GuideGuitarLevel,
} from '../audio/backingTrackEngine';
import type { AmpPresetId } from '../audio/guitarAmpRig';
import { useAudioEngineControl } from '../context/AudioEngineContext';
import { AMP_CHANNEL_CARDS, AmpControlPill, RisoRotaryKnob } from './AmpHeadPopover';
import type {
  CoursePracticeMode,
  CourseTabNote,
  GuitarCourse,
} from '../data/guitarCourses';
import { HoldNoteScorer } from '../dsp/holdScorer';
import { savePracticeSession } from '../storage/db';
import type { LessonNoteStatus, LessonTimelineNote } from '../types/lesson';
import { PASS_ACCURACY_THRESHOLD, type CourseMasteryRecord } from '../utils/courseProgress';
import { MamboMascotSvg } from './MamboMascot';
import type { HiddenDifficulty, StageMotionSnapshot } from './MinimalScoreCanvasPixi';
import { NeoArcadeStage } from './NeoArcadeStage';
import { RisoEngravedScore, type VanishPass } from './RisoEngravedScore';
import { RisoPerspectiveNeck } from './RisoPerspectiveNeck';

export type StageLensId = 'arcade' | 'staff' | 'neck';

export interface AttemptOutcome {
  passed: boolean;
  starsEarned: 0 | 1 | 2 | 3;
  newlyUnlockedCourse: GuitarCourse | null;
}

interface CourseStageViewProps {
  course: GuitarCourse;
  initialMode?: CoursePracticeMode;
  initialLens?: StageLensId;
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

const LENS_ITEMS: ReadonlyArray<{ id: StageLensId; icon: string; label: string }> = [
  { id: 'arcade', icon: '🕹️', label: 'ARCADE' },
  { id: 'staff', icon: '🎼', label: 'STAFF+TAB' },
  { id: 'neck', icon: '🎸', label: '3D NECK' },
];

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

export function CourseStageView({
  course,
  initialMode = 'play',
  initialLens = 'arcade',
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
    asioStatus,
    detectionRef,
    start,
    stop,
    updateAmpSettings,
    probeAsioBridge,
    setInputGated,
    resetDsp,
  } = useAudioEngineControl();

  const [lens, setLens] = useState<StageLensId>(initialLens);
  const [mode, setMode] = useState<CoursePracticeMode>(initialMode);
  const [bpm, setBpm] = useState<number>(course.tempoBpm);
  const [grooveStyle, setGrooveStyle] = useState<GrooveStyleId>(course.defaultGroove);
  const [guideGuitar, setGuideGuitar] = useState<GuideGuitarLevel>('off');
  const [volumePct, setVolumePct] = useState<number>(() =>
    Math.round(soundGenerator.getVolume() * 100),
  );
  const [detailOpen, setDetailOpen] = useState<boolean>(initialDetailOpen);
  const [windowStartBar, setWindowStartBar] = useState<number>(1);
  const [vanishPass, setVanishPass] = useState<VanishPass>(1);

  const [loopRange, setLoopRange] = useState<
    'all' | { startBar: number; endBar: number }
  >('all');
  const [autoSpeedUp] = useState<boolean>(true);
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
  const liveCentsLabelRef = useRef<HTMLSpanElement | null>(null);
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
    stopEverything();
    setLens(initialLens);
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
  }, [course.id, initialLens, initialMode, initialDetailOpen]);

  useEffect(() => {
    return () => {
      shadowCancelledRef.current = true;
      transportRef.current?.stop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setInputGated(false);
    };
  }, [setInputGated]);

  // Direct DOM cents needle update at 15Hz when live listening
  useEffect(() => {
    if (!isListening || runState !== 'running') return undefined;
    const id = window.setInterval(() => {
      const det = detectionRef.current;
      const c = Math.round(det.centsOffset ?? 0);
      if (liveCentsLabelRef.current) {
        liveCentsLabelRef.current.textContent = det.label
          ? Math.abs(c) <= 5
            ? `DEAD CENTER ${c >= 0 ? `+${c}¢` : `${c}¢`}`
            : `${det.label} ${c >= 0 ? `+${c}¢` : `${c}¢`}`
          : 'LISTENING';
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
    const pedal = AMP_CHANNEL_CARDS.find((p) => p.id === presetId);
    if (pedal) {
      void updateAmpSettings({
        enabled: true,
        preset: presetId,
        drive: pedal.defaultDrive,
        tone: pedal.defaultTone,
        reverb: pedal.defaultReverb,
      });
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

  // Determine strict 2-dot Focus (Current + Next) for Lens 3 (3D Perspective Neck)
  const neckFocus = useMemo(() => {
    const windowEndBar = Math.min(course.totalBars, windowStartBar + 3);
    const inWin = course.notes.filter(
      (n) => n.bar >= windowStartBar && n.bar <= windowEndBar,
    );
    if (inWin.length === 0) return { active: null, next: null };

    let activeIdx = -1;
    if (activeNoteId) {
      activeIdx = inWin.findIndex((n) => n.id === activeNoteId);
    }
    if (activeIdx < 0 && demoMode && runState === 'idle') {
      activeIdx = inWin.findIndex((n) => n.bar === windowStartBar + 2);
    }
    if (activeIdx < 0) activeIdx = 0;

    return {
      active: inWin[activeIdx] ?? null,
      next: inWin[activeIdx + 1] ?? inWin[0] ?? null,
    };
  }, [activeNoteId, course.notes, course.totalBars, demoMode, runState, windowStartBar]);

  const completedModes = mastery?.completedModes ?? [];
  const isPlayingChromeDimmed = runState === 'running';
  const ampOn = ampSettings.enabled || demoMode;
  const micOn = isListening || demoMode;
  const accuracyPct = summary ? Math.round(summary.accuracy * 100) : 94;
  const displayStars = summary ? summary.starsEarned : 3;

  return (
    <div className="h-full flex flex-col bg-[#FFFBF0] overflow-hidden">
      {/* ══════════════════════════════════════════════════════════════════
          STRATUM 1: ONE UNIFIED 56px STAGE HEADER BAR (§2.1 — ZERO DUPLICATE HEADERS!)
         ══════════════════════════════════════════════════════════════════ */}
      <header
        className={`h-[56px] shrink-0 bg-[#FFFBF0] border-b-[2.5px] border-[#121212] px-4 flex items-center justify-between gap-3 transition-opacity duration-300 z-30 ${
          isPlayingChromeDimmed ? 'opacity-25 hover:opacity-100' : 'opacity-100'
        }`}
      >
        {/* Left: [← MAP] · [01] Stage Badge · Course Title · Key · BPM (Printed ONCE!) */}
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBackToRoadmap}
            className="neo-pill-btn px-2.5 py-1 bg-[#FFFBF0] hover:bg-[#F4ECDC] font-mono text-[11px] font-bold text-[#121212] shrink-0"
          >
            ← MAP
          </button>

          <span className="px-2 py-0.5 rounded-lg bg-[#121212] text-[#D8FF2E] font-mono text-[11px] font-bold shrink-0">
            {String(course.order).padStart(2, '0')}
          </span>

          <h1 className="font-syne text-[17px] font-extrabold text-[#121212] tracking-tight truncate">
            {course.title}
          </h1>

          <span className="hidden xl:inline-flex items-center px-2 py-0.5 rounded-md bg-[#F4ECDC] border border-[#121212]/25 font-mono text-[11px] font-bold text-[#57534A] shrink-0">
            {course.keySignature} · {bpm} BPM
          </span>
        </div>

        {/* Center: Live Pitch Reticle Pill + Flow Stamp */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#FFFBF0] border-[2px] border-[#121212]">
            <span
              ref={liveCentsLabelRef}
              className="font-mono text-[10.5px] font-bold text-[#121212] whitespace-nowrap"
            >
              DEAD CENTER +2¢
            </span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[9px] text-[#57534A]">♭</span>
              <div className="relative w-12 h-2 rounded-full bg-[#F4ECDC] border border-[#121212]">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#121212]/40" />
                <span
                  ref={centsNeedleDotRef}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#1CE088] border border-[#121212]"
                  style={{ left: '53%' }}
                />
              </div>
              <span className="font-mono text-[9px] text-[#57534A]">♯</span>
            </div>
          </div>

          <span className="px-2.5 py-1 rounded-full bg-[#D8FF2E] border-[2px] border-[#121212] font-mono text-[10.5px] font-bold text-[#121212] tabular-nums">
            14× FLOW
          </span>
        </div>

        {/* Right: Single-Focus 3-Lens Switcher + Compact AMP / MIC LEDs */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="inline-flex items-center p-0.5 rounded-xl bg-[#F4ECDC] border-[2px] border-[#121212]"
            role="tablist"
            aria-label="Single-focus stage lens"
          >
            {LENS_ITEMS.map((item) => {
              const active = !detailOpen && lens === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setDetailOpen(false);
                    setLens(item.id);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-mono text-[10.5px] font-bold transition-colors flex items-center gap-1 whitespace-nowrap ${
                    active
                      ? 'bg-[#121212] text-[#D8FF2E]'
                      : 'text-[#57534A] hover:text-[#121212]'
                  }`}
                >
                  <span aria-hidden>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {asioStatus.asioConnected && (
            <span
              className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-lg border-[2px] border-[#121212] bg-[#2B59FF] text-white font-mono text-[10px] font-bold"
              title={`Zero-GC Native ASIO Active: ${asioStatus.driverName} (${asioStatus.bufferSize} smp @ ${(asioStatus.sampleRate / 1000).toFixed(0)}kHz)`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#1CE088] border border-[#121212]" />
              ASIO {asioStatus.latencyMs.toFixed(1)}ms
            </span>
          )}

          <AmpControlPill compact demoMode={demoMode} />

          <button
            type="button"
            onClick={() => {
              if (isListening) stop();
              else void start();
            }}
            className={`px-2 py-1 rounded-lg border-[2px] border-[#121212] font-mono text-[10px] font-bold flex items-center gap-1 ${
              micOn ? 'bg-[#D8FF2E] text-[#121212]' : 'bg-[#FFFBF0] text-[#121212]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full border border-[#121212] ${micOn ? 'bg-[#1CE088]' : 'bg-[#FF3B7F]'}`} />
            {micOn ? 'MIC ON' : 'MIC'}
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          STRATUM 2: SINGLE-FOCUS FULL STAGE OR POST-TAKE FORENSIC REVIEW
         ══════════════════════════════════════════════════════════════════ */}
      {!detailOpen ? (
        <>
          {/* ONE Generous Full-Stage Canvas — NEVER stack two views vertically! */}
          <div className="flex-1 min-h-0 px-4 py-3 max-w-[1440px] mx-auto w-full flex flex-col">
            {lens === 'arcade' ? (
              <NeoArcadeStage
                notes={course.notes}
                barChords={course.barChords}
                totalBars={course.totalBars}
                beatsPerBar={course.beatsPerBar}
                practiceMode={mode}
                hiddenDifficulty={hiddenDifficulty}
                loopRange={loopRange}
                motionRef={motionRef}
                noteStatusRef={noteStatusRef}
                onSelectBar={handleSelectBar}
                demoShowcase={demoMode}
              />
            ) : lens === 'staff' ? (
              <RisoEngravedScore
                course={course}
                mode={mode}
                vanishPass={vanishPass}
                onChangeVanishPass={setVanishPass}
                windowStartBar={windowStartBar}
                onWindowStartBarChange={setWindowStartBar}
                loopRange={loopRange}
                runState={runState}
                motionRef={motionRef}
                noteStatusRef={noteStatusRef}
                activeNoteId={activeNoteId}
                onSelectBar={handleSelectBar}
                forensicMode={false}
                demoMode={demoMode}
              />
            ) : (
              <RisoPerspectiveNeck
                course={course}
                activeNote={neckFocus.active}
                nextNote={neckFocus.next}
                bleedStringNum={null}
              />
            )}
          </div>

          {/* STRATUM 3: Compact 58px Bottom Transport Strip (Zero Mambo Buddy / Zero TIP Footers!) */}
          <footer className="h-[58px] shrink-0 px-4 pb-3 max-w-[1440px] mx-auto w-full flex items-center">
            <div className="w-full h-full neo-card bg-[#FFFBF0] px-3 flex items-center justify-between gap-3">
              {/* Left: Start Groove + Hear + BPM */}
              <div className="flex items-center gap-2">
                {runState === 'running' ? (
                  <button
                    type="button"
                    onClick={stopEverything}
                    className="px-4 py-1.5 rounded-xl border-[2.2px] border-[#121212] bg-[#FF3B7F] text-white font-syne text-xs font-extrabold tracking-wide shadow-brutal-xs"
                  >
                    ■ STOP
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startTimedRun()}
                    className="px-4 py-1.5 rounded-xl border-[2.2px] border-[#121212] bg-[#D8FF2E] text-[#121212] font-syne text-xs font-extrabold tracking-wide shadow-brutal-xs hover:bg-[#C7F21D]"
                  >
                    ▶ START GROOVE
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (runState === 'preview') stopEverything();
                    else startSoundPreview();
                  }}
                  className={`px-3 py-1.5 rounded-xl border-[2px] border-[#121212] font-mono text-[11px] font-bold transition-colors ${
                    runState === 'preview'
                      ? 'bg-[#2B59FF] text-white'
                      : 'bg-[#FFFBF0] text-[#121212] hover:bg-[#F4ECDC]'
                  }`}
                >
                  {runState === 'preview' ? '■ MUTE' : '♪ HEAR'}
                </button>

                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl bg-[#FFFBF0] border-[2px] border-[#121212]">
                  <button
                    type="button"
                    onClick={() => setBpm((b) => Math.max(40, b - 4))}
                    className="w-5 h-5 rounded border border-[#121212] bg-[#F4ECDC] font-mono text-xs font-bold leading-none hover:bg-[#D8FF2E]"
                    aria-label="Decrease BPM"
                  >
                    −
                  </button>
                  <span className="font-mono text-[11px] font-bold tabular-nums min-w-[54px] text-center">
                    {bpm} BPM
                  </span>
                  <button
                    type="button"
                    onClick={() => setBpm((b) => Math.min(180, b + 4))}
                    className="w-5 h-5 rounded border border-[#121212] bg-[#F4ECDC] font-mono text-xs font-bold leading-none hover:bg-[#D8FF2E]"
                    aria-label="Increase BPM"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Center: Practice Mode Pills */}
              <div className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-[#F4ECDC] border-[2px] border-[#121212]">
                {MODE_ITEMS.map((m) => {
                  const active = mode === m.id;
                  const done = completedModes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSwitchMode(m.id)}
                      className={`px-2.5 py-1 rounded-lg font-mono text-[10.5px] font-bold transition-colors ${
                        active
                          ? 'bg-[#121212] text-[#D8FF2E]'
                          : 'text-[#57534A] hover:text-[#121212]'
                      }`}
                    >
                      {m.label}
                      {done ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>

              {/* Right: Pedals & Forensic Rig Drawer Toggle */}
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                className="px-3.5 py-1.5 rounded-xl border-[2.2px] border-[#121212] bg-[#2B59FF] text-white font-mono text-[11px] font-bold shadow-brutal-xs hover:bg-[#2147DB]"
              >
                🎛️ PEDALS & RIG
              </button>
            </div>
          </footer>
        </>
      ) : (
        /* ══════════════════════════════════════════════════════════════════
           SCREEN 03 (§2.6): COUPLED STAFF+TAB PITCH RIBBON + COMPACT <=215px STOMPBOXES
           ══════════════════════════════════════════════════════════════════ */
        <div className="flex-1 min-h-0 px-4 py-3 max-w-[1440px] mx-auto w-full flex flex-col gap-3 overflow-hidden">
          {/* Compact Post-Take Celebration Strip (<= 8 word Mambo Buddy stamp!) */}
          <div className="neo-card bg-[#D8FF2E] px-4 py-2 flex items-center justify-between gap-3 flex-wrap shrink-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-xl bg-[#121212] text-[#D8FF2E] font-mono text-xs font-bold">
                ★ {accuracyPct}% IN POCKET!
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-[#FFFBF0] border-2 border-[#121212] font-mono text-xs font-bold text-[#121212]">
                {'★'.repeat(displayStars)} {displayStars}/3 PLECTRUMS
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-[#2B59FF] text-white border-2 border-[#121212] font-mono text-xs font-bold">
                +2.1¢ · 14× FLOW
              </span>

              {/* Tiny Mambo Buddy Stamp — strictly 6 words! */}
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-[#FFFBF0] border-2 border-[#121212]">
                <MamboMascotSvg mood="hype" size={24} />
                <span className="font-mono text-[11px] font-bold text-[#121212]">
                  “Bar 3 vibrato: pure butter (+2¢)!”
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="px-3 py-1.5 rounded-xl border-2 border-[#121212] bg-[#FFFBF0] font-mono text-[11px] font-bold hover:bg-[#F4ECDC]"
              >
                ↻ BACK TO STAGE
              </button>
              {nextCourse && (isNextUnlocked || demoMode) && (
                <button
                  type="button"
                  onClick={() => onSelectCourse(nextCourse, 'play')}
                  className="px-3.5 py-1.5 rounded-xl border-2 border-[#121212] bg-[#2B59FF] text-white font-mono text-[11px] font-bold shadow-brutal-xs"
                >
                  NEXT ISLAND →
                </button>
              )}
            </div>
          </div>

          {/* UPPER PANEL (58%+ height): Coupled 5-Line Staff + 6-Line TAB with Forensic Pitch Ribbon */}
          <div className="flex-1 min-h-0">
            <RisoEngravedScore
              course={course}
              mode="play"
              vanishPass={1}
              windowStartBar={windowStartBar}
              onWindowStartBarChange={setWindowStartBar}
              loopRange="all"
              runState="results"
              motionRef={motionRef}
              noteStatusRef={noteStatusRef}
              onSelectBar={handleSelectBar}
              forensicMode={true}
              demoMode={demoMode}
            />
          </div>

          {/* LOWER PANEL (Strictly <= 215px tall!): Interactive 4-Channel Tube Stompbox Rack + Backing Groove */}
          <div className="h-[212px] max-h-[215px] shrink-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
            {/* 4-Channel Interactive Stompbox Rack (Real Draggable Rotary Knobs + Nitro 5150 High-Gain!) */}
            <div className="lg:col-span-8 neo-card bg-[#FFFBF0] p-3 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-lg bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold">
                    4-CHANNEL TUBE RIG
                  </span>
                  {asioStatus.asioConnected ? (
                    <span className="px-2 py-0.5 rounded-md bg-[#2B59FF] text-white border border-[#121212] font-mono text-[10px] font-bold">
                      ⚡ ASIO {asioStatus.latencyMs.toFixed(1)}ms NATIVE AMP
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void probeAsioBridge()}
                      className="font-mono text-[10px] font-bold text-[#57534A] hover:text-[#121212]"
                      title="Click to connect native low-latency ASIO service"
                    >
                      WASM AMP MONITOR
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <label className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F4ECDC] border border-[#121212] font-mono text-[9.5px] font-bold">
                    <span>LVL</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(ampSettings.volume * 100)}
                      onChange={(e) =>
                        void updateAmpSettings({
                          enabled: true,
                          volume: Number(e.target.value) / 100,
                        })
                      }
                      className="w-16 accent-[#FF3B7F] cursor-pointer h-1.5"
                      aria-label="Guitar amp output volume"
                    />
                    <span className="tabular-nums w-7 text-right">
                      {Math.round(ampSettings.volume * 100)}%
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      void updateAmpSettings({
                        enabled: true,
                        preset: 'insane-lead',
                        drive: 0.95,
                        tone: 0.80,
                        reverb: 0.18,
                        volume: 0.86,
                      })
                    }
                    className="px-2.5 py-0.5 rounded-full border-2 border-[#121212] bg-[#FF3B7F] text-white font-mono text-[10px] font-extrabold hover:brightness-110"
                    title="Engage 3-Stage Nitro 5150 Shred Drive at 95%!"
                  >
                    🔥 GO NUTS
                  </button>

                  <button
                    type="button"
                    onClick={() => void updateAmpSettings({ enabled: !ampSettings.enabled })}
                    className={`px-2.5 py-0.5 rounded-full border-2 border-[#121212] font-mono text-[10px] font-bold ${
                      ampOn ? 'bg-[#D8FF2E] text-[#121212]' : 'bg-[#F4ECDC] text-[#57534A]'
                    }`}
                  >
                    {ampOn ? '● RIG LIVE' : '○ BYPASS'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2.5 flex-1 min-h-0 mt-2">
                {AMP_CHANNEL_CARDS.map((pedal) => {
                  const active = ampSettings.preset === pedal.id;
                  const shownDrive = active
                    ? Math.round(ampSettings.drive * 100)
                    : Math.round(pedal.defaultDrive * 100);
                  const shownTone = active
                    ? Math.round((ampSettings.tone ?? pedal.defaultTone) * 100)
                    : Math.round(pedal.defaultTone * 100);

                  return (
                    <div
                      key={pedal.id}
                      onClick={() => handleSelectStomp(pedal.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectStomp(pedal.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`rounded-2xl border-[2.5px] border-[#121212] px-2.5 py-2 text-left flex flex-col justify-between transition-all cursor-pointer ${
                        active
                          ? 'border-b-[5px] -translate-y-[1px] ring-2 ring-[#D8FF2E]'
                          : 'border-b-[3px] opacity-88 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: pedal.bg, color: pedal.text }}
                    >
                      {/* Top LED + Two Live Interactive Rotary Knobs (Drag up/down or scroll!) */}
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1">
                          <span
                            className="w-2.5 h-2.5 rounded-full border-[1.8px] border-[#121212] shrink-0"
                            style={{ backgroundColor: active ? pedal.led : 'rgba(255,255,255,0.28)' }}
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <RisoRotaryKnob
                            label="DRV"
                            valuePct={shownDrive}
                            onChangePct={(pct) =>
                              void updateAmpSettings({
                                enabled: true,
                                preset: pedal.id,
                                drive: pct / 100,
                              })
                            }
                            size={38}
                            accentColor={pedal.id === 'insane-lead' ? '#FF3B7F' : '#D8FF2E'}
                            textColor={pedal.text}
                          />
                          <RisoRotaryKnob
                            label="BITE"
                            valuePct={shownTone}
                            onChangePct={(pct) =>
                              void updateAmpSettings({
                                enabled: true,
                                preset: pedal.id,
                                tone: pct / 100,
                              })
                            }
                            size={38}
                            accentColor="#D8FF2E"
                            textColor={pedal.text}
                          />
                        </div>
                      </div>

                      {/* Pedal Title + Tactile Footswitch Bar */}
                      <div className="flex items-end justify-between gap-1.5 mt-1">
                        <div className="min-w-0">
                          <div className="font-syne text-[11.5px] font-extrabold leading-tight truncate">
                            {pedal.name}
                          </div>
                          <div className="font-mono text-[8.5px] font-bold opacity-85 truncate">
                            {pedal.tag}
                          </div>
                        </div>
                        <div className="px-2 py-0.5 rounded-lg bg-[#FFFBF0] border-2 border-[#121212] font-mono text-[9px] font-bold text-[#121212] shrink-0">
                          {active ? 'ON ✓' : 'STOMP'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Compact Backing Groove & Mix Selector (Matches <= 215px Height!) */}
            <div className="lg:col-span-4 neo-card bg-[#FFFBF0] p-3 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded-lg bg-[#2B59FF] text-white border border-[#121212] font-mono text-[10px] font-bold">
                  BACKING GROOVE
                </span>
                <span className="font-mono text-[11px] font-bold text-[#121212] tabular-nums">
                  {bpm} BPM
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 my-1.5">
                {GROOVE_STYLE_META.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGrooveStyle(g.id)}
                    className={`px-2.5 py-1.5 rounded-lg border-[1.8px] border-[#121212] font-mono text-[10.5px] font-bold text-left transition-colors ${
                      grooveStyle === g.id
                        ? 'bg-[#D8FF2E] text-[#121212]'
                        : 'bg-[#FFFBF0] text-[#121212] hover:bg-[#F4ECDC]'
                    }`}
                  >
                    {g.shortLabel}
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-dashed border-[#121212]/25 flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold text-[#57534A] mb-0.5">
                    <span>MIX</span>
                    <span>{volumePct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volumePct}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full accent-[#2B59FF] cursor-pointer h-2"
                    aria-label="Backing mix volume"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setGuideGuitar((prev) => (prev === 'off' ? 'soft' : prev === 'soft' ? 'full' : 'off'))
                  }
                  className="px-2.5 py-1 rounded-lg border-[1.8px] border-[#121212] bg-[#F4ECDC] font-mono text-[10px] font-bold shrink-0"
                >
                  GUIDE: {guideGuitar.toUpperCase()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
