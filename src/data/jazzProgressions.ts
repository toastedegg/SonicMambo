import type { ProgressionExercise } from '../types/jazz.ts';

// Pitch classes: C=0, C#=1, D=2, Eb=3, E=4, F=5, F#=6, G=7, Ab=8, A=9, Bb=10, B=11
export const JAZZ_PROGRESSIONS: ProgressionExercise[] = [
  {
    id: 'ii-v-i-c-major',
    title: 'Major ii\u2013V\u2013I in C',
    keyLabel: 'C Major',
    tempoBpm: 92,
    totalBeats: 16,
    description:
      'Hear the changes silently: land chord tones on beats 1 & 3 and resolve 7th \u2192 3rd (F \u2192 E, C \u2192 B) across bar lines.',
    changes: [
      {
        id: 'c1',
        symbol: 'Dm7',
        rootPitchClass: 2,
        quality: 'm7',
        chordTones: [2, 5, 9, 0], // D F A C
        guideTones: [5, 0], // F, C
        scaleTones: [2, 4, 5, 7, 9, 11, 0],
        startBeat: 0,
        durationBeats: 4,
      },
      {
        id: 'c2',
        symbol: 'G7',
        rootPitchClass: 7,
        quality: '7',
        chordTones: [7, 11, 2, 5], // G B D F
        guideTones: [11, 5], // B, F
        scaleTones: [7, 9, 11, 0, 2, 4, 5],
        startBeat: 4,
        durationBeats: 4,
      },
      {
        id: 'c3',
        symbol: 'Cmaj7',
        rootPitchClass: 0,
        quality: 'maj7',
        chordTones: [0, 4, 7, 11], // C E G B
        guideTones: [4, 11], // E, B
        scaleTones: [0, 2, 4, 5, 7, 9, 11],
        startBeat: 8,
        durationBeats: 8,
      },
    ],
  },
  {
    id: 'ii-v-i-bb-major',
    title: 'Major ii\u2013V\u2013I in Bb',
    keyLabel: 'Bb Major',
    tempoBpm: 96,
    totalBeats: 16,
    description:
      'Classic horn-friendly jazz cadence. Aim for Bb \u2192 A (Cm7 to F7) and Eb \u2192 D (F7 to Bbmaj7).',
    changes: [
      {
        id: 'b1',
        symbol: 'Cm7',
        rootPitchClass: 0,
        quality: 'm7',
        chordTones: [0, 3, 7, 10], // C Eb G Bb
        guideTones: [3, 10], // Eb, Bb
        scaleTones: [0, 2, 3, 5, 7, 9, 10],
        startBeat: 0,
        durationBeats: 4,
      },
      {
        id: 'b2',
        symbol: 'F7',
        rootPitchClass: 5,
        quality: '7',
        chordTones: [5, 9, 0, 3], // F A C Eb
        guideTones: [9, 3], // A, Eb
        scaleTones: [5, 7, 9, 10, 0, 2, 3],
        startBeat: 4,
        durationBeats: 4,
      },
      {
        id: 'b3',
        symbol: 'Bbmaj7',
        rootPitchClass: 10,
        quality: 'maj7',
        chordTones: [10, 2, 5, 9], // Bb D F A
        guideTones: [2, 9], // D, A
        scaleTones: [10, 0, 2, 3, 5, 7, 9],
        startBeat: 8,
        durationBeats: 8,
      },
    ],
  },
  {
    id: 'minor-ii-v-i-gm',
    title: 'Minor ii\u2013V\u2013i in G minor',
    keyLabel: 'G Minor',
    tempoBpm: 88,
    totalBeats: 16,
    description:
      'Half-diminished to altered dominant resolution: target Eb \u2192 D and F# \u2192 G on the minor tonic.',
    changes: [
      {
        id: 'g1',
        symbol: 'Am7b5',
        rootPitchClass: 9,
        quality: 'm7b5',
        chordTones: [9, 0, 3, 7], // A C Eb G
        guideTones: [0, 7], // C, G
        scaleTones: [9, 10, 0, 2, 3, 5, 7],
        startBeat: 0,
        durationBeats: 4,
      },
      {
        id: 'g2',
        symbol: 'D7b9',
        rootPitchClass: 2,
        quality: '7b9',
        chordTones: [2, 6, 9, 0], // D F# A C
        guideTones: [6, 0], // F#, C
        scaleTones: [2, 3, 6, 7, 9, 10, 0],
        startBeat: 4,
        durationBeats: 4,
      },
      {
        id: 'g3',
        symbol: 'Gm7',
        rootPitchClass: 7,
        quality: 'm7',
        chordTones: [7, 10, 2, 5], // G Bb D F
        guideTones: [10, 5], // Bb, F
        scaleTones: [7, 9, 10, 0, 2, 3, 5],
        startBeat: 8,
        durationBeats: 8,
      },
    ],
  },
];
