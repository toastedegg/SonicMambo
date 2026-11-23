import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetectedNote } from '../types/audio';
import {
  computeNoiseFloorThreshold,
  readCalibration,
  writeCalibration,
} from '../utils/calibrationStorage';

interface MicCheckProps {
  isListening: boolean;
  loudness: number;
  rmsThreshold: number;
  currentNote: DetectedNote | null;
  frequency: number | null;
  error: string | null;
  onCalibrateNoiseFloor?: (rmsThreshold: number) => void;
  onResetCalibration?: () => void;
  onSignalGood?: () => void;
}

const ZONES = {
  quiet: 0.03,
  good: 0.35,
  hot: 0.55,
} as const;

const GOOD_HOLD_MS = 500;
const NOISE_SAMPLE_DURATION_MS = 1500;

export function MicCheck({
  isListening,
  loudness,
  rmsThreshold,
  currentNote,
  frequency,
  error,
  onCalibrateNoiseFloor,
  onResetCalibration,
  onSignalGood,
}: MicCheckProps) {
  const [peak, setPeak] = useState(0);
  const goodSinceRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);

  const [calibrating, setCalibrating] = useState(false);
  const [calProgress, setCalProgress] = useState(0);
  const [calibratedMeta, setCalibratedMeta] = useState<{
    rmsThreshold: number;
    silenceRms: number;
  } | null>(() => {
    const saved = readCalibration();
    return saved
      ? { rmsThreshold: saved.rmsThreshold, silenceRms: saved.silenceRms }
      : null;
  });

  const noiseSamplesRef = useRef<number[]>([]);
  const calStartRef = useRef<number>(0);

  useEffect(() => {
    setPeak((prev) => {
      const decay = prev * 0.92;
      return Math.max(decay, loudness);
    });

    if (!isListening) {
      goodSinceRef.current = null;
      firedRef.current = false;
      setConfirmed(false);
      setCalibrating(false);
      return;
    }

    if (calibrating) {
      noiseSamplesRef.current.push(loudness);
      return;
    }

    const quietFloor = Math.max(rmsThreshold * 1.4, ZONES.quiet);
    const inGoodZone = loudness >= quietFloor && loudness <= ZONES.hot;
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
  }, [loudness, currentNote, isListening, calibrating, rmsThreshold, onSignalGood]);

  const startNoiseCalibration = useCallback(() => {
    if (!isListening) return;
    noiseSamplesRef.current = [loudness];
    calStartRef.current = performance.now();
    setCalProgress(0);
    setCalibrating(true);
  }, [isListening, loudness]);

  useEffect(() => {
    if (!calibrating) return undefined;

    const id = window.setInterval(() => {
      const elapsed = performance.now() - calStartRef.current;
      const pct = Math.min(100, Math.round((elapsed / NOISE_SAMPLE_DURATION_MS) * 100));
      setCalProgress(pct);

      if (elapsed >= NOISE_SAMPLE_DURATION_MS) {
        window.clearInterval(id);
        const result = computeNoiseFloorThreshold(noiseSamplesRef.current);
        writeCalibration({
          rmsThreshold: result.rmsThreshold,
          silenceRms: result.silenceRms,
        });
        setCalibratedMeta(result);
        onCalibrateNoiseFloor?.(result.rmsThreshold);
        setCalibrating(false);
        setCalProgress(100);
      }
    }, 50);

    return () => window.clearInterval(id);
  }, [calibrating, onCalibrateNoiseFloor]);

  const zone = getZone(loudness, rmsThreshold);

  return (
    <div className="sp-card-padded">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="sp-heading-md">Check your signal</h3>
          <p className="text-sm text-sp-text-sub mt-0.5">
            First calibrate your room&rsquo;s silence floor, then play any note on your guitar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {calibratedMeta && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sp-elevated text-sp-text-sub text-xs font-bold border border-white/10">
              Noise floor: {calibratedMeta.rmsThreshold.toFixed(4)}
            </span>
          )}
          {confirmed && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-sp-green/20 text-sp-green text-xs font-bold">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
              </svg>
              Signal looks good
            </span>
          )}
        </div>
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
          Microphone is off. Turn it on in the step above to calibrate and test your signal.
        </p>
      )}

      {isListening && (
        <>
          <div className="mb-5 p-3.5 rounded-lg bg-sp-elevated/70 border border-white/10 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">
                {calibrating
                  ? 'Listening to room silence... mute your strings'
                  : 'Noise-floor calibration (1.5s)'}
              </p>
              <p className="text-xs text-sp-text-sub mt-0.5">
                {calibrating
                  ? `Measuring background hum (${calProgress}%)`
                  : `Sets your gate threshold to 3\u00d7 room silence (active: ${rmsThreshold.toFixed(4)}) so faint hum never triggers false notes.`}
              </p>
              {calibrating && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-sp-black overflow-hidden">
                  <div
                    className="h-full bg-sp-green transition-all duration-75"
                    style={{ width: `${calProgress}%` }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={calibrating}
                onClick={startNoiseCalibration}
                className="sp-btn-secondary disabled:opacity-50"
              >
                {calibrating ? 'Measuring...' : 'Measure room noise (1.5s)'}
              </button>
              {onResetCalibration && (
                <button
                  type="button"
                  disabled={calibrating}
                  onClick={() => {
                    setCalibratedMeta(null);
                    onResetCalibration();
                  }}
                  className="sp-btn-ghost text-xs"
                >
                  Reset default
                </button>
              )}
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest mb-1.5">
              <span className="text-sp-text-muted">Input level</span>
              <span className={zoneTextClass(zone)}>{zoneLabel(zone)}</span>
            </div>
            <LoudnessMeter loudness={loudness} peak={peak} rmsThreshold={rmsThreshold} />
            <div className="flex justify-between text-[10px] text-sp-text-muted mt-1.5">
              <span>silent (&lt;{rmsThreshold.toFixed(3)})</span>
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

function LoudnessMeter({
  loudness,
  peak,
  rmsThreshold,
}: {
  loudness: number;
  peak: number;
  rmsThreshold: number;
}) {
  const quietFloor = Math.max(rmsThreshold * 1.4, ZONES.quiet);
  const scaled = Math.min(loudness / ZONES.hot, 1.2);
  const peakScaled = Math.min(peak / ZONES.hot, 1.2);
  const thresholdMark = Math.min(95, (rmsThreshold / ZONES.hot) * 100);
  const quietMark = (quietFloor / ZONES.hot) * 100;
  const goodMark = (ZONES.good / ZONES.hot) * 100;

  const fillColor =
    loudness < rmsThreshold
      ? 'bg-sp-text-muted'
      : loudness < quietFloor
        ? 'bg-sp-text-sub'
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
        className="absolute top-0 h-full w-0.5 bg-sp-green/70"
        title="Calibrated noise gate"
        style={{ left: `${thresholdMark}%` }}
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

function getZone(loudness: number, rmsThreshold: number): Zone {
  const quietFloor = Math.max(rmsThreshold * 1.4, ZONES.quiet);
  if (loudness < rmsThreshold) return 'silent';
  if (loudness < quietFloor) return 'quiet';
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
