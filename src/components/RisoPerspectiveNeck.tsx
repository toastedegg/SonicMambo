import { useMemo } from 'react';
import type { CourseTabNote, GuitarCourse } from '../data/guitarCourses';

export interface RisoPerspectiveNeckProps {
  course: GuitarCourse;
  activeNote: CourseTabNote | null;
  nextNote: CourseTabNote | null;
  bleedStringNum?: 1 | 2 | 3 | 4 | 5 | 6 | null;
}

const MAX_FRET = 17;
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17] as const;
const STRING_META: ReadonlyArray<{ num: 1 | 2 | 3 | 4 | 5 | 6; label: string; gauge: number }> = [
  { num: 1, label: 'e4', gauge: 1.35 },
  { num: 2, label: 'B3', gauge: 1.75 },
  { num: 3, label: 'G3', gauge: 2.25 },
  { num: 4, label: 'D3', gauge: 2.8 },
  { num: 5, label: 'A2', gauge: 3.4 },
  { num: 6, label: 'E2', gauge: 4.05 },
];

// Full-Stage 1:1 Tapered 3D Perspective Guitar Neck Geometry (extracted from branch 05, re-inked for Risograph)
const VB_W = 1280;
const VB_H = 340;
const NUT_X = 94;
const END_X = 1236;
const TOP_LEFT_Y = 56;
const BOT_LEFT_Y = 258;
const TOP_RIGHT_Y = 34;
const BOT_RIGHT_Y = 280;

function fretRatio(fret: number): number {
  const raw = 1 - Math.pow(2, -fret / 12);
  const maxRaw = 1 - Math.pow(2, -MAX_FRET / 12);
  return raw / maxRaw;
}

function fretWireX(fret: number): number {
  if (fret <= 0) return NUT_X;
  return NUT_X + fretRatio(fret) * (END_X - NUT_X);
}

function fretCenterX(fret: number): number {
  if (fret <= 0) return NUT_X - 24;
  return (fretWireX(fret - 1) + fretWireX(fret)) * 0.5;
}

function neckTopY(x: number): number {
  const t = Math.max(0, Math.min(1, (x - NUT_X) / (END_X - NUT_X)));
  return TOP_LEFT_Y + t * (TOP_RIGHT_Y - TOP_LEFT_Y);
}

function neckBotY(x: number): number {
  const t = Math.max(0, Math.min(1, (x - NUT_X) / (END_X - NUT_X)));
  return BOT_LEFT_Y + t * (BOT_RIGHT_Y - BOT_LEFT_Y);
}

function stringYAtX(stringNum: 1 | 2 | 3 | 4 | 5 | 6, x: number): number {
  const top = neckTopY(x) + 18;
  const bot = neckBotY(x) - 18;
  const frac = (stringNum - 1) / 5;
  return top + frac * (bot - top);
}

/**
 * Lens 3: De-cluttered Full-Stage 3D Perspective Luthiery Neck (§2.4).
 * Strict 2-Dot Focus: Current Target (#D8FF2E lime ring + active string glow) + Next Target (#FFFFFF/#2B59FF ring)
 * connected by 05's curved #2B59FF Spring-Vector Sightline Arc. Zero scattered grey ghost circles!
 */
