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
  /** Minimum ratio of matching frames inside the scoring window to register a hit. */
  hitRatio: 0.5,
  /** Tolerance around each note's time window, in beats. Allows slight early/late. */
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
  /** EMA smoothing factor for frequency (0..1). Higher = more responsive, less smooth. */
  frequencyEmaAlpha: 0.3,
  /** Minimum pitch confidence to accept a detection. */
  minConfidence: 0.5,
  /** Number of consecutive stable frames required before changing the reported label. */
  labelStabilityFrames: 3,
  /** Hold the last good pitch this long (ms) before declaring silence, to ride out dropouts. */
  pitchHoldMs: 150,
} as const;
