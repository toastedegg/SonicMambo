import type { GrooveStyleId } from '../audio/backingTrackEngine.ts';
import type { LessonNoteDefinition } from '../types/lesson.ts';
import { midiToNoteLabel } from '../utils/noteFromFrequency.ts';

export type CoursePracticeMode = 'play' | 'loop' | 'shadow' | 'hidden';

export interface CourseTabNote extends LessonNoteDefinition {
  bar: number; // 1-indexed bar (1..totalBars)
  beatInBar: number; // 0..beatsPerBar
  stringNum: 1 | 2 | 3 | 4 | 5 | 6; // 1 = high e4, 6 = low E2
  fret: number;
  isAnchor: boolean;
  tech?: string;
}

export interface CourseChapterTheme {
  id: 'midnight-blues' | 'marshall-rock' | 'sunburst-mastery';
  chapterNumber: number;
  title: string;
  subtitle: string;
  accentHex: string;
  secondaryHex: string;
  glowRgba: string;
  badgeBg: string;
}

export interface GuitarCourse {
  id: string;
  order: number; // 1..N sequential unlock order
  chapterId: CourseChapterTheme['id'];
  title: string;
  subtitle: string;
  styleLabel: string;
  keySignature: string;
  tempoBpm: number;
  beatsPerBar: number;
  totalBars: number;
  defaultGroove: GrooveStyleId;
  barChords: readonly string[]; // length === totalBars
  notes: readonly CourseTabNote[];
}

export const STRING_OPEN_MIDI: Record<1 | 2 | 3 | 4 | 5 | 6, number> = {
  1: 64, // E4
  2: 59, // B3
  3: 55, // G3
  4: 50, // D3
  5: 45, // A2
  6: 40, // E2
};

function tabNote(
  id: string,
  bar: number,
  beatInBar: number,
  durationBeats: number,
  stringNum: 1 | 2 | 3 | 4 | 5 | 6,
  fret: number,
  opts: { anchor?: boolean; tech?: string; beatsPerBar?: number } = {},
): CourseTabNote {
  const bpb = opts.beatsPerBar ?? 4;
  const midi = STRING_OPEN_MIDI[stringNum] + fret;
  const label = midiToNoteLabel(midi);
  if (!label) {
    throw new Error(`Invalid guitar MIDI ${midi} at string ${stringNum} fret ${fret}`);
  }
  return {
    id,
    label,
    bar,
    beatInBar,
    startBeat: (bar - 1) * bpb + beatInBar,
    durationBeats,
    stringNum,
    fret,
    isAnchor: opts.anchor ?? beatInBar === 0,
    tech: opts.tech,
  };
}

export const COURSE_CHAPTERS: readonly CourseChapterTheme[] = [
  {
    id: 'midnight-blues',
    chapterNumber: 1,
    title: 'Chapter I · Midnight Electric Blues',
    subtitle: 'Pentatonic phrasing, shuffle pocket, and soulful double-bar call & response.',
    accentHex: '#38BDF8',
    secondaryHex: '#818CF8',
    glowRgba: 'rgba(56, 189, 248, 0.16)',
    badgeBg: 'rgba(56, 189, 248, 0.14)',
  },
  {
    id: 'marshall-rock',
    chapterNumber: 2,
    title: 'Chapter II · Arena Hard Rock',
    subtitle: 'Low-string power riffs, driving 8th-note grooves, and soaring chorus hooks.',
    accentHex: '#F59E0B',
    secondaryHex: '#FB7185',
    glowRgba: 'rgba(245, 158, 11, 0.16)',
    badgeBg: 'rgba(245, 158, 11, 0.14)',
  },
  {
    id: 'sunburst-mastery',
    chapterNumber: 3,
    title: 'Chapter III · Precision Lead & Twang',
    subtitle: 'High-velocity 16th-note runs, open-string pull-offs, and cross-picking stamina.',
    accentHex: '#1DB954',
    secondaryHex: '#34D399',
    glowRgba: 'rgba(29, 185, 84, 0.16)',
    badgeBg: 'rgba(29, 185, 84, 0.14)',
  },
];

