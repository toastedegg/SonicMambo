import { useCallback, useEffect, useRef, useState } from 'react';

// @ts-ignore - essentia.js doesn't ship with official TS types yet
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
// @ts-ignore
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';

import {
  type AudioEngineConfig,
  type AudioEngineState,
  DEFAULT_AUDIO_CONFIG,
} from '../types/audio';
import { frequencyToNoteString, frequencyToNote } from '../utils/noteFromFrequency';
import { AUDIO } from '../config/staff';

export interface UseAudioEngineOptions {
  config?: Partial<AudioEngineConfig>;
}

export interface UseAudioEngineReturn extends AudioEngineState {
  /** Smoothed frequency in Hz (EMA). null when silent / low confidence. */
  smoothedFrequency: number | null;
  /** Mutable ref mirror of the latest detection, for high-frequency consumers. */
  detectionRef: React.MutableRefObject<{
    hz: number | null;
    label: string | null;
    confidence: number;
    timestamp: number;
  }>;
  start: () => Promise<void>;
  stop: () => void;
}

export function useAudioEngine(options: UseAudioEngineOptions = {}): UseAudioEngineReturn {
  const config: AudioEngineConfig = { ...DEFAULT_AUDIO_CONFIG, ...options.config };

  const [state, setState] = useState<AudioEngineState & { smoothedFrequency: number | null }>({
    isListening: false,
    currentNote: null,
    frequency: null,
    smoothedFrequency: null,
    loudness: 0,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array | null>(null);
  const essentiaRef = useRef<any>(null);

  // Smoothing / hysteresis state (lives across ticks, not React renders).
  const smoothedHzRef = useRef<number | null>(null);
  const lastGoodAtRef = useRef<number>(0);
  const candidateLabelRef = useRef<string | null>(null);
  const candidateStreakRef = useRef<number>(0);
  const stableLabelRef = useRef<string | null>(null);

  // Ref mirror so render loops (Pixi ticker, scoring RAF) can read without re-rendering React.
  const detectionRef = useRef<{
    hz: number | null;
    label: string | null;
    confidence: number;
    timestamp: number;
  }>({ hz: null, label: null, confidence: 0, timestamp: 0 });

  const stop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;

    if (essentiaRef.current) {
      essentiaRef.current = null;
    }

    smoothedHzRef.current = null;
    lastGoodAtRef.current = 0;
    candidateLabelRef.current = null;
    candidateStreakRef.current = 0;
    stableLabelRef.current = null;
    detectionRef.current = { hz: null, label: null, confidence: 0, timestamp: 0 };

    setState({
      isListening: false,
      currentNote: null,
      frequency: null,
      smoothedFrequency: null,
      loudness: 0,
      error: null,
    });
  }, []);

  const start = useCallback(async () => {
    stop();

    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      await audioContext.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = config.fftSize;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.fftSize;
      const buffer = new Float32Array(bufferLength);
      bufferRef.current = buffer;

      const essentia = new Essentia(EssentiaWASM);
      essentiaRef.current = essentia;

      const sampleRate = audioContext.sampleRate;

      setState((s) => ({ ...s, isListening: true, error: null }));

      const tick = () => {
        const ctx = audioContextRef.current;
        const analyserNode = analyserRef.current;
        const buf = bufferRef.current;
        const ess = essentiaRef.current;

        if (!ctx || ctx.state === 'closed' || !analyserNode || !buf || !ess) {
          return;
        }

        (analyserNode as unknown as {
          getFloatTimeDomainData: (array: Float32Array) => void;
        }).getFloatTimeDomainData(buf);

        const audioVector = ess.arrayToVector(buf);

        let rms = 0;
        let rawFrequency: number | null = null;
        let confidence = 0;

        try {
          rms = ess.RMS(audioVector).rms;

          if (rms > config.rmsThreshold) {
            const pitchData = ess.PitchYin(
              audioVector,
              config.fftSize,
              true,
              config.maxFrequency,
              config.minFrequency,
              sampleRate,
              0.15,
            );
            rawFrequency = pitchData.pitch;
            confidence = pitchData.pitchConfidence;
          }
        } finally {
          audioVector.delete?.();
        }

        const now = performance.now();
        const hasGoodDetection =
          rawFrequency != null
          && Number.isFinite(rawFrequency)
          && rawFrequency > 0
          && confidence > AUDIO.minConfidence;

        let smoothedHz = smoothedHzRef.current;
        let reportedLabel: string | null = stableLabelRef.current;

        if (hasGoodDetection) {
          const alpha = AUDIO.frequencyEmaAlpha;
          smoothedHz = smoothedHz == null
            ? (rawFrequency as number)
            : smoothedHz + alpha * ((rawFrequency as number) - smoothedHz);
          smoothedHzRef.current = smoothedHz;
          lastGoodAtRef.current = now;

          const candidate = frequencyToNoteString(smoothedHz);
          if (candidate === stableLabelRef.current) {
            // already stable, keep streak at max
            candidateLabelRef.current = candidate;
            candidateStreakRef.current = AUDIO.labelStabilityFrames;
          } else if (candidate === candidateLabelRef.current) {
            candidateStreakRef.current += 1;
            if (candidateStreakRef.current >= AUDIO.labelStabilityFrames) {
              stableLabelRef.current = candidate;
              reportedLabel = candidate;
            }
          } else {
            candidateLabelRef.current = candidate;
            candidateStreakRef.current = 1;
          }
        } else if (now - lastGoodAtRef.current > AUDIO.pitchHoldMs) {
          // Long enough silence: clear everything.
          smoothedHz = null;
          smoothedHzRef.current = null;
          stableLabelRef.current = null;
          candidateLabelRef.current = null;
          candidateStreakRef.current = 0;
          reportedLabel = null;
        }

        // Update ref mirror every frame for high-frequency consumers.
        detectionRef.current = {
          hz: smoothedHz,
          label: reportedLabel,
          confidence,
          timestamp: now,
        };

        setState((prev) => {
          const nextNote =
            reportedLabel && smoothedHz != null
              ? (() => {
                  const note = frequencyToNote(smoothedHz);
                  return note
                    ? { name: note.name, octave: note.octave, label: reportedLabel!, frequency: smoothedHz! }
                    : prev.currentNote;
                })()
              : null;

          return {
            ...prev,
            loudness: rms,
            frequency: hasGoodDetection ? (rawFrequency as number) : null,
            smoothedFrequency: smoothedHz,
            currentNote: nextNote,
          };
        });
      };

      const loop = () => {
        tick();
        rafIdRef.current = requestAnimationFrame(loop);
      };
      rafIdRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start microphone';
      setState((s) => ({
        ...s,
        isListening: false,
        error: message,
      }));
    }
  }, [config.bufferLength, config.fftSize, config.maxFrequency, config.minFrequency, config.rmsThreshold, stop]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { ...state, detectionRef, start, stop };
}
