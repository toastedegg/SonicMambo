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

// Coupled Two-System Grand Guitar Score Geometry (§2.3 & §2.6 — Copperplate Rhythm Engraving)
const SVG_W = 1280;
const SVG_H = 448;
const SYSTEM_LEFT = 24;
const MARGIN_LEFT = 114;
const MARGIN_RIGHT = 32;
const SCORE_W = SVG_W - MARGIN_LEFT - MARGIN_RIGHT;

// Top System: 5-Line Engraved Treble Staff (112, 128, 144, 160, 176)
const STAFF_TOP = 112;
const STAFF_GAP = 16;
const STAFF_BOTTOM = STAFF_TOP + STAFF_GAP * 4;

// Bottom System: Standard 6-Line Guitar TAB (e, B, G, D, A, E -> 252, 272, 292, 312, 332, 352)
const TAB_TOP = 252;
const TAB_GAP = 20;
const TAB_BOTTOM = TAB_TOP + TAB_GAP * 5;
const TAB_STEM_TOP = TAB_BOTTOM + 13;
const TAB_STEM_BOTTOM = TAB_BOTTOM + 35;
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

type NoteDurationKind = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

interface RhythmSpec {
  kind: NoteDurationKind;
  hollow: boolean;
  hasStem: boolean;
  beamCount: 0 | 1 | 2;
  dotted: boolean;
}

interface LaidOutScoreNote {
  note: CourseTabNote;
  midi: number;
  isSharp: boolean;
  x: number;
  staffY: number;
  tabY: number;
  rhythm: RhythmSpec;
}

interface StemAssignment {
  stemDown: boolean;
  stemX: number;
  tipY: number;
  beamed: boolean;
}

interface SlantedBeamSegment {
  key: string;
  points: string;
  fill: string;
  opacity: number;
}

interface TabBeamSegment {
  key: string;
  x1: number;
  x2: number;
  y: number;
  height: number;
  fill: string;
  opacity: number;
}

/**
 * Maps `durationBeats` (in quarter-note beats) to authentic standard notation
 * notehead, stem, beam/flag count, and augmentation-dot attributes.
 */
function classifyNoteRhythm(durationBeats: number): RhythmSpec {
  if (durationBeats >= 3.75) {
    return { kind: 'whole', hollow: true, hasStem: false, beamCount: 0, dotted: false };
  }
  if (durationBeats >= 2.75) {
    return { kind: 'half', hollow: true, hasStem: true, beamCount: 0, dotted: true };
  }
  if (durationBeats >= 1.85) {
    return {
      kind: 'half',
      hollow: true,
      hasStem: true,
      beamCount: 0,
      dotted: durationBeats >= 2.35,
    };
  }
  if (durationBeats >= 1.38) {
    return { kind: 'quarter', hollow: false, hasStem: true, beamCount: 0, dotted: true };
  }
  if (durationBeats >= 0.86) {
    return { kind: 'quarter', hollow: false, hasStem: true, beamCount: 0, dotted: false };
  }
  if (durationBeats >= 0.68) {
    return { kind: 'eighth', hollow: false, hasStem: true, beamCount: 1, dotted: true };
  }
  if (durationBeats >= 0.36) {
    return { kind: 'eighth', hollow: false, hasStem: true, beamCount: 1, dotted: false };
  }
  return { kind: 'sixteenth', hollow: false, hasStem: true, beamCount: 2, dotted: false };
}

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
  return Math.max(72, Math.min(212, y));
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

/**
 * Engraved calligraphic S-curve flag for standalone (unbeamed) 8th / 16th notes.
 */
