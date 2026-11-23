import { centsBetween, midiToFrequency } from '../utils/noteFromFrequency.ts';
import type { NoteEvent, PitchFrame } from './types.ts';

export type GuitarTechniqueKind =
  | 'normal'
  | 'bend'
  | 'slide'
  | 'vibrato'
  | 'hammer-pull'
  | 'palm-mute'
  | 'dead-note';

export interface TechniqueDetectionResult {
  techniques: GuitarTechniqueKind[];
  bendCentsPeak: number;
  slideSemitones: number;
  vibratoRateHz: number | null;
  vibratoDepthCents: number;
}

/**
 * Classifies guitar techniques from continuous `PitchFrame[]` curves and `NoteEvent` metadata:
 * - **Bend**: monotonic pitch rise `+80..+400` cents over `60..600 ms`
 * - **Slide**: rapid continuous pitch ramp `>= 200` cents across semitones
 * - **Vibrato**: periodic oscillation at `4.0..8.5 Hz` with `±15..±80` cents peak-to-peak
 * - **Hammer-on / Pull-off**: `event.isLegato === true`
 * - **Palm mute / Dead note**: rapid short decay (`< 90 ms` with low confidence `< 0.45` or rapid envelope drop)
 */
export function detectGuitarTechnique(
  event: NoteEvent,
  framesInNote: readonly PitchFrame[],
): TechniqueDetectionResult {
  const techniques: GuitarTechniqueKind[] = [];
  if (event.isLegato) techniques.push('hammer-pull');

  const voiced = framesInNote.filter(
    (f) => f.smoothedHz != null && f.confidence >= 0.45,
  );

  if (event.durationMs < 95 && event.confidence < 0.5) {
    techniques.push('dead-note');
    return {
      techniques,
      bendCentsPeak: 0,
      slideSemitones: 0,
      vibratoRateHz: null,
      vibratoDepthCents: 0,
    };
  }

  if (voiced.length < 4) {
    return {
      techniques: techniques.length > 0 ? techniques : ['normal'],
      bendCentsPeak: 0,
      slideSemitones: 0,
      vibratoRateHz: null,
      vibratoDepthCents: 0,
    };
  }

  const baseHz = voiced[0].smoothedHz!;
  const centsCurve = voiced.map((f) => ({
    timeMs: f.timeMs,
    cents: centsBetween(f.smoothedHz!, baseHz),
  }));

  const maxCents = Math.max(...centsCurve.map((c) => c.cents));
  const minCents = Math.min(...centsCurve.map((c) => c.cents));
  const totalDelta = centsCurve[centsCurve.length - 1].cents - centsCurve[0].cents;
  const durationSpanMs =
    centsCurve[centsCurve.length - 1].timeMs - centsCurve[0].timeMs;

  // Check Bend (+80..+400c rise reaching and holding above +80c)
  let bendCentsPeak = 0;
  if (
    maxCents >= 80 &&
    maxCents <= 420 &&
    durationSpanMs >= 60 &&
    totalDelta >= 75
  ) {
    // Distinguish bend (continuous microtonal rise) vs slide (stepped/large >= 200c ramp)
    let continuousSteps = 0;
    for (let i = 1; i < centsCurve.length; i += 1) {
      const step = centsCurve[i].cents - centsCurve[i - 1].cents;
      if (step > 0 && step < 75) continuousSteps += 1;
    }
    if (continuousSteps >= 2 && maxCents <= 280) {
      bendCentsPeak = Math.round(maxCents);
      techniques.push('bend');
    }
  }

  // Check Slide (>= 200 cents rapid shift between two fretted notes)
  let slideSemitones = 0;
  if (
    !techniques.includes('bend') &&
    Math.abs(totalDelta) >= 185 &&
    durationSpanMs <= 650
  ) {
    slideSemitones = Math.round(Math.abs(totalDelta) / 100);
    techniques.push('slide');
  }

  // Check Vibrato (periodic oscillation around mean cents: 4.0..8.5 Hz, ±15..±80c depth)
  const steadyCurve = centsCurve.slice(Math.min(2, centsCurve.length - 1));
  const meanC =
    steadyCurve.reduce((s, p) => s + p.cents, 0) / steadyCurve.length;
  const detrended = steadyCurve.map((p) => ({
    timeMs: p.timeMs,
    val: p.cents - meanC,
  }));

  let zeroCrossings = 0;
  for (let i = 1; i < detrended.length; i += 1) {
    if (
      (detrended[i - 1].val < 0 && detrended[i].val >= 0) ||
      (detrended[i - 1].val > 0 && detrended[i].val <= 0)
    ) {
      zeroCrossings += 1;
    }
  }
  const steadyDurSec =
    (detrended[detrended.length - 1].timeMs - detrended[0].timeMs) / 1000;
  const estRateHz = steadyDurSec > 0.15 ? zeroCrossings / 2 / steadyDurSec : 0;
  const vibratoDepthCents = Math.round(maxCents - minCents);

  let vibratoRateHz: number | null = null;
  if (
    !techniques.includes('bend') &&
    !techniques.includes('slide') &&
    estRateHz >= 3.8 &&
    estRateHz <= 8.8 &&
    vibratoDepthCents >= 15 &&
    vibratoDepthCents <= 110
  ) {
    vibratoRateHz = Math.round(estRateHz * 10) / 10;
    techniques.push('vibrato');
  }

  // Palm mute heuristic: rapid RMS decay (>75% drop within 130 ms while pitch stays flat)
  if (
    techniques.length === 0 &&
    event.durationMs <= 165 &&
    framesInNote.length >= 4
  ) {
    const peakRms = Math.max(...framesInNote.map((f) => f.rms));
    const tailRms = framesInNote[framesInNote.length - 1].rms;
    if (peakRms > 0 && tailRms / peakRms <= 0.25) {
      techniques.push('palm-mute');
    }
  }

  void midiToFrequency;
  if (techniques.length === 0) techniques.push('normal');

  return {
    techniques,
    bendCentsPeak,
    slideSemitones,
    vibratoRateHz,
    vibratoDepthCents,
  };
}