export const GUITAR_COURSES: readonly GuitarCourse[] = [
  /* ─────────────── CHAPTER I: MIDNIGHT ELECTRIC BLUES ─────────────── */
  {
    id: 'blues-1-smokestack',
    order: 1,
    chapterId: 'midnight-blues',
    title: 'Smokestack E Minor Blues',
    subtitle: 'Open-position E minor pentatonic call & turnaround over a warm 12/8 shuffle.',
    styleLabel: 'Electric Blues',
    keySignature: 'E Minor',
    tempoBpm: 76,
    beatsPerBar: 4,
    totalBars: 4,
    defaultGroove: 'blues-shuffle',
    barChords: ['Em7', 'A7', 'Em7', 'B7'],
    notes: [
      // Bar 1: Em7
      tabNote('b1-1', 1, 0.0, 1.0, 4, 2, { anchor: true }),
      tabNote('b1-2', 1, 1.0, 1.0, 3, 0),
      tabNote('b1-3', 1, 2.0, 0.5, 3, 2),
      tabNote('b1-4', 1, 2.5, 0.5, 2, 0, { anchor: true }),
      tabNote('b1-5', 1, 3.0, 1.0, 2, 3, { tech: 'vibrato' }),
      // Bar 2: A7
      tabNote('b1-6', 2, 0.0, 1.0, 1, 0, { anchor: true }),
      tabNote('b1-7', 2, 1.0, 1.0, 1, 3, { tech: 'vibrato' }),
      tabNote('b1-8', 2, 2.0, 0.5, 1, 0),
      tabNote('b1-9', 2, 2.5, 0.5, 2, 3),
      tabNote('b1-10', 2, 3.0, 1.0, 2, 0, { anchor: true }),
      // Bar 3: Em7
      tabNote('b1-11', 3, 0.0, 0.5, 3, 2, { anchor: true }),
      tabNote('b1-12', 3, 0.5, 0.5, 3, 0, { tech: 'pull' }),
      tabNote('b1-13', 3, 1.0, 1.5, 4, 2, { anchor: true, tech: 'vibrato' }),
      tabNote('b1-14', 3, 2.5, 0.5, 3, 0),
      tabNote('b1-15', 3, 3.0, 1.0, 3, 2),
      // Bar 4: B7 -> Em7
      tabNote('b1-16', 4, 0.0, 1.0, 2, 0, { anchor: true }),
      tabNote('b1-17', 4, 1.0, 0.5, 3, 2),
      tabNote('b1-18', 4, 1.5, 0.5, 3, 0),
      tabNote('b1-19', 4, 2.0, 2.0, 4, 2, { anchor: true, tech: 'vibrato' }),
    ],
  },

  {
    id: 'blues-2-texas-shuffle',
    order: 2,
    chapterId: 'midnight-blues',
    title: 'Texas Shuffle Box-1 Lead',
    subtitle: '5th-fret A minor blues box phrasing with target-tone sustain and turnaround bite.',
    styleLabel: 'Texas Blues',
    keySignature: 'A Minor',
    tempoBpm: 84,
    beatsPerBar: 4,
    totalBars: 6,
    defaultGroove: 'blues-shuffle',
    barChords: ['Am7', 'Dm7', 'Am7', 'E7', 'Dm7', 'Am7'],
    notes: [
      // Bar 1: Am7
      tabNote('b2-1', 1, 0.0, 1.0, 4, 7, { anchor: true }),
      tabNote('b2-2', 1, 1.0, 0.5, 3, 5),
      tabNote('b2-3', 1, 1.5, 0.5, 3, 7, { tech: 'hammer' }),
      tabNote('b2-4', 1, 2.0, 2.0, 2, 5, { anchor: true, tech: 'vibrato' }),
      // Bar 2: Dm7
      tabNote('b2-5', 2, 0.0, 1.0, 2, 8, { anchor: true }),
      tabNote('b2-6', 2, 1.0, 1.0, 1, 5),
      tabNote('b2-7', 2, 2.0, 0.5, 2, 8),
      tabNote('b2-8', 2, 2.5, 0.5, 2, 5),
      tabNote('b2-9', 2, 3.0, 1.0, 3, 7, { tech: 'vibrato' }),
      // Bar 3: Am7
      tabNote('b2-10', 3, 0.0, 0.5, 3, 5, { anchor: true }),
      tabNote('b2-11', 3, 0.5, 0.5, 3, 7),
      tabNote('b2-12', 3, 1.0, 1.0, 2, 5, { anchor: true }),
      tabNote('b2-13', 3, 2.0, 1.0, 1, 5),
      tabNote('b2-14', 3, 3.0, 1.0, 1, 8, { tech: 'slide' }),
      // Bar 4: E7
      tabNote('b2-15', 4, 0.0, 1.5, 1, 7, { anchor: true, tech: 'vibrato' }),
      tabNote('b2-16', 4, 1.5, 0.5, 1, 5),
      tabNote('b2-17', 4, 2.0, 1.0, 2, 8),
      tabNote('b2-18', 4, 3.0, 1.0, 2, 5),
      // Bar 5: Dm7
      tabNote('b2-19', 5, 0.0, 1.0, 3, 7, { anchor: true }),
      tabNote('b2-20', 5, 1.0, 0.5, 3, 5),
      tabNote('b2-21', 5, 1.5, 0.5, 4, 7),
      tabNote('b2-22', 5, 2.0, 1.0, 3, 5),
      tabNote('b2-23', 5, 3.0, 1.0, 3, 7, { tech: 'slide' }),
      // Bar 6: Am7
      tabNote('b2-24', 6, 0.0, 0.5, 2, 5, { anchor: true }),
      tabNote('b2-25', 6, 0.5, 0.5, 3, 7),
      tabNote('b2-26', 6, 1.0, 1.0, 3, 5),
      tabNote('b2-27', 6, 2.0, 2.0, 4, 7, { anchor: true, tech: 'vibrato' }),
    ],
  },

  {
    id: 'blues-3-sunburst-verse',
    order: 3,
    chapterId: 'midnight-blues',
    title: 'Sunburst Soul Lead: Verse',
    subtitle: 'Hendrix-inspired half-time D major melodic slides & vibrato (from Jam 4 Jimi Bars 1–8).',
    styleLabel: 'Soul-Rock Blues',
    keySignature: 'D Major',
    tempoBpm: 78,
    beatsPerBar: 4,
    totalBars: 8,
    defaultGroove: 'soul-rock',
    barChords: ['D', 'Em7', 'Gmaj7', 'D', 'D', 'Em7', 'Gmaj7', 'A7'],
    notes: [
      // Bar 1 (t1 Bar 1)
      tabNote('j1-1', 1, 0.0, 1.5, 2, 12, { anchor: true, tech: 'slide' }),
      tabNote('j1-2', 1, 1.5, 0.5, 2, 7),
      tabNote('j1-3', 1, 2.0, 2.0, 2, 10, { anchor: true, tech: 'vibrato' }),
      // Bar 2 (t1 Bar 2)
      tabNote('j1-4', 2, 1.0, 0.5, 2, 10, { anchor: true, tech: 'hammer' }),
      tabNote('j1-5', 2, 1.5, 0.5, 2, 5, { tech: 'slide' }),
      tabNote('j1-6', 2, 2.0, 0.5, 2, 7),
      tabNote('j1-7', 2, 2.5, 1.0, 2, 3, { tech: 'slide' }),
      tabNote('j1-8', 2, 3.5, 0.5, 2, 5, { tech: 'hammer' }),
      // Bar 3 (t1 Bar 3)
      tabNote('j1-9', 3, 0.25, 1.5, 2, 7, { anchor: true, tech: 'slide' }),
      tabNote('j1-10', 3, 1.75, 0.5, 2, 5),
      tabNote('j1-11', 3, 2.25, 1.75, 3, 4, { anchor: true, tech: 'vibrato' }),
      // Bar 4 (t1 Bar 4)
      tabNote('j1-12', 4, 2.0, 0.5, 3, 9, { anchor: true }),
      tabNote('j1-13', 4, 2.5, 0.5, 2, 7),
      tabNote('j1-14', 4, 3.0, 0.5, 2, 10),
      tabNote('j1-15', 4, 3.5, 0.5, 2, 15, { tech: 'slide' }),
      // Bar 5 (t1 Bar 5)
      tabNote('j1-16', 5, 0.0, 2.0, 2, 14, { anchor: true, tech: 'vibrato' }),
      tabNote('j1-17', 5, 2.0, 0.5, 2, 15),
      tabNote('j1-18', 5, 2.5, 0.5, 2, 12),
      tabNote('j1-19', 5, 3.0, 0.5, 2, 10, { tech: 'slide' }),
      tabNote('j1-20', 5, 3.5, 0.5, 2, 12),
      // Bar 6 (t1 Bar 6)
      tabNote('j1-21', 6, 1.0, 0.5, 2, 10, { anchor: true, tech: 'slide' }),
      tabNote('j1-22', 6, 1.5, 0.5, 2, 7),
      tabNote('j1-23', 6, 2.0, 1.0, 2, 10, { anchor: true }),
      tabNote('j1-24', 6, 3.0, 0.5, 2, 8),
      tabNote('j1-25', 6, 3.5, 0.5, 2, 7),
      // Bar 7 (t1 Bar 7)
      tabNote('j1-26', 7, 0.25, 3.5, 2, 10, { anchor: true, tech: 'vibrato' }),
      // Bar 8 (t1 Bar 8)
      tabNote('j1-27', 8, 2.0, 0.5, 3, 2, { anchor: true }),
      tabNote('j1-28', 8, 2.5, 0.5, 3, 4),
      tabNote('j1-29', 8, 3.0, 0.5, 2, 3),
      tabNote('j1-30', 8, 3.5, 0.5, 2, 5),
    ],
  },

  /* ─────────────── CHAPTER II: ARENA HARD ROCK ─────────────── */
  {
    id: 'rock-4-backstage-riff',
    order: 4,
    chapterId: 'marshall-rock',
    title: 'Backstage E5 Power Riff',
    subtitle: 'Heavy low-string single-note rock riffage locking tight with kick & snare.',
    styleLabel: 'Hard Rock',
    keySignature: 'E Minor',
    tempoBpm: 96,
    beatsPerBar: 4,
    totalBars: 4,
    defaultGroove: 'hard-rock',
    barChords: ['E5', 'G5 / A5', 'E5', 'B5 / E5'],
    notes: [
      // Bar 1: E5
      tabNote('r4-1', 1, 0.0, 1.0, 6, 0, { anchor: true }),
      tabNote('r4-2', 1, 1.0, 0.5, 6, 0),
      tabNote('r4-3', 1, 1.5, 0.5, 6, 3),
      tabNote('r4-4', 1, 2.0, 1.0, 5, 0, { anchor: true }),
      tabNote('r4-5', 1, 3.0, 1.0, 4, 2, { tech: 'vibrato' }),
      // Bar 2: G5 / A5
      tabNote('r4-6', 2, 0.0, 1.0, 6, 3, { anchor: true }),
      tabNote('r4-7', 2, 1.0, 0.5, 5, 2),
      tabNote('r4-8', 2, 1.5, 0.5, 4, 0),
      tabNote('r4-9', 2, 2.0, 1.0, 5, 0, { anchor: true }),
      tabNote('r4-10', 2, 3.0, 1.0, 4, 2),
      // Bar 3: E5
      tabNote('r4-11', 3, 0.0, 0.5, 6, 0, { anchor: true }),
      tabNote('r4-12', 3, 0.5, 0.5, 6, 3),
      tabNote('r4-13', 3, 1.0, 0.5, 5, 0),
      tabNote('r4-14', 3, 1.5, 0.5, 5, 2, { tech: 'slide' }),
      tabNote('r4-15', 3, 2.0, 1.0, 4, 2, { anchor: true }),
      tabNote('r4-16', 3, 3.0, 1.0, 3, 0),
      // Bar 4: B5 -> E5
      tabNote('r4-17', 4, 0.0, 1.0, 5, 2, { anchor: true }),
      tabNote('r4-18', 4, 1.0, 0.5, 5, 0),
      tabNote('r4-19', 4, 1.5, 0.5, 6, 3),
      tabNote('r4-20', 4, 2.0, 2.0, 6, 0, { anchor: true, tech: 'vibrato' }),
    ],
  },

  {
    id: 'rock-5-midnight-highway',
    order: 5,
    chapterId: 'marshall-rock',
    title: 'Midnight Highway Anthem',
    subtitle: 'Driving 6-bar stadium rock lead climbing from A minor into harmonic E7 resolution.',
    styleLabel: 'Arena Hard Rock',
    keySignature: 'A Minor',
    tempoBpm: 102,
    beatsPerBar: 4,
    totalBars: 6,
    defaultGroove: 'hard-rock',
    barChords: ['Am', 'G', 'F', 'G', 'Am', 'E7'],
    notes: [
      // Bar 1: Am
      tabNote('r5-1', 1, 0.0, 1.0, 4, 7, { anchor: true }),
      tabNote('r5-2', 1, 1.0, 0.5, 4, 7),
      tabNote('r5-3', 1, 1.5, 0.5, 3, 5),
      tabNote('r5-4', 1, 2.0, 1.0, 3, 7, { anchor: true }),
      tabNote('r5-5', 1, 3.0, 1.0, 3, 9, { tech: 'slide' }),
      // Bar 2: G
      tabNote('r5-6', 2, 0.0, 1.0, 3, 7, { anchor: true }),
      tabNote('r5-7', 2, 1.0, 0.5, 3, 5),
      tabNote('r5-8', 2, 1.5, 0.5, 3, 4),
      tabNote('r5-9', 2, 2.0, 2.0, 4, 5, { anchor: true, tech: 'vibrato' }),
      // Bar 3: F
      tabNote('r5-10', 3, 0.0, 1.0, 4, 3, { anchor: true }),
      tabNote('r5-11', 3, 1.0, 0.5, 4, 5),
      tabNote('r5-12', 3, 1.5, 0.5, 4, 7),
      tabNote('r5-13', 3, 2.0, 1.0, 3, 5, { anchor: true }),
      tabNote('r5-14', 3, 3.0, 1.0, 3, 4),
      // Bar 4: G
      tabNote('r5-15', 4, 0.0, 1.5, 3, 7, { anchor: true }),
      tabNote('r5-16', 4, 1.5, 0.5, 3, 5),
      tabNote('r5-17', 4, 2.0, 1.0, 3, 4, { anchor: true }),
      tabNote('r5-18', 4, 3.0, 0.5, 3, 5),
      tabNote('r5-19', 4, 3.5, 0.5, 3, 7),
      // Bar 5: Am
      tabNote('r5-20', 5, 0.0, 1.0, 2, 5, { anchor: true }),
      tabNote('r5-21', 5, 1.0, 0.5, 2, 8),
      tabNote('r5-22', 5, 1.5, 1.5, 2, 10, { anchor: true, tech: 'slide-vibrato' }),
      tabNote('r5-23', 5, 3.0, 1.0, 2, 8),
      // Bar 6: E7 -> Am
      tabNote('r5-24', 6, 0.0, 1.0, 2, 9, { anchor: true }),
      tabNote('r5-25', 6, 1.0, 0.5, 2, 5),
      tabNote('r5-26', 6, 1.5, 0.5, 3, 7),
      tabNote('r5-27', 6, 2.0, 2.0, 4, 7, { anchor: true, tech: 'vibrato' }),
    ],
  },

  {
    id: 'rock-6-sunburst-chorus',
    order: 6,
    chapterId: 'marshall-rock',
    title: 'Sunburst Chorus & High Octave',
    subtitle: 'Soaring melodic rock chorus into 17th-fret lead climax (from Jam 4 Jimi Chorus & Outro).',
    styleLabel: 'Classic Rock Solo',
    keySignature: 'G / D Major',
    tempoBpm: 86,
    beatsPerBar: 4,
    totalBars: 8,
    defaultGroove: 'soul-rock',
    barChords: ['G', 'C', 'G', 'D', 'Em7', 'C', 'D', 'G'],
    notes: [
      // Bar 1 (t1 Bar 33)
      tabNote('jc-1', 1, 0.5, 2.0, 2, 7, { anchor: true }),
      tabNote('jc-2', 1, 2.5, 1.5, 2, 8, { tech: 'vibrato' }),
      // Bar 2 (t1 Bar 34)
      tabNote('jc-3', 2, 2.0, 0.5, 3, 5, { anchor: true }),
      tabNote('jc-4', 2, 2.5, 0.5, 3, 7),
      tabNote('jc-5', 2, 3.0, 0.5, 2, 5),
      tabNote('jc-6', 2, 3.5, 0.5, 2, 8),
      // Bar 3 (t1 Bar 35)
      tabNote('jc-7', 3, 0.0, 2.5, 2, 7, { anchor: true }),
      tabNote('jc-8', 3, 2.5, 1.5, 2, 8, { tech: 'vibrato' }),
      // Bar 4 (t1 Bar 36)
      tabNote('jc-9', 4, 2.0, 0.5, 4, 7, { anchor: true }),
      tabNote('jc-10', 4, 2.5, 0.5, 3, 5),
      tabNote('jc-11', 4, 3.0, 1.0, 3, 7),
      // Bar 5 (t1 Bar 39)
      tabNote('jc-12', 5, 0.0, 2.0, 2, 7, { anchor: true }),
      tabNote('jc-13', 5, 2.0, 2.0, 2, 5, { anchor: true, tech: 'vibrato' }),
      // Bar 6 (t1 Bar 40-41 motif)
      tabNote('jc-14', 6, 1.0, 1.0, 2, 8, { anchor: true }),
      tabNote('jc-15', 6, 2.0, 2.0, 2, 10, { anchor: true, tech: 'slide-vibrato' }),
      // Bar 7 (t1 Bar 53)
      tabNote('jc-16', 7, 0.5, 0.5, 2, 15, { anchor: true }),
      tabNote('jc-17', 7, 1.0, 0.5, 2, 17, { tech: 'slide' }),
      tabNote('jc-18', 7, 1.5, 1.5, 2, 12, { anchor: true }),
      tabNote('jc-19', 7, 3.0, 1.0, 2, 10, { tech: 'slide' }),
      // Bar 8 (t1 Bar 55)
      tabNote('jc-20', 8, 0.5, 1.0, 2, 7, { anchor: true }),
      tabNote('jc-21', 8, 1.5, 0.5, 2, 10),
      tabNote('jc-22', 8, 2.0, 2.0, 2, 7, { anchor: true, tech: 'vibrato' }),
    ],
  },

  /* ─────────────── CHAPTER III: PRECISION LEAD & TWANG ─────────────── */
  {
    id: 'twang-7-nashville-hook',
    order: 7,
    chapterId: 'sunburst-mastery',
    title: 'Nashville Double-Time Hook',
    subtitle: 'Crisp A-major Telecaster slides, triad arpeggios & open-string pull-offs (Country Pickin’ Pt. 1).',
    styleLabel: 'Country / Rock Lead',
    keySignature: 'A Major',
    tempoBpm: 94,
    beatsPerBar: 4,
    totalBars: 6,
    defaultGroove: 'country-train',
    barChords: ['A', 'A', 'D / A', 'D / A', 'D / A', 'F#m / B7'],
    notes: [
      // Bar 1 (t2 Bar 1)
      tabNote('cp1-1', 1, 0.0, 0.65, 5, 0, { anchor: true }),
      tabNote('cp1-2', 1, 0.75, 0.65, 1, 14, { tech: 'slide' }),
      tabNote('cp1-3', 1, 1.5, 1.5, 1, 9, { anchor: true, tech: 'vibrato' }),
      tabNote('cp1-4', 1, 3.0, 0.25, 2, 12),
      tabNote('cp1-5', 1, 3.25, 0.25, 3, 11),
      tabNote('cp1-6', 1, 3.5, 0.25, 2, 10, { tech: 'hammer' }),
      tabNote('cp1-7', 1, 3.75, 0.25, 2, 12),
      // Bar 2 (t2 Bar 2)
      tabNote('cp1-8', 2, 0.0, 1.25, 1, 9, { anchor: true, tech: 'vibrato' }),
      tabNote('cp1-9', 2, 1.25, 1.75, 2, 12, { anchor: true }),
      tabNote('cp1-10', 2, 3.0, 0.5, 4, 16),
      tabNote('cp1-11', 2, 3.5, 0.25, 3, 16),
      tabNote('cp1-12', 2, 3.75, 0.25, 2, 14),
      // Bar 3 (t2 Bar 5)
      tabNote('cp1-13', 3, 0.25, 0.25, 4, 7, { anchor: true }),
      tabNote('cp1-14', 3, 0.5, 0.5, 2, 7),
      tabNote('cp1-15', 3, 1.0, 0.75, 2, 10, { anchor: true, tech: 'slide' }),
      tabNote('cp1-16', 3, 1.75, 0.25, 3, 7),
      tabNote('cp1-17', 3, 2.0, 0.25, 3, 6),
      tabNote('cp1-18', 3, 2.25, 0.25, 4, 7),
      tabNote('cp1-19', 3, 2.5, 1.5, 5, 7, { anchor: true, tech: 'vibrato' }),
      // Bar 4 (t2 Bar 6)
      tabNote('cp1-20', 4, 0.0, 0.25, 5, 5, { anchor: true }),
      tabNote('cp1-21', 4, 0.25, 0.25, 4, 7),
      tabNote('cp1-22', 4, 0.5, 0.5, 2, 7),
      tabNote('cp1-23', 4, 1.0, 0.25, 2, 10, { tech: 'slide' }),
      tabNote('cp1-24', 4, 1.25, 0.75, 2, 7),
      tabNote('cp1-25', 4, 2.0, 0.25, 1, 9, { anchor: true }),
      tabNote('cp1-26', 4, 2.25, 0.25, 2, 10),
      tabNote('cp1-27', 4, 2.5, 1.5, 1, 12, { tech: 'vibrato' }),
      // Bar 5 (t2 Bar 7)
      tabNote('cp1-28', 5, 0.0, 0.25, 5, 5, { anchor: true }),
      tabNote('cp1-29', 5, 0.25, 0.25, 4, 7),
      tabNote('cp1-30', 5, 0.5, 0.5, 2, 7),
      tabNote('cp1-31', 5, 1.0, 0.75, 2, 10, { tech: 'slide' }),
      tabNote('cp1-32', 5, 1.75, 0.25, 3, 7),
      tabNote('cp1-33', 5, 2.0, 0.25, 3, 6),
      tabNote('cp1-34', 5, 2.25, 0.25, 4, 7),
      tabNote('cp1-35', 5, 2.5, 1.5, 5, 7, { anchor: true }),
      // Bar 6 (t2 Bar 8)
      tabNote('cp1-36', 6, 0.25, 0.5, 2, 2, { anchor: true, tech: 'hammer' }),
      tabNote('cp1-37', 6, 0.75, 0.25, 1, 5),
      tabNote('cp1-38', 6, 1.0, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp1-39', 6, 1.25, 0.25, 1, 7),
      tabNote('cp1-40', 6, 1.5, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp1-41', 6, 1.75, 0.25, 2, 7),
      tabNote('cp1-42', 6, 2.0, 0.25, 1, 5, { anchor: true }),
      tabNote('cp1-43', 6, 2.25, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp1-44', 6, 2.5, 0.5, 2, 7),
      tabNote('cp1-45', 6, 3.0, 0.25, 3, 4),
      tabNote('cp1-46', 6, 3.25, 0.25, 3, 6, { tech: 'hammer' }),
      tabNote('cp1-47', 6, 3.5, 0.5, 3, 4, { tech: 'pull' }),
    ],
  },

  {
    id: 'twang-8-barnburner-finale',
    order: 8,
    chapterId: 'sunburst-mastery',
    title: 'Barnburner Cross-Pick Finale',
    subtitle: 'Full 8-bar capstone solo from Country Pickin’ Chorus 2 (Bars 10–17) up to high A5!',
    styleLabel: 'Virtuoso Lead',
    keySignature: 'A Major',
    tempoBpm: 106,
    beatsPerBar: 4,
    totalBars: 8,
    defaultGroove: 'country-train',
    barChords: ['A', 'A', 'D', 'A', 'D / A', 'E7', 'D / A', 'F#m / B7'],
    notes: [
      // Bar 1 (t2 Bar 10)
      tabNote('cp2-1', 1, 0.0, 0.5, 5, 0, { anchor: true }),
      tabNote('cp2-2', 1, 0.5, 0.25, 1, 12),
      tabNote('cp2-3', 1, 0.75, 0.75, 1, 14, { tech: 'slide' }),
      tabNote('cp2-4', 1, 1.5, 1.5, 1, 9, { anchor: true, tech: 'vibrato' }),
      tabNote('cp2-5', 1, 3.0, 0.25, 2, 12),
      tabNote('cp2-6', 1, 3.25, 0.25, 3, 11),
      tabNote('cp2-7', 1, 3.5, 0.25, 2, 10),
      tabNote('cp2-8', 1, 3.75, 0.25, 2, 12),
      // Bar 2 (t2 Bar 11)
      tabNote('cp2-9', 2, 0.0, 0.25, 1, 9, { anchor: true }),
      tabNote('cp2-10', 2, 0.25, 0.75, 1, 12),
      tabNote('cp2-11', 2, 1.0, 0.75, 1, 9),
      tabNote('cp2-12', 2, 1.75, 1.75, 2, 12, { anchor: true, tech: 'vibrato' }),
      tabNote('cp2-13', 2, 3.5, 0.25, 4, 16),
      tabNote('cp2-14', 2, 3.75, 0.25, 3, 14),
      // Bar 3 (t2 Bar 12)
      tabNote('cp2-15', 3, 0.0, 0.25, 3, 16, { anchor: true }),
      tabNote('cp2-16', 3, 0.25, 0.25, 2, 14),
      tabNote('cp2-17', 3, 0.5, 0.25, 2, 17),
      tabNote('cp2-18', 3, 0.75, 0.25, 1, 14),
      tabNote('cp2-19', 3, 1.0, 0.25, 1, 17, { anchor: true }),
      tabNote('cp2-20', 3, 1.25, 0.25, 1, 14),
      tabNote('cp2-21', 3, 1.5, 0.5, 2, 17),
      tabNote('cp2-22', 3, 2.0, 0.25, 3, 16),
      tabNote('cp2-23', 3, 2.25, 0.75, 2, 14, { anchor: true }),
      tabNote('cp2-24', 3, 3.0, 0.25, 2, 17),
      tabNote('cp2-25', 3, 3.25, 0.25, 2, 14),
      tabNote('cp2-26', 3, 3.5, 0.25, 3, 16),
      tabNote('cp2-27', 3, 3.75, 0.25, 3, 14),
      // Bar 4 (t2 Bar 13)
      tabNote('cp2-28', 4, 0.0, 0.25, 4, 16, { anchor: true }),
      tabNote('cp2-29', 4, 0.25, 0.25, 3, 16),
      tabNote('cp2-30', 4, 0.5, 0.25, 3, 14),
      tabNote('cp2-31', 4, 0.75, 0.25, 4, 16),
      tabNote('cp2-32', 4, 1.0, 0.25, 4, 14),
      tabNote('cp2-33', 4, 1.25, 0.25, 3, 14),
      tabNote('cp2-34', 4, 1.5, 0.25, 4, 16),
      tabNote('cp2-35', 4, 1.75, 0.25, 4, 12),
      tabNote('cp2-36', 4, 2.0, 2.0, 4, 14, { anchor: true, tech: 'vibrato' }),
      // Bar 5 (t2 Bar 14)
      tabNote('cp2-37', 5, 0.25, 0.25, 4, 7, { anchor: true }),
      tabNote('cp2-38', 5, 0.5, 0.5, 2, 7),
      tabNote('cp2-39', 5, 1.0, 0.75, 2, 10),
      tabNote('cp2-40', 5, 1.75, 0.25, 3, 7),
      tabNote('cp2-41', 5, 2.0, 0.25, 3, 6),
      tabNote('cp2-42', 5, 2.25, 0.25, 4, 7),
      tabNote('cp2-43', 5, 2.5, 1.5, 5, 7, { anchor: true }),
      // Bar 6 (t2 Bar 15)
      tabNote('cp2-44', 6, 0.0, 0.25, 6, 10, { anchor: true }),
      tabNote('cp2-45', 6, 0.25, 0.25, 5, 12),
      tabNote('cp2-46', 6, 0.5, 0.5, 3, 11),
      tabNote('cp2-47', 6, 1.0, 0.5, 2, 14, { tech: 'slide' }),
      tabNote('cp2-48', 6, 1.5, 0.25, 1, 12),
      tabNote('cp2-49', 6, 1.75, 0.25, 2, 15),
      tabNote('cp2-50', 6, 2.0, 0.5, 2, 14),
      tabNote('cp2-51', 6, 2.5, 1.5, 1, 17, { anchor: true, tech: 'vibrato' }),
      // Bar 7 (t2 Bar 16)
      tabNote('cp2-52', 7, 0.25, 0.25, 4, 7, { anchor: true }),
      tabNote('cp2-53', 7, 0.5, 0.5, 2, 7),
      tabNote('cp2-54', 7, 1.0, 0.75, 2, 10),
      tabNote('cp2-55', 7, 1.75, 0.25, 3, 7),
      tabNote('cp2-56', 7, 2.0, 0.25, 3, 6),
      tabNote('cp2-57', 7, 2.25, 0.25, 4, 7),
      tabNote('cp2-58', 7, 2.5, 1.5, 5, 7, { anchor: true }),
      // Bar 8 (t2 Bar 17)
      tabNote('cp2-59', 8, 0.25, 0.5, 2, 2, { anchor: true }),
      tabNote('cp2-60', 8, 0.75, 0.25, 1, 5),
      tabNote('cp2-61', 8, 1.0, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp2-62', 8, 1.25, 0.25, 1, 7),
      tabNote('cp2-63', 8, 1.5, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp2-64', 8, 1.75, 0.25, 2, 7),
      tabNote('cp2-65', 8, 2.0, 0.25, 1, 5, { anchor: true }),
      tabNote('cp2-66', 8, 2.25, 0.25, 1, 0, { tech: 'pull' }),
      tabNote('cp2-67', 8, 2.5, 0.5, 2, 7),
      tabNote('cp2-68', 8, 3.0, 0.25, 3, 4),
      tabNote('cp2-69', 8, 3.25, 0.25, 3, 6),
      tabNote('cp2-70', 8, 3.5, 0.5, 3, 4, { anchor: true }),
    ],
  },
];

export function getChapterForCourse(course: GuitarCourse): CourseChapterTheme {
  return (
    COURSE_CHAPTERS.find((ch) => ch.id === course.chapterId) ?? COURSE_CHAPTERS[0]
  );
}
