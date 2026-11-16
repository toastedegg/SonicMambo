import { useCallback, useEffect, useRef, useState } from 'react';

import {
  GuitarAmpRig,
  readSavedAmpSettings,
  writeSavedAmpSettings,
  type AmpSettings,
} from '../audio/guitarAmpRig';
import { AUDIO } from '../config/staff';
import {
  createDetectorBackend,
  readDetectorBackend,
  type DetectorBackendKind,
} from '../dsp/mlBackends';
import { DspPipeline } from '../dsp/pipeline';
import type { NoteEvent, PitchFrame } from '../dsp/types';
import {
  type AudioEngineConfig,
  type AudioEngineState,
  DEFAULT_AUDIO_CONFIG,
  GUITAR_CAPTURE_CONSTRAINTS,
} from '../types/audio';
import { readCalibration, writeCalibration } from '../utils/calibrationStorage';
import { frequencyToNote } from '../utils/noteFromFrequency';

export interface DetectionSnapshot {
  hz: number | null;
  rawHz: number | null;
  midi: number | null;
  label: string | null;
  confidence: number;
  rms: number;
  timestamp: number;
  audioTimeMs: number;
  centsOffset: number | null;
  tuningOffsetCents: number;
}

export type InputChannelSelection = 'auto' | 'sum' | number;

export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
}

export interface UseAudioEngineOptions {
  config?: Partial<AudioEngineConfig>;
}

export type FrameListener = (frame: PitchFrame, tuningOffsetCents: number) => void;
export type NoteEventListener = (event: NoteEvent) => void;
export type RawAudioListener = (samples: Float32Array, sampleRate: number) => void;

export interface UseAudioEngineReturn extends AudioEngineState {
  smoothedFrequency: number | null;
  rmsThreshold: number;
  audioLatencyMs: number;
  sampleRate: number;
  isInputGated: boolean;
  inputDevices: AudioInputDeviceInfo[];
  selectedDeviceId: string;
  channelSelection: InputChannelSelection;
  detectedChannelCount: number;
  activeChannelIndex: number;
  ampSettings: AmpSettings;
  detectionRef: React.MutableRefObject<DetectionSnapshot>;
  start: (overrideDeviceId?: string) => Promise<void>;
  stop: () => void;
  refreshDevices: () => Promise<void>;
  setSelectedDeviceId: (deviceId: string) => Promise<void>;
  setChannelSelection: (channel: InputChannelSelection) => void;
  updateAmpSettings: (partial: Partial<AmpSettings>) => Promise<void>;
  setRmsThreshold: (threshold: number) => void;
  resetNoiseCalibration: () => void;
  setDetectorBackend: (backend: DetectorBackendKind) => void;
  detectorBackend: DetectorBackendKind;
  setRawCaptureEnabled: (enabled: boolean) => void;
  setInputGated: (gated: boolean) => void;
  resetDsp: () => void;
  subscribeFrames: (listener: FrameListener) => () => void;
  subscribeNoteEvents: (listener: NoteEventListener) => () => void;
  subscribeRawAudio: (listener: RawAudioListener) => () => void;
}

const INPUT_DEVICE_KEY = 'sonicmambo:inputDeviceId';
const INPUT_CHANNEL_KEY = 'sonicmambo:inputChannel';

function readSavedDeviceId(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return window.localStorage.getItem(INPUT_DEVICE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeSavedDeviceId(id: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (id) window.localStorage.setItem(INPUT_DEVICE_KEY, id);
      else window.localStorage.removeItem(INPUT_DEVICE_KEY);
    }
  } catch {
    // ignore
  }
}

function readSavedChannelSelection(): InputChannelSelection {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'auto';
    const raw = window.localStorage.getItem(INPUT_CHANNEL_KEY);
    if (!raw || raw === 'auto') return 'auto';
    if (raw === 'sum') return 'sum';
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 15 ? n : 'auto';
  } catch {
    return 'auto';
  }
}

function writeSavedChannelSelection(ch: InputChannelSelection): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(INPUT_CHANNEL_KEY, String(ch));
    }
  } catch {
    // ignore
  }
}

const EMPTY_DETECTION: DetectionSnapshot = {
  hz: null,
  rawHz: null,
  midi: null,
  label: null,
  confidence: 0,
  rms: 0,
  timestamp: 0,
  audioTimeMs: 0,
  centsOffset: null,
  tuningOffsetCents: 0,
};

