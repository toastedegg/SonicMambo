import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoursePracticeMode, CourseTabNote } from '../data/guitarCourses';
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

// Rocksmith-inspired 6-string peripheral color reflex palette in Risograph inks
const STRING_LANES: readonly StringStyle[] = [
  { num: 1, name: 'e', pitch: 'E4', color: '#FF3B7F', textColor: '#FFFFFF', wireTint: 'rgba(255,59,127,0.32)' },
  { num: 2, name: 'B', pitch: 'B3', color: '#FF8A00', textColor: '#121212', wireTint: 'rgba(255,138,0,0.34)' },
  { num: 3, name: 'G', pitch: 'G3', color: '#D8FF2E', textColor: '#121212', wireTint: 'rgba(180,219,10,0.48)' },
  { num: 4, name: 'D', pitch: 'D3', color: '#1CE088', textColor: '#121212', wireTint: 'rgba(28,224,136,0.34)' },
  { num: 5, name: 'A', pitch: 'A2', color: '#2B59FF', textColor: '#FFFFFF', wireTint: 'rgba(43,89,255,0.30)' },
  { num: 6, name: 'E', pitch: 'E2', color: '#8B5CF6', textColor: '#FFFFFF', wireTint: 'rgba(139,92,246,0.30)' },
];

const TECH_META: Record<string, { label: string; bg: string; text: string }> = {
  vibrato: { label: 'VIB', bg: '#D8FF2E', text: '#121212' },
  slide: { label: 'SLIDE', bg: '#2B59FF', text: '#FFFFFF' },
  'slide-vibrato': { label: 'SLD·VIB', bg: '#2B59FF', text: '#FFFFFF' },
  hammer: { label: 'H-ON', bg: '#FF3B7F', text: '#FFFFFF' },
  pull: { label: 'PULL', bg: '#FF8A00', text: '#121212' },
};

const PX_PER_BEAT = 128;
const HIT_ZONE_X = 248; // px from left of scrolling track
const HEADER_RAIL_HEIGHT = 48;
const LANE_HEIGHT = 82; // Generous 6-lane breathing height (48 + 82*6 = 540px)
const DEMO_PLAYHEAD_BEAT = 3.25; // Lands mid-vibrato on Bar 1 B3 fret 3 with rich upcoming multi-string riff

