export type ChordQuality = 'm7' | '7' | 'maj7' | 'm7b5' | '7b9';

export interface ChordChange {
  id: string;
  symbol: string;
  rootPitchClass: number; // 0=C .. 11=B
  quality: ChordQuality;
  chordTones: number[]; // pitch classes [root, 3rd, 5th, 7th]
  guideTones: [number, number]; // [3rd pitch class, 7th pitch class]
  scaleTones: number[]; // diatonic/altered scale pitch classes
  startBeat: number;
  durationBeats: number;
}

export interface ProgressionExercise {
  id: string;
  title: string;
  keyLabel: string;
  tempoBpm: number;
  description: string;
  totalBeats: number;
  changes: ChordChange[];
}

export type JazzNoteClassification =
  | 'chord-tone-strong'
  | 'chord-tone'
  | 'guide-tone-resolution'
  | 'approach-enclosure'
  | 'scale-tone'
  | 'outside-note';

export interface AnalyzedJazzNote {
  noteId: string;
  label: string;
  midi: number;
  pitchClass: number;
  beat: number;
  chordSymbol: string;
  classification: JazzNoteClassification;
  resolutionNote?: string;
}

export interface JazzTakeAnalysis {
  analyzedNotes: AnalyzedJazzNote[];
  strongBeatChordTonePct: number;
  guideToneResolutions: number;
  approachOrEnclosures: number;
  outsideNoteCount: number;
  summaryTip: string;
}
