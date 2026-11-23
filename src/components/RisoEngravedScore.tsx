import { useEffect, useMemo, useRef } from 'react';
import type { CoursePracticeMode, CourseTabNote, GuitarCourse } from '../data/guitarCourses';
import type { LessonNoteStatus } from '../types/lesson';
import { noteLabelToMidi } from '../utils/noteFromFrequency';
import type { HiddenDifficulty, StageMotionSnapshot } from './MinimalScoreCanvasPixi';

export type VanishPass = 1 | 2 | 3 | 4;

export interface RisoEngravedScoreProps {
  course: GuitarCourse;
  practiceMode: CoursePracticeMode;
  hiddenDifficulty: HiddenDifficulty;
  vanishPass: VanishPass;
  onChangeVanishPass?: (pass: VanishPass) => void;
  loopRange: 'all' | { startBar: number; endBar: number };
  selectedWindowStartBar: number;
  onChangeWindowStartBar: (bar: number) => void;
  onSelectBar: (barNum: number) => void;
  runState: 'idle' | 'running' | 'preview' | 'results';
  motionRef: React.MutableRefObject<StageMotionSnapshot>;
  noteStatusRef: React.MutableRefObject<Record<string, LessonNoteStatus>>;
  demoMode?: boolean;
  forensicMode?: boolean;
}

const SVG_W = 1280;
const SVG_H = 336;
const MARGIN_LEFT = 82;
const MARGIN_RIGHT = 32;
const SCORE_W = SVG_W - MARGIN_LEFT - MARGIN_RIGHT;
const STAFF_TOP = 132;
const STAFF_GAP = 20; // 5 lines: 132, 152, 172, 192, 212
const STAFF_BOTTOM = STAFF_TOP + STAFF_GAP * 4;

const STEP_BY_SEMITONE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const SHARP_SEMITONES = [
  false,
  true,
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
] as const;

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
  // Guitar sounds one octave lower than written treble; anchor E3 near bottom line
  const y = STAFF_BOTTOM - (step - E3_STEP) * (STAFF_GAP / 2);
  return Math.max(92, Math.min(266, y));
}

function buildSmoothContourPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    d += ` C ${cx.toFixed(1)} ${p0.y.toFixed(1)}, ${cx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return d;
}

function shortTechTag(tech?: string): string | null {
  if (!tech) return null;
  if (tech.includes('vibrato')) return 'VIB';
  if (tech.includes('slide')) return 'SLD';
  if (tech.includes('hammer')) return 'H-ON';
  if (tech.includes('pull')) return 'PULL';
  return tech.slice(0, 4).toUpperCase();
}

const PASS_PILLS: ReadonlyArray<{ pass: VanishPass; label: string }> = [
  { pass: 1, label: '100% INK' },
  { pass: 2, label: '55% GHOST' },
  { pass: 3, label: '25% CONTOUR' },
  { pass: 4, label: '0% EAR' },
];

interface PositionedNote {
  note: CourseTabNote;
  x: number;
  y: number;
  isSharp: boolean;
  tailWidth: number;
  status: 'upcoming' | 'active' | 'hit' | 'miss';
}

export function RisoEngravedScore({
  course,
  practiceMode,
  hiddenDifficulty,
  vanishPass,
  onChangeVanishPass,
  loopRange,
  selectedWindowStartBar,
  onChangeWindowStartBar,
  onSelectBar,
  runState,
  motionRef,
  noteStatusRef,
  demoMode = false,
  forensicMode = false,
}: RisoEngravedScoreProps) {
  const playheadGroupRef = useRef<SVGGElement | null>(null);

  const barsPerWindow = Math.min(4, course.totalBars);
  const windowStartBar = Math.max(
    1,
    Math.min(selectedWindowStartBar, Math.max(1, course.totalBars - barsPerWindow + 1)),
  );
  const windowEndBar = Math.min(course.totalBars, windowStartBar + barsPerWindow - 1);
  const windowBeats = barsPerWindow * course.beatsPerBar;
  const windowStartBeat = (windowStartBar - 1) * course.beatsPerBar;

  // Demo snapshot playhead sits on Bar 3 Beat 0.25 (Gmaj7 anchor Fret 7)
  const demoPlayheadBeat = Math.min(
    windowStartBeat + windowBeats - 0.5,
    windowStartBeat + 2 * course.beatsPerBar + 0.25,
  );

  // Zero-jank 60/120fps playhead transform reading motionRef directly
  useEffect(() => {
    if (forensicMode) return undefined;

    const beatToX = (beat: number): number => {
      const rel = Math.max(0, Math.min(windowBeats, beat - windowStartBeat));
      return MARGIN_LEFT + (rel / windowBeats) * SCORE_W;
    };

    const setX = (x: number) => {
      if (playheadGroupRef.current) {
        playheadGroupRef.current.setAttribute('transform', `translate(${x.toFixed(1)}, 0)`);
      }
    };

    if (runState !== 'running' && runState !== 'preview') {
      const staticBeat = demoMode ? demoPlayheadBeat : motionRef.current.focusStartBeat;
      setX(beatToX(staticBeat));
      return undefined;
    }

    let rafId = 0;
    const tick = () => {
      const m = motionRef.current;
      if (m.running || m.previewing) {
        setX(beatToX(m.courseBeat));
        // Auto-paginate stationary 4-bar window cleanly when playhead enters next phrase
        const barNow = Math.floor(m.courseBeat / course.beatsPerBar) + 1;
        if (barNow > windowEndBar && windowEndBar < course.totalBars) {
          onChangeWindowStartBar(Math.min(course.totalBars - barsPerWindow + 1, windowStartBar + barsPerWindow));
        } else if (barNow < windowStartBar) {
          onChangeWindowStartBar(Math.max(1, Math.floor((barNow - 1) / barsPerWindow) * barsPerWindow + 1));
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    barsPerWindow,
    course.beatsPerBar,
    course.totalBars,
    demoMode,
    demoPlayheadBeat,
    forensicMode,
    motionRef,
    onChangeWindowStartBar,
    runState,
    windowBeats,
    windowEndBar,
    windowStartBar,
    windowStartBeat,
  ]);

  const effectivePass: VanishPass = useMemo(() => {
    if (forensicMode) return 1;
    if (practiceMode !== 'hidden') return 1;
    if (vanishPass !== 1) return vanishPass;
    if (hiddenDifficulty === 'full-blackout') return 4;
    if (hiddenDifficulty === 'bar-anchors') return 3;
    return 2;
  }, [forensicMode, hiddenDifficulty, practiceMode, vanishPass]);

  const positionedNotes: PositionedNote[] = useMemo(() => {
    const raw = course.notes.filter(
      (n) => n.bar >= windowStartBar && n.bar <= windowEndBar,
    );
    const activeBeatRef = demoMode && runState === 'idle'
      ? demoPlayheadBeat
      : motionRef.current.courseBeat;

    return raw.map((note, idx) => {
      const relBeat = note.startBeat - windowStartBeat;
      const x = MARGIN_LEFT + ((relBeat + 0.14) / windowBeats) * SCORE_W;
      const midi = noteLabelToMidi(note.label) ?? 64;
      const { isSharp } = midiToDiatonic(midi);
      const y = midiToStaffY(midi);
      const tailWidth = Math.max(0, (note.durationBeats / windowBeats) * SCORE_W - 22);

      let status: PositionedNote['status'] = 'upcoming';
      const liveStatus = noteStatusRef.current[note.id];
      if (forensicMode) {
        status = idx === 6 ? 'miss' : 'hit';
      } else if (liveStatus === 'hit') {
        status = 'hit';
      } else if (liveStatus === 'miss') {
        status = 'miss';
      } else if (demoMode && runState === 'idle') {
        if (note.startBeat < activeBeatRef - 0.08) {
          status = 'hit';
        } else if (
          activeBeatRef >= note.startBeat - 0.08 &&
          activeBeatRef <= note.startBeat + note.durationBeats
        ) {
          status = 'active';
        } else {
          status = 'upcoming';
        }
      } else if (motionRef.current.activeTargetNoteId === note.id) {
        status = 'active';
      }

      return { note, x, y, isSharp, tailWidth, status };
    });
  }, [
    course.notes,
    demoMode,
    demoPlayheadBeat,
    forensicMode,
    motionRef,
    noteStatusRef,
    runState,
    windowBeats,
    windowEndBar,
    windowStartBar,
    windowStartBeat,
  ]);

  const contourPath = useMemo(
    () => buildSmoothContourPath(positionedNotes.map((p) => ({ x: p.x, y: p.y }))),
    [positionedNotes],
  );

  // Continuous played pitch & timing pocket ribbon for Forensic Mode (Screen 03)
  const forensicData = useMemo(() => {
    if (!forensicMode || positionedNotes.length < 2) return null;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < positionedNotes.length; i += 1) {
      const cur = positionedNotes[i];
      const next = positionedNotes[i + 1];
      // Slight realistic micro-intonation & vibrato excursion on Bar 3
      const centsOffsetPx = cur.note.bar === 2 && i % 2 === 1 ? 6 : cur.note.bar === 3 ? -2 : 0;
      pts.push({ x: cur.x, y: cur.y + centsOffsetPx });
      if (cur.note.tech?.includes('vibrato') && next) {
        const span = Math.min(cur.tailWidth, (next.x - cur.x) * 0.78);
        for (let step = 1; step <= 6; step += 1) {
          const t = step / 6;
          const wave = Math.sin(t * Math.PI * 4) * 5.2;
          pts.push({ x: cur.x + span * t, y: cur.y + wave });
        }
      } else if (cur.note.tech?.includes('slide') && next) {
        const midX = cur.x + (next.x - cur.x) * 0.55;
        const midY = cur.y + (next.y - cur.y) * 0.45 - 3;
        pts.push({ x: midX, y: midY });
      }
    }

    const playedPath = buildSmoothContourPath(pts);
    const upperEnv = pts.map((p) => `${p.x.toFixed(1)},${(p.y - 10).toFixed(1)}`).join(' ');
    const lowerEnv = [...pts]
      .reverse()
      .map((p) => `${p.x.toFixed(1)},${(p.y + 10).toFixed(1)}`)
      .join(' ');

    // 3 pinned callout anchors directly on the curve
    const pin1 = positionedNotes[0];
    const pin2 = positionedNotes.find((p) => p.note.bar === 2) ?? positionedNotes[Math.min(3, positionedNotes.length - 1)];
    const pin3 = positionedNotes.find((p) => p.note.bar === 3 && p.note.tech?.includes('vibrato'))
      ?? positionedNotes.find((p) => p.note.bar === 3)
      ?? positionedNotes[positionedNotes.length - 1];

    return {
      playedPath,
      envelopePoints: `${upperEnv} ${lowerEnv}`,
      pins: [
        { x: pin1.x + 18, y: pin1.y, label: 'SLIDE 12→7 · +2¢', color: '#1CE088', textColor: '#121212' },
        { x: pin2.x + 14, y: pin2.y, label: 'LAYBACK -11ms', color: '#2B59FF', textColor: '#FFFFFF' },
        { x: pin3.x + 20, y: pin3.y, label: 'VIB 5.2Hz', color: '#D8FF2E', textColor: '#121212' },
      ],
    };
  }, [forensicMode, positionedNotes]);

  const activeBarNum = useMemo(() => {
    if (forensicMode) return -1;
    if (demoMode && runState === 'idle') {
      return Math.min(windowEndBar, windowStartBar + 2);
    }
    return Math.floor(motionRef.current.courseBeat / course.beatsPerBar) + 1;
  }, [course.beatsPerBar, demoMode, forensicMode, motionRef, runState, windowEndBar, windowStartBar]);

  const barWindows = useMemo(() => {
    const chunks: Array<{ start: number; end: number }> = [];
    for (let b = 1; b <= course.totalBars; b += 4) {
      chunks.push({ start: b, end: Math.min(course.totalBars, b + 3) });
    }
    return chunks;
  }, [course.totalBars]);

  const barWidth = SCORE_W / barsPerWindow;

  return (
    <section
      className="neo-card bg-[#FFFBF0] overflow-hidden flex flex-col h-full min-h-0"
      aria-label="Risograph Engraved Contour Score"
    >
      {/* Top Bar: Clickable Measure Chord Pills + Window Pagination + 4-Pass Vanish Stepper */}
      <div className="px-4 py-2 bg-[#F4ECDC] border-b-[2.5px] border-[#121212] flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {Array.from({ length: barsPerWindow }, (_, idx) => {
            const barNum = windowStartBar + idx;
            const chord = course.barChords[barNum - 1] ?? '—';
            const isActiveBar = barNum === activeBarNum;
            const isLooped =
              loopRange !== 'all' && barNum >= loopRange.startBar && barNum <= loopRange.endBar;

            return (
              <button
                key={barNum}
                type="button"
                onClick={() => onSelectBar(barNum)}
                className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-[#121212] font-mono text-[11px] font-bold transition-all ${
                  isLooped
                    ? 'bg-[#FF8A00] text-[#121212] shadow-brutal-xs'
                    : isActiveBar
                      ? 'bg-[#D8FF2E] text-[#121212] shadow-brutal-xs'
                      : 'bg-white text-[#121212] hover:bg-[#FFF4D8]'
                }`}
                title={`Jump or loop Bar ${barNum}`}
              >
                <span className="opacity-65">M{barNum}</span>
                <span className="font-syne text-xs font-extrabold">{chord}</span>
                <span className="text-[10px] opacity-40 group-hover:opacity-100">↻</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Forensic Legend */}
          {forensicMode && (
            <div className="hidden md:flex items-center gap-2.5 font-mono text-[10px] font-bold">
              <span className="inline-flex items-center gap-1 text-[#121212]">
                <span className="w-3.5 h-1 rounded-full bg-[#FF3B7F] border border-[#121212]" />
                PITCH
              </span>
              <span className="inline-flex items-center gap-1 text-[#121212]">
                <span className="w-3.5 h-2 rounded-sm bg-[#2B59FF]/20 border border-[#2B59FF]" />
                POCKET
              </span>
            </div>
          )}

          {/* 4-Pass Vanishing Ink Selector (visible in Hidden/Blackout mode) */}
          {practiceMode === 'hidden' && !forensicMode && onChangeVanishPass && (
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-white border-2 border-[#121212]">
              {PASS_PILLS.map((p) => (
                <button
                  key={p.pass}
                  type="button"
                  onClick={() => onChangeVanishPass(p.pass)}
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold transition-colors ${
                    effectivePass === p.pass
                      ? 'bg-[#121212] text-[#D8FF2E]'
                      : 'text-[#423E37] hover:text-[#121212]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Stationary 4-Bar Window Pagination */}
          {barWindows.length > 1 && (
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-white border-2 border-[#121212]">
              {barWindows.map((win) => {
                const active = win.start === windowStartBar;
                return (
                  <button
                    key={win.start}
                    type="button"
                    onClick={() => onChangeWindowStartBar(win.start)}
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold transition-colors ${
                      active
                        ? 'bg-[#121212] text-[#D8FF2E]'
                        : 'text-[#423E37] hover:text-[#121212]'
                    }`}
                  >
                    B{win.start}–{win.end}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main SVG Engraved 5-Line Staff + Contour Ribbon + Fret-Inside-Notehead Pills */}
      <div className="relative flex-1 min-h-0 w-full bg-[#FFFBF0] riso-paper-grain flex items-center justify-center">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full max-h-full block select-none"
          role="img"
          aria-label={forensicMode ? 'Forensic pitch ribbon over 4-bar score' : '4-bar engraved contour staff'}
        >
          <defs>
            <pattern
              id="riso-coral-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#FF3B7F" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#121212" strokeWidth="1.6" opacity="0.32" />
            </pattern>
          </defs>

          {/* Subtle Active Bar Highlight Band */}
          {Array.from({ length: barsPerWindow }, (_, idx) => {
            const barNum = windowStartBar + idx;
            const bx = MARGIN_LEFT + idx * barWidth;
            const isActiveBar = barNum === activeBarNum;
            const isLooped =
              loopRange !== 'all' && barNum >= loopRange.startBar && barNum <= loopRange.endBar;

            return (
              <g key={`bar-bg-${barNum}`}>
                {(isActiveBar || isLooped) && (
                  <rect
                    x={bx}
                    y={18}
                    width={barWidth}
                    height={SVG_H - 34}
                    rx={8}
                    fill={isLooped ? 'rgba(255,138,0,0.12)' : 'rgba(216,255,46,0.15)'}
                    stroke={isLooped ? '#FF8A00' : 'rgba(18,18,18,0.14)'}
                    strokeWidth={1.5}
                    strokeDasharray={isLooped ? '5 4' : undefined}
                  />
                )}

                {/* Chord Engraving Header inside Plate */}
                <text
                  x={bx + 14}
                  y={32}
                  fill="#121212"
                  fontFamily="Syne, sans-serif"
                  fontWeight="800"
                  fontSize="18"
                >
                  {course.barChords[barNum - 1] ?? ''}
                </text>
                <text
                  x={bx + barWidth - 12}
                  y={30}
                  textAnchor="end"
                  fill="rgba(18,18,18,0.45)"
                  fontFamily="Space Mono, monospace"
                  fontWeight="700"
                  fontSize="11"
                >
                  M{barNum}
                </text>

                {/* Subtle Beat Sub-Grid Hairlines */}
                {[1, 2, 3].map((beatIdx) => {
                  const gx = bx + (beatIdx / course.beatsPerBar) * barWidth;
                  return (
                    <line
                      key={beatIdx}
                      x1={gx}
                      y1={STAFF_TOP - 8}
                      x2={gx}
                      y2={STAFF_BOTTOM + 8}
                      stroke="rgba(18,18,18,0.08)"
                      strokeWidth="1"
                      strokeDasharray="3 4"
                    />
                  );
                })}

                {/* Measure Barline */}
                <line
                  x1={bx + barWidth}
                  y1={STAFF_TOP}
                  x2={bx + barWidth}
                  y2={STAFF_BOTTOM}
                  stroke="#121212"
                  strokeWidth={idx === barsPerWindow - 1 ? 3 : 1.6}
                />
              </g>
            );
          })}

          {/* Left Staff Clef Spine + Engraved 5-Line Treble Staff */}
          <line
            x1={MARGIN_LEFT}
            y1={STAFF_TOP}
            x2={MARGIN_LEFT}
            y2={STAFF_BOTTOM}
            stroke="#121212"
            strokeWidth="2.5"
          />

          {[0, 1, 2, 3, 4].map((lineIdx) => {
            const ly = STAFF_TOP + lineIdx * STAFF_GAP;
            return (
              <line
                key={`staff-line-${lineIdx}`}
                x1={MARGIN_LEFT}
                y1={ly}
                x2={SVG_W - MARGIN_RIGHT}
                y2={ly}
                stroke="rgba(18,18,18,0.32)"
                strokeWidth="1.5"
              />
            );
          })}

          {/* Crisp Engraved Treble Clef Emblem */}
          <text
            x={MARGIN_LEFT - 52}
            y={STAFF_BOTTOM - 2}
            fontSize="94"
            fill="#121212"
            fontFamily="Georgia, serif"
            opacity="0.92"
          >
            𝄞
          </text>

          {/* Smooth Melodic Horizon Contour Ribbon (from 04 Monolith Jazz, re-inked in Cobalt) */}
          {effectivePass <= 3 && contourPath && (
            <path
              d={contourPath}
              fill="none"
              stroke={forensicMode ? 'rgba(43,89,255,0.28)' : '#2B59FF'}
              strokeWidth={effectivePass === 3 ? 3.5 : 2.6}
              strokeLinecap="round"
              strokeDasharray={effectivePass === 3 ? '7 5' : undefined}
              opacity={forensicMode ? 0.55 : 0.72}
            />
          )}

          {/* Forensic Timing Pocket Envelope + Continuous Played Pitch Ribbon (Screen 03) */}
          {forensicData && (
            <g>
              <polygon
                points={forensicData.envelopePoints}
                fill="rgba(43,89,255,0.14)"
                stroke="rgba(43,89,255,0.35)"
                strokeWidth="1"
              />
              <path
                d={forensicData.playedPath}
                fill="none"
                stroke="#FF3B7F"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path
                d={forensicData.playedPath}
                fill="none"
                stroke="#121212"
                strokeWidth="1.1"
                strokeDasharray="2 6"
                opacity="0.45"
              />
            </g>
          )}

          {/* Engraved Fret-Inside-Notehead Pills (Strict 4-State Semantic Color + Shape!) */}
          {positionedNotes.map((item) => {
            const { note, x, y, isSharp, tailWidth, status } = item;
            const tech = shortTechTag(note.tech);

            // 4-Pass Vanishing Ink visibility rules
            let noteOpacity = 1;
            if (effectivePass === 2 && !note.isAnchor) noteOpacity = 0.34;
            if (effectivePass === 3) noteOpacity = note.isAnchor ? 0.65 : 0.08;
            if (effectivePass === 4) noteOpacity = 0;

            if (noteOpacity === 0) return null;

            const isActive = status === 'active';
            const isHit = status === 'hit';
            const isMiss = status === 'miss';

            const pillW = isActive ? 34 : 28;
            const pillH = isActive ? 24 : 20;
            const fill = isActive
              ? '#D8FF2E'
              : isHit
                ? '#1CE088'
                : isMiss
                  ? 'url(#riso-coral-hatch)'
                  : '#FFFFFF';
            const textFill = isMiss ? '#FFFFFF' : '#121212';

            // Ledger lines above or below staff
            const ledgerLines: number[] = [];
            if (y < STAFF_TOP - STAFF_GAP / 2) {
              for (let ly = STAFF_TOP - STAFF_GAP; ly >= y - 4; ly -= STAFF_GAP) {
                ledgerLines.push(ly);
              }
            }
            if (y > STAFF_BOTTOM + STAFF_GAP / 2) {
              for (let ly = STAFF_BOTTOM + STAFF_GAP; ly <= y + 4; ly += STAFF_GAP) {
                ledgerLines.push(ly);
              }
            }

            return (
              <g key={note.id} opacity={noteOpacity}>
                {/* Ledger lines */}
                {ledgerLines.map((ly) => (
                  <line
                    key={ly}
                    x1={x - 20}
                    y1={ly}
                    x2={x + 20}
                    y2={ly}
                    stroke="#121212"
                    strokeWidth="1.6"
                  />
                ))}

                {/* Duration Sustain Tail Bar */}
                {tailWidth > 8 && (
                  <rect
                    x={x + pillW / 2 - 2}
                    y={y - 3.5}
                    width={tailWidth}
                    height={7}
                    rx={3.5}
                    fill={
                      isActive
                        ? '#D8FF2E'
                        : isHit
                          ? 'rgba(28,224,136,0.45)'
                          : 'rgba(18,18,18,0.12)'
                    }
                    stroke="#121212"
                    strokeWidth={isActive ? 1.5 : 1}
                    opacity={isActive ? 0.95 : 0.75}
                  />
                )}

                {/* Vertical Stem */}
                <line
                  x1={x + pillW / 2 - 1}
                  y1={y}
                  x2={x + pillW / 2 - 1}
                  y2={y > STAFF_TOP + STAFF_GAP * 2 ? y - 42 : y + 42}
                  stroke="#121212"
                  strokeWidth={isActive || isHit ? 2.2 : 1.6}
                />

                {/* Sharp accidental */}
                {isSharp && (
                  <text
                    x={x - pillW / 2 - 10}
                    y={y + 5}
                    fontSize="14"
                    fontWeight="800"
                    fontFamily="Space Mono, monospace"
                    fill="#121212"
                  >
                    #
                  </text>
                )}

                {/* Active Double Halo Ring */}
                {isActive && (
                  <rect
                    x={x - pillW / 2 - 5}
                    y={y - pillH / 2 - 5}
                    width={pillW + 10}
                    height={pillH + 10}
                    rx={14}
                    fill="none"
                    stroke="#121212"
                    strokeWidth="2.5"
                    strokeDasharray="4 3"
                  />
                )}

                {/* Hard Ink Offset Shadow */}
                <rect
                  x={x - pillW / 2 + 2.5}
                  y={y - pillH / 2 + 2.5}
                  width={pillW}
                  height={pillH}
                  rx={10}
                  fill="#121212"
                />

                {/* Fret-Inside-Notehead Pill */}
                <rect
                  x={x - pillW / 2}
                  y={y - pillH / 2}
                  width={pillW}
                  height={pillH}
                  rx={10}
                  fill={fill}
                  stroke="#121212"
                  strokeWidth={isActive ? 2.5 : 2}
                />

                <text
                  x={x}
                  y={y + 4.5}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="800"
                  fontSize={isActive ? '13' : '11.5'}
                  fill={textFill}
                >
                  {note.fret}
                </text>

                {/* Non-Color Accessibility Status Micro-Badge (✓ Hit / × Miss) */}
                {(isHit || isMiss) && !forensicMode && (
                  <g transform={`translate(${x + pillW / 2 - 2}, ${y - pillH / 2 - 2})`}>
                    <circle
                      r="6.5"
                      fill={isHit ? '#121212' : '#FF3B7F'}
                      stroke="#121212"
                      strokeWidth="1.4"
                    />
                    <text
                      y="3.2"
                      textAnchor="middle"
                      fontSize="8.5"
                      fontWeight="800"
                      fill={isHit ? '#D8FF2E' : '#FFFFFF'}
                    >
                      {isHit ? '✓' : '×'}
                    </text>
                  </g>
                )}

                {/* Compact Technique Stamp */}
                {tech && !forensicMode && (
                  <g transform={`translate(${x}, ${y - pillH / 2 - 14})`}>
                    <rect
                      x="-16"
                      y="-8"
                      width="32"
                      height="14"
                      rx="5"
                      fill={isActive ? '#2B59FF' : '#FFF4D8'}
                      stroke="#121212"
                      strokeWidth="1.4"
                    />
                    <text
                      y="2.5"
                      textAnchor="middle"
                      fontFamily="Space Mono, monospace"
                      fontWeight="700"
                      fontSize="8.5"
                      fill={isActive ? '#FFFFFF' : '#121212'}
                    >
                      {tech}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Forensic Pinned Curve Callouts (Screen 03 — Zero Prose Cards!) */}
          {forensicData &&
            forensicData.pins.map((pin, idx) => {
              const boxY = Math.max(46, Math.min(72, pin.y - 68));
              const boxW = pin.label.length * 7.8 + 26;
              return (
                <g key={pin.label}>
                  <line
                    x1={pin.x}
                    y1={pin.y}
                    x2={pin.x}
                    y2={boxY + 24}
                    stroke="#121212"
                    strokeWidth="2"
                  />
                  <circle cx={pin.x} cy={pin.y} r="5" fill={pin.color} stroke="#121212" strokeWidth="2" />
                  <g transform={`translate(${Math.max(MARGIN_LEFT + 6, pin.x - boxW / 2)}, ${boxY})`}>
                    <rect x="2.5" y="2.5" width={boxW} height="24" rx="8" fill="#121212" />
                    <rect
                      width={boxW}
                      height="24"
                      rx="8"
                      fill={pin.color}
                      stroke="#121212"
                      strokeWidth="2"
                    />
                    <text
                      x={boxW / 2}
                      y="15.5"
                      textAnchor="middle"
                      fontFamily="Space Mono, monospace"
                      fontWeight="700"
                      fontSize="10.5"
                      fill={pin.textColor}
                    >
                      {idx + 1} · {pin.label}
                    </text>
                  </g>
                </g>
              );
            })}

          {/* Blackout Pass 4 Watermark */}
          {effectivePass === 4 && (
            <text
              x={MARGIN_LEFT + SCORE_W / 2}
              y={STAFF_TOP + STAFF_GAP * 2 + 6}
              textAnchor="middle"
              fontFamily="Syne, sans-serif"
              fontWeight="800"
              fontSize="26"
              fill="rgba(18,18,18,0.16)"
              letterSpacing="4"
            >
              EAR &amp; MEMORY BLACKOUT
            </text>
          )}

          {/* Razor #FF3B7F Playhead Laser (Zero-Jank Transform Ref!) */}
          {!forensicMode && (
            <g
              ref={playheadGroupRef}
              transform={`translate(${(MARGIN_LEFT + ((demoPlayheadBeat - windowStartBeat) / windowBeats) * SCORE_W).toFixed(1)}, 0)`}
            >
              <line
                x1="0"
                y1="26"
                x2="0"
                y2={SVG_H - 18}
                stroke="#FF3B7F"
                strokeWidth="3"
              />
              <polygon
                points="-7,22 7,22 0,33"
                fill="#FF3B7F"
                stroke="#121212"
                strokeWidth="1.8"
              />
              <circle cx="0" cy={SVG_H - 18} r="4.5" fill="#FF3B7F" stroke="#121212" strokeWidth="1.8" />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
