/**
 * Tuning constants for the scrolling staff engine and lesson scoring.
 * Keep all feel/responsiveness knobs here so they can be adjusted in one place.
 */

export const STAFF = {
  /** Horizontal distance (px) representing one beat in the scrolling view. */
  pixelsPerBeat: 160,
  /** Fraction of the viewport width at which the fixed hit line sits. */
  hitLineFraction: 0.3,
  /** Vertical gap between adjacent staff lines (px). Diatonic step = half of this. */
  lineGap: 14,
  /** Staff top line y (px), measured from the top of the canvas. */
  topLineY: 80,
  /** How many beats of lead-in are shown before the first note reaches the hit line. */
  leadInBeats: 1.5,
  /** How many beats of trailing "past" view to keep visible after the hit line. */
  trailBeats: 0.5,
  /** Maximum pitch samples kept for the ribbon (~2s at 60fps). */
  ribbonBufferSize: 160,
  /** How long (ms) a sample stays visible in the ribbon before being dropped. */
  ribbonWindowMs: 2500,
  /** Flash duration (ms) on hit/miss events at the hit line. */
  flashDurationMs: 360,
} as const;

export const SCORING = {
  /** Minimum ratio of matching frames inside the scoring window to register a hit. */
  hitRatio: 0.5,
  /** Tolerance around each note's time window, in beats. Allows slight early/late. */
  toleranceBeats: 0.25,
} as const;

export const AUDIO = {
  /** EMA smoothing factor for frequency (0..1). Higher = more responsive, less smooth. */
  frequencyEmaAlpha: 0.3,
  /** Minimum pitch confidence to accept a detection. */
  minConfidence: 0.5,
  /** Number of consecutive stable frames required before changing the reported label. */
  labelStabilityFrames: 3,
  /** Hold the last good pitch this long (ms) before declaring silence, to ride out dropouts. */
  pitchHoldMs: 150,
} as const;
