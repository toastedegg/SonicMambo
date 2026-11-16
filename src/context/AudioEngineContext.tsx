import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AmpSettings } from '../audio/guitarAmpRig';
import {
  useAudioEngine,
  type AudioInputDeviceInfo,
  type DetectionSnapshot,
  type FrameListener,
  type InputChannelSelection,
  type NoteEventListener,
  type UseAudioEngineReturn,
} from '../hooks/useAudioEngine';

/**
 * Stable control & ref slice of the audio engine.
 * Does NOT include high-frequency `loudness` / `frequency` / `currentNote` state,
 * so consumers (like `CourseStageView` and `AppShell`) NEVER re-render during live play!
 */
export interface AudioEngineControl {
  isListening: boolean;
  isInputGated: boolean;
  audioLatencyMs: number;
  rmsThreshold: number;
  sampleRate: number;
  inputDevices: AudioInputDeviceInfo[];
  selectedDeviceId: string;
  channelSelection: InputChannelSelection;
  detectedChannelCount: number;
  activeChannelIndex: number;
  ampSettings: AmpSettings;
  error: string | null;
  detectionRef: React.MutableRefObject<DetectionSnapshot>;
  start: (overrideDeviceId?: string) => Promise<void>;
  stop: () => void;
  refreshDevices: () => Promise<void>;
  setSelectedDeviceId: (deviceId: string) => Promise<void>;
  setChannelSelection: (channel: InputChannelSelection) => void;
  updateAmpSettings: (partial: Partial<AmpSettings>) => Promise<void>;
  setRmsThreshold: (threshold: number) => void;
  resetNoiseCalibration: () => void;
  setInputGated: (gated: boolean) => void;
  resetDsp: () => void;
  subscribeFrames: (listener: FrameListener) => () => void;
  subscribeNoteEvents: (listener: NoteEventListener) => () => void;
}

const AudioEngineFullContext = createContext<UseAudioEngineReturn | null>(null);
const AudioEngineControlContext = createContext<AudioEngineControl | null>(null);

export function AudioEngineProvider({ children }: { children: ReactNode }) {
  const engine = useAudioEngine();

  const control = useMemo<AudioEngineControl>(
    () => ({
      isListening: engine.isListening,
      isInputGated: engine.isInputGated,
      audioLatencyMs: engine.audioLatencyMs,
      rmsThreshold: engine.rmsThreshold,
      sampleRate: engine.sampleRate,
      inputDevices: engine.inputDevices,
      selectedDeviceId: engine.selectedDeviceId,
      channelSelection: engine.channelSelection,
      detectedChannelCount: engine.detectedChannelCount,
      activeChannelIndex: engine.activeChannelIndex,
      ampSettings: engine.ampSettings,
      error: engine.error,
      detectionRef: engine.detectionRef,
      start: engine.start,
      stop: engine.stop,
      refreshDevices: engine.refreshDevices,
      setSelectedDeviceId: engine.setSelectedDeviceId,
      setChannelSelection: engine.setChannelSelection,
      updateAmpSettings: engine.updateAmpSettings,
      setRmsThreshold: engine.setRmsThreshold,
      resetNoiseCalibration: engine.resetNoiseCalibration,
      setInputGated: engine.setInputGated,
      resetDsp: engine.resetDsp,
      subscribeFrames: engine.subscribeFrames,
      subscribeNoteEvents: engine.subscribeNoteEvents,
    }),
    [
      engine.isListening,
      engine.isInputGated,
      engine.audioLatencyMs,
      engine.rmsThreshold,
      engine.sampleRate,
      engine.inputDevices,
      engine.selectedDeviceId,
      engine.channelSelection,
      engine.detectedChannelCount,
      engine.activeChannelIndex,
      engine.ampSettings,
      engine.error,
      engine.detectionRef,
      engine.start,
      engine.stop,
      engine.refreshDevices,
      engine.setSelectedDeviceId,
      engine.setChannelSelection,
      engine.updateAmpSettings,
      engine.setRmsThreshold,
      engine.resetNoiseCalibration,
      engine.setInputGated,
      engine.resetDsp,
      engine.subscribeFrames,
      engine.subscribeNoteEvents,
    ],
  );

  return (
    <AudioEngineControlContext.Provider value={control}>
      <AudioEngineFullContext.Provider value={engine}>
        {children}
      </AudioEngineFullContext.Provider>
    </AudioEngineControlContext.Provider>
  );
}

/** Use in Setup / MicCheck / Tuner where live React meter state is desired. */
export function useSharedAudioEngine(): UseAudioEngineReturn {
  const ctx = useContext(AudioEngineFullContext);
  if (!ctx) {
    throw new Error('useSharedAudioEngine must be used within an AudioEngineProvider');
  }
  return ctx;
}

/** Use in Stage / Pixi / AppShell for zero React re-renders during live guitar play. */
export function useAudioEngineControl(): AudioEngineControl {
  const ctx = useContext(AudioEngineControlContext);
  if (!ctx) {
    throw new Error('useAudioEngineControl must be used within an AudioEngineProvider');
  }
  return ctx;
}