function buildMusicalFlagPath(
  stemX: number,
  tipY: number,
  stemDown: boolean,
  flagIndex: number,
): string {
  if (!stemDown) {
    const y0 = tipY + flagIndex * 7.5;
    return [
      `M ${stemX.toFixed(1)} ${y0.toFixed(1)}`,
      `C ${(stemX + 6).toFixed(1)} ${(y0 + 3.5).toFixed(1)}, ${(stemX + 12.5).toFixed(1)} ${(y0 + 9.5).toFixed(1)}, ${(stemX + 9.2).toFixed(1)} ${(y0 + 18.5).toFixed(1)}`,
      `C ${(stemX + 10.6).toFixed(1)} ${(y0 + 11.5).toFixed(1)}, ${(stemX + 5.2).toFixed(1)} ${(y0 + 6.8).toFixed(1)}, ${stemX.toFixed(1)} ${(y0 + 4.4).toFixed(1)}`,
      'Z',
    ].join(' ');
  }
  const y0 = tipY - flagIndex * 7.5;
  return [
    `M ${stemX.toFixed(1)} ${y0.toFixed(1)}`,
    `C ${(stemX + 6).toFixed(1)} ${(y0 - 3.5).toFixed(1)}, ${(stemX + 12.5).toFixed(1)} ${(y0 - 9.5).toFixed(1)}, ${(stemX + 9.2).toFixed(1)} ${(y0 - 18.5).toFixed(1)}`,
    `C ${(stemX + 10.6).toFixed(1)} ${(y0 - 11.5).toFixed(1)}, ${(stemX + 5.2).toFixed(1)} ${(y0 - 6.8).toFixed(1)}, ${stemX.toFixed(1)} ${(y0 - 4.4).toFixed(1)}`,
    'Z',
  ].join(' ');
}

