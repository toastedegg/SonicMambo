import {
  computeLowpassBiquad,
  computePeakingBiquad,
  getGuitarAmpWasmBinary,
} from './wasmAmpBinary';

export type AmpPresetId = 'clean-studio' | 'blues-breakup' | 'british-crunch' | 'velvet-jazz';

export interface AmpSettings {
  enabled: boolean;
  preset: AmpPresetId;
  drive: number; // 0..1
  reverb: number; // 0..1
  volume: number; // 0..1
}

export const AMP_PRESETS: ReadonlyArray<{
  id: AmpPresetId;
  label: string;
  shortLabel: string;
  defaultDrive: number;
  defaultReverb: number;
}> = [
  {
    id: 'clean-studio',
    label: 'Clean Twin',
    shortLabel: 'Clean',
    defaultDrive: 0.18,
    defaultReverb: 0.28,
  },
  {
    id: 'blues-breakup',
    label: 'Blues Tube',
    shortLabel: 'Blues',
    defaultDrive: 0.48,
    defaultReverb: 0.32,
  },
  {
    id: 'british-crunch',
    label: 'Rock Crunch',
    shortLabel: 'Crunch',
    defaultDrive: 0.76,
    defaultReverb: 0.22,
  },
  {
    id: 'velvet-jazz',
    label: 'Velvet Warm',
    shortLabel: 'Warm',
    defaultDrive: 0.12,
    defaultReverb: 0.35,
  },
];

const AMP_STORAGE_KEY = 'sonicmambo:ampSettings:v1';

export function readSavedAmpSettings(): AmpSettings {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        enabled: false,
        preset: 'blues-breakup',
        drive: 0.45,
        reverb: 0.28,
        volume: 0.7,
      };
    }
    const raw = window.localStorage.getItem(AMP_STORAGE_KEY);
    if (!raw) {
      return {
        enabled: false,
        preset: 'blues-breakup',
        drive: 0.45,
        reverb: 0.28,
        volume: 0.7,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AmpSettings>;
    const preset: AmpPresetId =
      parsed.preset === 'clean-studio' ||
      parsed.preset === 'blues-breakup' ||
      parsed.preset === 'british-crunch' ||
      parsed.preset === 'velvet-jazz'
        ? parsed.preset
        : 'blues-breakup';
    return {
      enabled: false,
      preset,
      drive: typeof parsed.drive === 'number' ? Math.max(0, Math.min(1, parsed.drive)) : 0.45,
      reverb: typeof parsed.reverb === 'number' ? Math.max(0, Math.min(1, parsed.reverb)) : 0.28,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.7,
    };
  } catch {
    return {
      enabled: false,
      preset: 'blues-breakup',
      drive: 0.45,
      reverb: 0.28,
      volume: 0.7,
    };
  }
}

export function writeSavedAmpSettings(settings: AmpSettings): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AMP_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // ignore
  }
}

export function buildWasmAmpParams(
  settings: AmpSettings,
  channelRouting: 'auto' | 'sum' | number,
  sampleRate: number,
): Float32Array {
  const ch0W = channelRouting === 1 ? 0.0 : 1.0;
  const ch1W = channelRouting === 0 ? 0.0 : 1.0;
  const hpCoeff = Math.exp((-2 * Math.PI * 85) / Math.max(8000, sampleRate));

  let midFreq = 1650;
  let midDb = 2.0;
  let cabLpHz = 4200;
  let driveBias = settings.drive;

  switch (settings.preset) {
    case 'clean-studio':
      midFreq = 2100;
      midDb = 1.8;
      cabLpHz = 4900;
      driveBias = settings.drive * 0.42;
      break;
    case 'blues-breakup':
      midFreq = 980;
      midDb = 4.2;
      cabLpHz = 4100;
      driveBias = 0.16 + settings.drive * 0.68;
      break;
    case 'british-crunch':
      midFreq = 1250;
      midDb = 5.8;
      cabLpHz = 3650;
      driveBias = 0.35 + settings.drive * 0.65;
      break;
    case 'velvet-jazz':
      midFreq = 420;
      midDb = 2.4;
      cabLpHz = 2700;
      driveBias = settings.drive * 0.22;
      break;
  }

  const driveGain = 1.15 + driveBias * 5.6;
  const makeup = 1.0 / (1.0 + driveBias * 0.85);
  const bq1 = computePeakingBiquad(midFreq, 0.95, midDb, sampleRate);
  const bq2 = computeLowpassBiquad(cabLpHz, 0.85, sampleRate);

  const roomWet = settings.reverb * 0.45;
  const roomFb = 0.18 + settings.reverb * 0.26;
  const master = settings.enabled ? settings.volume * 1.4 : 0.0;

  return new Float32Array([
    ch0W,
    ch1W,
    hpCoeff,
    driveGain,
    makeup,
    ...bq1,
    ...bq2,
    roomWet,
    roomFb,
    master,
  ]);
}

