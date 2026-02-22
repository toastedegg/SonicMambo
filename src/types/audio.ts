/**
 * TypeScript interfaces for audio engine state and config.
 */

export interface DetectedNote {
  name: string;
  octave: number;
  label: string;
  frequency: number;
}

export interface AudioEngineState {
  isListening: boolean;
  currentNote: DetectedNote | null;
  frequency: number | null;
  loudness: number;
  error: string | null;
}

export interface AudioEngineConfig {
  rmsThreshold: number;
  fftSize: number;
  bufferLength: number;
  minFrequency: number;
  maxFrequency: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioEngineConfig = {
  rmsThreshold: 0.01,
  fftSize: 2048,
  bufferLength: 2048,
  minFrequency: 80,
  maxFrequency: 400,
};
