import { useEffect, useRef, useState } from 'react';
import type { DetectedNote } from '../types/audio';

interface MicCheckProps {
  isListening: boolean;
  loudness: number;
  currentNote: DetectedNote | null;
  frequency: number | null;
  error: string | null;
  onSignalGood?: () => void;
}

/**
 * Loudness zones on the RMS 0..1 scale. Tuned for DI'd electric guitar through
 * an audio interface (Focusrite etc.) at sensible gain, and for a laptop mic.
 */
const ZONES = {
  silent: 0.01,
  quiet: 0.03,
  good: 0.35,
  hot: 0.55,
} as const;

const GOOD_HOLD_MS = 500;

export function MicCheck({
  isListening,
  loudness,
  currentNote,
  frequency,
  error,
  onSignalGood,
}: MicCheckProps) {
  const [peak, setPeak] = useState(0);
  const goodSinceRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setPeak((prev) => {
      const decay = prev * 0.92;
      return Math.max(decay, loudness);
    });

    if (!isListening) {
      goodSinceRef.current = null;
      firedRef.current = false;
      setConfirmed(false);
      return;
    }

    const inGoodZone = loudness >= ZONES.quiet && loudness <= ZONES.hot;
    const hasStableNote = currentNote != null;

    if (inGoodZone && hasStableNote) {
      if (goodSinceRef.current == null) goodSinceRef.current = performance.now();
      const held = performance.now() - goodSinceRef.current;
      if (held >= GOOD_HOLD_MS && !firedRef.current) {
        firedRef.current = true;
        setConfirmed(true);
        onSignalGood?.();
      }
    } else {
      goodSinceRef.current = null;
    }
  }, [loudness, currentNote, isListening, onSignalGood]);

  const zone = getZone(loudness);

  return (
    <div className="sp-card-padded">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="sp-heading-md">Check your signal</h3>
          <p className="text-sm text-sp-text-sub mt-0.5">
            Play any note on your guitar. You should see it detected below.
          </p>
        </div>
        {confirmed && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sp-green/20 text-sp-green text-xs font-bold">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
            </svg>
            Signal looks good
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-brand-red/15 border border-brand-red/30 text-sm text-brand-red">
          <strong>Microphone error:</strong> {error}
          <p className="text-xs mt-1 text-sp-text-sub">
            Make sure you allowed mic access in the browser prompt, and that this page is served over HTTPS or from localhost.
          </p>
        </div>
      )}

      {!isListening && !error && (
        <p className="text-sm text-sp-text-muted italic">
          Microphone is off. Turn it on in the step above to test your signal.
        </p>
      )}

      {isListening && (
        <>
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest mb-1.5">
              <span className="text-sp-text-muted">Input level</span>
              <span className={zoneTextClass(zone)}>{zoneLabel(zone)}</span>
            </div>
            <LoudnessMeter loudness={loudness} peak={peak} />
            <div className="flex justify-between text-[10px] text-sp-text-muted mt-1.5">
              <span>silent</span>
              <span>good</span>
              <span>too hot</span>
            </div>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted mb-1">
                Detected note
              </div>
              {currentNote ? (
                <div>
                  <div className="text-4xl font-extrabold text-white leading-none">
                    {currentNote.label}
                  </div>
                  {frequency != null && (
                    <div className="text-xs text-sp-text-muted mt-1">
                      {frequency.toFixed(1)} Hz
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sp-text-muted italic">Play something...</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LoudnessMeter({ loudness, peak }: { loudness: number; peak: number }) {
  const scaled = Math.min(loudness / ZONES.hot, 1.2);
  const peakScaled = Math.min(peak / ZONES.hot, 1.2);
  const quietMark = (ZONES.quiet / ZONES.hot) * 100;
  const goodMark = (ZONES.good / ZONES.hot) * 100;

  const fillColor =
    loudness < ZONES.quiet
      ? 'bg-sp-text-muted'
      : loudness < ZONES.good
        ? 'bg-sp-green'
        : loudness < ZONES.hot
          ? 'bg-yellow-400'
          : 'bg-brand-red';

  return (
    <div className="relative h-3 rounded-full bg-sp-elevated overflow-hidden">
      <div
        className={`absolute left-0 top-0 h-full transition-[width] duration-75 ${fillColor}`}
        style={{ width: `${Math.min(scaled * 100, 100)}%` }}
      />
      <div
        className="absolute top-0 h-full w-0.5 bg-white/70"
        style={{ left: `${Math.min(peakScaled * 100, 100)}%` }}
      />
      <div
        className="absolute top-0 h-full w-px bg-white/20"
        style={{ left: `${quietMark}%` }}
      />
      <div
        className="absolute top-0 h-full w-px bg-white/20"
        style={{ left: `${goodMark}%` }}
      />
    </div>
  );
}

type Zone = 'silent' | 'quiet' | 'good' | 'hot' | 'clipping';

function getZone(loudness: number): Zone {
  if (loudness < ZONES.silent) return 'silent';
  if (loudness < ZONES.quiet) return 'quiet';
  if (loudness < ZONES.good) return 'good';
  if (loudness < ZONES.hot) return 'hot';
  return 'clipping';
}

function zoneLabel(zone: Zone): string {
  switch (zone) {
    case 'silent':
      return 'No signal';
    case 'quiet':
      return 'Too quiet';
    case 'good':
      return 'Good';
    case 'hot':
      return 'Getting hot';
    case 'clipping':
      return 'Too hot \u2014 lower gain';
  }
}

function zoneTextClass(zone: Zone): string {
  switch (zone) {
    case 'silent':
    case 'quiet':
      return 'text-sp-text-muted';
    case 'good':
      return 'text-sp-green';
    case 'hot':
      return 'text-yellow-400';
    case 'clipping':
      return 'text-brand-red';
  }
}