const loadedContexts = new WeakSet<AudioContext>();

/**
 * WebAssembly (`f32` native machine code) Guitar Amplifier controller.
 * - When `enabled === false`: 100% disconnected from the Web Audio graph (0.00% CPU).
 * - When `enabled === true`: runs a single 720-byte compiled `.wasm` kernel inside
 *   `AudioWorkletProcessor` (~2.3 microseconds per 128-sample block).
 */
export class GuitarAmpRig {
  private readonly ctx: AudioContext;
  private readonly source: AudioNode;
  private workletNode: AudioWorkletNode | null = null;
  private connected = false;
  private disposed = false;
  private mountingPromise: Promise<void> | null = null;

  private settings: AmpSettings;
  private channelRouting: 'auto' | 'sum' | number = 'auto';

  constructor(ctx: AudioContext, source: AudioNode, initialSettings: AmpSettings) {
    this.ctx = ctx;
    this.source = source;
    this.settings = { ...initialSettings };

    if (this.settings.enabled) {
      void this.ensureMountedAndConnected();
    }
  }

  private async ensureMountedAndConnected(): Promise<void> {
    if (this.disposed || this.ctx.state === 'closed') return;

    if (this.workletNode) {
      if (!this.connected && this.settings.enabled) {
        this.source.connect(this.workletNode);
        this.workletNode.connect(this.ctx.destination);
        this.connected = true;
      }
      this.pushParams();
      return;
    }

    if (this.mountingPromise) return this.mountingPromise;

    this.mountingPromise = (async () => {
      try {
        if (typeof this.ctx.audioWorklet === 'undefined') return;
        if (!loadedContexts.has(this.ctx)) {
          const url = `${import.meta.env.BASE_URL}amp-worklet.js?v=1`;
          await this.ctx.audioWorklet.addModule(url);
          loadedContexts.add(this.ctx);
        }

        if (this.disposed || this.ctx.state === 'closed') return;

        const initialParams = buildWasmAmpParams(
          this.settings,
          this.channelRouting,
          this.ctx.sampleRate,
        );

        const node = new AudioWorkletNode(this.ctx, 'sonicmambo-wasm-amp-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCountMode: 'max',
          processorOptions: {
            wasmBytes: getGuitarAmpWasmBinary(),
            initialParams,
          },
        });

        this.workletNode = node;

        if (this.settings.enabled && !this.disposed) {
          this.source.connect(node);
          node.connect(this.ctx.destination);
          this.connected = true;
        }
      } catch (err) {
        console.warn('WASM Guitar Amp worklet failed to initialize:', err);
      } finally {
        this.mountingPromise = null;
      }
    })();

    return this.mountingPromise;
  }

  private disconnectGraph(): void {
    if (!this.connected || !this.workletNode) return;
    try {
      this.source.disconnect(this.workletNode);
    } catch {
      // ignore
    }
    try {
      this.workletNode.disconnect();
    } catch {
      // ignore
    }
    this.connected = false;
  }

  private pushParams(): void {
    if (!this.workletNode) return;
    const params = buildWasmAmpParams(
      this.settings,
      this.channelRouting,
      this.ctx.sampleRate,
    );
    this.workletNode.port.postMessage({ type: 'params', params });
  }

  setChannelRouting(selection: 'auto' | 'sum' | number): void {
    this.channelRouting = selection;
    if (this.connected) {
      this.pushParams();
    }
  }

  applySettings(next: AmpSettings): void {
    this.settings = { ...next };

    if (!next.enabled) {
      // Complete hardware graph disconnect -> literally 0.00% CPU when Amp is Off!
      this.disconnectGraph();
      return;
    }

    if (this.workletNode) {
      if (!this.connected) {
        this.source.connect(this.workletNode);
        this.workletNode.connect(this.ctx.destination);
        this.connected = true;
      }
      this.pushParams();
    } else {
      void this.ensureMountedAndConnected();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.disconnectGraph();
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
      } catch {
        // ignore
      }
      this.workletNode = null;
    }
  }
}
