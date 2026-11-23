import { useEffect, useMemo, useRef } from 'react';
import type { CoursePracticeMode, CourseTabNote, GuitarCourse } from '../data/guitarCourses';
import type { LessonNoteStatus } from '../types/lesson';
import { noteLabelToMidi } from '../utils/noteFromFrequency';
import type { StageMotionSnapshot } from './MinimalScoreCanvasPixi';

export type VanishPass = 1 | 2 | 3 | 4;

export interface RisoEngravedScoreProps {
  course: GuitarCourse;
  mode: CoursePracticeMode;
  vanishPass: VanishPass;
  onChangeVanishPass?: (pass: VanishPass) => void;
  windowStartBar: number;
  onWindowStartBarChange?: (bar: number) => void;
  loopRange: 'all' | { startBar: number; endBar: number };
  runState: 'idle' | 'running' | 'preview' | 'results';
  motionRef: React.MutableRefObject<StageMotionSnapshot>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  activeNoteId?: string | null;
  onSelectBar?: (barNumber: number) => void;
  forensicMode?: boolean;
  demoMode?: boolean;
}

// Coupled Two-System Grand Guitar Score Geometry (§2.3 & §2.6 — 04-monolith-jazz copperplate discipline)
const SVG_W = 1280;
const SVG_H = 430;
const MARGIN_LEFT = 86;
const MARGIN_RIGHT = 32;
const SCORE_W = SVG_W - MARGIN_LEFT - MARGIN_RIGHT;

// Top System: 5-Line Engraved Treble Staff (116, 132, 148, 164, 180)
const STAFF_TOP = 116;
const STAFF_GAP = 16;
const STAFF_BOTTOM = STAFF_TOP + STAFF_GAP * 4;

// Bottom System: Standard 6-Line Guitar TAB (e, B, G, D, A, E -> 262, 282, 302, 322, 342, 362)
const TAB_TOP = 262;
const TAB_GAP = 20;
const TAB_BOTTOM = TAB_TOP + TAB_GAP * 5;
const TAB_STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'] as const;

const STEP_BY_SEMITONE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const SHARP_SEMITONES = [
  false, true, false, true, false, false, true, false, true, false, true, false,
] as const;

const VANISH_TABS: ReadonlyArray<{ pass: VanishPass; label: string }> = [
  { pass: 1, label: '100% INK' },
  { pass: 2, label: '55% GHOST' },
  { pass: 3, label: '25% CONTOUR' },
  { pass: 4, label: '0% EAR' },
];

function midiToDiatonic(midi: number): { step: number; isSharp: boolean } {
  const r = Math.round(midi);
  const oct = Math.floor(r / 12) - 1;
  const semi = ((r % 12) + 12) % 12;
  return {
    step: (oct + 1) * 7 + STEP_BY_SEMITONE[semi],
    isSharp: SHARP_SEMITONES[semi],
  };
}

const E3_STEP = midiToDiatonic(52).step;

function midiToStaffY(midi: number): number {
  const { step } = midiToDiatonic(midi);
  // Guitar sounds an octave below written treble; anchor E3 on bottom line
  const y = STAFF_BOTTOM - (step - E3_STEP) * (STAFF_GAP / 2);
  return Math.max(76, Math.min(218, y));
}

function stringToTabY(stringNum: 1 | 2 | 3 | 4 | 5 | 6): number {
  return TAB_TOP + (stringNum - 1) * TAB_GAP;
}

function buildSmoothContourPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) * 0.5;
    d += ` C ${cx.toFixed(1)} ${p0.y.toFixed(1)}, ${cx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function buildVibratoWavePath(startX: number, y: number, length: number): string {
  const cycles = Math.max(3, Math.floor(length / 10));
  let d = `M ${startX.toFixed(1)} ${y.toFixed(1)}`;
  for (let i = 0; i < cycles; i += 1) {
    const x1 = startX + i * 10 + 2.5;
    const x2 = startX + i * 10 + 5;
    const x3 = startX + i * 10 + 7.5;
    const x4 = startX + (i + 1) * 10;
    d += ` Q ${x1.toFixed(1)} ${(y - 3.2).toFixed(1)}, ${x2.toFixed(1)} ${y.toFixed(1)} Q ${x3.toFixed(1)} ${(y + 3.2).toFixed(1)}, ${x4.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export function RisoEngravedScore({
  course,
  mode,
  vanishPass,
  onChangeVanishPass,
  windowStartBar,
  onWindowStartBarChange,
  loopRange,
  runState,
  motionRef,
  noteStatusRef,
  activeNoteId = null,
  onSelectBar,
  forensicMode = false,
  demoMode = false,
}: RisoEngravedScoreProps) {
  const playheadGroupRef = useRef<SVGGElement | null>(null);

  const visibleBarCount = Math.min(4, Math.max(1, course.totalBars - windowStartBar + 1));
  const windowEndBar = windowStartBar + visibleBarCount - 1;
  const windowStartBeat = (windowStartBar - 1) * course.beatsPerBar;
  const windowTotalBeats = visibleBarCount * course.beatsPerBar;
  const barWidth = SCORE_W / visibleBarCount;

  const beatToX = (courseBeat: number): number => {
    const rel = courseBeat - windowStartBeat;
    const barIdx = Math.floor(rel / course.beatsPerBar);
    const beatInBar = rel - barIdx * course.beatsPerBar;
    const padL = 30;
    const padR = 22;
    const usable = Math.max(40, barWidth - padL - padR);
    return (
      MARGIN_LEFT +
      barIdx * barWidth +
      padL +
      (beatInBar / Math.max(1, course.beatsPerBar)) * usable
    );
  };

  const laidOutNotes = useMemo(() => {
    return course.notes
      .filter((n) => n.bar >= windowStartBar && n.bar <= windowEndBar)
      .map((n) => {
        const midi = noteLabelToMidi(n.label) ?? 64;
        const { isSharp } = midiToDiatonic(midi);
        const x = beatToX(n.startBeat);
        const staffY = midiToStaffY(midi);
        const tabY = stringToTabY(n.stringNum);
        return { note: n, midi, isSharp, x, staffY, tabY };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.notes, course.beatsPerBar, windowStartBar, windowEndBar, visibleBarCount]);

  const contourPath = useMemo(
    () => buildSmoothContourPath(laidOutNotes.map((item) => ({ x: item.x, y: item.staffY }))),
    [laidOutNotes],
  );

  // Demo playhead lands on Bar 3 downbeat (Gmaj7) so Hits, Active Lime Badge, and Upcoming are all clearly demonstrated
  const demoPlayheadBeat = useMemo(() => {
    const bar3Note = laidOutNotes.find((n) => n.note.bar === windowStartBar + 2);
    return bar3Note ? bar3Note.note.startBeat : windowStartBeat + 0.5;
  }, [laidOutNotes, windowStartBar, windowStartBeat]);

  const effectiveActiveId = useMemo(() => {
    if (activeNoteId) return activeNoteId;
    if (demoMode && runState === 'idle' && !forensicMode) {
      const bar3Note = laidOutNotes.find((n) => n.note.bar === windowStartBar + 2);
      return bar3Note?.note.id ?? laidOutNotes[0]?.note.id ?? null;
    }
    return null;
  }, [activeNoteId, demoMode, forensicMode, laidOutNotes, runState, windowStartBar]);

  // Zero-jank 60/120fps playhead motion driven directly on SVG ref
  useEffect(() => {
    if (forensicMode) return undefined;
    let rafId = 0;

    const placePlayhead = (beat: number) => {
      const g = playheadGroupRef.current;
      if (!g) return;
      const clampedBeat = Math.max(
        windowStartBeat,
        Math.min(windowStartBeat + windowTotalBeats - 0.01, beat),
      );
      const px = beatToX(clampedBeat);
      g.style.transform = `translate3d(${px.toFixed(2)}px, 0, 0)`;
    };

    placePlayhead(demoMode && runState === 'idle' ? demoPlayheadBeat : windowStartBeat);

    if (runState !== 'running' && runState !== 'preview') {
      return undefined;
    }

    const tick = () => {
      placePlayhead(motionRef.current.courseBeat);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, demoPlayheadBeat, forensicMode, motionRef, runState, windowStartBeat, windowTotalBeats]);

  // Vanishing ink opacity tiers (Pass 1..4) — bypassed in forensic review mode
  const effectivePass: VanishPass = forensicMode ? 1 : vanishPass;
  const getInkOpacity = (note: CourseTabNote, isActive: boolean): number => {
    if (forensicMode || isActive) return 1;
    if (effectivePass === 1) return 1;
    if (effectivePass === 2) return note.isAnchor ? 0.92 : 0.45;
    if (effectivePass === 3) return note.isAnchor ? 0.48 : 0.14;
    return 0.05;
  };

  // Continuous played pitch forensic ribbon + timing pocket envelope + 3 delicate 1px hairline callouts (§2.6)
  const forensicData = useMemo(() => {
    if (!forensicMode || laidOutNotes.length < 3) return null;
    const samples: Array<{ x: number; y: number }> = [];
    const upperEnv: Array<{ x: number; y: number }> = [];
    const lowerEnv: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < laidOutNotes.length; i += 1) {
      const cur = laidOutNotes[i];
      const next = laidOutNotes[i + 1];
      const centsJitter = i % 4 === 1 ? -2.2 : i % 3 === 0 ? 1.6 : 0.6;
      const baseY = cur.staffY + centsJitter;
      samples.push({ x: cur.x, y: baseY });
      upperEnv.push({ x: cur.x, y: cur.staffY - 9 });
      lowerEnv.push({ x: cur.x, y: cur.staffY + 9 });

      if (cur.note.tech === 'vibrato') {
        for (let step = 1; step <= 6; step += 1) {
          const sx = cur.x + step * 11;
          const sy = baseY + Math.sin(step * 1.65) * 4.2;
          samples.push({ x: sx, y: sy });
          upperEnv.push({ x: sx, y: cur.staffY - 8 });
          lowerEnv.push({ x: sx, y: cur.staffY + 8 });
        }
      } else if (next) {
        const mx = (cur.x + next.x) * 0.5;
        const my = (cur.staffY + next.staffY) * 0.5 + (cur.note.tech === 'slide' ? -1.4 : 1.0);
        samples.push({ x: mx, y: my });
        upperEnv.push({ x: mx, y: my - 8.5 });
        lowerEnv.push({ x: mx, y: my + 8.5 });
      }
    }

    const pitchPath = buildSmoothContourPath(samples);
    const pocketPolygon = [
      ...upperEnv.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
      ...lowerEnv.reverse().map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`),
      'Z',
    ].join(' ');

    const pin1 = laidOutNotes[0];
    const pin2 = laidOutNotes[Math.min(3, laidOutNotes.length - 1)];
    const pin3 =
      laidOutNotes.find((n) => n.note.bar === windowStartBar + 2 && n.note.tech === 'vibrato') ??
      laidOutNotes[Math.min(10, laidOutNotes.length - 1)];

    return {
      pitchPath,
      pocketPolygon,
      pins: [
        {
          x: pin1.x + 28,
          y: pin1.staffY + 2,
          label: '01 · SLIDE 12→7 +2¢',
          dotColor: '#0D9F6E',
        },
        {
          x: pin2.x + 12,
          y: pin2.staffY,
          label: '02 · -11ms POCKET',
          dotColor: '#2B59FF',
        },
        {
          x: pin3.x + 22,
          y: pin3.staffY,
          label: '03 · VIB 5.2Hz',
          dotColor: '#FF3B7F',
        },
      ],
    };
  }, [forensicMode, laidOutNotes, windowStartBar]);

  const showVanishStrip = !forensicMode && (mode === 'hidden' || mode === 'shadow');
  const hasMultipleWindows = course.totalBars > 4;

  return (
    <section
      className="neo-card-lg bg-[#FFFBF0] overflow-hidden flex flex-col h-full min-h-0 select-none"
      aria-label={
        forensicMode
          ? 'Coupled Staff and TAB Forensic Pitch Analysis'
          : 'Coupled 5-Line Staff and 6-Line Guitar TAB'
      }
    >
      {/* Subtle Top Controls Bar ONLY when needed (Window Switcher / Vanishing Pass / Forensic Legend) — Zero duplicate chord row! */}
      {(showVanishStrip || hasMultipleWindows || forensicMode) && (
        <div className="px-4 py-1.5 bg-[#F4ECDC]/75 border-b border-[#121212]/20 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold text-[#57534A]">
            {forensicMode ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[#121212]">
                  <span className="w-3.5 h-[2.5px] rounded-full bg-[#FF3B7F]" />
                  PLAYED PITCH
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#2B59FF]">
                  <span className="w-3 h-2 rounded-sm bg-[#2B59FF]/20 border border-[#2B59FF]/60" />
                  TIMING POCKET
                </span>
              </>
            ) : (
              <span className="tracking-wider uppercase">
                COUPLED TREBLE STAFF + 6-LINE TAB
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {showVanishStrip && (
              <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#FFFBF0] border border-[#121212]">
                {VANISH_TABS.map((t) => (
                  <button
                    key={t.pass}
                    type="button"
                    onClick={() => onChangeVanishPass?.(t.pass)}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold transition-colors ${
                      effectivePass === t.pass
                        ? 'bg-[#121212] text-[#D8FF2E]'
                        : 'text-[#57534A] hover:text-[#121212]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {hasMultipleWindows && (
              <div className="inline-flex items-center p-0.5 rounded-lg bg-[#FFFBF0] border border-[#121212]">
                {[1, 5].map((startBar) => {
                  if (startBar > course.totalBars) return null;
                  const endBar = Math.min(course.totalBars, startBar + 3);
                  const active = windowStartBar === startBar;
                  return (
                    <button
                      key={startBar}
                      type="button"
                      onClick={() => onWindowStartBarChange?.(startBar)}
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        active ? 'bg-[#121212] text-[#D8FF2E]' : 'text-[#57534A] hover:text-[#121212]'
                      }`}
                    >
                      B{startBar}–{endBar}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Coupled 5-Line Staff + 6-Line Guitar TAB Copperplate Engraving SVG */}
      <div className="relative flex-1 min-h-0 w-full bg-[#FFFBF0] riso-paper-grain flex items-center justify-center px-2 py-1">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full max-h-full block select-none"
          role="img"
          aria-label="Coupled 5-line treble staff and 6-line guitar TAB"
        >
          {/* Coupled Left Grand-System Brace connecting Staff + TAB */}
          <line
            x1={MARGIN_LEFT - 10}
            y1={STAFF_TOP}
            x2={MARGIN_LEFT - 10}
            y2={TAB_BOTTOM}
            stroke="#121212"
            strokeWidth="2.2"
          />

          {/* Measure Columns, Clickable BAR 01..04 Chord Headers (Printed ONCE!), and Shared Barlines */}
          {Array.from({ length: visibleBarCount }, (_, idx) => {
            const barNum = windowStartBar + idx;
            const bx = MARGIN_LEFT + idx * barWidth;
            const isLoopedBar =
              loopRange !== 'all' &&
              barNum >= loopRange.startBar &&
              barNum <= loopRange.endBar;
            const isActiveBar =
              !forensicMode &&
              demoMode &&
              runState === 'idle' &&
              barNum === windowStartBar + 2;

            return (
              <g key={`bar-${barNum}`}>
                {/* Subtle Warm Cream Highlight on Looped or Active Bar */}
                {(isLoopedBar || isActiveBar) && (
                  <rect
                    x={bx}
                    y={52}
                    width={barWidth}
                    height={TAB_BOTTOM - 32}
                    rx="6"
                    fill={isLoopedBar ? '#2B59FF' : '#D8FF2E'}
                    opacity={isLoopedBar ? 0.06 : 0.11}
                  />
                )}

                {/* Shared Vertical Measure Barline spanning BOTH Staff & TAB */}
                <line
                  x1={bx}
                  y1={STAFF_TOP}
                  x2={bx}
                  y2={STAFF_BOTTOM}
                  stroke="#121212"
                  strokeWidth={idx === 0 ? 2 : 1.15}
                  opacity={idx === 0 ? 0.85 : 0.45}
                />
                <line
                  x1={bx}
                  y1={TAB_TOP}
                  x2={bx}
                  y2={TAB_BOTTOM}
                  stroke="#121212"
                  strokeWidth={idx === 0 ? 2 : 1.15}
                  opacity={idx === 0 ? 0.85 : 0.45}
                />
                {/* Faint Vertical Guide Connecting Staff & TAB Beat Grid */}
                <line
                  x1={bx}
                  y1={STAFF_BOTTOM}
                  x2={bx}
                  y2={TAB_TOP}
                  stroke="#121212"
                  strokeWidth="0.8"
                  strokeDasharray="3 4"
                  opacity="0.16"
                />

                {/* Clickable Engraved Bar & Chord Heading (Printed ONCE per bar!) */}
                <g
                  className="cursor-pointer"
                  onClick={() => onSelectBar?.(barNum)}
                  role="button"
                  tabIndex={0}
                >
                  <rect
                    x={bx + 8}
                    y={14}
                    width={136}
                    height={28}
                    rx="6"
                    fill="transparent"
                  />
                  <text
                    x={bx + 12}
                    y={32}
                    fill="#57534A"
                    fontFamily="Space Mono, monospace"
                    fontWeight="700"
                    fontSize="11"
                    letterSpacing="0.06em"
                  >
                    BAR {String(barNum).padStart(2, '0')}
                  </text>
                  <text
                    x={bx + 68}
                    y={33}
                    fill="#121212"
                    fontFamily="Syne, sans-serif"
                    fontWeight="800"
                    fontSize="18"
                  >
                    {course.barChords[barNum - 1] ?? ''}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Closing Double Barline on Right Edge */}
          <line x1={SVG_W - MARGIN_RIGHT - 5} y1={STAFF_TOP} x2={SVG_W - MARGIN_RIGHT - 5} y2={STAFF_BOTTOM} stroke="#121212" strokeWidth="1.2" opacity="0.7" />
          <line x1={SVG_W - MARGIN_RIGHT} y1={STAFF_TOP} x2={SVG_W - MARGIN_RIGHT} y2={STAFF_BOTTOM} stroke="#121212" strokeWidth="3" opacity="0.9" />
          <line x1={SVG_W - MARGIN_RIGHT - 5} y1={TAB_TOP} x2={SVG_W - MARGIN_RIGHT - 5} y2={TAB_BOTTOM} stroke="#121212" strokeWidth="1.2" opacity="0.7" />
          <line x1={SVG_W - MARGIN_RIGHT} y1={TAB_TOP} x2={SVG_W - MARGIN_RIGHT} y2={TAB_BOTTOM} stroke="#121212" strokeWidth="3" opacity="0.9" />

          {/* ── TOP SYSTEM: 5-LINE ENGRAVED TREBLE STAFF ── */}
          {[0, 1, 2, 3, 4].map((lineIdx) => {
            const y = STAFF_TOP + lineIdx * STAFF_GAP;
            return (
              <line
                key={`st-${lineIdx}`}
                x1={MARGIN_LEFT - 10}
                y1={y}
                x2={SVG_W - MARGIN_RIGHT}
                y2={y}
                stroke="#121212"
                strokeWidth="1.15"
                opacity="0.48"
              />
            );
          })}

          {/* Treble Clef Glyph */}
          <text
            x={MARGIN_LEFT - 44}
            y={STAFF_BOTTOM - 2}
            fontSize="74"
            fontFamily="Georgia, serif"
            fill="#121212"
            opacity="0.88"
          >
            𝄞
          </text>

          {/* Subtle Cobalt Melodic Contour Horizon Arc */}
          {contourPath && (
            <path
              d={contourPath}
              fill="none"
              stroke="#2B59FF"
              strokeWidth={effectivePass === 3 ? 2.4 : 1.75}
              strokeLinecap="round"
              opacity={forensicMode ? 0.28 : effectivePass === 4 ? 0.08 : 0.44}
            />
          )}

          {/* ── BOTTOM SYSTEM: STANDARD 6-LINE GUITAR TAB (e B G D A E) ── */}
          {TAB_STRINGS.map((strLabel, idx) => {
            const y = TAB_TOP + idx * TAB_GAP;
            return (
              <g key={`tab-line-${strLabel}`}>
                <line
                  x1={MARGIN_LEFT - 10}
                  y1={y}
                  x2={SVG_W - MARGIN_RIGHT}
                  y2={y}
                  stroke="#121212"
                  strokeWidth={idx >= 3 ? 1.25 : 1.0}
                  opacity="0.38"
                />
                <text
                  x={MARGIN_LEFT - 26}
                  y={y + 4}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="700"
                  fontSize="11.5"
                  fill="#57534A"
                >
                  {strLabel}
                </text>
              </g>
            );
          })}

          {/* Vertical T-A-B Clef Label */}
          <g fontFamily="Syne, sans-serif" fontWeight="800" fontSize="13" fill="#121212" opacity="0.82">
            <text x={MARGIN_LEFT - 56} y={TAB_TOP + 22} textAnchor="middle">T</text>
            <text x={MARGIN_LEFT - 56} y={TAB_TOP + 54} textAnchor="middle">A</text>
            <text x={MARGIN_LEFT - 56} y={TAB_TOP + 86} textAnchor="middle">B</text>
          </g>

          {/* ── FORENSIC CONTINUOUS PLAYED PITCH & TIMING POCKET OVERLAY (Screen 03) ── */}
          {forensicData && (
            <g>
              <path
                d={forensicData.pocketPolygon}
                fill="#2B59FF"
                opacity="0.11"
                stroke="#2B59FF"
                strokeOpacity="0.32"
                strokeWidth="1"
              />
              <path
                d={forensicData.pitchPath}
                fill="none"
                stroke="#FF3B7F"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </g>
          )}

          {/* ── COUPLED CLASSICAL STAFF NOTEHEADS + FRAMELESS PRINT TAB DIGITS ── */}
          {laidOutNotes.map((item, idx) => {
            const { note, isSharp, x, staffY, tabY } = item;
            const nextItem = laidOutNotes[idx + 1];
            const liveStatus = noteStatusRef.current[note.id];
            const isActive = !forensicMode && effectiveActiveId === note.id;

            let state: 'upcoming' | 'active' | 'hit' | 'miss' = 'upcoming';
            if (isActive) {
              state = 'active';
            } else if (liveStatus === 'hit') {
              state = 'hit';
            } else if (liveStatus === 'miss') {
              state = 'miss';
            } else if (forensicMode) {
              state = idx === 6 ? 'miss' : 'hit';
            } else if (demoMode && runState === 'idle' && note.startBeat < demoPlayheadBeat) {
              state = 'hit';
            }

            const inkOpacity = getInkOpacity(note, isActive);
            const stemDown = staffY <= STAFF_TOP + STAFF_GAP * 2;
            const stemX = stemDown ? x - 6.2 : x + 6.2;
            const stemY2 = stemDown ? staffY + 34 : staffY - 34;

            const noteheadFill =
              state === 'active'
                ? '#121212'
                : state === 'hit'
                  ? '#0D9F6E'
                  : state === 'miss'
                    ? '#FF3B7F'
                    : '#121212';

            const tabDigitFill =
              state === 'active'
                ? '#121212'
                : state === 'hit'
                  ? '#0D9F6E'
                  : state === 'miss'
                    ? '#FF3B7F'
                    : '#121212';

            // Ledger lines when note sits above top staff line or below bottom staff line
            const ledgerLines: number[] = [];
            if (staffY <= STAFF_TOP - STAFF_GAP) {
              for (let ly = STAFF_TOP - STAFF_GAP; ly >= staffY - 2; ly -= STAFF_GAP) {
                ledgerLines.push(ly);
              }
            }
            if (staffY >= STAFF_BOTTOM + STAFF_GAP) {
              for (let ly = STAFF_BOTTOM + STAFF_GAP; ly <= staffY + 2; ly += STAFF_GAP) {
                ledgerLines.push(ly);
              }
            }

            return (
              <g key={note.id} opacity={inkOpacity}>
                {/* Ledger lines if needed */}
                {ledgerLines.map((ly) => (
                  <line
                    key={ly}
                    x1={x - 12}
                    y1={ly}
                    x2={x + 12}
                    y2={ly}
                    stroke="#121212"
                    strokeWidth="1.15"
                    opacity="0.55"
                  />
                ))}

                {/* Classical Articulation Marks (ZERO bordered pills!) */}
                {/* Diagonal Slide Line `/` */}
                {note.tech === 'slide' && nextItem && nextItem.note.bar === note.bar && (
                  <>
                    <line
                      x1={x + 10}
                      y1={staffY + (nextItem.staffY > staffY ? 3 : -3)}
                      x2={nextItem.x - 10}
                      y2={nextItem.staffY + (nextItem.staffY > staffY ? -3 : 3)}
                      stroke="#121212"
                      strokeWidth="1.35"
                      opacity="0.65"
                    />
                    <line
                      x1={x + 13}
                      y1={tabY + (nextItem.tabY > tabY ? 2 : -2)}
                      x2={nextItem.x - 13}
                      y2={nextItem.tabY + (nextItem.tabY > tabY ? -2 : 2)}
                      stroke="#121212"
                      strokeWidth="1.3"
                      opacity="0.55"
                    />
                  </>
                )}

                {/* Wavy Vibrato Squiggle `~~~` */}
                {note.tech === 'vibrato' && (
                  <path
                    d={buildVibratoWavePath(x + 10, staffY - 16, Math.max(36, note.durationBeats * 46))}
                    fill="none"
                    stroke="#121212"
                    strokeWidth="1.3"
                    opacity="0.62"
                  />
                )}

                {/* Curved Hammer-On / Pull-Off Slur `⌒` */}
                {(note.tech === 'hammer' || note.tech === 'pull') &&
                  nextItem &&
                  nextItem.note.bar === note.bar && (
                    <path
                      d={`M ${x + 2} ${staffY - 12} Q ${((x + nextItem.x) * 0.5).toFixed(1)} ${(Math.min(staffY, nextItem.staffY) - 28).toFixed(1)}, ${nextItem.x - 2} ${nextItem.staffY - 12}`}
                      fill="none"
                      stroke="#121212"
                      strokeWidth="1.35"
                      opacity="0.68"
                    />
                  )}

                {/* Sharp Accidental */}
                {isSharp && (
                  <text
                    x={x - 15}
                    y={staffY + 4}
                    fontFamily="Georgia, serif"
                    fontSize="14"
                    fontWeight="700"
                    fill={noteheadFill}
                  >
                    ♯
                  </text>
                )}

                {/* Subtle Active Lime Aura Ring on Staff Notehead */}
                {state === 'active' && (
                  <circle
                    cx={x}
                    cy={staffY}
                    r="12"
                    fill="#D8FF2E"
                    stroke="#121212"
                    strokeWidth="1.8"
                  />
                )}

                {/* Classical Tilted Copperplate Oval Notehead + Thin 1.25px Stem */}
                <line
                  x1={stemX}
                  y1={staffY}
                  x2={stemX}
                  y2={stemY2}
                  stroke={noteheadFill}
                  strokeWidth="1.25"
                />
                <ellipse
                  cx={x}
                  cy={staffY}
                  rx="6.8"
                  ry="5"
                  transform={`rotate(-18 ${x} ${staffY})`}
                  fill={noteheadFill}
                />

                {/* ── BOTTOM SYSTEM: FRAMELESS PRINT TAB DIGIT (ONLY Active Note gets Acid Lime Badge!) ── */}
                {state === 'active' ? (
                  <g transform={`translate(${x - 13}, ${tabY - 10})`}>
                    <rect
                      width="26"
                      height="20"
                      rx="6"
                      fill="#D8FF2E"
                      stroke="#121212"
                      strokeWidth="2"
                    />
                    <text
                      x="13"
                      y="14"
                      textAnchor="middle"
                      fontFamily="Space Mono, monospace"
                      fontWeight="800"
                      fontSize="13"
                      fill="#121212"
                    >
                      {note.fret}
                    </text>
                  </g>
                ) : (
                  <g>
                    {/* Frameless #FFFBF0 Paper Mask clears string line cleanly behind print digit */}
                    <rect
                      x={x - 10}
                      y={tabY - 9}
                      width="20"
                      height="18"
                      rx="3"
                      fill="#FFFBF0"
                      stroke="none"
                    />
                    <text
                      x={x}
                      y={tabY + 4.5}
                      textAnchor="middle"
                      fontFamily="Space Mono, monospace"
                      fontWeight="700"
                      fontSize="13.5"
                      fill={tabDigitFill}
                    >
                      {note.fret}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* ── FORENSIC 3 DELICATE 1PX HAIRLINE PIN CALLOUTS (Screen 03 — Zero Bulky Colored Banners!) ── */}
          {forensicData &&
            forensicData.pins.map((pin) => {
              const boxW = pin.label.length * 6.9 + 20;
              const boxY = 54;
              const boxX = Math.max(MARGIN_LEFT + 6, Math.min(SVG_W - MARGIN_RIGHT - boxW - 6, pin.x - boxW / 2));
              return (
                <g key={pin.label}>
                  <line
                    x1={pin.x}
                    y1={pin.y}
                    x2={pin.x}
                    y2={boxY + 21}
                    stroke="#121212"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    opacity="0.72"
                  />
                  <circle
                    cx={pin.x}
                    cy={pin.y}
                    r="3.8"
                    fill={pin.dotColor}
                    stroke="#121212"
                    strokeWidth="1.2"
                  />
                  <g transform={`translate(${boxX}, ${boxY})`}>
                    <rect
                      width={boxW}
                      height="21"
                      rx="5"
                      fill="#FFFBF0"
                      stroke="#121212"
                      strokeWidth="1"
                    />
                    <circle cx="9" cy="10.5" r="3" fill={pin.dotColor} />
                    <text
                      x="17"
                      y="14"
                      fontFamily="Space Mono, monospace"
                      fontWeight="700"
                      fontSize="10"
                      fill="#121212"
                    >
                      {pin.label}
                    </text>
                  </g>
                </g>
              );
            })}

          {/* ── SINGLE #FF3B7F 1.5PX VERTICAL PLAYHEAD SPANNING BOTH STAFF & TAB ── */}
          {!forensicMode && (
            <g ref={playheadGroupRef} style={{ willChange: 'transform' }}>
              <line
                x1="0"
                y1={56}
                x2="0"
                y2={TAB_BOTTOM + 14}
                stroke="#FF3B7F"
                strokeWidth="1.75"
              />
              <polygon
                points="-5,54 5,54 0,62"
                fill="#FF3B7F"
              />
              <circle
                cx="0"
                cy={TAB_BOTTOM + 14}
                r="3.5"
                fill="#FF3B7F"
              />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
