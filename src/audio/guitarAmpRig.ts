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
      // Always boot muted on fresh session or preserve explicit preference?
      // Keeping enabled false on cold reload prevents surprise speaker feedback on laptop mics,
      // while preserving user's dialed-in tone preset, drive, reverb, and volume!
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

/**
 * Builds an asymmetric triode-style soft-clipping curve (`4096` samples).
 * Slight asymmetry adds warm 2nd-order even harmonics like a 12AX7 preamp stage.
 */
function buildTubeSaturationCurve(driveAmount: number): Float32Array {
  const n = 4096;
  const curve = new Float32Array(n);
  const k = 1 + driveAmount * driveAmount * 26;
  const norm = Math.tanh(k);

  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / (n - 1) - 1;
    // Asymmetric bias produces natural touch-sensitive tube breakup
    const biased = x >= 0 ? x * k : x * k * 0.82;
    curve[i] = Math.tanh(biased) / Math.max(0.25, norm);
  }
  return curve;
}

/**
 * Low-latency native Web Audio Guitar Amplifier & Cabinet Simulator.
 * Runs in parallel with the dry pitch-detection AudioWorklet on the same AudioContext
 * (`~4–8 ms` interactive hardware latency, zero JS main-thread overhead).
 */
export class GuitarAmpRig {
  private readonly ctx: AudioContext;
  private readonly monoCenterSum: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly ch0Gain: GainNode;
  private readonly ch1Gain: GainNode;
  private readonly tightHighPass: BiquadFilterNode;
  private readonly preMidFocus: BiquadFilterNode;
  private readonly driveGain: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly postCompGain: GainNode;
  private readonly cabLowResonance: BiquadFilterNode;
  private readonly cabMidVoicing: BiquadFilterNode;
  private readonly cabRollOffA: BiquadFilterNode;
  private readonly cabRollOffB: BiquadFilterNode;
  private readonly dryOut: GainNode;
  private readonly roomWetOut: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly feedbackL: GainNode;
  private readonly feedbackR: GainNode;
  private readonly roomDamp: BiquadFilterNode;
  private readonly stereoMerger: ChannelMergerNode;
  private readonly masterOut: GainNode;

  private settings: AmpSettings;

  constructor(ctx: AudioContext, source: AudioNode, initialSettings: AmpSettings) {
    this.ctx = ctx;
    this.settings = { ...initialSettings };

    // 1. Dual-channel centering input: whether guitar is plugged into Ch 1 (Mic) or Ch 2 (Scarlett Inst),
    // both channels feed into a mono preamp node so output is centered in BOTH left & right headphones!
    this.splitter = ctx.createChannelSplitter(2);
    this.ch0Gain = ctx.createGain();
    this.ch1Gain = ctx.createGain();
    this.ch0Gain.gain.value = 1.0;
    this.ch1Gain.gain.value = 1.0;

    this.monoCenterSum = ctx.createGain();
    this.monoCenterSum.channelCount = 1;
    this.monoCenterSum.channelCountMode = 'explicit';
    this.monoCenterSum.gain.value = 1.0;

    source.connect(this.splitter);
    this.splitter.connect(this.ch0Gain, 0);
    this.splitter.connect(this.ch1Gain, 1);
    this.ch0Gain.connect(this.monoCenterSum);
    this.ch1Gain.connect(this.monoCenterSum);

    // 2. Pre-EQ tightener (cuts sub-85 Hz boom before saturation) + midrange focus
    this.tightHighPass = ctx.createBiquadFilter();
    this.tightHighPass.type = 'highpass';
    this.tightHighPass.frequency.value = 85;
    this.tightHighPass.Q.value = 0.707;

    this.preMidFocus = ctx.createBiquadFilter();
    this.preMidFocus.type = 'peaking';
    this.preMidFocus.frequency.value = 760;
    this.preMidFocus.Q.value = 0.9;

    // 3. Asymmetric 4x-oversampled tube waveshaper
    this.driveGain = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.postCompGain = ctx.createGain();

    // 4. 12" Guitar Speaker Cabinet Simulation (115 Hz woody thump + mid character + 24dB/oct 4.1 kHz cone roll-off)
    this.cabLowResonance = ctx.createBiquadFilter();
    this.cabLowResonance.type = 'peaking';
    this.cabLowResonance.frequency.value = 118;
    this.cabLowResonance.Q.value = 1.25;
    this.cabLowResonance.gain.value = 3.5;

    this.cabMidVoicing = ctx.createBiquadFilter();
    this.cabMidVoicing.type = 'peaking';
    this.cabMidVoicing.frequency.value = 2150;
    this.cabMidVoicing.Q.value = 1.1;

    this.cabRollOffA = ctx.createBiquadFilter();
    this.cabRollOffA.type = 'lowpass';
    this.cabRollOffA.frequency.value = 4100;
    this.cabRollOffA.Q.value = 0.85;

    this.cabRollOffB = ctx.createBiquadFilter();
    this.cabRollOffB.type = 'lowpass';
    this.cabRollOffB.frequency.value = 5100;
    this.cabRollOffB.Q.value = 0.65;

    // 5. Stereo Studio Room Ambience (warm damped cross-delay -> natural 3D headphone width)
    this.dryOut = ctx.createGain();
    this.roomWetOut = ctx.createGain();
    this.roomDamp = ctx.createBiquadFilter();
    this.roomDamp.type = 'lowpass';
    this.roomDamp.frequency.value = 2300;

    this.delayL = ctx.createDelay(0.1);
    this.delayR = ctx.createDelay(0.1);
    this.delayL.delayTime.value = 0.024;
    this.delayR.delayTime.value = 0.037;

    this.feedbackL = ctx.createGain();
    this.feedbackR = ctx.createGain();
    this.feedbackL.gain.value = 0.32;
    this.feedbackR.gain.value = 0.32;

    this.stereoMerger = ctx.createChannelMerger(2);

    this.masterOut = ctx.createGain();
    this.masterOut.gain.value = 0;

    // Wire series chain
    this.monoCenterSum.connect(this.tightHighPass);
    this.tightHighPass.connect(this.preMidFocus);
    this.preMidFocus.connect(this.driveGain);
    this.driveGain.connect(this.shaper);
    this.shaper.connect(this.postCompGain);
    this.postCompGain.connect(this.cabLowResonance);
    this.cabLowResonance.connect(this.cabMidVoicing);
    this.cabMidVoicing.connect(this.cabRollOffA);
    this.cabRollOffA.connect(this.cabRollOffB);

    // Dry centered output
    this.cabRollOffB.connect(this.dryOut);
    this.dryOut.connect(this.masterOut);

    // Stereo room ambience loop
    this.cabRollOffB.connect(this.roomDamp);
    this.roomDamp.connect(this.delayL);
    this.roomDamp.connect(this.delayR);
    this.delayL.connect(this.feedbackL);
    this.feedbackL.connect(this.delayR);
    this.delayR.connect(this.feedbackR);
    this.feedbackR.connect(this.delayL);

    this.delayL.connect(this.stereoMerger, 0, 0);
    this.delayR.connect(this.stereoMerger, 0, 1);
    this.stereoMerger.connect(this.roomWetOut);
    this.roomWetOut.connect(this.masterOut);

    this.masterOut.connect(ctx.destination);

    this.applySettings(this.settings, true);
  }