export function NeoArcadeStage({
  notes,
  barChords,
  totalBars,
  beatsPerBar,
  practiceMode,
  hiddenDifficulty,
  loopRange,
  motionRef,
  noteStatusRef,
  onSelectBar,
  demoShowcase = false,
}: NeoArcadeStageProps) {
  // Discrete UI state only — 60/120fps horizontal scrolling is driven directly via trackRef!
  const [discrete, setDiscrete] = useState<{
    staticBeat: number;
    running: boolean;
    previewing: boolean;
    inCountIn: boolean;
    countInNumber: number;
    shadowPhase: 'idle' | 'listen' | 'respond';
    activeTargetNoteId: string | null;
    currentBar: number;
  }>(() => {
    const initialBeat = demoShowcase ? DEMO_PLAYHEAD_BEAT : 0;
    const demoActive = demoShowcase
      ? notes.find(
          (n) => initialBeat >= n.startBeat && initialBeat < n.startBeat + n.durationBeats,
        )?.id ?? notes[0]?.id ?? null
      : null;
    return {
      staticBeat: initialBeat,
      running: false,
      previewing: false,
      inCountIn: false,
      countInNumber: 4,
      shadowPhase: 'idle',
      activeTargetNoteId: demoActive,
      currentBar: Math.min(totalBars, Math.max(1, Math.floor(initialBeat / beatsPerBar) + 1)),
    };
  });

  const trackRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number>(0);

  // Sync smooth 60/120fps translate3d transform directly on DOM ref while updating React state ONLY on discrete transitions
  useEffect(() => {
    let mounted = true;
    let lastActiveId: string | null = discrete.activeTargetNoteId;
    let lastBar = discrete.currentBar;
    let lastRunning = discrete.running;
    let lastPreviewing = discrete.previewing;
    let lastCountIn = discrete.inCountIn;
    let lastCountNum = discrete.countInNumber;
    let lastShadow = discrete.shadowPhase;
    let lastStaticBeat = discrete.staticBeat;

    const applyTransform = (beat: number) => {
      if (trackRef.current) {
        const tx = HIT_ZONE_X - beat * PX_PER_BEAT;
        trackRef.current.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0)`;
      }
    };

    applyTransform(discrete.staticBeat);

    const tick = () => {
      if (!mounted) return;
      const m = motionRef.current;
      const isActive = m.running || m.previewing;
      const beat = isActive
        ? m.courseBeat
        : demoShowcase && m.focusStartBeat === 0
          ? DEMO_PLAYHEAD_BEAT
          : m.focusStartBeat;

      applyTransform(beat);

      const bar = Math.min(totalBars, Math.max(1, Math.floor(beat / beatsPerBar) + 1));
      const nextActiveId = isActive
        ? m.activeTargetNoteId
        : demoShowcase && m.focusStartBeat === 0
          ? notes.find((n) => beat >= n.startBeat && beat < n.startBeat + n.durationBeats)?.id ?? null
          : null;

      const discreteChanged =
        nextActiveId !== lastActiveId ||
        bar !== lastBar ||
        m.running !== lastRunning ||
        m.previewing !== lastPreviewing ||
        m.inCountIn !== lastCountIn ||
        m.countInNumber !== lastCountNum ||
        m.shadowPhase !== lastShadow ||
        (!isActive && Math.abs(beat - lastStaticBeat) > 0.01);

      if (discreteChanged) {
        lastActiveId = nextActiveId;
        lastBar = bar;
        lastRunning = m.running;
        lastPreviewing = m.previewing;
        lastCountIn = m.inCountIn;
        lastCountNum = m.countInNumber;
        lastShadow = m.shadowPhase;
        lastStaticBeat = beat;
        setDiscrete({
          staticBeat: beat,
          running: m.running,
          previewing: m.previewing,
          inCountIn: m.inCountIn,
          countInNumber: m.countInNumber,
          shadowPhase: m.shadowPhase,
          activeTargetNoteId: nextActiveId,
          currentBar: bar,
        });
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatsPerBar, demoShowcase, motionRef, notes, totalBars]);

  const activeNote = useMemo(
    () =>
      notes.find((n) => n.id === discrete.activeTargetNoteId) ??
      (demoShowcase && !discrete.running && !discrete.previewing
        ? notes.find(
            (n) =>
              DEMO_PLAYHEAD_BEAT >= n.startBeat &&
              DEMO_PLAYHEAD_BEAT < n.startBeat + n.durationBeats,
          ) ?? notes[0]
        : null),
    [demoShowcase, discrete.activeTargetNoteId, discrete.previewing, discrete.running, notes],
  );

  const getNoteVisualState = (note: CourseTabNote): 'hit' | 'active' | 'miss' | 'upcoming' => {
    const liveStatus = noteStatusRef.current[note.id];
    if (liveStatus === 'hit') return 'hit';
    if (liveStatus === 'miss') return 'miss';
    if (discrete.activeTargetNoteId === note.id) return 'active';

    const refBeat =
      discrete.running || discrete.previewing
        ? motionRef.current.courseBeat
        : discrete.staticBeat;

    if (demoShowcase && !discrete.running && !discrete.previewing) {
      if (note.startBeat + note.durationBeats <= refBeat) return 'hit';
      if (refBeat >= note.startBeat && refBeat < note.startBeat + note.durationBeats) {
        return 'active';
      }
    }
    return 'upcoming';
  };

  const trackWidthPx = Math.max(1800, totalBars * beatsPerBar * PX_PER_BEAT + 600);
  const highwayHeight = HEADER_RAIL_HEIGHT + LANE_HEIGHT * 6;

  return (
    <div className="h-full w-full flex items-center justify-center">
      <section
        className="neo-card-lg bg-[#FFFBF0] overflow-hidden select-none w-full"
        aria-label="Arcade 6-String Riff Highway"
      >
        {/* Main 6-String Color-Coded Riff Highway — Full Breathing Height, Zero Duplicate Headers or Footer Tips */}
        <div
          className="relative w-full overflow-hidden bg-[#FFFBF0] riso-grid"
          style={{ height: `${highwayHeight}px` }}
        >
        {/* Count-in Overlay */}
        {discrete.inCountIn && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#121212]/45 backdrop-blur-[1px]">
            <div className="neo-card bg-[#D8FF2E] px-8 py-4 text-center">
              <div className="font-mono text-xs font-bold uppercase tracking-widest text-[#121212]">
                COUNT IN
              </div>
              <div className="font-syne text-6xl font-extrabold text-[#121212] leading-none mt-1">
                {discrete.countInNumber}
              </div>
            </div>
          </div>
        )}

        {/* Shadow Call-and-Response Stamp */}
        {!discrete.inCountIn && discrete.shadowPhase !== 'idle' && (
          <div className="absolute top-2.5 right-4 z-30">
            <span
              className={`neo-stamp ${
                discrete.shadowPhase === 'listen'
                  ? 'bg-[#2B59FF] text-white'
                  : 'bg-[#D8FF2E] text-[#121212]'
              }`}
            >
              {discrete.shadowPhase === 'listen' ? '👂 LISTEN' : '🎸 ECHO BACK'}
            </span>
          </div>
        )}

        {/* Left Nut Column (Fixed 6-String Peripheral Color Reflex Badges) */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[76px] bg-[#FFF4D8] border-r-[3px] border-[#121212] z-20 flex flex-col"
          aria-label="Guitar strings high e to low E"
        >
          <div
            className="border-b-2 border-[#121212] bg-[#121212] text-[#D8FF2E] flex items-center justify-center font-mono text-[10px] font-bold tracking-widest"
            style={{ height: `${HEADER_RAIL_HEIGHT}px` }}
          >
            6-STR
          </div>

          {STRING_LANES.map((s) => {
            const isTargetString = activeNote?.stringNum === s.num;
            return (
              <div
                key={s.num}
                className="flex items-center justify-center border-b border-[#121212]/10 last:border-b-0 relative"
                style={{ height: `${LANE_HEIGHT}px` }}
              >
                <div
                  className={`w-12 h-11 rounded-xl border-2 border-[#121212] flex flex-col items-center justify-center leading-none transition-transform ${
                    isTargetString ? 'scale-110 shadow-brutal-xs ring-2 ring-[#D8FF2E]' : ''
                  }`}
                  style={{ backgroundColor: s.color, color: s.textColor }}
                >
                  <span className="font-syne text-[15px] font-extrabold">{s.name}</span>
                  <span className="font-mono text-[9px] font-bold opacity-85 mt-0.5">
                    {s.pitch}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Highway Viewport (Right of Nut) */}
        <div className="absolute left-[76px] right-0 top-0 bottom-0 overflow-hidden">
          {/* Top Measure & Chord Rail Background */}
          <div
            className="absolute top-0 left-0 right-0 bg-[#FFF4D8]/95 border-b-2 border-[#121212] z-10"
            style={{ height: `${HEADER_RAIL_HEIGHT}px` }}
          />

          {/* 6 Horizontal String Lanes & Wires */}
          {STRING_LANES.map((s, idx) => {
            const topY = HEADER_RAIL_HEIGHT + idx * LANE_HEIGHT;
            const wireThickness = 2 + idx * 0.5;
            const isActiveLane = activeNote?.stringNum === s.num;
            return (
              <div
                key={s.num}
                className="absolute left-0 right-0 flex items-center"
                style={{ top: `${topY}px`, height: `${LANE_HEIGHT}px` }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: isActiveLane
                      ? 'rgba(216, 255, 46, 0.08)'
                      : idx % 2 === 0
                        ? 'rgba(255,255,255,0.45)'
                        : 'rgba(244,236,220,0.34)',
                  }}
                />
                {/* Crisp Guitar String Wire */}
                <div
                  className="w-full relative z-0"
                  style={{
                    height: `${wireThickness}px`,
                    backgroundColor: '#121212',
                    opacity: isActiveLane ? 0.42 : 0.22,
                  }}
                />
                {/* Subtle String Lane Tint Strip */}
                <div
                  className="absolute left-0 right-0 h-[5px] pointer-events-none"
                  style={{ backgroundColor: s.wireTint, opacity: isActiveLane ? 0.55 : 0.24 }}
                />
              </div>
            );
          })}

          {/* Fixed Tactile PLAY Hit-Gate Beam */}
          <div
            className="neo-beam absolute top-0 bottom-0 z-10 pointer-events-none"
            style={{ left: `${HIT_ZONE_X - 22}px`, width: '44px' }}
          >
            <div className="absolute inset-0 bg-[#D8FF2E]/40 border-x-[2.5px] border-[#121212]" />
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[3px] bg-[#121212]" />
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-0.5 rounded-md bg-[#121212] text-[#D8FF2E] font-mono text-[10px] font-bold uppercase tracking-widest shadow-brutal-xs">
              PLAY
            </div>
          </div>

          {/* Active String Target Reticle on Hit-Gate */}
          {activeNote && (
            <div
              className="absolute z-15 pointer-events-none -translate-x-1/2 -translate-y-1/2 w-[62px] h-[62px] rounded-2xl border-[3px] border-[#121212] bg-[#D8FF2E]/50 shadow-brutal-sm"
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

          {/* Smooth 60/120fps Hardware-Accelerated Scrolling Track (Zero per-frame React re-renders) */}
          <div
            ref={trackRef}
            className="absolute top-0 bottom-0 left-0 will-change-transform z-20"
            style={{ width: `${trackWidthPx}px` }}
          >
            {/* Vertical Barlines & Clickable Measure Chord Stamps */}
            {Array.from({ length: totalBars }, (_, idx) => {
              const barNum = idx + 1;
              const barX = idx * beatsPerBar * PX_PER_BEAT;
              const isInLoop =
                loopRange === 'all' ||
                (barNum >= loopRange.startBar && barNum <= loopRange.endBar);
              const isCurrent = barNum === discrete.currentBar;

              return (
                <div
                  key={barNum}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${barX}px` }}
                >
                  {/* Measure Barline */}
                  <div
                    className="absolute top-0 bottom-0 w-[2px]"
                    style={{
                      backgroundColor: isInLoop ? '#121212' : 'rgba(18,18,18,0.16)',
                      opacity: 0.42,
                    }}
                  />
                  {/* Beat Subdivision Ticks */}
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

                  {/* Clickable Measure Chord Stamp on Top Highway Rail */}
                  <button
                    type="button"
                    onClick={() => onSelectBar?.(barNum)}
                    className={`pointer-events-auto absolute top-2 left-2.5 z-30 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-[#121212] font-mono text-[11px] font-bold shadow-brutal-xs transition-colors ${
                      isCurrent
                        ? 'bg-[#D8FF2E] text-[#121212]'
                        : 'bg-white text-[#121212] hover:bg-[#FFF4D8]'
                    }`}
                  >
                    <span className="text-[#57534A]">M{barNum}</span>
                    <span className="font-syne font-extrabold">{barChords[idx] ?? '—'}</span>
                    <span className="text-[10px] opacity-65">↻</span>
                  </button>
                </div>
              );
            })}

            {/* Proportional 6-String Candy-Bar Sustain Bricks (Zero "2 HOL" truncation + 42% settled left-of-gate hierarchy!) */}
            {notes.map((note) => {
              const lane = STRING_LANES[note.stringNum - 1];
              const leftX = note.startBeat * PX_PER_BEAT - 20;
              const rawWidth = note.durationBeats * PX_PER_BEAT - 10;
              const pillWidth = Math.max(48, rawWidth);
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

              // Left-of-Gate Visual Settling (§2.2):
              // Hit notes softly settle to 42% opacity retaining their string lane hue + crisp ✓ badge
              // Active gate note shines at 100% scale-105 with animated inner sustain fill
              // Upcoming notes right of PLAY gate shine at 100% vivid Risograph string ink
              const noteOpacity = isOutOfLoop
                ? 0.2
                : state === 'hit'
                  ? 0.42
                  : 1;

              const pillBg =
                state === 'miss'
                  ? '#FFD9E7'
                  : isHiddenNote
                    ? '#121212'
                    : lane.color;

              const pillText =
                state === 'miss'
                  ? '#121212'
                  : isHiddenNote
                    ? '#D8FF2E'
                    : lane.textColor;

              const isCompactBrick = pillWidth < 96;

              return (
                <div
                  key={note.id}
                  className="absolute -translate-y-1/2 transition-opacity duration-150"
                  style={{
                    left: `${leftX}px`,
                    top: `${topY}px`,
                    width: `${pillWidth}px`,
                    opacity: noteOpacity,
                    zIndex: state === 'active' ? 30 : 20,
                  }}
                >
                  {/* Floating Technique Tag (VIB / SLIDE / H-ON / PULL) */}
                  {techInfo && !isHiddenNote && (
                    <span
                      className="absolute -top-[19px] left-1 px-1.5 py-[1px] rounded-md border-[1.8px] border-[#121212] font-mono text-[9px] font-bold uppercase leading-tight shadow-brutal-xs whitespace-nowrap z-30"
                      style={{
                        backgroundColor: techInfo.bg,
                        color: techInfo.text,
                      }}
                    >
                      {techInfo.label}
                    </span>
                  )}

                  {/* Proportional Tactile Sustain Brick */}
                  <div
                    className={`relative h-[44px] rounded-xl border-[2.5px] border-[#121212] flex items-center overflow-hidden ${
                      isCompactBrick ? 'justify-center px-1' : 'justify-between px-3'
                    } ${
                      state === 'active'
                        ? 'scale-[1.05] shadow-brutal ring-[3px] ring-[#D8FF2E]'
                        : state === 'hit'
                          ? 'shadow-none'
                          : 'shadow-brutal-sm'
                    }`}
                    style={{
                      backgroundColor: pillBg,
                      color: pillText,
                    }}
                  >
                    {/* Animated Inner Sustain Progress Fill for Active Note */}
                    {state === 'active' && (
                      <div
                        className="absolute inset-y-0 left-0 bg-[#D8FF2E]/45 border-r-2 border-[#121212]/40 pointer-events-none"
                        style={{ width: '48%' }}
                      />
                    )}

                    {/* Oversized 17px Fret Number (Never Truncated!) */}
                    <span className="relative z-10 font-mono text-[17px] font-extrabold leading-none tabular-nums">
                      {isHiddenNote ? '?' : note.fret}
                    </span>

                    {/* Wide Bricks (>= 96px): Clean Sustain Track + Optional Roomy Pitch Label */}
                    {!isCompactBrick && !isHiddenNote && (
                      <>
                        <div className="relative z-10 flex-1 mx-2.5 h-2 rounded-full bg-current opacity-25 overflow-hidden">
                          {state === 'active' && (
                            <div className="h-full w-1/2 bg-[#121212] rounded-full opacity-75" />
                          )}
                        </div>
                        {state === 'hit' ? (
                          <span className="relative z-10 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#121212] text-[#D8FF2E] shrink-0">
                            ✓
                          </span>
                        ) : pillWidth >= 112 ? (
                          <span className="relative z-10 font-mono text-[11px] font-bold opacity-85 shrink-0">
                            {note.label}
                          </span>
                        ) : null}
                      </>
                    )}

                    {/* Compact Hit Checkmark (Top-right corner micro-badge so fret digit stays centered & huge) */}
                    {isCompactBrick && state === 'hit' && (
                      <span className="absolute top-0.5 right-0.5 z-10 w-4 h-4 rounded bg-[#121212] text-[#D8FF2E] font-mono text-[9px] font-bold flex items-center justify-center">
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </section>
    </div>
  );
}
