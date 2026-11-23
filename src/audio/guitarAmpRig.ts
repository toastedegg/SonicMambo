import {
  computeLowpassBiquad,
  computePeakingBiquad,
  getGuitarAmpWasmBinary,
} from './wasmAmpBinary';

export type AmpPresetId =
  | 'clean-studio'
  | 'blues-breakup'
  | 'british-crunch'
  | 'insane-lead'
  | 'velvet-jazz';

export interface AmpSettings {
  enabled: boolean;
  preset: AmpPresetId;
  drive: number; // 0..1
  tone: number; // 0..1 (Bite / Mid-Presence)
  reverb: number; // 0..1 (Cabinet Room Air)
  volume: number; // 0..1 (Master Output Level)
}

export const AMP_PRESETS: ReadonlyArray<{
  id: AmpPresetId;
  label: string;
  shortLabel: string;
  tag: string;
  defaultDrive: number;
  defaultTone: number;
  defaultReverb: number;
}> = [
  {
    id: 'clean-studio',
    label: 'Twin Clean',
    shortLabel: 'Clean',
    tag: '6L6 CHIME',
    defaultDrive: 0.24,
    defaultTone: 0.58,
    defaultReverb: 0.34,
  },
  {
    id: 'blues-breakup',
    label: 'Texas Screamer',
    shortLabel: 'Texas OD',
    tag: 'TS9 OVERDRIVE',
    defaultDrive: 0.62,
    defaultTone: 0.62,
    defaultReverb: 0.30,
  },
  {
    id: 'british-crunch',
    label: 'Plexi JCM800',
    shortLabel: 'JCM Crunch',
    tag: 'EL34 ROAR',
    defaultDrive: 0.78,
    defaultTone: 0.68,
    defaultReverb: 0.24,
  },
  {
    id: 'insane-lead',
    label: 'Nitro 5150',
    shortLabel: 'Nitro 5150',
    tag: 'HIGH-GAIN SHRED',
    defaultDrive: 0.88,
    defaultTone: 0.74,
    defaultReverb: 0.20,
  },
  {
    id: 'velvet-jazz',
    label: 'Velvet Jazz',
    shortLabel: 'Warm',
    tag: 'DARK ARCHTOP',
    defaultDrive: 0.14,
    defaultTone: 0.36,
    defaultReverb: 0.36,
  },
];

const AMP_STORAGE_KEY = 'sonicmambo:ampSettings:v2';

export function readSavedAmpSettings(): AmpSettings {
  const defaults: AmpSettings = {
    enabled: false,
    preset: 'british-crunch',
    drive: 0.74,
    tone: 0.66,
    reverb: 0.24,
    volume: 0.80,
  };
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return defaults;
    }
    const raw = window.localStorage.getItem(AMP_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AmpSettings>;
    const preset: AmpPresetId =
      parsed.preset === 'clean-studio' ||
      parsed.preset === 'blues-breakup' ||
      parsed.preset === 'british-crunch' ||
      parsed.preset === 'insane-lead' ||
      parsed.preset === 'velvet-jazz'
        ? parsed.preset
        : defaults.preset;
    return {
      enabled: false,
      preset,
      drive: typeof parsed.drive === 'number' ? Math.max(0, Math.min(1, parsed.drive)) : defaults.drive,
      tone: typeof parsed.tone === 'number' ? Math.max(0, Math.min(1, parsed.tone)) : defaults.tone,
      reverb: typeof parsed.reverb === 'number' ? Math.max(0, Math.min(1, parsed.reverb)) : defaults.reverb,
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : defaults.volume,
    };
  } catch {
    return defaults;
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
  const d = Math.max(0, Math.min(1, settings.drive));
  const t = Math.max(0, Math.min(1, settings.tone ?? 0.64));
  const dCurve = d * d * 0.65 + d * 0.35;

  let hpHz = 120;
  let midFreq = 1100 + t * 1200;
  let midDb = 2.0 + t * 5.5;
  let cabLpHz = 3400 + t * 1400;
  let driveGain = 14.0;
  let makeup = 0.62;

  switch (settings.preset) {
    case 'clean-studio':
      hpHz = 75;
      midFreq = 1400 + t * 1300;
      midDb = 0.5 + t * 3.8;
      cabLpHz = 4200 + t * 1500;
      driveGain = 3.5 + dCurve * 12.0;
      makeup = 0.72 / (1.0 + dCurve * 0.3);
      break;
    case 'velvet-jazz':
      hpHz = 70;
      midFreq = 500 + t * 700;
      midDb = 1.4 + t * 2.8;
      cabLpHz = 2500 + t * 1000;
      driveGain = 3.0 + dCurve * 8.0;
      makeup = 0.75 / (1.0 + dCurve * 0.22);
      break;
    case 'blues-breakup':
      hpHz = 135;
      midFreq = 900 + t * 1100;
      midDb = 2.8 + t * 5.4;
      cabLpHz = 3400 + t * 1400;
      driveGain = 9.0 + dCurve * 46.0;
      makeup = 0.62 / (1.0 + dCurve * 0.2);
      break;
    case 'british-crunch':
      hpHz = 210;
      midFreq = 1080 + t * 1250;
      midDb = 3.8 + t * 6.2;
      cabLpHz = 3300 + t * 1300;
      driveGain = 22.0 + dCurve * 95.0;
      makeup = 0.56 / (1.0 + dCurve * 0.16);
      break;
    case 'insane-lead':
      hpHz = 290;
      midFreq = 1200 + t * 1350;
      midDb = 4.5 + t * 7.5;
      cabLpHz = 3200 + t * 1250;
      driveGain = 48.0 + dCurve * 190.0;
      makeup = 0.52 / (1.0 + dCurve * 0.12);
      break;
  }

  const hpCoeff = Math.exp((-2 * Math.PI * hpHz) / Math.max(8000, sampleRate));
  const bq1 = computePeakingBiquad(midFreq, 0.92, midDb, sampleRate);
  const bq2 = computeLowpassBiquad(cabLpHz, 0.82, sampleRate);

  const roomWet = settings.reverb * 0.42;
  const roomFb = 0.16 + settings.reverb * 0.25;
  const master = settings.enabled ? settings.volume * 1.5 : 0.0;

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
