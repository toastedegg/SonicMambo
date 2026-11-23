export interface PitchFrame {
  timeMs: number;
  rms: number;
  rawHz: number | null;
  smoothedHz: number | null;
  midi: number | null;
  centsOffset: number | null;
  label: string | null;
  confidence: number;
}

export interface NoteEvent {
  id: string;
  onsetMs: number;
  durationMs: number;
  midi: number;
  medianHz: number;
  pitchCents: number;
  label: string;
  velocity: number;
  confidence: number;
  isLegato: boolean;
}

export interface GroundTruthNote {
  id?: string;
  onsetSec: number;
  durationSec: number;
  midi: number;
  label?: string;
  bar?: number;
  beatInBar?: number;
  technique?: string;
}

export interface PitchDetectionResult {
  pitchHz: number | null;
  confidence: number;
  rms: number;
}

export interface PitchDetectorBackend {
  readonly name: string;
  detect(frame: Float32Array, sampleRate: number): PitchDetectionResult;
  setRmsThreshold?(threshold: number): void;
  dispose?(): void;
}