export function RisoPerspectiveNeck({
  course,
  activeNote,
  nextNote,
  bleedStringNum = null,
}: RisoPerspectiveNeckProps) {
  const fretNumbers = useMemo(
    () => Array.from({ length: MAX_FRET }, (_, i) => i + 1),
    [],
  );

  const activePoint = useMemo(
    () =>
      activeNote
        ? {
            x: fretCenterX(activeNote.fret),
            y: stringYAtX(activeNote.stringNum, fretCenterX(activeNote.fret)),
          }
        : null,
    [activeNote],
  );

  const nextPoint = useMemo(
    () =>
      nextNote && (!activeNote || nextNote.id !== activeNote.id)
        ? {
            x: fretCenterX(nextNote.fret),
            y: stringYAtX(nextNote.stringNum, fretCenterX(nextNote.fret)),
          }
        : null,
    [activeNote, nextNote],
  );

  // Curved #2B59FF Spring-Vector Sightline Arc from Current -> Next Fret
  const vectorArcPath = useMemo(() => {
    if (!activePoint || !nextPoint) return null;
    const midX = (activePoint.x + nextPoint.x) * 0.5;
    const dist = Math.hypot(nextPoint.x - activePoint.x, nextPoint.y - activePoint.y);
    const lift = Math.min(48, Math.max(20, dist * 0.24));
    const ctrlY = Math.min(activePoint.y, nextPoint.y) - lift;
    return `M ${activePoint.x.toFixed(1)} ${activePoint.y.toFixed(1)} Q ${midX.toFixed(1)} ${ctrlY.toFixed(1)}, ${nextPoint.x.toFixed(1)} ${nextPoint.y.toFixed(1)}`;
  }, [activePoint, nextPoint]);

  const activeStringLabel = activeNote
    ? STRING_META.find((s) => s.num === activeNote.stringNum)?.label ?? ''
    : '';

  return (
    <section
      className="neo-card-lg bg-[#FFFBF0] overflow-hidden flex flex-col h-full min-h-0 select-none"
      aria-label={`3D Perspective Guitar Fretboard for ${course.title}`}
    >
      {/* Calm Minimal Spatial Readout Bar */}
      <div className="px-5 py-2.5 bg-[#F4ECDC] border-b-2 border-[#121212] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 font-mono text-xs font-bold text-[#121212]">
          <span className="px-2.5 py-0.5 rounded-lg bg-[#121212] text-[#D8FF2E] tracking-wider">
            3D PERSPECTIVE NECK · FRETS 0–{MAX_FRET}
          </span>
          {activeNote && (
            <span className="text-[#121212]">
              NOW: <span className="px-1.5 py-0.5 rounded bg-[#D8FF2E] border border-[#121212]">S{activeNote.stringNum} ({activeStringLabel}) · F{activeNote.fret} · {activeNote.label}</span>
              {nextNote && nextNote.id !== activeNote.id ? (
                <span className="text-[#2B59FF] ml-2">
                  → NEXT: F{nextNote.fret} ({nextNote.label})
                </span>
              ) : null}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px] font-bold">
          <span className="inline-flex items-center gap-1.5 text-[#121212]">
            <span className="w-3 h-3 rounded-full bg-[#D8FF2E] border-2 border-[#121212]" />
            CURRENT
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#2B59FF]">
            <span className="w-3 h-3 rounded-full bg-white border-2 border-[#2B59FF]" />
            NEXT VECTOR
          </span>
          {bleedStringNum != null && (
            <span className="px-2 py-0.5 rounded-full bg-[#FF3B7F] text-white border-[1.5px] border-[#121212]">
              MUTE {STRING_META[bleedStringNum - 1]?.label}
            </span>
          )}
        </div>
      </div>

      {/* Full-Stage Tapered Roasted-Rosewood 3D Perspective Guitar Neck SVG */}
      <div className="flex-1 min-h-0 w-full bg-[#FFFBF0] riso-paper-grain px-4 py-3 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full max-h-full block select-none"
          role="img"
          aria-label="Full-stage tapered perspective guitar fretboard"
        >
          <defs>
            <linearGradient id="riso-rosewood-v7" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2C2521" />
              <stop offset="48%" stopColor="#231E1B" />
              <stop offset="100%" stopColor="#1A1614" />
            </linearGradient>
            <linearGradient id="riso-fretwire-v7" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9A9184" />
              <stop offset="50%" stopColor="#EFE3CE" />
              <stop offset="100%" stopColor="#7C7468" />
            </linearGradient>
            <filter id="riso-neck-shadow" x="-4%" y="-10%" width="108%" height="125%">
              <feDropShadow dx="5" dy="6" stdDeviation="0" floodColor="#121212" floodOpacity="0.95" />
            </filter>
          </defs>

          {/* Tapered Roasted-Rosewood Fingerboard Slab */}
          <polygon
            points={`${NUT_X - 8},${TOP_LEFT_Y} ${END_X},${TOP_RIGHT_Y} ${END_X},${BOT_RIGHT_Y} ${NUT_X - 8},${BOT_LEFT_Y}`}
            fill="url(#riso-rosewood-v7)"
            stroke="#121212"
            strokeWidth="3.2"
            filter="url(#riso-neck-shadow)"
          />

          {/* Subtle Warm Wood Grain Lines */}
          {[0.18, 0.36, 0.54, 0.72, 0.88].map((frac) => {
            const yL = TOP_LEFT_Y + frac * (BOT_LEFT_Y - TOP_LEFT_Y);
            const yR = TOP_RIGHT_Y + frac * (BOT_RIGHT_Y - TOP_RIGHT_Y);
            return (
              <line
                key={frac}
                x1={NUT_X}
                y1={yL}
                x2={END_X}
                y2={yR}
                stroke="#F5E6CC"
                strokeOpacity="0.06"
                strokeWidth="1.2"
              />
            );
          })}

          {/* Cream Bone Binding Edge Strips */}
          <line
            x1={NUT_X - 6}
            y1={TOP_LEFT_Y + 3.5}
            x2={END_X - 2}
            y2={TOP_RIGHT_Y + 3.5}
            stroke="#F5E6CC"
            strokeWidth="3"
            opacity="0.88"
          />
          <line
            x1={NUT_X - 6}
            y1={BOT_LEFT_Y - 3.5}
            x2={END_X - 2}
            y2={BOT_RIGHT_Y - 3.5}
            stroke="#F5E6CC"
            strokeWidth="3"
            opacity="0.88"
          />

          {/* Subtle Active Fret Column Band Highlight */}
          {activeNote && activeNote.fret > 0 && (
            <polygon
              points={`${fretWireX(activeNote.fret - 1)},${neckTopY(fretWireX(activeNote.fret - 1)) + 5} ${fretWireX(activeNote.fret)},${neckTopY(fretWireX(activeNote.fret)) + 5} ${fretWireX(activeNote.fret)},${neckBotY(fretWireX(activeNote.fret)) - 5} ${fretWireX(activeNote.fret - 1)},${neckBotY(fretWireX(activeNote.fret - 1)) - 5}`}
              fill="#D8FF2E"
              opacity="0.14"
            />
          )}

          {/* Cream Bone Nut (Fret 0) */}
          <polygon
            points={`${NUT_X - 9},${TOP_LEFT_Y + 2} ${NUT_X + 3},${TOP_LEFT_Y + 2} ${NUT_X + 3},${BOT_LEFT_Y - 2} ${NUT_X - 9},${BOT_LEFT_Y - 2}`}
            fill="#F5E6CC"
            stroke="#121212"
            strokeWidth="2.2"
          />

          {/* Logarithmic Metallic Fret Wires */}
          {fretNumbers.map((fret) => {
            const x = fretWireX(fret);
            const y1 = neckTopY(x) + 4;
            const y2 = neckBotY(x) - 4;
            return (
              <line
                key={`fw-${fret}`}
                x1={x}
                y1={y1}
                x2={x}
                y2={y2}
                stroke="url(#riso-fretwire-v7)"
                strokeWidth={fret === 12 ? 3.8 : 2.5}
              />
            );
          })}

          {/* Warm Bone Pearloid Dot Inlays (3, 5, 7, 9, 12 double, 15, 17) */}
          {INLAY_FRETS.map((fret) => {
            const cx = fretCenterX(fret);
            const top = neckTopY(cx);
            const bot = neckBotY(cx);
            const mid = (top + bot) * 0.5;
            if (fret === 12) {
              return (
                <g key={`inlay-${fret}`}>
                  <circle cx={cx} cy={top + (bot - top) * 0.30} r="6.5" fill="#F5E6CC" opacity="0.82" />
                  <circle cx={cx} cy={top + (bot - top) * 0.70} r="6.5" fill="#F5E6CC" opacity="0.82" />
                </g>
              );
            }
            return (
              <circle
                key={`inlay-${fret}`}
                cx={cx}
                cy={mid}
                r="6.5"
                fill="#F5E6CC"
                opacity="0.8"
              />
            );
          })}

          {/* 6 Perspective Guitar Strings (Active String Glows #D8FF2E; Zero Unprompted Pink Bleed Lasers!) */}
          {STRING_META.map((s) => {
            const yL = stringYAtX(s.num, NUT_X - 8);
            const yR = stringYAtX(s.num, END_X);
            const isActiveStr = activeNote?.stringNum === s.num;
            const isBleedStr = bleedStringNum === s.num;
            const strokeColor = isBleedStr
              ? '#FF3B7F'
              : isActiveStr
                ? '#D8FF2E'
                : s.num >= 4
                  ? '#C7B69B'
                  : '#EAE2D3';
            return (
              <g key={`str-${s.num}`}>
                {isActiveStr && (
                  <line
                    x1={NUT_X - 8}
                    y1={yL}
                    x2={END_X}
                    y2={yR}
                    stroke="#D8FF2E"
                    strokeWidth={s.gauge + 6}
                    opacity="0.22"
                  />
                )}
                <line
                  x1={NUT_X - 8}
                  y1={yL}
                  x2={END_X}
                  y2={yR}
                  stroke={strokeColor}
                  strokeWidth={isActiveStr || isBleedStr ? s.gauge + 1.1 : s.gauge}
                  opacity={isActiveStr || isBleedStr ? 1 : 0.62}
                />
                {/* Left String Tuning Tag Pill */}
                <g transform={`translate(24, ${yL - 12})`}>
                  <rect
                    width="46"
                    height="24"
                    rx="7"
                    fill={isBleedStr ? '#FF3B7F' : isActiveStr ? '#D8FF2E' : '#FFFBF0'}
                    stroke="#121212"
                    strokeWidth="2"
                  />
                  <text
                    x="23"
                    y="16"
                    textAnchor="middle"
                    fontFamily="Space Mono, monospace"
                    fontWeight="700"
                    fontSize="11.5"
                    fill={isBleedStr ? '#FFFFFF' : '#121212'}
                  >
                    {s.label}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Curved Cobalt Blue Spring-Vector Sightline Arc (Current -> Next Target) */}
          {vectorArcPath && (
            <g>
              <path
                d={vectorArcPath}
                fill="none"
                stroke="#121212"
                strokeWidth="7.5"
                strokeLinecap="round"
                opacity="0.6"
              />
              <path
                d={vectorArcPath}
                fill="none"
                stroke="#2B59FF"
                strokeWidth="4.2"
                strokeDasharray="9 6"
                strokeLinecap="round"
              />
            </g>
          )}

          {/* Next Target Dot (Strict 2-Dot Focus: Clean White/Cobalt Ring) */}
          {nextPoint && nextNote && (
            <g transform={`translate(${nextPoint.x}, ${nextPoint.y})`}>
              <circle r="21" fill="#2B59FF" opacity="0.24" />
              <circle
                r="16.5"
                fill="#FFFFFF"
                stroke="#2B59FF"
                strokeWidth="3.5"
              />
              <text
                y="5"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="800"
                fontSize="14"
                fill="#121212"
              >
                {nextNote.fret}
              </text>
              <text
                y="34"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="700"
                fontSize="10.5"
                fill="#FFFFFF"
                opacity="0.88"
              >
                NEXT
              </text>
            </g>
          )}

          {/* Active Target Dot (#D8FF2E Acid Lime Double-Ring Focus) */}
          {activePoint && activeNote && (
            <g transform={`translate(${activePoint.x}, ${activePoint.y})`}>
              <circle r="30" fill="#D8FF2E" opacity="0.2" />
              <circle
                r="24"
                fill="none"
                stroke="#D8FF2E"
                strokeWidth="2.8"
                strokeDasharray="5 3.5"
              />
              <circle
                r="18.5"
                fill="#D8FF2E"
                stroke="#121212"
                strokeWidth="3.2"
              />
              <text
                y="5.5"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="800"
                fontSize="15.5"
                fill="#121212"
              >
                {activeNote.fret}
              </text>
              <g transform="translate(-24, -44)">
                <rect width="48" height="20" rx="6" fill="#121212" />
                <text
                  x="24"
                  y="13.5"
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="700"
                  fontSize="10.5"
                  fill="#D8FF2E"
                >
                  {activeNote.label}
                </text>
              </g>
            </g>
          )}

          {/* Live Acoustic Bleed Pill ONLY when real bleed occurs */}
          {bleedStringNum != null && (
            <g transform={`translate(${fretCenterX(3)}, ${stringYAtX(bleedStringNum, fretCenterX(3))})`}>
              <rect
                x="-44"
                y="-13"
                width="88"
                height="26"
                rx="13"
                fill="#FF3B7F"
                stroke="#121212"
                strokeWidth="2.2"
              />
              <text
                y="4"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="700"
                fontSize="10.5"
                fill="#FFFFFF"
              >
                × MUTE {STRING_META[bleedStringNum - 1]?.label}
              </text>
            </g>
          )}

          {/* Fret Scale Numbers Along Bottom Edge */}
          {fretNumbers.map((fret) => {
            const cx = fretCenterX(fret);
            const isInlay = (INLAY_FRETS as readonly number[]).includes(fret);
            const isActiveFret = activeNote?.fret === fret;
            return (
              <text
                key={`fnum-${fret}`}
                x={cx}
                y={VB_H - 18}
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight={isActiveFret || isInlay ? '800' : '700'}
                fontSize={isActiveFret ? '14.5' : '12.5'}
                fill={isActiveFret ? '#2B59FF' : isInlay ? '#121212' : '#6E695F'}
              >
                {fret}
                {fret === 12 ? '••' : isInlay ? '•' : ''}
              </text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
