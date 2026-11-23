import { useMemo } from 'react';
import type { CourseTabNote, GuitarCourse } from '../data/guitarCourses';

export interface RisoPerspectiveNeckProps {
  course: GuitarCourse;
  activeNote: CourseTabNote | null;
  nextNote: CourseTabNote | null;
  upcomingNotes: readonly CourseTabNote[];
  /** Optional bleeding neighbor string (1..6) for direct-on-string bleed indicator */
  bleedStringNum?: 1 | 2 | 3 | 4 | 5 | 6 | null;
}

const STRING_LABELS = ['e4', 'B3', 'G3', 'D3', 'A2', 'E2'] as const;
const STRING_GAUGES = [1.15, 1.45, 1.75, 2.15, 2.6, 3.1] as const;
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17] as const;
const MAX_FRET = 17;

// 1:1 Tapered 3D Perspective Guitar Neck Geometry (extracted from branch 05, re-inked for Risograph)
const VB_W = 1280;
const VB_H = 248;
const NUT_X = 88;
const END_X = 1236;
const TOP_LEFT_Y = 38;
const BOT_LEFT_Y = 186;
const TOP_RIGHT_Y = 22;
const BOT_RIGHT_Y = 204;

/** Acoustic 22-fret logarithmic fret-wire spacing across Frets 0..17 */
function fretWireX(fret: number): number {
  if (fret <= 0) return NUT_X;
  const maxRatio = 1 - Math.pow(2, -MAX_FRET / 22);
  const ratio = (1 - Math.pow(2, -fret / 22)) / maxRatio;
  return NUT_X + ratio * (END_X - NUT_X);
}

/** Center X for placing a note node on fret 0..17 */
function fretCenterX(fret: number): number {
  if (fret <= 0) return NUT_X - 22;
  const clamped = Math.min(MAX_FRET, fret);
  return (fretWireX(clamped - 1) + fretWireX(clamped)) * 0.5;
}

function neckTopY(x: number): number {
  const t = Math.max(0, Math.min(1, (x - NUT_X) / (END_X - NUT_X)));
  return TOP_LEFT_Y + t * (TOP_RIGHT_Y - TOP_LEFT_Y);
}

function neckBotY(x: number): number {
  const t = Math.max(0, Math.min(1, (x - NUT_X) / (END_X - NUT_X)));
  return BOT_LEFT_Y + t * (BOT_RIGHT_Y - BOT_LEFT_Y);
}

/** Y coordinate for guitar string 1 (high e4, top) .. 6 (low E2, bottom) at horizontal position x */
function stringY(stringNum: 1 | 2 | 3 | 4 | 5 | 6, x: number): number {
  const top = neckTopY(x) + 15;
  const bot = neckBotY(x) - 15;
  const ratio = (stringNum - 1) / 5;
  return top + ratio * (bot - top);
}

function shortTech(tech?: string): string | null {
  if (!tech) return null;
  if (tech.includes('vibrato')) return 'VIB';
  if (tech.includes('slide')) return 'SLD';
  if (tech.includes('hammer')) return 'H-ON';
  if (tech.includes('pull')) return 'PULL';
  return null;
}

