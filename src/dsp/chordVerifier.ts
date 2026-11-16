import { midiToFrequency } from '../utils/noteFromFrequency.ts';
import { goertzelWindowedMagnitude } from './pitchDetector.ts';

export interface ChordVerificationResult {
  matched: boolean;
  cosineSimilarity: number;
  presentChordTones: number[]; // pitch classes detected cleanly
  missingChordTones: number[]; // required pitch classes absent
  clashRatio: number;
  hpcp36: Float32Array;
}

/**
 * Computes a 36-bin HPCP (Harmonic Pitch Class Profile, 3 bins per semitone)
 * across guitar MIDI range `40..79` (`E2..G5`) and verifies an expected chord
 * against the score rather than transcribing polyphony blind.
 */
export function computeHpcp36(frame: Float32Array, sampleRate: number): Float32Array {
  const hpcp = new Float32Array(36);
  const n = frame.length;
  if (n < 256 || sampleRate <= 0) return hpcp;

  const windowed = new Float32Array(n);
  const twoPiOverN = (2 * Math.PI) / (n - 1);
  for (let i = 0; i < n; i += 1) {
    windowed[i] = (0.5 - 0.5 * Math.cos(twoPiOverN * i)) * frame[i];
  }

  // Probe fundamentals from E2 (40) to G5 (79) across 3 sub-bins/semitone
  for (let midi = 40; midi <= 79; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    const baseBin = pc * 3;
    const hz = midiToFrequency(midi);
    const mag = goertzelWindowedMagnitude(windowed, hz, sampleRate);
    // Weight lower-mid fundamentals slightly more than high treble overtones
    const weight = midi <= 67 ? 1.0 : 0.72;
    hpcp[baseBin] += mag * weight;
  }

  // Smooth into adjacent third-semitone bins (0.25, 1.0, 0.25) & L2 normalize
  const smoothed = new Float32Array(36);
  for (let i = 0; i < 36; i += 1) {
    const prev = hpcp[(i + 35) % 36];
    const next = hpcp[(i + 1) % 36];
    smoothed[i] = hpcp[i] + 0.25 * (prev + next);
  }

  let normSq = 0;
  for (let i = 0; i < 36; i += 1) normSq += smoothed[i] * smoothed[i];
  const norm = Math.sqrt(normSq);
  if (norm > 0) {
    for (let i = 0; i < 36; i += 1) smoothed[i] /= norm;
  }

  return smoothed;
}

export function verifyChordAgainstScore(
  frame: Float32Array,
  sampleRate: number,
  expectedChordTones: readonly number[], // pitch classes e.g. [0, 4, 7, 11] for Cmaj7
  requiredGuideTones: readonly number[] = expectedChordTones,
): ChordVerificationResult {
  const hpcp36 = computeHpcp36(frame, sampleRate);
  const template = new Float32Array(36);
  const expectedSet = new Set(expectedChordTones.map((pc) => ((pc % 12) + 12) % 12));

  expectedSet.forEach((pc) => {
    const bin = pc * 3;
    template[bin] = 1.0;
    template[(bin + 35) % 36] = 0.25;
    template[(bin + 1) % 36] = 0.25;
  });

  let dot = 0;
  let normH = 0;
  let normT = 0;
  for (let i = 0; i < 36; i += 1) {
    dot += hpcp36[i] * template[i];
    normH += hpcp36[i] * hpcp36[i];
    normT += template[i] * template[i];
  }
  const cosineSimilarity =
    normH > 0 && normT > 0 ? dot / (Math.sqrt(normH) * Math.sqrt(normT)) : 0;

  // Check energy per pitch class (sum of 3 sub-bins)
  const pcEnergy = new Float32Array(12);
  let maxPcEnergy = 0;
  let clashEnergy = 0;
  let expectedEnergy = 0;
  for (let pc = 0; pc < 12; pc += 1) {
    const e = hpcp36[pc * 3];
    pcEnergy[pc] = e;
    if (e > maxPcEnergy) maxPcEnergy = e;
    if (expectedSet.has(pc)) expectedEnergy += e;
    else clashEnergy += e;
  }

  const presenceThreshold = Math.max(0.08, maxPcEnergy * 0.22);
  const presentChordTones: number[] = [];
  const missingChordTones: number[] = [];

  for (const pc of expectedSet) {
    if (pcEnergy[pc] >= presenceThreshold) presentChordTones.push(pc);
    else missingChordTones.push(pc);
  }

  const guidesPresent = requiredGuideTones.every(
    (g) => pcEnergy[((g % 12) + 12) % 12] >= presenceThreshold,
  );
  const clashRatio = expectedEnergy > 0 ? clashEnergy / (expectedEnergy + clashEnergy) : 1;

  const matched =
    cosineSimilarity >= 0.62 &&
    guidesPresent &&
    missingChordTones.length <= 1 &&
    clashRatio <= 0.4;

  return {
    matched,
    cosineSimilarity: Number(cosineSimilarity.toFixed(3)),
    presentChordTones,
    missingChordTones,
    clashRatio: Number(clashRatio.toFixed(3)),
    hpcp36,
  };
}
