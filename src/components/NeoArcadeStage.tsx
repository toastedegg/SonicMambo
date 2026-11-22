import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoursePracticeMode, CourseTabNote } from '../data/guitarCourses';
import type { DetectionSnapshot } from '../hooks/useAudioEngine';
import type { LessonNoteStatus } from '../types/lesson';
import type { HiddenDifficulty, StageMotionSnapshot } from './MinimalScoreCanvasPixi';

interface NeoArcadeStageProps {
  notes: readonly CourseTabNote[];
  barChords: readonly string[];
  totalBars: number;
  beatsPerBar: number;
  practiceMode: CoursePracticeMode;
  hiddenDifficulty: HiddenDifficulty;
  loopRange: 'all' | { startBar: number; endBar: number };
  motionRef: React.MutableRefObject<StageMotionSnapshot>;
  detectionRef: React.MutableRefObject<DetectionSnapshot>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  onSelectBar?: (barNumber: number) => void;
  demoShowcase?: boolean;
}

interface StringStyle {
  num: 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  pitch: string;
  color: string;
  textColor: string;
  wireTint: string;
}

const STRING_LANES: readonly StringStyle[] = [
  { num: 1, name: 'e', pitch: 'E4', color: '#FF3B7F', textColor: '#FFFFFF', wireTint: 'rgba(255,59,127,0.35)' },
  { num: 2, name: 'B', pitch: 'B3', color: '#FF8A00', textColor: '#121212', wireTint: 'rgba(255,138,0,0.40)' },
  { num: 3, name: 'G', pitch: 'G3', color: '#D8FF2E', textColor: '#121212', wireTint: 'rgba(180,219,10,0.55)' },
  { num: 4, name: 'D', pitch: 'D3', color: '#1CE088', textColor: '#121212', wireTint: 'rgba(28,224,136,0.40)' },
  { num: 5, name: 'A', pitch: 'A2', color: '#2B59FF', textColor: '#FFFFFF', wireTint: 'rgba(43,89,255,0.35)' },
  { num: 6, name: 'E', pitch: 'E2', color: '#8B5CF6', textColor: '#FFFFFF', wireTint: 'rgba(139,92,246,0.35)' },
];

const TECH_META: Record<string, { label: string; bg: string; text: string }> = {
  vibrato: { label: 'VIB', bg: '#D8FF2E', text: '#121212' },
  slide: { label: 'SLIDE', bg: '#2B59FF', text: '#FFFFFF' },
  'slide-vibrato': { label: 'SLD·VIB', bg: '#2B59FF', text: '#FFFFFF' },
  hammer: { label: 'H-ON', bg: '#FF3B7F', text: '#FFFFFF' },
  pull: { label: 'PULL', bg: '#FF8A00', text: '#121212' },
};

const PX_PER_BEAT = 114;
const HIT_ZONE_X = 228; // px from left of scrolling track
const LANE_HEIGHT = 54;
const HEADER_RAIL_HEIGHT = 42;
const DEMO_PLAYHEAD_BEAT = 2.15;