function makeBeamPolygon(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  inwardThickness: number,
): string {
  return `${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${x2.toFixed(2)},${(y2 + inwardThickness).toFixed(2)} ${x1.toFixed(2)},${(y1 + inwardThickness).toFixed(2)}`;
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
    const padL = 28;
    const padR = 22;
    const usable = Math.max(40, barWidth - padL - padR);
    return (
      MARGIN_LEFT +
      barIdx * barWidth +
      padL +
      (beatInBar / Math.max(1, course.beatsPerBar)) * usable
    );
  };

  const laidOutNotes: ReadonlyArray<LaidOutScoreNote> = useMemo(() => {
    return course.notes
      .filter((n) => n.bar >= windowStartBar && n.bar <= windowEndBar)
      .map((n) => {
        const midi = noteLabelToMidi(n.label) ?? 64;
        const { isSharp } = midiToDiatonic(midi);
        const x = beatToX(n.startBeat);
        const staffY = midiToStaffY(midi);
        const tabY = stringToTabY(n.stringNum);
        const rhythm = classifyNoteRhythm(n.durationBeats);
        return { note: n, midi, isSharp, x, staffY, tabY, rhythm };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.notes, course.beatsPerBar, windowStartBar, windowEndBar, visibleBarCount]);

  const contourPath = useMemo(
    () => buildSmoothContourPath(laidOutNotes.map((item) => ({ x: item.x, y: item.staffY }))),
    [laidOutNotes],
  );

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

  // Vanishing ink opacity tiers (Pass 1..4) — bypassed in forensic review mode
  const effectivePass: VanishPass = forensicMode ? 1 : vanishPass;
  const getInkOpacity = (note: CourseTabNote, isActive: boolean): number => {
    if (forensicMode || isActive) return 1;
    if (effectivePass === 1) return 1;
    if (effectivePass === 2) return note.isAnchor ? 0.92 : 0.45;
    if (effectivePass === 3) return note.isAnchor ? 0.48 : 0.14;
    return 0.05;
  };

  /**
   * Measure- and half-bar-aware 8th / 16th beam grouping for BOTH the 5-Line Treble Staff
   * and the Guitar-Pro-style rhythm rail underneath the 6-Line TAB.
   */
  const rhythmLayout = useMemo(() => {
    const stemsById: Record<string, StemAssignment> = {};
    const staffBeams: SlantedBeamSegment[] = [];
    const tabBeams: TabBeamSegment[] = [];

    const halfBarSize = course.beatsPerBar === 4 ? 2 : 1;
    const canBeamTogether = (a: LaidOutScoreNote, b: LaidOutScoreNote): boolean => {
      if (a.rhythm.beamCount < 1 || b.rhythm.beamCount < 1) return false;
      if (a.note.bar !== b.note.bar) return false;
      const groupA = Math.floor((a.note.beatInBar + 0.001) / halfBarSize);
      const groupB = Math.floor((b.note.beatInBar + 0.001) / halfBarSize);
      if (groupA !== groupB) return false;
      const endA = a.note.startBeat + a.note.durationBeats;
      return Math.abs(b.note.startBeat - endA) <= 0.22;
    };

    let idx = 0;
    while (idx < laidOutNotes.length) {
      const first = laidOutNotes[idx];
      if (first.rhythm.beamCount >= 1) {
        const group: LaidOutScoreNote[] = [first];
        while (
          idx + 1 < laidOutNotes.length &&
          canBeamTogether(group[group.length - 1], laidOutNotes[idx + 1]) &&
          group.length < 4
        ) {
          idx += 1;
          group.push(laidOutNotes[idx]);
        }

        if (group.length >= 2) {
          const avgStaffY =
            group.reduce((sum, n) => sum + n.staffY, 0) / group.length;
          const stemDown = avgStaffY <= STAFF_TOP + STAFF_GAP * 2;
          const stemOffset = stemDown ? -6.3 : 6.3;

          const firstX = group[0].x + stemOffset;
          const lastX = group[group.length - 1].x + stemOffset;
          const spanX = Math.max(1, lastX - firstX);

          const idealFirstY = stemDown ? group[0].staffY + 34 : group[0].staffY - 34;
          const rawDeltaY = group[group.length - 1].staffY - group[0].staffY;
          const clampedDeltaY = Math.max(-11, Math.min(11, rawDeltaY * 0.45));
          let y1 = idealFirstY;
          let y2 = idealFirstY + clampedDeltaY;

          // Guarantee >= 27px stem clearance on every intermediate notehead in the group
          for (const member of group) {
            const mx = member.x + stemOffset;
            const t = (mx - firstX) / spanX;
            const beamY = y1 + (y2 - y1) * t;
            if (stemDown) {
              const needed = member.staffY + 27 - beamY;
              if (needed > 0) {
                y1 += needed;
                y2 += needed;
              }
            } else {
              const needed = beamY - (member.staffY - 27);
              if (needed > 0) {
                y1 -= needed;
                y2 -= needed;
              }
            }
          }

          const beamYAt = (sx: number): number =>
            y1 + (y2 - y1) * ((sx - firstX) / spanX);

          const groupOpacity = Math.max(
            ...group.map((m) =>
              getInkOpacity(m.note, !forensicMode && effectiveActiveId === m.note.id),
            ),
          );

          const allGroupHit = group.every((m) => {
            const isAct = !forensicMode && effectiveActiveId === m.note.id;
            if (isAct) return false;
            if (noteStatusRef.current[m.note.id] === 'hit') return true;
            if (forensicMode) return true;
            return demoMode && runState === 'idle' && m.note.startBeat < demoPlayheadBeat;
          });
          const groupFill = allGroupHit ? '#0D9F6E' : '#121212';

          const inwardPrimary = stemDown ? -4.1 : 4.1;
          staffBeams.push({
            key: `sb1-${group[0].note.id}`,
            points: makeBeamPolygon(firstX, y1, lastX, y2, inwardPrimary),
            fill: groupFill,
            opacity: groupOpacity,
          });

          tabBeams.push({
            key: `tb1-${group[0].note.id}`,
            x1: group[0].x,
            x2: group[group.length - 1].x,
            y: TAB_STEM_BOTTOM - 3.6,
            height: 3.6,
            fill: groupFill,
            opacity: groupOpacity,
          });

          // Secondary 16th beams (full span between adjacent 16ths, or fractional 16th hook)
          const secondOffset = stemDown ? -6.8 : 6.8;
          const inwardSecondary = stemDown ? -3.5 : 3.5;

          for (let g = 0; g < group.length; g += 1) {
            const cur = group[g];
            const sx = cur.x + stemOffset;
            stemsById[cur.note.id] = {
              stemDown,
              stemX: sx,
              tipY: beamYAt(sx),
              beamed: true,
            };

            if (cur.rhythm.beamCount >= 2) {
              const next = group[g + 1];
              const prev = group[g - 1];
              if (next && next.rhythm.beamCount >= 2) {
                const nx = next.x + stemOffset;
                staffBeams.push({
                  key: `sb2-${cur.note.id}-${next.note.id}`,
                  points: makeBeamPolygon(
                    sx,
                    beamYAt(sx) + secondOffset,
                    nx,
                    beamYAt(nx) + secondOffset,
                    inwardSecondary,
                  ),
                  fill: groupFill,
                  opacity: groupOpacity,
                });
                tabBeams.push({
                  key: `tb2-${cur.note.id}-${next.note.id}`,
                  x1: cur.x,
                  x2: next.x,
                  y: TAB_STEM_BOTTOM - 9.4,
                  height: 3.1,
                  fill: groupFill,
                  opacity: groupOpacity,
                });
              } else if (!prev || prev.rhythm.beamCount < 2) {
                // Fractional 16th stub pointing inward toward neighbor (e.g. dotted-8th + 16th)
                const stubDir = g === group.length - 1 ? -1 : 1;
                const stubX = sx + stubDir * 11;
                const xStart = Math.min(sx, stubX);
                const xEnd = Math.max(sx, stubX);
                staffBeams.push({
                  key: `sb2-stub-${cur.note.id}`,
                  points: makeBeamPolygon(
                    xStart,
                    beamYAt(xStart) + secondOffset,
                    xEnd,
                    beamYAt(xEnd) + secondOffset,
                    inwardSecondary,
                  ),
                  fill: groupFill,
                  opacity: groupOpacity,
                });
                const tabStubX1 = Math.min(cur.x, cur.x + stubDir * 11);
                const tabStubX2 = Math.max(cur.x, cur.x + stubDir * 11);
                tabBeams.push({
                  key: `tb2-stub-${cur.note.id}`,
                  x1: tabStubX1,
                  x2: tabStubX2,
                  y: TAB_STEM_BOTTOM - 9.4,
                  height: 3.1,
                  fill: groupFill,
                  opacity: groupOpacity,
                });
              }
            }
          }

          idx += 1;
          continue;
        }
      }

      // Unbeamed standalone note (whole, half, quarter, or isolated 8th/16th)
      const stemDown = first.staffY <= STAFF_TOP + STAFF_GAP * 2;
      const stemX = stemDown ? first.x - 6.3 : first.x + 6.3;
      const tipY = stemDown ? first.staffY + 34 : first.staffY - 34;
      stemsById[first.note.id] = {
        stemDown,
        stemX,
        tipY,
        beamed: false,
      };
      idx += 1;
    }

    return { stemsById, staffBeams, tabBeams };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.beatsPerBar, effectiveActiveId, effectivePass, forensicMode, laidOutNotes]);

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
      {/* Subtle Top Controls Bar ONLY when needed (Window Switcher / Vanishing Pass / Forensic Legend) */}
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
                COUPLED TREBLE STAFF + 6-LINE RHYTHM TAB ({course.beatsPerBar}/4)
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
          aria-label="Coupled 5-line treble staff and 6-line guitar rhythm TAB"
        >
          {/* Coupled Left Grand-System Brace connecting Staff + TAB */}
          <line
            x1={SYSTEM_LEFT}
            y1={STAFF_TOP}
            x2={SYSTEM_LEFT}
            y2={TAB_BOTTOM}
            stroke="#121212"
            strokeWidth="2.5"
          />

          {/* Measure Columns, Beat Subdivision Ticks, Clickable BAR 01..04 Chord Headers, and Shared Barlines */}
          {Array.from({ length: visibleBarCount }, (_, idx) => {
            const barNum = windowStartBar + idx;
            const bx = MARGIN_LEFT + idx * barWidth;
            const barStartBeat = (barNum - 1) * course.beatsPerBar;
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
                    y={50}
                    width={barWidth}
                    height={TAB_STEM_BOTTOM - 40}
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
                  strokeWidth={idx === 0 ? 1.8 : 1.15}
                  opacity={idx === 0 ? 0.85 : 0.45}
                />
                <line
                  x1={bx}
                  y1={TAB_TOP}
                  x2={bx}
                  y2={TAB_BOTTOM}
                  stroke="#121212"
                  strokeWidth={idx === 0 ? 1.8 : 1.15}
                  opacity={idx === 0 ? 0.85 : 0.45}
                />
                {/* Faint Vertical Guide Connecting Staff & TAB Measure Start */}
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

                {/* Subtle Beat Count Ticks (1 · 2 · 3 · 4) between Staff and TAB */}
                {Array.from({ length: course.beatsPerBar }, (__, beatIdx) => {
                  const beatX = beatToX(barStartBeat + beatIdx);
                  return (
                    <g key={`bt-${barNum}-${beatIdx}`} opacity="0.34">
                      <line
                        x1={beatX}
                        y1={TAB_TOP - 14}
                        x2={beatX}
                        y2={TAB_TOP - 8}
                        stroke="#57534A"
                        strokeWidth="1"
                      />
                      <text
                        x={beatX}
                        y={TAB_TOP - 17}
                        textAnchor="middle"
                        fontFamily="Space Mono, monospace"
                        fontWeight="700"
                        fontSize="8.5"
                        fill="#57534A"
                      >
                        {beatIdx + 1}
                      </text>
                    </g>
                  );
                })}

                {/* Clickable Engraved Bar & Chord Heading (Printed ONCE per bar!) */}
                <g
                  className="cursor-pointer"
                  onClick={() => onSelectBar?.(barNum)}
                  role="button"
                  tabIndex={0}
                >
                  <rect
                    x={bx + 8}
                    y={12}
                    width={136}
                    height={28}
                    rx="6"
                    fill="transparent"
                  />
                  <text
                    x={bx + 12}
                    y={30}
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
                    y={31}
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
                x1={SYSTEM_LEFT}
                y1={y}
                x2={SVG_W - MARGIN_RIGHT}
                y2={y}
                stroke="#121212"
                strokeWidth="1.15"
                opacity="0.48"
              />
            );
          })}

          {/* Treble Clef Glyph ON Staff */}
          <text
            x={SYSTEM_LEFT + 8}
            y={STAFF_BOTTOM - 2}
            fontSize="70"
            fontFamily="Georgia, serif"
            fill="#121212"
            opacity="0.9"
          >
            𝄞
          </text>

          {/* Engraved Stacked Time Signature (e.g. 4 / 4) on Treble Staff */}
          <g
            fontFamily="Georgia, serif"
            fontWeight="700"
            fontSize="31"
            fill="#121212"
            opacity="0.9"
            textAnchor="middle"
          >
            <text x={SYSTEM_LEFT + 66} y={STAFF_TOP + STAFF_GAP + 10.5}>
              {course.beatsPerBar}
            </text>
            <text x={SYSTEM_LEFT + 66} y={STAFF_TOP + STAFF_GAP * 3 + 10.5}>
              4
            </text>
          </g>

          {/* Subtle Cobalt Melodic Contour Horizon Arc */}
          {contourPath && (
            <path
              d={contourPath}
              fill="none"
              stroke="#2B59FF"
              strokeWidth={effectivePass === 3 ? 2.4 : 1.75}
              strokeLinecap="round"
              opacity={forensicMode ? 0.28 : effectivePass === 4 ? 0.08 : 0.4}
            />
          )}

          {/* ── BOTTOM SYSTEM: STANDARD 6-LINE GUITAR TAB (e B G D A E) ── */}
          {TAB_STRINGS.map((strLabel, idx) => {
            const y = TAB_TOP + idx * TAB_GAP;
            return (
              <g key={`tab-line-${strLabel}`}>
                <line
                  x1={SYSTEM_LEFT}
                  y1={y}
                  x2={SVG_W - MARGIN_RIGHT}
                  y2={y}
                  stroke="#121212"
                  strokeWidth={idx >= 3 ? 1.25 : 1.0}
                  opacity="0.38"
                />
                <rect
                  x={SYSTEM_LEFT + 57}
                  y={y - 7}
                  width="14"
                  height="14"
                  rx="2"
                  fill="#FFFBF0"
                />
                <text
                  x={SYSTEM_LEFT + 64}
                  y={y + 4}
                  textAnchor="middle"
                  fontFamily="Space Mono, monospace"
                  fontWeight="700"
                  fontSize="11"
                  fill="#57534A"
                >
                  {strLabel}
                </text>
              </g>
            );
          })}

          {/* Vertical T-A-B Clef ON TAB Staff */}
          <g fontFamily="Syne, sans-serif" fontWeight="800" fontSize="14" fill="#121212" opacity="0.86">
            <rect x={SYSTEM_LEFT + 12} y={TAB_TOP + 8} width="22" height="84" rx="3" fill="#FFFBF0" />
            <text x={SYSTEM_LEFT + 23} y={TAB_TOP + 24} textAnchor="middle">T</text>
            <text x={SYSTEM_LEFT + 23} y={TAB_TOP + 55} textAnchor="middle">A</text>
            <text x={SYSTEM_LEFT + 23} y={TAB_TOP + 86} textAnchor="middle">B</text>
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

          {/* ── SLANTED 8TH / 16TH STAFF BEAM BARS & GUITAR-PRO TAB RHYTHM BEAMS ── */}
          {rhythmLayout.staffBeams.map((seg) => (
            <polygon
              key={seg.key}
              points={seg.points}
              fill={seg.fill}
              opacity={seg.opacity}
            />
          ))}
          {rhythmLayout.tabBeams.map((tb) => (
            <rect
              key={tb.key}
              x={tb.x1 - 0.6}
              y={tb.y}
              width={Math.max(2, tb.x2 - tb.x1 + 1.2)}
              height={tb.height}
              rx="0.8"
              fill={tb.fill}
              opacity={tb.opacity * 0.85}
            />
          ))}

          {/* ── COUPLED CLASSICAL STAFF RHYTHM NOTEHEADS + TAB FRETS & RHYTHM STEMS ── */}
          {laidOutNotes.map((item, idx) => {
            const { note, isSharp, x, staffY, tabY, rhythm } = item;
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
            const stem = rhythmLayout.stemsById[note.id];
            const stemDown = stem ? stem.stemDown : staffY <= STAFF_TOP + STAFF_GAP * 2;
            const stemX = stem ? stem.stemX : stemDown ? x - 6.3 : x + 6.3;
            const stemY2 = stem ? stem.tipY : stemDown ? staffY + 34 : staffY - 34;

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

            // Shift augmentation dot into adjacent space if notehead sits directly on a staff line
            const onStaffLine = Math.abs(((staffY - STAFF_TOP) % STAFF_GAP + STAFF_GAP) % STAFF_GAP) < 1.5;
            const staffDotY = onStaffLine ? staffY - 4.2 : staffY;

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

                {/* Classical Articulation Marks */}
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

                {note.tech === 'vibrato' && (
                  <path
                    d={buildVibratoWavePath(x + 10, staffY - 16, Math.max(36, note.durationBeats * 46))}
                    fill="none"
                    stroke="#121212"
                    strokeWidth="1.3"
                    opacity="0.62"
                  />
                )}

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

                {/* Staff Stem (omitted on Whole notes) */}
                {rhythm.hasStem && (
                  <line
                    x1={stemX}
                    y1={staffY}
                    x2={stemX}
                    y2={stemY2}
                    stroke={noteheadFill}
                    strokeWidth="1.35"
                  />
                )}

                {/* Standalone 8th / 16th Calligraphic Flags (when not part of a beam group) */}
                {rhythm.hasStem && !stem?.beamed && rhythm.beamCount >= 1 && (
                  <>
                    <path
                      d={buildMusicalFlagPath(stemX, stemY2, stemDown, 0)}
                      fill={noteheadFill}
                    />
                    {rhythm.beamCount >= 2 && (
                      <path
                        d={buildMusicalFlagPath(stemX, stemY2, stemDown, 1)}
                        fill={noteheadFill}
                      />
                    )}
                  </>
                )}

                {/* Engraved Notehead: Whole vs Hollow Half vs Solid Quarter/8th/16th */}
                {rhythm.kind === 'whole' ? (
                  <g>
                    <ellipse cx={x} cy={staffY} rx="8.2" ry="5.3" fill={noteheadFill} />
                    <ellipse
                      cx={x}
                      cy={staffY}
                      rx="4.5"
                      ry="3.3"
                      transform={`rotate(-22 ${x} ${staffY})`}
                      fill={state === 'active' ? '#D8FF2E' : '#FFFBF0'}
                    />
                  </g>
                ) : rhythm.hollow ? (
                  <g>
                    <ellipse
                      cx={x}
                      cy={staffY}
                      rx="7.2"
                      ry="5.2"
                      transform={`rotate(-18 ${x} ${staffY})`}
                      fill={noteheadFill}
                    />
                    <ellipse
                      cx={x}
                      cy={staffY}
                      rx="5.0"
                      ry="2.6"
                      transform={`rotate(-30 ${x} ${staffY})`}
                      fill={state === 'active' ? '#D8FF2E' : '#FFFBF0'}
                    />
                  </g>
                ) : (
                  <ellipse
                    cx={x}
                    cy={staffY}
                    rx="6.8"
                    ry="5"
                    transform={`rotate(-18 ${x} ${staffY})`}
                    fill={noteheadFill}
                  />
                )}

                {/* Augmentation Dot on Staff (`•` for dotted half / dotted quarter / dotted 8th) */}
                {rhythm.dotted && (
                  <circle
                    cx={state === 'active' ? x + 16.5 : x + 12.2}
                    cy={staffDotY}
                    r="2.35"
                    fill={noteheadFill}
                  />
                )}

                {/* ── BOTTOM SYSTEM: FRAMELESS PRINT TAB DIGIT + GUITAR-PRO RHYTHM STEM ── */}
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
                    <rect
                      x={note.fret >= 10 ? x - 7.5 : x - 5.5}
                      y={tabY - 8}
                      width={note.fret >= 10 ? 15 : 11}
                      height={16}
                      rx="2"
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

                {/* Coupled TAB Rhythm Stem / Flag / Dot directly beneath 6th string */}
                {rhythm.kind === 'whole' ? (
                  <circle
                    cx={x}
                    cy={TAB_STEM_BOTTOM - 5}
                    r="3.2"
                    fill="none"
                    stroke={tabDigitFill}
                    strokeWidth="1.5"
                    opacity="0.78"
                  />
                ) : (
                  <g opacity="0.84">
                    {/* Half notes use short lower stem; quarter/8th/16th use full stem */}
                    <line
                      x1={x}
                      y1={rhythm.hollow ? TAB_STEM_TOP + 10 : TAB_STEM_TOP}
                      x2={x}
                      y2={TAB_STEM_BOTTOM}
                      stroke={tabDigitFill}
                      strokeWidth="1.35"
                    />
                    {/* Standalone TAB flag(s) when not beamed */}
                    {!stem?.beamed && rhythm.beamCount >= 1 && (
                      <>
                        <line
                          x1={x}
                          y1={TAB_STEM_BOTTOM - 1.5}
                          x2={x + 8.5}
                          y2={TAB_STEM_BOTTOM - 5.5}
                          stroke={tabDigitFill}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        {rhythm.beamCount >= 2 && (
                          <line
                            x1={x}
                            y1={TAB_STEM_BOTTOM - 7}
                            x2={x + 8.5}
                            y2={TAB_STEM_BOTTOM - 11}
                            stroke={tabDigitFill}
                            strokeWidth="2.3"
                            strokeLinecap="round"
                          />
                        )}
                      </>
                    )}
                    {/* Augmentation dot on TAB rhythm stem */}
                    {rhythm.dotted && (
                      <circle
                        cx={x + 5.5}
                        cy={TAB_STEM_BOTTOM - (rhythm.beamCount >= 1 ? 13 : 6)}
                        r="2.0"
                        fill={tabDigitFill}
                      />
                    )}
                  </g>
                )}
              </g>
            );
          })}

          {/* ── FORENSIC 3 DELICATE 1PX HAIRLINE PIN CALLOUTS (Screen 03) ── */}
          {forensicData &&
            forensicData.pins.map((pin) => {
              const boxW = pin.label.length * 6.9 + 20;
              const boxY = 52;
              const boxX = Math.max(
                MARGIN_LEFT + 6,
                Math.min(SVG_W - MARGIN_RIGHT - boxW - 6, pin.x - boxW / 2),
              );
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

          {/* ── SINGLE #FF3B7F 1.75PX VERTICAL PLAYHEAD SPANNING BOTH STAFF & TAB ── */}
          {!forensicMode && (
            <g ref={playheadGroupRef} style={{ willChange: 'transform' }}>
              <line
                x1="0"
                y1={54}
                x2="0"
                y2={TAB_STEM_BOTTOM + 6}
                stroke="#FF3B7F"
                strokeWidth="1.75"
              />
              <polygon points="-5,52 5,52 0,60" fill="#FF3B7F" />
              <circle cx="0" cy={TAB_STEM_BOTTOM + 6} r="3.5" fill="#FF3B7F" />
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}
