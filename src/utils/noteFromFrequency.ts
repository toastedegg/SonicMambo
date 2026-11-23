/**
 * Convert frequency in Hz to a musical note name (e.g. "A4", "E2").
 * Uses equal temperament with A4 = 440 Hz.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const A4_FREQ = 440;
const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  A: 9,
  'A#': 10,
  B: 11,
};

/**
 * Convert frequency (Hz) to MIDI note number (e.g. 69 for A4).
 */
export function frequencyToMidi(freq: number): number {
  if (freq <= 0 || !Number.isFinite(freq)) return NaN;
  return 69 + 12 * Math.log2(freq / A4_FREQ);
}

/**
 * Convert note label (e.g. "E2", "F#3") to MIDI note number.
 */
export function noteLabelToMidi(noteLabel: string): number | null {
  const match = /^([A-G])(#?)(-?\d)$/.exec(noteLabel.trim());
  if (!match) return null;
  const [, root, accidental, octaveString] = match;
  const key = `${root}${accidental}`;
  const semitone = NOTE_TO_SEMITONE[key];
  if (semitone == null) return null;
  const octave = Number(octaveString);
  return semitone + (octave + 1) * 12;
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
 * Convert MIDI note number (integer or continuous) to frequency in Hz (69 -> 440 Hz).
 */
export function midiToFrequency(midi: number, a4Hz: number = A4_FREQ): number {
  if (!Number.isFinite(midi)) return NaN;
  return a4Hz * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert integer MIDI note number (e.g. 69) to label (e.g. "A4").
 */
export function midiToNoteLabel(midi: number): string | null {
  if (!Number.isFinite(midi)) return null;
  const rounded = Math.round(midi);
  if (rounded < 0 || rounded > 127) return null;
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Convert note label (e.g. "G4", "F#4", "E2") to target frequency in Hz.
 */
export function noteLabelToFrequency(noteLabel: string, a4Hz: number = A4_FREQ): number | null {
  const midi = noteLabelToMidi(noteLabel);
  if (midi == null) return null;
  return midiToFrequency(midi, a4Hz);
}

/**
 * Signed cents from `targetHz` to `detectedHz`: `1200 * log2(detectedHz / targetHz)`.
 * Negative = flat, positive = sharp, 0 = exact match.
 */
export function centsBetween(detectedHz: number, targetHz: number): number {
  if (
    detectedHz <= 0 ||
    targetHz <= 0 ||
    !Number.isFinite(detectedHz) ||
    !Number.isFinite(targetHz)
  ) {
    return NaN;
  }
  return 1200 * Math.log2(detectedHz / targetHz);
}

/**
 * Signed cents deviation from the nearest equal-tempered semitone (-50..+50).
 */
export function centsFromNearestMidi(freq: number): { midi: number; cents: number } | null {
  const continuous = frequencyToMidi(freq);
  if (Number.isNaN(continuous) || continuous < 0 || continuous > 127) return null;
  const midi = Math.round(continuous);
  return { midi, cents: (continuous - midi) * 100 };
}

/**
 * Guitar-friendly target notes (common open and fretted notes).
 */
export const GUITAR_TARGET_NOTES = [
  'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2', 'C3', 'C#3', 'D3', 'D#3', 'E3',
  'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3', 'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4',
];