type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'frame'; frame: PitchFrame; tuningOffsetCents: number }
  | { type: 'note-event'; note: NoteEvent }
  | { type: 'raw-chunk'; samples: Float32Array };

type WorkletStatusMessage = {
  type: 'input-status';
  channelCount: number;
  activeChannel: number;
};

export function useAudioEngine(options: UseAudioEngineOptions = {}): UseAudioEngineReturn {
  const initialThreshold =
    options.config?.rmsThreshold ??
    readCalibration()?.rmsThreshold ??
    DEFAULT_AUDIO_CONFIG.rmsThreshold;

  const config: AudioEngineConfig = {
    ...DEFAULT_AUDIO_CONFIG,
    ...options.config,
    rmsThreshold: initialThreshold,
  };

  const [state, setState] = useState<AudioEngineState & { smoothedFrequency: number | null }>({
    isListening: false,
    currentNote: null,
    frequency: null,
    smoothedFrequency: null,
    loudness: 0,
    error: null,
  });

  const [rmsThreshold, setRmsThresholdState] = useState<number>(initialThreshold);
  const [detectorBackend, setDetectorBackendState] = useState<DetectorBackendKind>(() =>
    readDetectorBackend(),
  );
  const [audioLatencyMs, setAudioLatencyMs] = useState<number>(0);
  const [sampleRate, setSampleRate] = useState<number>(44100);
  const [isInputGated, setIsInputGatedState] = useState<boolean>(false);
  const [inputDevices, setInputDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string>(() => readSavedDeviceId());
  const [channelSelection, setChannelSelectionState] = useState<InputChannelSelection>(() =>
    readSavedChannelSelection(),
  );
  const [detectedChannelCount, setDetectedChannelCount] = useState<number>(1);
  const [activeChannelIndex, setActiveChannelIndex] = useState<number>(0);
  const [ampSettings, setAmpSettingsState] = useState<AmpSettings>(() =>
    readSavedAmpSettings(),
  );

  const rmsThresholdRef = useRef<number>(initialThreshold);
  const detectorBackendRef = useRef<DetectorBackendKind>(detectorBackend);
  const selectedDeviceIdRef = useRef<string>(selectedDeviceId);
  const channelSelectionRef = useRef<InputChannelSelection>(channelSelection);
  const ampSettingsRef = useRef<AmpSettings>(ampSettings);
  const rawCaptureRef = useRef<boolean>(false);
  const inputGatedRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);
  const startingPromiseRef = useRef<Promise<void> | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Keep strong ref to MediaStreamAudioSourceNode to prevent Chromium GC bug (crbug.com/477364)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const ampRigRef = useRef<GuitarAmpRig | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const watchdogTimerRef = useRef<number>(0);
  const fallbackTimerRef = useRef<number>(0);
  const fallbackAnalysersRef = useRef<AnalyserNode[]>([]);
  const fallbackSplitterRef = useRef<ChannelSplitterNode | null>(null);
  const fallbackPipelineRef = useRef<DspPipeline | null>(null);

  const frameListenersRef = useRef<Set<FrameListener>>(new Set());
  const noteEventListenersRef = useRef<Set<NoteEventListener>>(new Set());
  const rawAudioListenersRef = useRef<Set<RawAudioListener>>(new Set());

  const lastReportedLabelRef = useRef<string | null>(null);
  const lastMeterStateAtRef = useRef<number>(0);
  const receivedWorkerFrameRef = useRef<boolean>(false);
  const detectionRef = useRef<DetectionSnapshot>({ ...EMPTY_DETECTION });

  const refreshDevices = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Audio Input ${idx + 1}`,
        }));
      setInputDevices(inputs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
      return undefined;
    }
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  const handlePipelineFrame = useCallback(
    (frame: PitchFrame, tuningOffsetCents: number) => {
      if (inputGatedRef.current) {
        detectionRef.current = { ...EMPTY_DETECTION, timestamp: performance.now() };
        return;
      }

      const now = performance.now();
      detectionRef.current = {
        hz: frame.smoothedHz,
        rawHz: frame.rawHz,
        midi: frame.midi,
        label: frame.label,
        confidence: frame.confidence,
        rms: frame.rms,
        timestamp: now,
        audioTimeMs: frame.timeMs,
        centsOffset: frame.centsOffset,
        tuningOffsetCents,
      };

      frameListenersRef.current.forEach((cb) => {
        cb(frame, tuningOffsetCents);
      });

      const labelChanged = frame.label !== lastReportedLabelRef.current;
      const meterDue = now - lastMeterStateAtRef.current >= AUDIO.meterUpdateIntervalMs;
      if (!labelChanged && !meterDue) return;

      lastReportedLabelRef.current = frame.label;
      lastMeterStateAtRef.current = now;

      setState((prev) => {
        const nextNote =
          frame.label && frame.smoothedHz != null
            ? (() => {
                const note = frequencyToNote(frame.smoothedHz);
                return note
                  ? {
                      name: note.name,
                      octave: note.octave,
                      label: frame.label!,
                      frequency: frame.smoothedHz!,
                    }
                  : prev.currentNote;
              })()
            : null;

        if (
          prev.currentNote?.label === (nextNote?.label ?? null) &&
          prev.smoothedFrequency === frame.smoothedHz &&
          Math.abs(prev.loudness - frame.rms) < 0.001
        ) {
          return prev;
        }

        return {
          ...prev,
          loudness: frame.rms,
          frequency: frame.rawHz,
          smoothedFrequency: frame.smoothedHz,
          currentNote: nextNote,
        };
      });
    },
    [],
  );

  const handlePipelineNoteEvent = useCallback((note: NoteEvent) => {
    if (inputGatedRef.current) return;
    noteEventListenersRef.current.forEach((cb) => {
      cb(note);
    });
  }, []);

  const startMultiChannelFallback = useCallback(
    (audioContext: AudioContext, source: MediaStreamAudioSourceNode, sr: number, chCount: number) => {
      if (fallbackTimerRef.current) {
        window.clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = 0;
      }

      const numChannels = Math.max(1, Math.min(8, chCount));
      const splitter = audioContext.createChannelSplitter(numChannels);
      source.connect(splitter);
      fallbackSplitterRef.current = splitter;

      const analysers: AnalyserNode[] = [];
      for (let ch = 0; ch < numChannels; ch += 1) {
        const an = audioContext.createAnalyser();
        an.fftSize = config.fftSize;
        an.smoothingTimeConstant = 0;
        splitter.connect(an, ch);
        analysers.push(an);
      }
      fallbackAnalysersRef.current = analysers;

      const pipeline = new DspPipeline({
        sampleRate: sr,
        frameSize: config.fftSize,
        hopSize: 256,
        rmsThreshold: rmsThresholdRef.current,
      });
      fallbackPipelineRef.current = pipeline;

      const hopBuf = new Float32Array(256);
      const chBuffers = analysers.map((an) => new Float32Array(an.fftSize));
      let activeCh = 0;

      fallbackTimerRef.current = window.setInterval(() => {
        const ctx = audioContextRef.current;
        const pipe = fallbackPipelineRef.current;
        if (!ctx || ctx.state === 'closed' || !pipe) return;

        for (let ch = 0; ch < analysers.length; ch += 1) {
          analysers[ch].getFloatTimeDomainData(chBuffers[ch]);
        }

        const mode = channelSelectionRef.current;
        if (mode === 'sum' && analysers.length > 1) {
          const offset = chBuffers[0].length - 256;
          for (let i = 0; i < 256; i += 1) {
            let s = 0;
            for (let ch = 0; ch < analysers.length; ch += 1) {
              s += chBuffers[ch][offset + i];
            }
            hopBuf[i] = s * 0.7071;
          }
          setActiveChannelIndex(-1);
        } else {
          let chosen = 0;
          if (typeof mode === 'number') {
            chosen = Math.max(0, Math.min(analysers.length - 1, mode));
          } else if (analysers.length > 1) {
            let bestCh = Math.min(activeCh, analysers.length - 1);
            let bestEnergy = 0;
            let curEnergy = 0;
            for (let ch = 0; ch < analysers.length; ch += 1) {
              const tail = chBuffers[ch];
              const startIdx = tail.length - 256;
              let e = 0;
              for (let i = startIdx; i < tail.length; i += 1) {
                e += tail[i] * tail[i];
              }
              if (ch === bestCh) curEnergy = e;
              if (e > bestEnergy) {
                bestEnergy = e;
                bestCh = ch;
              }
            }
            if (bestCh !== activeCh && bestEnergy / 256 > 1e-8 && bestEnergy > curEnergy * 1.35) {
              activeCh = bestCh;
            }
            chosen = activeCh;
          }
          const srcTail = chBuffers[chosen];
          hopBuf.set(srcTail.subarray(srcTail.length - 256));
          setActiveChannelIndex(chosen);
        }

        if (rawCaptureRef.current) {
          rawAudioListenersRef.current.forEach((cb) => cb(hopBuf.slice(), sr));
        }

        const { frames, noteEvents } = pipe.pushSamples(hopBuf, ctx.currentTime);
        const tuningOffset = pipe.getTuningOffsetCents();
        noteEvents.forEach(handlePipelineNoteEvent);
        if (frames.length > 0) {
          handlePipelineFrame(frames[frames.length - 1], tuningOffset);
        }
      }, 12);
    },
    [config.fftSize, handlePipelineFrame, handlePipelineNoteEvent],
  );

  const stop = useCallback(() => {
    isListeningRef.current = false;
    startingPromiseRef.current = null;

    if (watchdogTimerRef.current) {
      window.clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = 0;
    }

    if (fallbackTimerRef.current) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = 0;
    }

    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.postMessage({ type: 'stop' });
        workletNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      workletNodeRef.current = null;
    }

    if (fallbackSplitterRef.current) {
      try {
        fallbackSplitterRef.current.disconnect();
      } catch {
        // ignore
      }
      fallbackSplitterRef.current = null;
    }
    fallbackAnalysersRef.current = [];
    fallbackPipelineRef.current = null;

    if (ampRigRef.current) {
      ampRigRef.current.dispose();
      ampRigRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceNodeRef.current = null;
    }

    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {
        // ignore
      }
      silentGainRef.current = null;
    }

    if (workerRef.current) {
      try {
        workerRef.current.terminate();
      } catch {
        // ignore
      }
      workerRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {
        // ignore
      }
      audioContextRef.current = null;
    }

    lastReportedLabelRef.current = null;
    lastMeterStateAtRef.current = 0;
    receivedWorkerFrameRef.current = false;
    detectionRef.current = { ...EMPTY_DETECTION };

    setAudioLatencyMs(0);
    setState({
      isListening: false,
      currentNote: null,
      frequency: null,
      smoothedFrequency: null,
      loudness: 0,
      error: null,
    });
  }, []);

  const start = useCallback(
    async (overrideDeviceId?: string) => {
      if (startingPromiseRef.current && typeof overrideDeviceId !== 'string') {
        return startingPromiseRef.current;
      }

      const runStart = async () => {
        stop();

        const desiredDeviceId =
          typeof overrideDeviceId === 'string' ? overrideDeviceId : selectedDeviceIdRef.current;

        try {
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;
        const resumePromise =
          audioContext.state === 'suspended'
            ? audioContext.resume().catch(() => {})
            : Promise.resolve();

        const baseConstraints: MediaTrackConstraints = {
          ...GUITAR_CAPTURE_CONSTRAINTS,
          // Request up to 2 channels so guitar interfaces with Inst on Ch 2 deliver both channels!
          channelCount: { ideal: 2 },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: desiredDeviceId
              ? { ...baseConstraints, deviceId: { exact: desiredDeviceId } }
              : baseConstraints,
          });
        } catch (firstErr) {
          // If saved device was unplugged or driver rejected raw constraints, fall back gracefully
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: baseConstraints,
            });
          } catch {
            if (
              firstErr instanceof Error &&
              (firstErr.name === 'NotAllowedError' || firstErr.name === 'PermissionDeniedError')
            ) {
              throw firstErr;
            }
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
        }

        if (audioContextRef.current !== audioContext) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        void refreshDevices();

        const track = stream.getAudioTracks()[0];
        const trackSettings = track?.getSettings?.() ?? {};
        const reportedChCount = Math.max(1, trackSettings.channelCount ?? 2);
        setDetectedChannelCount(reportedChCount);

        if (trackSettings.deviceId && !desiredDeviceId) {
          // Keep empty string for system default unless explicitly selected
        }

        if (audioContext.state === 'suspended') {
          await Promise.race([
            resumePromise,
            audioContext.resume().catch(() => {}),
            new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
          ]);
        }

        const sr = audioContext.sampleRate;
        setSampleRate(sr);

        const baseLat = (audioContext as { baseLatency?: number }).baseLatency ?? 0;
        const outLat = (audioContext as { outputLatency?: number }).outputLatency ?? 0;
        setAudioLatencyMs(Math.round((baseLat + outLat) * 1000));

        const source = audioContext.createMediaStreamSource(stream);
        sourceNodeRef.current = source;

        // Parallel low-latency Guitar Amplifier & Cabinet Monitor Rig (does NOT color dry DSP path!)
        const ampRig = new GuitarAmpRig(audioContext, source, {
          ...ampSettingsRef.current,
          enabled: ampSettingsRef.current.enabled && !inputGatedRef.current,
        });
        ampRig.setChannelRouting(channelSelectionRef.current);
        ampRigRef.current = ampRig;

        const canUseWorklet =
          typeof audioContext.audioWorklet !== 'undefined' &&
          typeof Worker !== 'undefined' &&
          typeof MessageChannel !== 'undefined';

        isListeningRef.current = true;
        receivedWorkerFrameRef.current = false;
        setState((s) => ({ ...s, isListening: true, error: null }));

        if (canUseWorklet) {
          try {
            const workletUrl = `${import.meta.env.BASE_URL}capture-worklet.js?v=2`;
            await audioContext.audioWorklet.addModule(workletUrl);

            if (audioContextRef.current !== audioContext) return;

            // Do NOT clamp channelCount to 1 here — pass all interface channels into worklet!
            const workletNode = new AudioWorkletNode(
              audioContext,
              'sonicmambo-capture-processor',
              {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                channelCountMode: 'max',
              },
            );
            workletNodeRef.current = workletNode;

            workletNode.port.onmessage = (ev: MessageEvent<WorkletStatusMessage>) => {
              const data = ev.data;
              if (data && data.type === 'input-status') {
                setDetectedChannelCount(Math.max(1, data.channelCount));
                setActiveChannelIndex(data.activeChannel);
              }
            };

            const silentGain = audioContext.createGain();
            silentGain.gain.value = 0;
            silentGainRef.current = silentGain;

            const worker = new Worker(new URL('../workers/dspWorker.ts', import.meta.url), {
              type: 'module',
            });
            workerRef.current = worker;

            const switchToFallback = () => {
              if (audioContextRef.current !== audioContext) return;
              if (fallbackTimerRef.current) return;
              try {
                workletNode.disconnect();
              } catch {
                // ignore
              }
              workletNodeRef.current = null;
              worker.terminate();
              workerRef.current = null;
              startMultiChannelFallback(audioContext, source, sr, reportedChCount);
            };

            worker.onerror = (errEv) => {
              console.warn('DSP Worker error, switching to main-thread fallback:', errEv);
              switchToFallback();
            };

            const channel = new MessageChannel();

            worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
              const msg = event.data;
              if (!msg || typeof msg !== 'object') return;
              if (msg.type === 'frame') {
                receivedWorkerFrameRef.current = true;
                handlePipelineFrame(msg.frame, msg.tuningOffsetCents);
              } else if (msg.type === 'note-event') {
                receivedWorkerFrameRef.current = true;
                handlePipelineNoteEvent(msg.note);
              } else if (msg.type === 'raw-chunk') {
                rawAudioListenersRef.current.forEach((cb) => {
                  cb(msg.samples, sr);
                });
              }
            };

            worker.postMessage(
              {
                type: 'init',
                sampleRate: sr,
                rmsThreshold: rmsThresholdRef.current,
                backend: detectorBackendRef.current,
              },
              [channel.port1],
            );

            if (rawCaptureRef.current) {
              worker.postMessage({ type: 'config', recordRaw: true });
            }

            workletNode.port.postMessage(
              {
                type: 'connect-worker',
                channelMode: channelSelectionRef.current,
              },
              [channel.port2],
            );

            source.connect(workletNode);
            workletNode.connect(silentGain);
            silentGain.connect(audioContext.destination);

            // Watchdog: if no frames arrive from Worklet->Worker within 950ms, fall back seamlessly
            watchdogTimerRef.current = window.setTimeout(() => {
              if (
                audioContextRef.current === audioContext &&
                audioContext.state === 'running' &&
                !receivedWorkerFrameRef.current
              ) {
                switchToFallback();
              }
            }, 950);

            return;
          } catch (workletErr) {
            console.warn('AudioWorklet init failed, falling back to AnalyserNode:', workletErr);
            workletNodeRef.current = null;
            silentGainRef.current = null;
            workerRef.current?.terminate();
            workerRef.current = null;
          }
        }

        startMultiChannelFallback(audioContext, source, sr, reportedChCount);
      } catch (err) {
        isListeningRef.current = false;
        const message = err instanceof Error ? err.message : 'Failed to start microphone';
        setState((s) => ({
          ...s,
          isListening: false,
          error: message,
        }));
      } finally {
        startingPromiseRef.current = null;
      }
      };

      const p = runStart();
      startingPromiseRef.current = p;
      return p;
    },
    [handlePipelineFrame, handlePipelineNoteEvent, refreshDevices, startMultiChannelFallback, stop],
  );

  const setSelectedDeviceId = useCallback(
    async (deviceId: string) => {
      selectedDeviceIdRef.current = deviceId;
      setSelectedDeviceIdState(deviceId);
      writeSavedDeviceId(deviceId);
      if (isListeningRef.current) {
        await start(deviceId);
      }
    },
    [start],
  );

  const setChannelSelection = useCallback((channel: InputChannelSelection) => {
    channelSelectionRef.current = channel;
    setChannelSelectionState(channel);
    writeSavedChannelSelection(channel);
    ampRigRef.current?.setChannelRouting(channel);
    workletNodeRef.current?.port.postMessage({
      type: 'set-channel',
      channelMode: channel,
    });
  }, []);

  const updateAmpSettings = useCallback(
    async (partial: Partial<AmpSettings>) => {
      const next: AmpSettings = {
        ...ampSettingsRef.current,
        ...partial,
      };
      ampSettingsRef.current = next;
      setAmpSettingsState(next);
      writeSavedAmpSettings(next);

      if (next.enabled && !isListeningRef.current) {
        await start();
        return;
      }

      ampRigRef.current?.applySettings({
        ...next,
        enabled: next.enabled && !inputGatedRef.current,
      });
    },
    [start],
  );

  const setRmsThreshold = useCallback((threshold: number) => {
    const clamped = Math.min(0.08, Math.max(0.002, threshold));
    rmsThresholdRef.current = clamped;
    setRmsThresholdState(clamped);
    workerRef.current?.postMessage({ type: 'config', rmsThreshold: clamped });
    fallbackPipelineRef.current?.setRmsThreshold(clamped);
  }, []);

  const resetNoiseCalibration = useCallback(() => {
    const def = DEFAULT_AUDIO_CONFIG.rmsThreshold;
    writeCalibration({ rmsThreshold: def, silenceRms: def / 3 });
    setRmsThreshold(def);
  }, [setRmsThreshold]);

  const setDetectorBackend = useCallback((backend: DetectorBackendKind) => {
    detectorBackendRef.current = backend;
    setDetectorBackendState(backend);
    workerRef.current?.postMessage({ type: 'config', backend });
    fallbackPipelineRef.current?.setDetector(
      createDetectorBackend(backend, rmsThresholdRef.current),
    );
  }, []);

  const setRawCaptureEnabled = useCallback((enabled: boolean) => {
    rawCaptureRef.current = enabled;
    workerRef.current?.postMessage({ type: 'config', recordRaw: enabled });
  }, []);

  const setInputGated = useCallback((gated: boolean) => {
    inputGatedRef.current = gated;
    setIsInputGatedState(gated);
    ampRigRef.current?.applySettings({
      ...ampSettingsRef.current,
      enabled: ampSettingsRef.current.enabled && !gated,
    });
    if (gated) {
      detectionRef.current = { ...EMPTY_DETECTION, timestamp: performance.now() };
      setState((prev) => ({
        ...prev,
        currentNote: null,
        frequency: null,
        smoothedFrequency: null,
        loudness: 0,
      }));
    }
  }, []);

  const resetDsp = useCallback(() => {
    workerRef.current?.postMessage({ type: 'reset' });
    fallbackPipelineRef.current?.reset();
    lastReportedLabelRef.current = null;
    detectionRef.current = { ...EMPTY_DETECTION };
  }, []);

  const subscribeFrames = useCallback((listener: FrameListener) => {
    frameListenersRef.current.add(listener);
    return () => {
      frameListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeNoteEvents = useCallback((listener: NoteEventListener) => {
    noteEventListenersRef.current.add(listener);
    return () => {
      noteEventListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeRawAudio = useCallback((listener: RawAudioListener) => {
    rawAudioListenersRef.current.add(listener);
    return () => {
      rawAudioListenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    ...state,
    rmsThreshold,
    detectorBackend,
    audioLatencyMs,
    sampleRate,
    isInputGated,
    inputDevices,
    selectedDeviceId,
    channelSelection,
    detectedChannelCount,
    activeChannelIndex,
    ampSettings,
    detectionRef,
    start,
    stop,
    refreshDevices,
    setSelectedDeviceId,
    setChannelSelection,
    updateAmpSettings,
    setRmsThreshold,
    resetNoiseCalibration,
    setDetectorBackend,
    setRawCaptureEnabled,
    setInputGated,
    resetDsp,
    subscribeFrames,
    subscribeNoteEvents,
    subscribeRawAudio,
  };
}
