export type AudioOutputMode =
  | 'silent-visual'
  | 'call-and-response'
  | 'headphones-direct';

export type InputProfileKind = 'interface' | 'laptop-mic' | 'micd-amp' | null;

const AUDIO_OUTPUT_MODE_KEY = 'sonicmambo:audioOutputMode';
const INPUT_PROFILE_KEY = 'sonicmambo:inputProfile';

export const CALL_RESPONSE_REVERB_TAIL_MS = 85;

export function readAudioOutputMode(): AudioOutputMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'silent-visual';
    const raw = window.localStorage.getItem(AUDIO_OUTPUT_MODE_KEY);
    if (
      raw === 'silent-visual' ||
      raw === 'call-and-response' ||
      raw === 'headphones-direct'
    ) {
      return raw;
    }
    return 'silent-visual';
  } catch {
    return 'silent-visual';
  }
}

export function writeAudioOutputMode(mode: AudioOutputMode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AUDIO_OUTPUT_MODE_KEY, mode);
    }
  } catch {
    // ignore storage errors
  }
}

export function readInputProfile(): InputProfileKind {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(INPUT_PROFILE_KEY);
    return raw === 'interface' || raw === 'laptop-mic' || raw === 'micd-amp'
      ? raw
      : null;
  } catch {
    return null;
  }
}

export function writeInputProfile(profile: Exclude<InputProfileKind, null>): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(INPUT_PROFILE_KEY, profile);
    }
  } catch {
    // ignore
  }
}

/**
 * App Sound Policy gate:
 * App audio must NEVER mix into live microphone guitar detection.
 * Simultaneous playback during active mic detection is allowed ONLY when
 * the user has explicitly selected `'headphones-direct'` AND uses an audio `'interface'`.
 */
export function canPlayDuringDetection(
  mode: AudioOutputMode,
  inputProfile: InputProfileKind,
): boolean {
  return mode === 'headphones-direct' && inputProfile === 'interface';
}

/**
 * Plays a clean plucked-guitar-like synth phrase via Web Audio while keeping
 * mic detection gated off during playback + `CALL_RESPONSE_REVERB_TAIL_MS`.
 */
export async function playProtectedPhrase(
  notes: readonly { frequencyHz: number; startSec: number; durationSec: number }[],
  options: {
    setInputGated: (gated: boolean) => void;
    onProgressNote?: (index: number) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const { setInputGated, onProgressNote, signal } = options;
  if (notes.length === 0) return;

  setInputGated(true);
  const ctx = new AudioContext();
  try {
    await ctx.resume();
    const baseTime = ctx.currentTime + 0.04;
    let maxEndSec = 0;

    notes.forEach((n, idx) => {
      const osc = ctx.createOscillator();
      const sub = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = n.frequencyHz;
      sub.type = 'sine';
      sub.frequency.value = n.frequencyHz * 2;

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(4500, n.frequencyHz * 6), baseTime + n.startSec);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(400, n.frequencyHz * 2.2),
        baseTime + n.startSec + Math.max(0.08, n.durationSec),
      );

      const start = baseTime + n.startSec;
      const end = start + Math.max(0.12, n.durationSec);
      if (end - baseTime > maxEndSec) maxEndSec = end - baseTime;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, end);

      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      sub.start(start);
      osc.stop(end + 0.02);
      sub.stop(end + 0.02);

      if (onProgressNote) {
        window.setTimeout(() => {
          if (!signal?.aborted) onProgressNote(idx);
        }, Math.max(0, Math.round(n.startSec * 1000)));
      }
    });

    const waitMs = Math.ceil(maxEndSec * 1000) + CALL_RESPONSE_REVERB_TAIL_MS;
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(resolve, waitMs);
      signal?.addEventListener(
        'abort',
        () => {
          window.clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  } finally {
    try {
      await ctx.close();
    } catch {
      // ignore
    }
    setInputGated(false);
  }
}
