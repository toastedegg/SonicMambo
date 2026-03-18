import { useCallback, useEffect, useRef, useState } from 'react';

// Import Essentia.js (Exact paths might vary slightly based on your bundler/Vite setup)
// @ts-ignore - essentia.js doesn't ship with official TS types yet
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";// @ts-ignore
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';

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
  const rafIdRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array | null>(null);
  
  // Store the Essentia instance
  const essentiaRef = useRef<any>(null);

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

    // Optional: free memory used by the WASM module
    if (essentiaRef.current) {
      essentiaRef.current = null;
    }

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

      // Initialize the Essentia WebAssembly instance
      const essentia = new Essentia(EssentiaWASM);
      essentiaRef.current = essentia;

      setState((s) => ({ ...s, isListening: true, error: null }));

      const tick = () => {
        const ctx = audioContextRef.current;
        const analyserNode = analyserRef.current;
        const buf = bufferRef.current;
        const ess = essentiaRef.current;

        if (!ctx || ctx.state === 'closed' || !analyserNode || !buf || !ess) {
          return;
        }

        analyserNode.getFloatTimeDomainData(buf as any);

        // Convert the Float32Array into an Essentia internal C++ vector
        const audioVector = ess.arrayToVector(buf);

        // Calculate RMS loudness synchronously
        const rms = ess.RMS(audioVector).rms;

        setState((prev) => ({ ...prev, loudness: rms }));

        if (rms > config.rmsThreshold) {
          // Detect pitch using Yin Probabilistic (ideal for guitar strings)
          // Returns { pitch: number, pitchConfidence: number }
          const pitchData = ess.PitchYinProbabilistic(audioVector, config.fftSize, Math.floor(config.fftSize / 2));
          const frequency = pitchData.pitch;
          const confidence = pitchData.pitchConfidence;

          // Added confidence check (> 0.5) to reject false positives or harmonic noise
          if (frequency != null && Number.isFinite(frequency) && frequency > 0 && confidence > 0.5) {
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