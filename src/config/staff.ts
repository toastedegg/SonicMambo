/**
 * Tuning constants for the static staff layout and lesson scoring.
 * Keep all feel/responsiveness knobs here so they can be adjusted in one place.
 */

export const STAFF = {
  /** Vertical gap between adjacent staff lines (px). Diatonic step = half of this. */
  lineGap: 14,
  /** Staff top line y (px), measured from the top of the canvas. */
  topLineY: 80,
  /** Reserved area at the left for the brace / clef marker. */
  clefWidth: 48,
  /** Horizontal breathing room at the left (after the clef) and right of the note row. */
  leftPadding: 28,
  rightPadding: 28,
  /** Lower bound on per-note slot width when notes compress into a narrow viewport. */
  minSlotWidth: 60,
  /** Duration (ms) of the local pulse animation when a note finalizes as hit or miss. */
  activePulseDurationMs: 420,
} as const;

export const SCORING = {
  /** Max absolute cents deviation (after session tuning offset) to count as matching. */
  matchCentsTolerance: 50,
  /** Target steady hold time (ms) within cents tolerance to register a hit on medium/long notes. */
  holdDurationMs: 90,
  /** Fraction of note duration required for very fast notes (e.g. 16th notes at 112+ BPM). */
  minHoldDurationRatio: 0.28,
  /** Absolute floor on required hold duration (ms) for rapid 16th/32nd passages. */
  minHoldFloorMs: 28,
  /** Short dropout grace period (ms) bridging vibrato peaks or pick scrapes without resetting streak. */
  dropoutGraceMs: 42,
  /** Early window padding in beats (clamped to 140 ms max). */
  earlyToleranceBeats: 0.25,
  /** Late window padding in beats (clamped to 210 ms max). */
  lateToleranceBeats: 0.35,
  /** Legacy frame-ratio constant kept only for M0 benchmark comparisons. */
  hitRatio: 0.5,
  /** Legacy beat tolerance constant kept only for M0 benchmark comparisons. */
  toleranceBeats: 0.25,
} as const;

export const LESSON = {
  /** Countdown seconds shown before lesson scoring begins. */
  countdownSeconds: 3,
  /** Note sequence (labels) that starts a lesson when played in order on the guitar. */
  guitarStartSequence: ['E3', 'G3', 'C4'] as readonly string[],
  /** Max gap (ms) between consecutive notes in the start sequence before it resets. */
  guitarStartSequenceGapMs: 2000,
} as const;

export const AUDIO = {
  /** Window length (frames) for median pitch smoothing in semitones. */
  medianWindowFrames: 3,
  /** Pitch jump threshold (semitones) that triggers filter reset once confirmed (2 frames). */
  jumpResetSemitones: 0.85,
  /** Minimum pitch clarity/confidence (0..1) to accept a detection. */
  minConfidence: 0.58,
  /** Hold the last good pitch this long (ms) before declaring silence, to ride out dropouts. */
  pitchHoldMs: 95,
  /** Throttle interval (ms) for React loudness/frequency meter state (~15 Hz). */
  meterUpdateIntervalMs: 66,
  /** High-pass cutoff frequency (Hz) removing DC offset, handling thump, and 50/60 Hz hum. */
  highPassCutoffHz: 60,
} as const;