export function NeoArcadeStage({
  notes,
  barChords,
  totalBars,
  beatsPerBar,
  practiceMode,
  hiddenDifficulty,
  loopRange,
  motionRef,
  detectionRef,
  noteStatusRef,
  onSelectBar,
  demoShowcase = false,
}: NeoArcadeStageProps) {
  // Smooth lightweight UI frame snapshot when running/previewing (and rich static snapshot in demoShowcase)
  const [frame, setFrame] = useState<{
    courseBeat: number;
    running: boolean;
    previewing: boolean;
    inCountIn: boolean;
    countInNumber: number;
    shadowPhase: 'idle' | 'listen' | 'respond';
    activeTargetNoteId: string | null;
    detectedLabel: string | null;
    centsOffset: number | null;
    hitsCount: number;
    grooveFlow: number;
  }>(() => ({
    courseBeat: demoShowcase ? DEMO_PLAYHEAD_BEAT : 0,
    running: false,
    previewing: false,
    inCountIn: false,
    countInNumber: 4,
    shadowPhase: 'idle',
    activeTargetNoteId: demoShowcase ? notes[2]?.id ?? null : null,
    detectedLabel: demoShowcase ? notes[2]?.label ?? 'A4' : null,
    centsOffset: demoShowcase ? 2 : null,
    hitsCount: demoShowcase ? 14 : 0,
    grooveFlow: demoShowcase ? 14 : 0,
  }));

  const rafIdRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;
    const syncFrame = () => {
      if (!mounted) return;
      const m = motionRef.current;
      const d = detectionRef.current;
      const statuses = noteStatusRef.current;

      const isActive = m.running || m.previewing;
      if (isActive) {
        let hits = 0;
        for (const k in statuses) {
          if (statuses[k] === 'hit') hits += 1;
        }
        setFrame({
          courseBeat: m.courseBeat,
          running: m.running,
          previewing: m.previewing,
          inCountIn: m.inCountIn,
          countInNumber: m.countInNumber,
          shadowPhase: m.shadowPhase,
          activeTargetNoteId: m.activeTargetNoteId,
          detectedLabel: d.label,
          centsOffset: d.tuningOffsetCents != null ? Math.round(d.tuningOffsetCents) : null,
          hitsCount: hits,
          grooveFlow: Math.max(hits, 0),
        });
      } else if (!demoShowcase) {
        // Reflect bar focus jumps when idle
        setFrame((prev) => {
          const nextBeat = m.focusStartBeat;
          if (
            prev.running ||
            prev.previewing ||
            Math.abs(prev.courseBeat - nextBeat) > 0.01
          ) {
            return {
              ...prev,
              courseBeat: nextBeat,
              running: false,
              previewing: false,
              inCountIn: false,
              shadowPhase: 'idle',
              activeTargetNoteId: null,
            };
          }
          return prev;
        });
      }

      rafIdRef.current = requestAnimationFrame(syncFrame);
    };

    rafIdRef.current = requestAnimationFrame(syncFrame);
    return () => {
      mounted = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [demoShowcase, detectionRef, motionRef, noteStatusRef]);

  const currentBar = Math.min(
    totalBars,
    Math.max(1, Math.floor(frame.courseBeat / beatsPerBar) + 1),
  );
  const currentChord = barChords[currentBar - 1] ?? barChords[0] ?? '—';

  // Compute demo-enhanced or live note status
  const getNoteVisualState = (note: CourseTabNote): 'hit' | 'active' | 'miss' | 'upcoming' => {
    const liveStatus = noteStatusRef.current[note.id];
    if (liveStatus === 'hit') return 'hit';
    if (liveStatus === 'miss') return 'miss';
    if (frame.activeTargetNoteId === note.id) return 'active';

    if (demoShowcase && !frame.running && !frame.previewing) {
      if (note.startBeat + note.durationBeats <= DEMO_PLAYHEAD_BEAT) return 'hit';
      if (
        DEMO_PLAYHEAD_BEAT >= note.startBeat &&
        DEMO_PLAYHEAD_BEAT < note.startBeat + note.durationBeats
      ) {
        return 'active';
      }
    }
    return 'upcoming';
  };

  // Determine which notes are visible in the current scroll window
  const visibleNotes = useMemo(() => {
    const minBeat = frame.courseBeat - 2.6;
    const maxBeat = frame.courseBeat + 11.5;
    return notes.filter(
      (n) => n.startBeat + n.durationBeats >= minBeat && n.startBeat <= maxBeat,
    );
  }, [frame.courseBeat, notes]);

  // Compute active target note for hit-zone reticle
  const activeNote = useMemo(
    () =>
      notes.find((n) => n.id === frame.activeTargetNoteId) ??
      (demoShowcase && !frame.running ? notes[2] ?? notes[0] : null),
    [demoShowcase, frame.activeTargetNoteId, frame.running, notes],
  );

  // Subtle rhythmic chord-root pocket dots on lower strings so the 6-string highway feels alive
  const bassPocketGuides = useMemo(() => {
    const guides: Array<{ bar: number; beat: number; stringNum: 5 | 6; chord: string }> = [];
    for (let b = 1; b <= totalBars; b += 1) {
      const chord = barChords[b - 1] ?? '';
      const startBeat = (b - 1) * beatsPerBar;
      const isLowE = chord.startsWith('E') || chord.startsWith('G') || chord.startsWith('F');
      guides.push({
        bar: b,
        beat: startBeat,
        stringNum: isLowE ? 6 : 5,
        chord,
      });
    }
    return guides;
  }, [barChords, beatsPerBar, totalBars]);

  const cents = frame.centsOffset ?? (demoShowcase ? 2 : 0);
  const centsClamped = Math.max(-35, Math.min(35, cents));
  const centsLabel =
    frame.centsOffset != null || demoShowcase
      ? Math.abs(cents) <= 5
        ? `DEAD CENTER ${cents >= 0 ? `+${cents}c` : `${cents}c`}`
        : cents > 0
          ? `SHARP +${cents}c`
          : `FLAT ${cents}c`
      : 'READY FOR GUITAR';

  const grooveFlowValue = frame.running ? frame.grooveFlow : demoShowcase ? 14 : 0;

  return (
    <section className="neo-card-lg bg-white overflow-hidden select-none">
      {/* Top Arcade Telemetry Strip */}
      <div className="px-4 py-2.5 bg-[#121212] text-[#FFFBF0] border-b-[2.5px] border-[#121212] flex items-center justify-between gap-3 flex-wrap">
        {/* Left: Live Pitch Pocket Meter */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#D8FF2E] text-[#121212] border-2 border-[#FFFBF0]/15">
            <span className="w-2 h-2 rounded-full bg-[#121212]" />
            <span className="font-mono text-xs font-bold tracking-wide">{centsLabel}</span>
          </div>

          {/* Mini Pitch Reticle Bar */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/10 border border-white/15">
            <span className="font-mono text-[10px] text-white/60">♭</span>
            <div className="relative w-24 h-2 rounded-full bg-white/15 overflow-hidden">
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#D8FF2E] -translate-x-1/2" />
              <div
                className="absolute top-0 bottom-0 w-3 rounded-full bg-[#1CE088] border border-[#121212] transition-all duration-100"
                style={{
                  left: `calc(${50 + (centsClamped / 35) * 44}% - 6px)`,
                }}
              />
            </div>
            <span className="font-mono text-[10px] text-white/60">♯</span>
          </div>

          <span className="font-mono text-xs font-bold text-[#FFFBF0]/80">
            BAR {currentBar}/{totalBars} · <span className="text-[#FF8A00]">{currentChord}</span>
          </span>
        </div>

        {/* Center: Clickable Bar Pills */}
        <div className="hidden lg:flex items-center gap-1">
          {Array.from({ length: totalBars }, (_, idx) => {
            const barNum = idx + 1;
            const isCurrent = barNum === currentBar;
            const isLoopSelected =
              loopRange !== 'all' &&
              barNum >= loopRange.startBar &&
              barNum <= loopRange.endBar;

            return (
              <button
                key={barNum}
                type="button"
                onClick={() => onSelectBar?.(barNum)}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border transition-all ${
                  isLoopSelected
                    ? 'bg-[#FF3B7F] text-white border-white'
                    : isCurrent
                      ? 'bg-[#D8FF2E] text-[#121212] border-[#D8FF2E]'
                      : 'bg-white/10 text-white/75 border-white/15 hover:bg-white/20 hover:text-white'
                }`}
                title={
                  practiceMode === 'loop'
                    ? `Click to loop Bar ${barNum}`
                    : `Jump preview to Bar ${barNum}`
                }
              >
                B{barNum}
              </button>
            );
          })}
        </div>

        {/* Right: Non-Punitive Real-Time Groove Flow Meter */}
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#FF3B7F] text-white border-2 border-white/20">
            <span className="font-syne text-sm font-extrabold tracking-tight tabular-nums">
              {grooveFlowValue}× GROOVE FLOW
            </span>
          </div>
          <span
            className="hidden sm:inline-flex items-center px-2 py-1 rounded-lg bg-white/10 font-mono text-[10px] font-bold text-[#1CE088]"
            title="Missed notes never wipe your progress — jump right back into the pocket!"
          >
            RECOVERY READY
          </span>
        </div>
      </div>

      {/* Main 6-String Color-Coded Riff Highway */}
      <div
        className="relative w-full overflow-hidden bg-[#FFFBF0] riso-grid"
        style={{ height: `${HEADER_RAIL_HEIGHT + LANE_HEIGHT * 6}px` }}
      >
        {/* Count-in or Shadow Phase Banner Overlay */}
        {frame.inCountIn && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#121212]/45 backdrop-blur-[1px]">
            <div className="neo-card bg-[#D8FF2E] px-8 py-4 text-center">
              <div className="font-mono text-xs font-bold uppercase tracking-widest text-[#121212]">
                COUNT IN · GET READY
              </div>
              <div className="font-syne text-6xl font-extrabold text-[#121212] leading-none mt-1">
                {frame.countInNumber}
              </div>
            </div>
          </div>
        )}

        {!frame.inCountIn && frame.shadowPhase !== 'idle' && (
          <div className="absolute top-2 right-4 z-25">
            <span
              className={`neo-stamp ${
                frame.shadowPhase === 'listen'
                  ? 'bg-[#2B59FF] text-white'
                  : 'bg-[#D8FF2E] text-[#121212]'
              }`}
            >
              {frame.shadowPhase === 'listen'
                ? '👂 LISTEN TO PHRASE'
                : '🎸 YOUR TURN — ECHO BACK!'}
            </span>
          </div>
        )}

        {/* Left Nut Column (Fixed 6-String Color Legend) */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[72px] bg-[#FFF4D8] border-r-[3px] border-[#121212] z-20 flex flex-col"
          aria-label="Guitar strings high e to low E"
        >
          {/* Nut corner header */}
          <div
            className="border-b-2 border-[#121212] bg-[#121212] text-[#D8FF2E] flex items-center justify-center font-mono text-[10px] font-bold tracking-widest"
            style={{ height: `${HEADER_RAIL_HEIGHT}px` }}
          >
            6-STR
          </div>

          {/* 6 String Badges */}
          {STRING_LANES.map((s) => {
            const isTargetString = activeNote?.stringNum === s.num;
            return (
              <div
                key={s.num}
                className="flex items-center justify-center border-b border-[#121212]/10 last:border-b-0 relative"
                style={{ height: `${LANE_HEIGHT}px` }}
              >
                <div
                  className={`w-11 h-9 rounded-xl border-2 border-[#121212] flex flex-col items-center justify-center leading-none transition-transform ${
                    isTargetString ? 'scale-110 shadow-brutal-xs ring-2 ring-[#D8FF2E]' : ''
                  }`}
                  style={{ backgroundColor: s.color, color: s.textColor }}
                >
                  <span className="font-syne text-sm font-extrabold">{s.name}</span>
                  <span className="font-mono text-[8px] font-bold opacity-85">{s.pitch}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrolling Highway Viewport (Right of Nut) */}
        <div className="absolute left-[72px] right-0 top-0 bottom-0 overflow-hidden">
          {/* Top Chord & Measure Rail */}
          <div
            className="absolute top-0 left-0 right-0 bg-[#FFF4D8]/90 border-b-2 border-[#121212] z-10"
            style={{ height: `${HEADER_RAIL_HEIGHT}px` }}
          />

          {/* 6 Horizontal String Wires */}
          {STRING_LANES.map((s, idx) => {
            const topY = HEADER_RAIL_HEIGHT + idx * LANE_HEIGHT;
            const wireThickness = 2 + idx * 0.5;
            return (
              <div
                key={s.num}
                className="absolute left-0 right-0 flex items-center"
                style={{ top: `${topY}px`, height: `${LANE_HEIGHT}px` }}
              >
                {/* Alternating subtle lane tint */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: idx % 2 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,244,216,0.28)',
                  }}
                />
                {/* Crisp Guitar String Wire */}
                <div
                  className="w-full relative z-0"
                  style={{
                    height: `${wireThickness}px`,
                    backgroundColor: '#121212',
                    opacity: 0.24,
                  }}
                />
                {/* Subtle colored glow strip along wire */}
                <div
                  className="absolute left-0 right-0 h-[5px] pointer-events-none"
                  style={{ backgroundColor: s.wireTint, opacity: 0.25 }}
                />
              </div>
            );
          })}

          {/* Vertical Barlines & Tilted Comic Chord Stamps */}
          {Array.from({ length: totalBars }, (_, idx) => {
            const barNum = idx + 1;
            const barStartBeat = idx * beatsPerBar;
            const x = HIT_ZONE_X + (barStartBeat - frame.courseBeat) * PX_PER_BEAT;
            if (x < -160 || x > 1400) return null;

            const isInLoop =
              loopRange === 'all' ||
              (barNum >= loopRange.startBar && barNum <= loopRange.endBar);

            return (
              <div
                key={barNum}
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${x}px` }}
              >
                {/* Measure vertical rule */}
                <div
                  className="absolute top-0 bottom-0 w-[2px]"
                  style={{
                    backgroundColor: isInLoop ? '#121212' : 'rgba(18,18,18,0.18)',
                    opacity: 0.45,
                  }}
                />
                {/* Beat subdivision ticks */}
                {[1, 2, 3].map((sub) => (
                  <div
                    key={sub}
                    className="absolute bottom-0 w-px border-l border-dashed border-[#121212]/15"
                    style={{
                      top: `${HEADER_RAIL_HEIGHT}px`,
                      left: `${sub * PX_PER_BEAT}px`,
                    }}
                  />
                ))}

                {/* Clickable Chord & Bar Stamp in Header Rail */}
                <button
                  type="button"
                  onClick={() => onSelectBar?.(barNum)}
                  className="pointer-events-auto absolute top-1.5 left-2 z-20 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border-2 border-[#121212] bg-white hover:bg-[#D8FF2E] shadow-brutal-xs transition-colors"
                >
                  <span className="font-mono text-[10px] font-bold text-[#57534A]">
                    M{barNum}
                  </span>
                  <span className="font-syne text-xs font-extrabold text-[#121212]">
                    {barChords[idx] ?? '—'}
                  </span>
                </button>
              </div>
            );
          })}

          {/* Subtle Chord-Root Pocket Markers on Lower Strings (visual groove anchors) */}
          {bassPocketGuides.map((g) => {
            const x = HIT_ZONE_X + (g.beat - frame.courseBeat) * PX_PER_BEAT;
            if (x < -40 || x > 1350) return null;
            const laneIdx = g.stringNum - 1;
            const topY = HEADER_RAIL_HEIGHT + laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
            const lane = STRING_LANES[laneIdx];
            return (
              <div
                key={`guide-${g.bar}`}
                className="absolute -translate-y-1/2 pointer-events-none z-5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-[#121212]/35 bg-white/80"
                style={{ left: `${x + 4}px`, top: `${topY}px` }}
              >
                <span
                  className="w-2 h-2 rounded-full border border-[#121212]"
                  style={{ backgroundColor: lane.color }}
                />
                <span className="font-mono text-[9px] font-bold text-[#57534A]">
                  BASS {g.chord}
                </span>
              </div>
            );
          })}

          {/* Active Glowing Hit-Zone Beam */}
          <div
            className="neo-beam absolute top-0 bottom-0 z-10 pointer-events-none"
            style={{ left: `${HIT_ZONE_X - 20}px`, width: '40px' }}
          >
            {/* Electric Acid Lime vertical beam */}
            <div className="absolute inset-0 bg-[#D8FF2E]/45 border-x-[2.5px] border-[#121212]" />
            {/* Center strike hair-line */}
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] bg-[#121212]" />
            {/* Top Hit-Zone Tag */}
            <div className="absolute top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded-md bg-[#121212] text-[#D8FF2E] font-mono text-[9px] font-bold uppercase tracking-widest shadow-brutal-xs">
              PLAY
            </div>
          </div>

          {/* Target Reticle Ring on Active String at Hit-Zone */}
          {activeNote && (
            <div
              className="absolute z-15 pointer-events-none -translate-x-1/2 -translate-y-1/2 w-[52px] h-[52px] rounded-2xl border-[3px] border-[#121212] bg-[#D8FF2E]/50 shadow-brutal-sm"
              style={{
                left: `${HIT_ZONE_X}px`,
                top: `${
                  HEADER_RAIL_HEIGHT +
                  (activeNote.stringNum - 1) * LANE_HEIGHT +
                  LANE_HEIGHT / 2
                }px`,
              }}
            />
          )}

          {/* Note Pills along 6 Color-Coded String Lanes */}
          {visibleNotes.map((note) => {
            const lane = STRING_LANES[note.stringNum - 1];
            const x = HIT_ZONE_X + (note.startBeat - frame.courseBeat) * PX_PER_BEAT;
            const rawWidth = note.durationBeats * PX_PER_BEAT - 10;
            const pillWidth = Math.max(44, rawWidth);
            const topY =
              HEADER_RAIL_HEIGHT +
              (note.stringNum - 1) * LANE_HEIGHT +
              LANE_HEIGHT / 2;

            const state = getNoteVisualState(note);
            const techInfo = note.tech ? TECH_META[note.tech] : null;

            const isHiddenNote =
              practiceMode === 'hidden' &&
              state === 'upcoming' &&
              (hiddenDifficulty === 'full-blackout' ||
                (hiddenDifficulty === 'bar-anchors' && note.beatInBar > 0) ||
                (hiddenDifficulty === 'ghost-passing' && !note.isAnchor));

            const isOutOfLoop =
              loopRange !== 'all' &&
              (note.bar < loopRange.startBar || note.bar > loopRange.endBar);

            const pillBg =
              state === 'hit'
                ? '#1CE088'
                : state === 'active'
                  ? '#D8FF2E'
                  : state === 'miss'
                    ? '#FFD9E7'
                    : isHiddenNote
                      ? '#121212'
                      : lane.color;

            const pillText =
              state === 'hit' || state === 'active'
                ? '#121212'
                : state === 'miss'
                  ? '#121212'
                  : isHiddenNote
                    ? '#D8FF2E'
                    : lane.textColor;

            return (
              <div
                key={note.id}
                className="absolute -translate-y-1/2 z-20 transition-opacity"
                style={{
                  left: `${x - 20}px`,
                  top: `${topY}px`,
                  width: `${pillWidth}px`,
                  opacity: isOutOfLoop ? 0.25 : 1,
                }}
              >
                {/* Floating Vibrant Technique Badge (VIB / SLIDE / H-ON / PULL) */}
                {techInfo && !isHiddenNote && (
                  <span
                    className="absolute -top-[18px] left-1 px-1.5 py-[1px] rounded-md border-[1.8px] border-[#121212] font-mono text-[9px] font-bold uppercase leading-tight shadow-brutal-xs whitespace-nowrap z-30"
                    style={{
                      backgroundColor: techInfo.bg,
                      color: techInfo.text,
                    }}
                  >
                    {techInfo.label}
                  </span>
                )}

                {/* Chunky Pop Note Pill */}
                <div
                  className={`h-[36px] rounded-xl border-[2.5px] border-[#121212] flex items-center justify-between px-2.5 overflow-hidden ${
                    state === 'active'
                      ? 'shadow-brutal scale-[1.04] ring-2 ring-[#121212]'
                      : state === 'hit'
                        ? 'shadow-brutal-xs'
                        : 'shadow-brutal-sm'
                  }`}
                  style={{
                    backgroundColor: pillBg,
                    color: pillText,
                  }}
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-[15px] font-bold leading-none tabular-nums">
                      {isHiddenNote ? '?' : note.fret}
                    </span>
                    {pillWidth >= 82 && !isHiddenNote && (
                      <span className="font-mono text-[10px] font-bold opacity-80">
                        {note.label}
                      </span>
                    )}
                  </div>

                  {/* Sustain tail graphic or Hit checkmark */}
                  {state === 'hit' ? (
                    <span className="font-mono text-[11px] font-bold px-1 rounded bg-[#121212] text-[#D8FF2E] shrink-0">
                      ✓
                    </span>
                  ) : state === 'active' ? (
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#121212] text-[#D8FF2E] shrink-0">
                      HOLD
                    </span>
                  ) : pillWidth >= 105 ? (
                    <div className="flex-1 ml-2 h-1.5 rounded-full bg-current opacity-30" />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compact Footer Legend inside Highway Cabinet */}
      <div className="px-4 py-2 bg-[#FFF4D8] border-t-[2.5px] border-[#121212] flex items-center justify-between gap-3 flex-wrap text-[11px]">
        <div className="flex items-center gap-3 flex-wrap font-mono font-bold text-[#121212]">
          <span className="inline-flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-[#D8FF2E] border border-[#121212] text-[9px]">
              VIB
            </span>
            <span>Vibrato</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-[#2B59FF] text-white border border-[#121212] text-[9px]">
              SLIDE
            </span>
            <span>Slide</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded bg-[#FF3B7F] text-white border border-[#121212] text-[9px]">
              H-ON
            </span>
            <span>Hammer-On</span>
          </span>
        </div>

        <span className="font-mono text-[10px] font-bold text-[#57534A]">
          TIP: CLICK ANY MEASURE STAMP (M1–M{totalBars}) TO JUMP OR LOOP THAT BAR
        </span>
      </div>
    </section>
  );
}