export function RisoPerspectiveNeck({
  course,
  activeNote,
  nextNote,
  upcomingNotes,
  bleedStringNum = null,
}: RisoPerspectiveNeckProps) {
  const fretNumbers = useMemo(
    () => Array.from({ length: MAX_FRET }, (_, i) => i + 1),
    [],
  );

  // Deduplicated upcoming phrase anchor dots on neck (excluding active & next)
  const ghostPositions = useMemo(() => {
    const seen = new Set<string>();
    if (activeNote) seen.add(`${activeNote.stringNum}:${activeNote.fret}`);
    if (nextNote) seen.add(`${nextNote.stringNum}:${nextNote.fret}`);
    const list: Array<{ stringNum: 1 | 2 | 3 | 4 | 5 | 6; fret: number; key: string }> = [];
    for (const n of upcomingNotes) {
      const k = `${n.stringNum}:${n.fret}`;
      if (!seen.has(k) && n.fret <= MAX_FRET) {
        seen.add(k);
        list.push({ stringNum: n.stringNum, fret: n.fret, key: k });
      }
      if (list.length >= 8) break;
    }
    return list;
  }, [activeNote, nextNote, upcomingNotes]);

  const activeCoords = useMemo(() => {
    if (!activeNote) return null;
    const x = fretCenterX(activeNote.fret);
    const y = stringY(activeNote.stringNum, x);
    return { x, y };
  }, [activeNote]);

  const nextCoords = useMemo(() => {
    if (!nextNote) return null;
    const x = fretCenterX(nextNote.fret);
    const y = stringY(nextNote.stringNum, x);
    return { x, y };
  }, [nextNote]);

  // Curved Spring-Vector Sightline Arc from Active Fret -> Next Target Fret (#2B59FF)
  const springArc = useMemo(() => {
    if (!activeCoords || !nextCoords) return null;
    const dx = nextCoords.x - activeCoords.x;
    const dy = nextCoords.y - activeCoords.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) return null;
    const midX = (activeCoords.x + nextCoords.x) * 0.5;
    const lift = Math.min(54, Math.max(24, dist * 0.24));
    const ctrlY = Math.min(activeCoords.y, nextCoords.y) - lift;
    return {
      d: `M ${activeCoords.x.toFixed(1)} ${activeCoords.y.toFixed(1)} Q ${midX.toFixed(1)} ${ctrlY.toFixed(1)} ${nextCoords.x.toFixed(1)} ${nextCoords.y.toFixed(1)}`,
      labelX: midX,
      labelY: ctrlY + 12,
    };
  }, [activeCoords, nextCoords]);

  const neckPolygon = `${NUT_X},${TOP_LEFT_Y} ${END_X},${TOP_RIGHT_Y} ${END_X},${BOT_RIGHT_Y} ${NUT_X},${BOT_LEFT_Y}`;
  const bindingTop = `${NUT_X},${TOP_LEFT_Y} ${END_X},${TOP_RIGHT_Y} ${END_X},${TOP_RIGHT_Y + 5} ${NUT_X},${TOP_LEFT_Y + 5}`;
  const bindingBot = `${NUT_X},${BOT_LEFT_Y - 5} ${END_X},${BOT_RIGHT_Y - 5} ${END_X},${BOT_RIGHT_Y} ${NUT_X},${BOT_LEFT_Y}`;

  return (
    <section
      className="neo-card bg-[#FFFBF0] overflow-hidden flex flex-col h-full min-h-0"
      aria-label={`3D Perspective Guitar Fretboard for ${course.title}`}
    >
      {/* Compact Header Telemetry Strip (Zero Prose!) */}
      <div className="px-4 py-1.5 bg-[#F4ECDC] border-b-[2.5px] border-[#121212] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="neo-stamp bg-[#231E1B] text-[#F5E6CC]">
            3D NECK &middot; 0–17
          </span>
          {activeNote && (
            <span className="font-mono text-[11px] font-bold text-[#121212]">
              S{activeNote.stringNum} ({STRING_LABELS[activeNote.stringNum - 1]}) &middot; F{activeNote.fret} &middot; {activeNote.label}
            </span>
          )}
          {nextNote && (
            <span className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px] font-bold text-[#2B59FF]">
              <span>&rarr;</span>
              <span>
                F{nextNote.fret} {nextNote.label}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] font-bold">
          <span className="inline-flex items-center gap-1 text-[#121212]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D8FF2E] border-[1.5px] border-[#121212]" />
            NOW
          </span>
          <span className="inline-flex items-center gap-1 text-[#2B59FF]">
            <span className="w-3 h-0.5 bg-[#2B59FF]" />
            NEXT
          </span>
          {bleedStringNum && (
            <span className="neo-stamp bg-[#FF3B7F] text-white">
              MUTE {STRING_LABELS[bleedStringNum - 1]}
            </span>
          )}
        </div>
      </div>

      {/* Tapered Roasted-Rosewood 3D Perspective Guitar Neck SVG */}
      <div className="flex-1 min-h-0 w-full bg-[#FFFBF0] px-2 py-1 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full max-h-full block select-none"
          role="img"
          aria-label="Tapered perspective guitar fretboard"
        >
          <defs>
            <linearGradient id="riso-rosewood" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2D2622" />
              <stop offset="50%" stopColor="#231E1B" />
              <stop offset="100%" stopColor="#1B1715" />
            </linearGradient>
            <marker
              id="riso-vector-arrow"
              viewBox="0 0 10 10"
              refX="7"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2B59FF" />
            </marker>
          </defs>

          {/* Subtle Brutalist Ink Drop Shadow under Neck */}
          <polygon
            points={`${NUT_X + 5},${TOP_LEFT_Y + 6} ${END_X + 5},${TOP_RIGHT_Y + 6} ${END_X + 5},${BOT_RIGHT_Y + 6} ${NUT_X + 5},${BOT_LEFT_Y + 6}`}
            fill="#121212"
            opacity="0.18"
          />

          {/* Main Fingerboard Body */}
          <polygon
            points={neckPolygon}
            fill="url(#riso-rosewood)"
            stroke="#121212"
            strokeWidth="3"
            strokeLinejoin="round"
          />

          {/* Warm Cream-Bone Binding Strips */}
          <polygon points={bindingTop} fill="#F5E6CC" opacity="0.92" />
          <polygon points={bindingBot} fill="#F5E6CC" opacity="0.92" />

          {/* Active Fret Column Subtle Warm Glow */}
          {activeNote && activeNote.fret > 0 && activeNote.fret <= MAX_FRET && (
            <polygon
              points={`${fretWireX(activeNote.fret - 1)},${neckTopY(fretWireX(activeNote.fret - 1)) + 5} ${fretWireX(activeNote.fret)},${neckTopY(fretWireX(activeNote.fret)) + 5} ${fretWireX(activeNote.fret)},${neckBotY(fretWireX(activeNote.fret)) - 5} ${fretWireX(activeNote.fret - 1)},${neckBotY(fretWireX(activeNote.fret - 1)) - 5}`}
              fill="rgba(216,255,46,0.14)"
            />
          )}

          {/* Bone Nut */}
          <rect
            x={NUT_X - 7}
            y={TOP_LEFT_Y - 1}
            width="10"
            height={BOT_LEFT_Y - TOP_LEFT_Y + 2}
            rx="2"
            fill="#F5E6CC"
            stroke="#121212"
            strokeWidth="2.2"
          />

          {/* Metallic Fret Wires (Frets 1..17) */}
          {fretNumbers.map((fret) => {
            const fx = fretWireX(fret);
            const y1 = neckTopY(fx) + 4;
            const y2 = neckBotY(fx) - 4;
            return (
              <g key={`fret-${fret}`}>
                <line
                  x1={fx}
                  y1={y1}
                  x2={fx}
                  y2={y2}
                  stroke="#E8DFCF"
                  strokeWidth={fret === 12 ? 3.2 : 2.1}
                  opacity="0.72"
                />
                <line
                  x1={fx + 1.5}
                  y1={y1}
                  x2={fx + 1.5}
                  y2={y2}
                  stroke="#121212"
                  strokeWidth="1"
                  opacity="0.45"
                />
              </g>
            );
          })}

          {/* Warm Bone Pearloid Inlays (3, 5, 7, 9, 12 double, 15, 17) */}
          {INLAY_FRETS.map((fret) => {
            const cx = fretCenterX(fret);
            const top = neckTopY(cx);
            const bot = neckBotY(cx);
            const mid = (top + bot) * 0.5;
            if (fret === 12) {
              return (
                <g key={`inlay-${fret}`} opacity="0.72">
                  <circle cx={cx} cy={mid - 28} r="5.5" fill="#F5E6CC" stroke="#121212" strokeWidth="1.2" />
                  <circle cx={cx} cy={mid + 28} r="5.5" fill="#F5E6CC" stroke="#121212" strokeWidth="1.2" />
                </g>
              );
            }
            return (
              <circle
                key={`inlay-${fret}`}
                cx={cx}
                cy={mid}
                r="5.5"
                fill="#F5E6CC"
                stroke="#121212"
                strokeWidth="1.2"
                opacity="0.68"
              />
            );
          })}

          {/* 6 Graduated Guitar Strings (Strict Semantic Color: Only Active Lime & Bleed Coral!) */}
          {([1, 2, 3, 4, 5, 6] as const).map((sNum) => {
            const yL = stringY(sNum, NUT_X);
            const yR = stringY(sNum, END_X);
            const isActiveString = activeNote?.stringNum === sNum;
            const isBleeding = bleedStringNum === sNum && !isActiveString;
            const strokeColor = isActiveString
              ? '#D8FF2E'
              : isBleeding
                ? '#FF3B7F'
                : 'rgba(245,230,204,0.52)';
            const gauge = isActiveString
              ? STRING_GAUGES[sNum - 1] + 1.3
              : isBleeding
                ? STRING_GAUGES[sNum - 1] + 1.0
                : STRING_GAUGES[sNum - 1];

            return (
              <g key={`string-${sNum}`} className={isBleeding ? 'riso-bleed-wire' : undefined}>
                {/* String Pitch Label Badge at Nut Left */}
                <rect
                  x={22}
                  y={yL - 10}
                  width="36"
                  height="20"
                  rx="6"
                  fill={isActiveString ? '#D8FF2E' : isBleeding ? '#FF3B7F' : '#F4ECDC'}
                  stroke="#121212"
                  strokeWidth="1.8"
                />
                <text
                  x={40}
                  y={yL + 4}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="800"
                  fontSize="10.5"
                  fill={isBleeding ? '#FFFFFF' : '#121212'}
                >
                  {STRING_LABELS[sNum - 1]}
                </text>

                {/* String Wire */}
                <line
                  x1={NUT_X - 4}
                  y1={yL}
                  x2={END_X}
                  y2={yR}
                  stroke={strokeColor}
                  strokeWidth={gauge}
                />

                {/* Direct-on-String Bleed Indicator (Zero External Radar Table!) */}
                {isBleeding && (
                  <g transform={`translate(${fretCenterX(3) + 12}, ${stringY(sNum, fretCenterX(3))})`}>
                    <rect
                      x="-36"
                      y="-10"
                      width="72"
                      height="20"
                      rx="7"
                      fill="#FF3B7F"
                      stroke="#121212"
                      strokeWidth="1.8"
                    />
                    <text
                      y="3.5"
                      textAnchor="middle"
                      fontFamily="Space Mono, monospace"
                      fontWeight="800"
                      fontSize="9.5"
                      fill="#FFFFFF"
                    >
                      × MUTE {STRING_LABELS[sNum - 1]}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Upcoming Phrase Anchor Dots (Quiet Bone-Cream Hollow Circles) */}
          {ghostPositions.map((pos) => {
            const gx = fretCenterX(pos.fret);
            const gy = stringY(pos.stringNum, gx);
            return (
              <g key={`ghost-${pos.key}`} opacity="0.82">
                <circle
                  cx={gx}
                  cy={gy}
                  r="11"
                  fill="#231E1B"
                  stroke="#F5E6CC"
                  strokeWidth="2"
                />
                <text
                  x={gx}
                  y={gy + 3.5}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="700"
                  fontSize="10"
                  fill="#F5E6CC"
                >
                  {pos.fret}
                </text>
              </g>
            );
          })}

          {/* Curved Dashed #2B59FF Spring-Vector Sightline Arc (Active -> Next Fret) */}
          {springArc && (
            <g>
              <path
                d={springArc.d}
                fill="none"
                stroke="#FFFBF0"
                strokeWidth="5.5"
                strokeLinecap="round"
                opacity="0.7"
              />
              <path
                d={springArc.d}
                fill="none"
                stroke="#2B59FF"
                strokeWidth="3"
                strokeDasharray="7 5"
                strokeLinecap="round"
                markerEnd="url(#riso-vector-arrow)"
              />
              {shortTech(nextNote?.tech) && (
                <g transform={`translate(${springArc.labelX}, ${springArc.labelY - 12})`}>
                  <rect
                    x="-19"
                    y="-9"
                    width="38"
                    height="17"
                    rx="6"
                    fill="#2B59FF"
                    stroke="#121212"
                    strokeWidth="1.6"
                  />
                  <text
                    y="3"
                    textAnchor="middle"
                    fontFamily="Space Mono, monospace"
                    fontWeight="800"
                    fontSize="9"
                    fill="#FFFFFF"
                  >
                    {shortTech(nextNote?.tech)}
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Next Target Fret Node (Crisp White + Cobalt Ring) */}
          {nextNote && nextCoords && (
            <g transform={`translate(${nextCoords.x}, ${nextCoords.y})`}>
              <circle r="15" fill="#FFFFFF" stroke="#2B59FF" strokeWidth="3" />
              <circle r="15" fill="none" stroke="#121212" strokeWidth="1.2" />
              <text
                y="4.5"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="800"
                fontSize="12"
                fill="#121212"
              >
                {nextNote.fret}
              </text>
            </g>
          )}

          {/* Active Target Fret Node (Single Focal Point: #D8FF2E Acid Lime Double-Ring) */}
          {activeNote && activeCoords && (
            <g transform={`translate(${activeCoords.x}, ${activeCoords.y})`}>
              <circle
                r="23"
                fill="none"
                stroke="#D8FF2E"
                strokeWidth="2.5"
                strokeDasharray="4 3"
              />
              <circle cx="2" cy="2" r="17" fill="#121212" />
              <circle
                r="17"
                fill="#D8FF2E"
                stroke="#121212"
                strokeWidth="2.8"
              />
              <text
                y="5"
                textAnchor="middle"
                fontFamily="Space Mono, monospace"
                fontWeight="800"
                fontSize="14"
                fill="#121212"
              >
                {activeNote.fret}
              </text>
            </g>
          )}

          {/* Fret Scale Numbers Along Bottom Edge */}
          {fretNumbers.map((fret) => {
            const cx = fretCenterX(fret);
            const isInlay = (INLAY_FRETS as readonly number[]).includes(fret);
            const isActiveFret = activeNote?.fret === fret;
            return (
              <g key={`fnum-${fret}`}>
                <text
                  x={cx}
                  y={VB_H - 14}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight={isActiveFret || isInlay ? '800' : '700'}
                  fontSize={isActiveFret ? '13' : '11.5'}
                  fill={isActiveFret ? '#2B59FF' : isInlay ? '#121212' : '#6E695F'}
                >
                  {fret}
                  {fret === 12 ? '••' : isInlay ? '•' : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
