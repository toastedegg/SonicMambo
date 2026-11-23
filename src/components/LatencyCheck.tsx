import { useCallback, useEffect, useRef, useState } from 'react';
import { medianOf } from '../dsp/pitchSmoother';
import type { NoteEvent } from '../dsp/types';
import { readCalibration, writeCalibration } from '../utils/calibrationStorage';

interface LatencyCheckProps {
  isListening: boolean;
  audioLatencyMs: number;
  subscribeNoteEvents: (listener: (event: NoteEvent) => void) => () => void;
  detectionRef: React.MutableRefObject<{ rms: number; timestamp: number }>;
  onCalibrated?: (extraLatencyMs: number) => void;
}

const FLASH_COUNT = 5;
const FLASH_INTERVAL_MS = 750; // 80 BPM silent visual pulse

export function LatencyCheck({
  isListening,
  audioLatencyMs,
  subscribeNoteEvents,
  detectionRef,
  onCalibrated,
}: LatencyCheckProps) {
  const [running, setRunning] = useState(false);
  const [flashIndex, setFlashIndex] = useState<number>(-1);
  const [flashLit, setFlashLit] = useState(false);
  const [savedExtraMs, setSavedExtraMs] = useState<number>(
    () => readCalibration()?.extraLatencyMs ?? 0,
  );
  const [measuredSamples, setMeasuredSamples] = useState<number[]>([]);

  const flashTimesRef = useRef<number[]>([]);
  const capturedOffsetsRef = useRef<number[]>([]);
  const lastRmsTrigRef = useRef<number>(0);

  const stopTest = useCallback(
    (commit: boolean) => {
      setRunning(false);
      setFlashLit(false);
      setFlashIndex(-1);

      if (commit && capturedOffsetsRef.current.length >= 2) {
        const med = Math.round(medianOf(capturedOffsetsRef.current));
        const clamped = Math.max(-150, Math.min(250, med));
        writeCalibration({ extraLatencyMs: clamped });
        setSavedExtraMs(clamped);
        onCalibrated?.(clamped);
      }
    },
    [onCalibrated],
  );

  const startTest = useCallback(() => {
    if (!isListening) return;
    flashTimesRef.current = [];
    capturedOffsetsRef.current = [];
    setMeasuredSamples([]);
    setRunning(true);
    setFlashIndex(0);
  }, [isListening]);

  // Silent visual flash scheduler (strict App Sound Policy: 0 speaker sound!)
  useEffect(() => {
    if (!running) return undefined;

    let step = 0;
    const timers: number[] = [];

    const fireFlash = () => {
      if (step >= FLASH_COUNT) {
        stopTest(true);
        return;
      }
      const now = performance.now();
      flashTimesRef.current.push(now);
      setFlashIndex(step + 1);
      setFlashLit(true);
      timers.push(
        window.setTimeout(() => setFlashLit(false), 160),
      );
      step += 1;
      timers.push(window.setTimeout(fireFlash, FLASH_INTERVAL_MS));
    };

    timers.push(window.setTimeout(fireFlash, 500));

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [running, stopTest]);

  // Listen to NoteEvents + transient RMS spikes to match taps to flashes
  useEffect(() => {
    if (!running) return undefined;

    const recordTap = (tapWallMs: number) => {
      const flashes = flashTimesRef.current;
      if (flashes.length === 0) return;
      const latestFlash = flashes[flashes.length - 1];
      const delta = tapWallMs - latestFlash;
      if (delta >= -120 && delta <= 320 && capturedOffsetsRef.current.length < flashes.length) {
        capturedOffsetsRef.current.push(delta);
        setMeasuredSamples([...capturedOffsetsRef.current]);
      }
    };

    const unsub = subscribeNoteEvents(() => {
      recordTap(performance.now());
    });

    const poll = window.setInterval(() => {
      const rms = detectionRef.current.rms;
      const now = performance.now();
      if (rms > 0.04 && now - lastRmsTrigRef.current > 350) {
        lastRmsTrigRef.current = now;
        recordTap(now);
      }
    }, 12);

    return () => {
      unsub();
      window.clearInterval(poll);
    };
  }, [running, subscribeNoteEvents, detectionRef]);

  return (
    <div className="sp-card-padded">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="sp-heading-md">Latency compensation (optional)</h3>
          <p className="text-sm text-sp-text-sub mt-0.5 max-w-xl">
            Measures your browser &amp; interface input lag silently using visual flashes
            (zero speaker sound). Mute your strings and pluck once on each green flash.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-widest text-sp-text-muted">
            Total compensation
          </div>
          <div className="text-lg font-extrabold text-white tabular-nums">
            {audioLatencyMs + savedExtraMs} ms
          </div>
          <div className="text-[11px] text-sp-text-muted">
            HW {audioLatencyMs} ms + Cal {savedExtraMs >= 0 ? `+${savedExtraMs}` : savedExtraMs} ms
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 flex-wrap">
        <div
          className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-extrabold text-sm transition-all duration-75 ${
            flashLit
              ? 'bg-sp-green border-sp-green text-black scale-110 shadow-lg shadow-sp-green/40'
              : 'bg-sp-elevated border-white/10 text-sp-text-muted'
          }`}
        >
          {running ? `${flashIndex}/${FLASH_COUNT}` : 'PULSE'}
        </div>

        {!running ? (
          <button
            type="button"
            disabled={!isListening}
            onClick={startTest}
            className="sp-btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {savedExtraMs !== 0 ? 'Re-run tap calibration' : 'Start 5-flash tap test'}
          </button>
        ) : (
          <button type="button" onClick={() => stopTest(false)} className="sp-btn-secondary">
            Cancel
          </button>
        )}

        {savedExtraMs !== 0 && !running && (
          <button
            type="button"
            onClick={() => {
              writeCalibration({ extraLatencyMs: 0 });
              setSavedExtraMs(0);
              onCalibrated?.(0);
            }}
            className="text-xs text-sp-text-muted hover:text-white transition-colors"
          >
            Reset to 0 ms
          </button>
        )}

        {measuredSamples.length > 0 && (
          <span className="text-xs text-sp-text-sub tabular-nums">
            Captured {measuredSamples.length} taps ({measuredSamples.map((v) => `${Math.round(v)}ms`).join(', ')})
          </span>
        )}
      </div>
    </div>
  );
}
