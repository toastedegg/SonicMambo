import { useCallback, useEffect, useRef, useState } from 'react';
import Meyda from 'meyda';
import * as Pitchfinder from 'pitchfinder';
import {
  type AudioEngineConfig,
  type AudioEngineState,
  DEFAULT_AUDIO_CONFIG,
} from '../types/audio';
import { frequencyToNoteString, frequencyToNote } from '../utils/noteFromFrequency';

export interface UseAudioEngineOptions {
  config?: Partial<AudioEngineConfig>;
}

export function useAudioEngine(options: UseAudioEngineOptions = {}): AudioEngineState & {
  start: () => Promise<void>;
  stop: () => void;
} {
  const config: AudioEngineConfig = { ...DEFAULT_AUDIO_CONFIG, ...options.config };

  const [state, setState] = useState<AudioEngineState>({
    isListening: false,
    currentNote: null,
    frequency: null,
    loudness: 0,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meydaAnalyzerRef = useRef<{ start(): void; stop(): void } | null>(null);
  const rafIdRef = useRef<number>(0);
  const rmsRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array | null>(null);
  const detectPitchRef = useRef<((buffer: Float32Array) => number | null) | null>(null);

  const stop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    meydaAnalyzerRef.current?.stop();
    meydaAnalyzerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    rmsRef.current = 0;
    setState({
      isListening: false,
      currentNote: null,
      frequency: null,
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

      const sampleRate = audioContext.sampleRate;
      detectPitchRef.current = Pitchfinder.AMDF({
        sampleRate,
        minFrequency: config.minFrequency,
        maxFrequency: config.maxFrequency,
      });

      const meydaAnalyzer = Meyda.createMeydaAnalyzer({
        audioContext,
        source: source as unknown as AudioNode,
        bufferSize: config.bufferLength,
        featureExtractors: ['rms'],
        callback: (features: { rms?: number }) => {
          rmsRef.current = typeof features?.rms === 'number' ? features.rms : 0;
        },
      });
      meydaAnalyzer.start();
      meydaAnalyzerRef.current = meydaAnalyzer;

      setState((s) => ({ ...s, isListening: true, error: null }));

      const tick = () => {
        const ctx = audioContextRef.current;
        const analyserNode = analyserRef.current;
        const buf = bufferRef.current;
        const detectPitch = detectPitchRef.current;

        if (!ctx || ctx.state === 'closed' || !analyserNode || !buf || !detectPitch) {
          return;
        }

        analyserNode.getFloatTimeDomainData(buf);
        const rms = rmsRef.current;

        setState((prev) => ({ ...prev, loudness: rms }));

        if (rms > config.rmsThreshold) {
          const frequency = detectPitch(buf);
          if (frequency != null && Number.isFinite(frequency) && frequency > 0) {
            const note = frequencyToNote(frequency);
            const label = frequencyToNoteString(frequency);
            setState((prev) => ({
              ...prev,
              frequency,
              currentNote: note && label
                ? { name: note.name, octave: note.octave, label, frequency }
                : prev.currentNote,
              loudness: rms,
            }));
            return;
          }
        }

        setState((prev) => ({
          ...prev,
          frequency: null,
          currentNote: null,
        }));
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

  return { ...state, start, stop };
}
