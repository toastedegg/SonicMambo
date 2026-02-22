/**
 * Convert frequency in Hz to a musical note name (e.g. "A4", "E2").
 * Uses equal temperament with A4 = 440 Hz.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const A4_FREQ = 440;
const A4_MIDI = 69;

/**
 * Convert frequency (Hz) to MIDI note number (e.g. 69 for A4).
 */
export function frequencyToMidi(freq: number): number {
  if (freq <= 0 || !Number.isFinite(freq)) return NaN;
  return 69 + 12 * Math.log2(freq / A4_FREQ);
}

/**
 * Convert frequency (Hz) to note name and octave (e.g. { name: "A", octave: 4 }).
 */
export function frequencyToNote(freq: number): { name: string; octave: number } | null {
  const midi = frequencyToMidi(freq);
  if (Number.isNaN(midi) || midi < 0 || midi > 127) return null;
  const noteIndex = Math.round(midi) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { name: NOTE_NAMES[noteIndex], octave };
}

/**
 * Format as "A4", "E2", etc.
 */
export function frequencyToNoteString(freq: number): string | null {
  const note = frequencyToNote(freq);
  if (!note) return null;
  return `${note.name}${note.octave}`;
}

/**
 * Guitar-friendly target notes (common open and fretted notes).
 */
export const GUITAR_TARGET_NOTES = [
  'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2', 'C3', 'C#3', 'D3', 'D#3', 'E3',
  'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3', 'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4',
];
