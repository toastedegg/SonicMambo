import type { Lesson } from '../types/lesson';

export const LESSONS: Lesson[] = [
  {
    id: 'lesson-1',
    title: 'E minor scale (one octave)',
    tempoBpm: 72,
    notes: [
      { id: 'n1', label: 'E3', startBeat: 0, durationBeats: 1 },
      { id: 'n2', label: 'G3', startBeat: 1, durationBeats: 1 },
      { id: 'n3', label: 'A3', startBeat: 2, durationBeats: 1 },
      { id: 'n4', label: 'B3', startBeat: 3, durationBeats: 1 },
      { id: 'n5', label: 'D4', startBeat: 4, durationBeats: 1 },
      { id: 'n6', label: 'E4', startBeat: 5, durationBeats: 1 },
      { id: 'n7', label: 'G4', startBeat: 6, durationBeats: 1 },
      { id: 'n8', label: 'E4', startBeat: 7, durationBeats: 2 },
    ],
  },
  {
    id: 'lesson-2',
    title: 'G major scale',
    tempoBpm: 72,
    notes: [
      { id: 'n1', label: 'G3', startBeat: 0, durationBeats: 1 },
      { id: 'n2', label: 'A3', startBeat: 1, durationBeats: 1 },
      { id: 'n3', label: 'B3', startBeat: 2, durationBeats: 1 },
      { id: 'n4', label: 'C4', startBeat: 3, durationBeats: 1 },
      { id: 'n5', label: 'D4', startBeat: 4, durationBeats: 1 },
      { id: 'n6', label: 'E4', startBeat: 5, durationBeats: 1 },
      { id: 'n7', label: 'F#4', startBeat: 6, durationBeats: 1 },
      { id: 'n8', label: 'G4', startBeat: 7, durationBeats: 2 },
    ],
  },
];