  setChannelRouting(selection: 'auto' | 'sum' | number): void {
    if (selection === 0) {
      this.ch0Gain.gain.value = 1.0;
      this.ch1Gain.gain.value = 0.0;
    } else if (selection === 1) {
      this.ch0Gain.gain.value = 0.0;
      this.ch1Gain.gain.value = 1.0;
    } else {
      this.ch0Gain.gain.value = 1.0;
      this.ch1Gain.gain.value = 1.0;
    }
  }

  applySettings(next: AmpSettings, immediate: boolean = false): void {
    this.settings = { ...next };
    const now = this.ctx.currentTime;
    const tau = immediate ? 0.002 : 0.016;

    const { enabled, preset, drive, reverb, volume } = next;

    // Voicing per amp model
    let preMidDb = 2.0;
    let cabMidDb = 1.5;
    let cabLpHz = 4200;
    let driveBias = drive;

    switch (preset) {
      case 'clean-studio':
        preMidDb = -1.0;
        cabMidDb = 2.2;
        cabLpHz = 4900;
        driveBias = drive * 0.45;
        break;
      case 'blues-breakup':
        preMidDb = 4.5;
        cabMidDb = 2.0;
        cabLpHz = 4100;
        driveBias = 0.15 + drive * 0.7;
        break;
      case 'british-crunch':
        preMidDb = 6.5;
        cabMidDb = 3.2;
        cabLpHz = 3650;
        driveBias = 0.35 + drive * 0.65;
        break;
      case 'velvet-jazz':
        preMidDb = 1.0;
        cabMidDb = -3.0;
        cabLpHz = 2750;
        driveBias = drive * 0.25;
        break;
    }

    this.preMidFocus.gain.setTargetAtTime(preMidDb, now, tau);
    this.cabMidVoicing.gain.setTargetAtTime(cabMidDb, now, tau);
    this.cabRollOffA.frequency.setTargetAtTime(cabLpHz, now, tau);

    const inputBoost = 1.2 + driveBias * 5.5;
    const makeup = 1 / (1 + driveBias * 0.85);
    this.driveGain.gain.setTargetAtTime(inputBoost, now, tau);
    this.shaper.curve = buildTubeSaturationCurve(driveBias);
    this.postCompGain.gain.setTargetAtTime(makeup, now, tau);

    this.dryOut.gain.setTargetAtTime(0.92, now, tau);
    this.roomWetOut.gain.setTargetAtTime(reverb * 0.55, now, tau);
    this.feedbackL.gain.setTargetAtTime(0.2 + reverb * 0.32, now, tau);
    this.feedbackR.gain.setTargetAtTime(0.2 + reverb * 0.32, now, tau);

    const targetMaster = enabled ? volume * 1.45 : 0;
    this.masterOut.gain.setTargetAtTime(targetMaster, now, tau);
  }

  dispose(): void {
    try {
      this.splitter.disconnect();
      this.monoCenterSum.disconnect();
      this.masterOut.disconnect();
    } catch {
      // ignore
    }
  }
}
