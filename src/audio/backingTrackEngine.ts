import { noteLabelToFrequency } from '../utils/noteFromFrequency.ts';

export type GrooveStyleId =
  | 'blues-shuffle'
  | 'hard-rock'
  | 'soul-rock'
  | 'country-train'
  | 'metronome'
  | 'off';

export type GuideGuitarLevel = 'off' | 'soft' | 'full';

export const GROOVE_STYLE_META: ReadonlyArray<{
  id: GrooveStyleId;
  label: string;
  shortLabel: string;
}> = [
  { id: 'blues-shuffle', label: 'Blues Shuffle Drums', shortLabel: 'Blues Shuffle' },
  { id: 'hard-rock', label: 'Hard Rock Drums', shortLabel: 'Hard Rock' },
  { id: 'soul-rock', label: 'Soul-Rock Groove', shortLabel: 'Soul-Rock' },
  { id: 'country-train', label: 'Country Train Beat', shortLabel: 'Train Beat' },
  { id: 'metronome', label: 'Studio Click Only', shortLabel: 'Click' },
  { id: 'off', label: 'Silent (Visual Pulse)', shortLabel: 'Mute Beat' },
];

export interface SchedulableGuitarNote {
  id: string;
  label: string;
  startBeat: number;
  durationBeats: number;
  tech?: string;
}

class SoundGeneratorEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterVolume = 0.78;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return null;
    }
    if (!this.ctx || this.ctx.state === 'closed') {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.14;

      const gain = ctx.createGain();
      gain.gain.value = this.masterVolume;

      comp.connect(gain);
      gain.connect(ctx.destination);

      this.ctx = ctx;
      this.compressor = comp;
      this.masterGain = gain;
      this.noiseBuffer = this.createWhiteNoiseBuffer(ctx, 1.0);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buf;
  }

  getContext(): AudioContext | null {
    return this.ensureContext();
  }

  setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.015);
    }
  }

  getVolume(): number {
    return this.masterVolume;
  }

  /** Studio punchy kick drum (sweeps 155 Hz -> 46 Hz rapidly — below 70 Hz guitar floor). */
  scheduleKick(when: number, velocity: number = 0.9): void {
    const ctx = this.ensureContext();
    const dest = this.compressor;
    if (!ctx || !dest) return;

    const t = Math.max(ctx.currentTime, when);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.068);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.19);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.58 * velocity, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);

    osc.connect(gain);
    gain.connect(dest);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
    osc.start(t);
    osc.stop(t + 0.22);

    // Subtle beater click
    if (this.noiseBuffer) {
      const click = ctx.createBufferSource();
      click.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 1.8;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.14 * velocity, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.014);
      click.connect(bp);
      bp.connect(cg);
      cg.connect(dest);
      click.onended = () => {
        try {
          click.disconnect();
          bp.disconnect();
          cg.disconnect();
        } catch {
          // ignore
        }
      };
      click.start(t);
      click.stop(t + 0.018);
    }
  }

  /** Crisp snare drum (body + filtered snare wires). */
  scheduleSnare(when: number, velocity: number = 0.85): void {
    const ctx = this.ensureContext();
    const dest = this.compressor;
    if (!ctx || !dest) return;

    const t = Math.max(ctx.currentTime, when);

    // Short shell body
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(190, t);
    body.frequency.exponentialRampToValueAtTime(112, t + 0.065);
    bodyGain.gain.setValueAtTime(0.24 * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    body.connect(bodyGain);
    bodyGain.connect(dest);
    body.onended = () => {
      try {
        body.disconnect();
        bodyGain.disconnect();
      } catch {
        // ignore
      }
    };
    body.start(t);
    body.stop(t + 0.09);

    // Snare wires
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1350;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7200;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.32 * velocity, t + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.135);

      noise.connect(hp);
      hp.connect(lp);
      lp.connect(ng);
      ng.connect(dest);
      noise.onended = () => {
        try {
          noise.disconnect();
          hp.disconnect();
          lp.disconnect();
          ng.disconnect();
        } catch {
          // ignore
        }
      };
      noise.start(t);
      noise.stop(t + 0.145);
    }
  }

  /** Closed or slightly open hi-hat / ride shimmer (> 6.5 kHz unpitched). */
  scheduleHiHat(when: number, velocity: number = 0.55, open: boolean = false): void {
    const ctx = this.ensureContext();
    const dest = this.compressor;
    if (!ctx || !dest || !this.noiseBuffer) return;

    const t = Math.max(ctx.currentTime, when);
    const dur = open ? 0.155 : 0.044;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6600;

    const bp = ctx.createBiquadFilter();
    bp.type = 'peaking';
    bp.frequency.value = 9400;
    bp.gain.value = 4;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * velocity, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(dest);
    noise.onended = () => {
      try {
        noise.disconnect();
        hp.disconnect();
        bp.disconnect();
        g.disconnect();
      } catch {
        // ignore
      }
    };
    noise.start(t);
    noise.stop(t + dur + 0.01);
  }

  /** Crisp studio woodblock / stick click for count-in and metronome mode. */
  scheduleClick(when: number, accented: boolean = false): void {
    const ctx = this.ensureContext();
    const dest = this.compressor;
    if (!ctx || !dest) return;

    const t = Math.max(ctx.currentTime, when);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = 'triangle';
    const baseHz = accented ? 1320 : 940;
    osc.frequency.setValueAtTime(baseHz, t);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.55, t + 0.032);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(accented ? 0.34 : 0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.038);

    osc.connect(g);
    g.connect(dest);
    osc.onended = () => {
      try {
        osc.disconnect();
        g.disconnect();
      } catch {
        // ignore
      }
    };
    osc.start(t);
    osc.stop(t + 0.042);
  }

  /**
   * Expressive plucked electric/clean guitar note synthesizer with pick transient,
   * dynamic lowpass filter, cabinet warmth, optional slide-in, and delayed vibrato.
   */
  scheduleGuitarNote(
    frequencyHz: number,
    when: number,
    durationSec: number,
    options: { gainScale?: number; tech?: string } = {},
  ): void {
    const ctx = this.ensureContext();
    const dest = this.compressor;
    if (!ctx || !dest || !Number.isFinite(frequencyHz) || frequencyHz <= 0) return;

    const t = Math.max(ctx.currentTime, when);
    const dur = Math.max(0.11, durationSec);
    const end = t + dur;
    const level = (options.gainScale ?? 1) * 0.24;
    const tech = options.tech ?? '';

    const oscMain = ctx.createOscillator();
    const oscWarm = ctx.createOscillator();
    oscMain.type = 'sawtooth';
    oscWarm.type = 'triangle';
    oscMain.detune.value = -3.5;
    oscWarm.detune.value = 3.5;

    if (tech.includes('slide')) {
      const startHz = frequencyHz * Math.pow(2, -2 / 12);
      oscMain.frequency.setValueAtTime(startHz, t);
      oscWarm.frequency.setValueAtTime(startHz, t);
      oscMain.frequency.exponentialRampToValueAtTime(frequencyHz, t + Math.min(0.055, dur * 0.35));
      oscWarm.frequency.exponentialRampToValueAtTime(frequencyHz, t + Math.min(0.055, dur * 0.35));
    } else {
      oscMain.frequency.setValueAtTime(frequencyHz, t);
      oscWarm.frequency.setValueAtTime(frequencyHz, t);
    }

    // Delayed natural vibrato on sustained notes or explicit vibrato tags
    let lfo: OscillatorNode | null = null;
    if (dur >= 0.55 || tech.includes('vibrato')) {
      lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 5.4;
      const vibDelay = Math.min(0.18, dur * 0.3);
      lfoGain.gain.setValueAtTime(0, t);
      lfoGain.gain.linearRampToValueAtTime(frequencyHz * 0.0065, t + vibDelay + 0.12);
      lfo.connect(lfoGain);
      lfoGain.connect(oscMain.frequency);
      lfoGain.connect(oscWarm.frequency);
      lfo.start(t);
      lfo.stop(end + 0.04);
    }

    const mixMain = ctx.createGain();
    const mixWarm = ctx.createGain();
    mixMain.gain.value = 0.52;
    mixWarm.gain.value = 0.68;

    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'peaking';
    bodyFilter.frequency.value = 250;
    bodyFilter.Q.value = 1.1;
    bodyFilter.gain.value = 3.5;

    const pluckLp = ctx.createBiquadFilter();
    pluckLp.type = 'lowpass';
    pluckLp.Q.value = 1.6;
    const attackCutoff = Math.min(5200, Math.max(950, frequencyHz * 8.5));
    const sustainCutoff = Math.min(2400, Math.max(420, frequencyHz * 2.5));
    pluckLp.frequency.setValueAtTime(attackCutoff, t);
    pluckLp.frequency.exponentialRampToValueAtTime(sustainCutoff, t + Math.min(0.24, dur * 0.65));

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(level, t + 0.008);
    env.gain.setTargetAtTime(level * 0.58, t + 0.02, 0.14);
    env.gain.setValueAtTime(Math.max(0.002, level * 0.42), Math.max(t + 0.03, end - 0.035));
    env.gain.exponentialRampToValueAtTime(0.0008, end + 0.025);

    oscMain.connect(mixMain);
    oscWarm.connect(mixWarm);
    mixMain.connect(bodyFilter);
    mixWarm.connect(bodyFilter);
    bodyFilter.connect(pluckLp);
    pluckLp.connect(env);
    env.connect(dest);

    // Pick transient
    if (this.noiseBuffer && !tech.includes('pull') && !tech.includes('hammer')) {
      const pick = ctx.createBufferSource();
      pick.buffer = this.noiseBuffer;
      const pickBp = ctx.createBiquadFilter();
      pickBp.type = 'bandpass';
      pickBp.frequency.value = Math.min(3600, frequencyHz * 5);
      pickBp.Q.value = 2.0;
      const pickGain = ctx.createGain();
      pickGain.gain.setValueAtTime(level * 0.45, t);
      pickGain.gain.exponentialRampToValueAtTime(0.0008, t + 0.011);
      pick.connect(pickBp);
      pickBp.connect(pickGain);
      pickGain.connect(dest);
      pick.onended = () => {
        try {
          pick.disconnect();
          pickBp.disconnect();
          pickGain.disconnect();
        } catch {
          // ignore
        }
      };
      pick.start(t);
      pick.stop(t + 0.015);
    }

    oscMain.onended = () => {
      try {
        oscMain.disconnect();
        oscWarm.disconnect();
        mixMain.disconnect();
        mixWarm.disconnect();
        bodyFilter.disconnect();
        pluckLp.disconnect();
        env.disconnect();
        lfo?.disconnect();
      } catch {
        // ignore
      }
    };
    oscMain.start(t);
    oscWarm.start(t);
    oscMain.stop(end + 0.035);
    oscWarm.stop(end + 0.035);
  }

  /** Schedules all drum hits inside a single beat `[beatIndex .. beatIndex + 1)` for a given groove style. */
  scheduleGrooveBeat(
    style: GrooveStyleId,
    beatInBar: number,
    beatStartSec: number,
    beatDurationSec: number,
  ): void {
    if (style === 'off') return;

    const b = ((beatInBar % 4) + 4) % 4;
    const s = beatDurationSec;

    if (style === 'metronome') {
      this.scheduleClick(beatStartSec, b === 0);
      return;
    }

    if (style === 'blues-shuffle') {
      // Swung ride/hat on downbeat and 2/3 triplet
      this.scheduleHiHat(beatStartSec, b === 0 ? 0.68 : 0.52, false);
      this.scheduleHiHat(beatStartSec + s * 0.667, 0.38, b === 3);
      if (b === 0) {
        this.scheduleKick(beatStartSec, 0.92);
      } else if (b === 1) {
        this.scheduleSnare(beatStartSec, 0.84);
      } else if (b === 2) {
        this.scheduleKick(beatStartSec, 0.82);
        this.scheduleKick(beatStartSec + s * 0.667, 0.58);
      } else if (b === 3) {
        this.scheduleSnare(beatStartSec, 0.88);
      }
      return;
    }

    if (style === 'hard-rock') {
      // Straight driving 8th-note hats, heavy rock kick & snare
      this.scheduleHiHat(beatStartSec, b === 0 ? 0.72 : 0.56, false);
      this.scheduleHiHat(beatStartSec + s * 0.5, 0.46, b === 3);
      if (b === 0) {
        this.scheduleKick(beatStartSec, 0.98);
      } else if (b === 1) {
        this.scheduleSnare(beatStartSec, 0.94);
        this.scheduleKick(beatStartSec + s * 0.5, 0.68);
      } else if (b === 2) {
        this.scheduleKick(beatStartSec, 0.9);
      } else if (b === 3) {
        this.scheduleSnare(beatStartSec, 0.95);
      }
      return;
    }

    if (style === 'soul-rock') {
      // Laid-back Hendrix groove
      this.scheduleHiHat(beatStartSec, 0.56, false);
      this.scheduleHiHat(beatStartSec + s * 0.5, 0.36, b === 1);
      if (b === 0) {
        this.scheduleKick(beatStartSec, 0.92);
        this.scheduleKick(beatStartSec + s * 0.75, 0.54);
      } else if (b === 1) {
        this.scheduleSnare(beatStartSec, 0.84);
      } else if (b === 2) {
        this.scheduleKick(beatStartSec + s * 0.5, 0.78);
      } else if (b === 3) {
        this.scheduleSnare(beatStartSec, 0.88);
        this.scheduleHiHat(beatStartSec + s * 0.75, 0.3, false);
      }
      return;
    }

    if (style === 'country-train') {
      // Boom-chick alternating train beat
      this.scheduleHiHat(beatStartSec, 0.48, false);
      this.scheduleHiHat(beatStartSec + s * 0.5, 0.42, false);
      if (b === 0 || b === 2) {
        this.scheduleKick(beatStartSec, 0.88);
      } else {
        this.scheduleSnare(beatStartSec, 0.76);
        this.scheduleSnare(beatStartSec + s * 0.5, 0.42);
        if (b === 3) {
          this.scheduleSnare(beatStartSec + s * 0.75, 0.36);
        }
      }
    }
  }

  /** Immediate single-note preview (e.g. for Guitar Tuner string buttons). */
  playReferenceNote(labelOrHz: string | number, durationSec: number = 1.35): void {
    const hz = typeof labelOrHz === 'number' ? labelOrHz : noteLabelToFrequency(labelOrHz);
    if (hz == null) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.scheduleGuitarNote(hz, ctx.currentTime + 0.015, durationSec, {
      gainScale: 1.0,
      tech: 'vibrato',
    });
  }
}

export const soundGenerator = new SoundGeneratorEngine();

export interface BackingTransportConfig {
  bpm: number;
  beatsPerBar: number;
  totalBeats: number;
  countInBeats: number;
  loop: boolean;
  grooveStyle: GrooveStyleId;
  guideGuitar: GuideGuitarLevel;
  notes: readonly SchedulableGuitarNote[];
  onLoopWrap?: (completedLoopIndex: number) => void;
  onComplete?: () => void;
}

/**
 * Sample-accurate Web Audio lookahead transport driving drum beats, count-in clicks,
 * optional/preview guitar synth notes, and exact visual `elapsedBeats` / `elapsedMs`.
 */
export class BackingTransport {
  private config: BackingTransportConfig;
  private startAudioSec = 0;
  private startPerfMs = 0;
  private timerId = 0;
  private running = false;

  private nextBeatToSchedule = 0; // starts at -countInBeats
  private scheduledNotePassKeys = new Set<string>();
  private lastReportedLoopIndex = 0;

  constructor(config: BackingTransportConfig) {
    this.config = config;
  }

  updateLiveOptions(partial: {
    grooveStyle?: GrooveStyleId;
    guideGuitar?: GuideGuitarLevel;
  }): void {
    if (partial.grooveStyle !== undefined) this.config.grooveStyle = partial.grooveStyle;
    if (partial.guideGuitar !== undefined) this.config.guideGuitar = partial.guideGuitar;
  }

  start(): void {
    this.stop();
    const ctx = soundGenerator.getContext();
    const leadInSec = 0.05;
    this.startAudioSec = ctx ? ctx.currentTime + leadInSec : 0;
    this.startPerfMs = performance.now() + leadInSec * 1000;
    this.nextBeatToSchedule = -this.config.countInBeats;
    this.scheduledNotePassKeys.clear();
    this.lastReportedLoopIndex = 0;
    this.running = true;

    this.schedulerTick();
    this.timerId = window.setInterval(() => this.schedulerTick(), 25);
  }

  stop(): void {
    this.running = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Returns exact current musical position:
   * - During count-in: `inCountIn = true`, `countInRemaining = 4..1`, `elapsedMs < 0`
   * - During play: `inCountIn = false`, `elapsedMs >= 0` (wrapped to `[0, cycleMs)` when `loop = true`)
   */
  getPosition(): {
    inCountIn: boolean;
    countInNumber: number;
    beatInBar: number;
    elapsedBeats: number;
    elapsedMs: number;
    loopIndex: number;
  } {
    const ctx = soundGenerator.getContext();
    const nowElapsedSec = ctx
      ? ctx.currentTime - this.startAudioSec
      : (performance.now() - this.startPerfMs) / 1000;

    const beatSec = 60 / Math.max(30, this.config.bpm);
    const countInSec = this.config.countInBeats * beatSec;
    const playSec = nowElapsedSec - countInSec;

    if (playSec < 0) {
      const remBeats = Math.ceil(-playSec / beatSec);
      const countInNumber = Math.max(1, Math.min(this.config.countInBeats, remBeats));
      const countBeatIdx = Math.floor((nowElapsedSec / beatSec) % this.config.beatsPerBar);
      return {
        inCountIn: true,
        countInNumber,
        beatInBar: Math.max(0, countBeatIdx),
        elapsedBeats: playSec / beatSec,
        elapsedMs: playSec * 1000,
        loopIndex: 0,
      };
    }

    const rawBeats = playSec / beatSec;
    const cycleBeats = Math.max(1, this.config.totalBeats);

    if (this.config.loop) {
      const loopIndex = Math.floor(rawBeats / cycleBeats);
      const wrappedBeats = rawBeats - loopIndex * cycleBeats;
      return {
        inCountIn: false,
        countInNumber: 0,
        beatInBar: Math.floor(wrappedBeats) % this.config.beatsPerBar,
        elapsedBeats: wrappedBeats,
        elapsedMs: wrappedBeats * beatSec * 1000,
        loopIndex,
      };
    }

    return {
      inCountIn: false,
      countInNumber: 0,
      beatInBar: Math.floor(rawBeats) % this.config.beatsPerBar,
      elapsedBeats: rawBeats,
      elapsedMs: playSec * 1000,
      loopIndex: 0,
    };
  }

  private schedulerTick(): void {
    if (!this.running) return;
    const ctx = soundGenerator.getContext();
    const nowSec = ctx ? ctx.currentTime : performance.now() / 1000;
    const baseSec = ctx ? this.startAudioSec : this.startPerfMs / 1000;

    const beatSec = 60 / Math.max(30, this.config.bpm);
    const countInSec = this.config.countInBeats * beatSec;
    const playStartSec = baseSec + countInSec;
    const lookaheadSec = 0.12;
    const cycleBeats = Math.max(1, this.config.totalBeats);

    // Check loop wrap or completion based on real time
    const currentPlayBeats = (nowSec - playStartSec) / beatSec;
    if (this.config.loop && currentPlayBeats >= 0) {
      const curLoop = Math.floor(currentPlayBeats / cycleBeats);
      if (curLoop > this.lastReportedLoopIndex) {
        this.lastReportedLoopIndex = curLoop;
        // Prune scheduled keys from older loop passes so Set never grows unbounded
        const keepPrefixA = `${curLoop}:`;
        const keepPrefixB = `${curLoop + 1}:`;
        for (const k of this.scheduledNotePassKeys) {
          if (!k.startsWith(keepPrefixA) && !k.startsWith(keepPrefixB)) {
            this.scheduledNotePassKeys.delete(k);
          }
        }
        this.config.onLoopWrap?.(curLoop);
      }
    } else if (!this.config.loop && currentPlayBeats >= cycleBeats + 0.5) {
      this.stop();
      this.config.onComplete?.();
      return;
    }

    // Schedule beats within lookahead window
    const horizonPlayBeats = (nowSec + lookaheadSec - playStartSec) / beatSec;
    const maxBeat = this.config.loop ? Math.ceil(horizonPlayBeats) : cycleBeats;

    while (this.nextBeatToSchedule < maxBeat && this.nextBeatToSchedule <= horizonPlayBeats) {
      const bIdx = this.nextBeatToSchedule;
      const beatWhen = playStartSec + bIdx * beatSec;

      if (bIdx < 0) {
        // Count-in click! Always audible unless grooveStyle === 'off'
        if (this.config.grooveStyle !== 'off') {
          const countPos = bIdx + this.config.countInBeats;
          soundGenerator.scheduleClick(beatWhen, countPos === 0);
        }
      } else if (ctx) {
        const beatInCycle = this.config.loop ? bIdx % cycleBeats : bIdx;
        const beatInBar = beatInCycle % this.config.beatsPerBar;
        soundGenerator.scheduleGrooveBeat(this.config.grooveStyle, beatInBar, beatWhen, beatSec);
      }

      this.nextBeatToSchedule += 1;
    }

    // Schedule guide/preview guitar notes within lookahead window
    if (ctx && this.config.guideGuitar !== 'off' && horizonPlayBeats >= -0.05) {
      const gainScale = this.config.guideGuitar === 'full' ? 1.05 : 0.42;
      const minPass = this.config.loop ? Math.max(0, Math.floor(currentPlayBeats / cycleBeats)) : 0;
      const maxPass = this.config.loop ? Math.max(0, Math.floor(horizonPlayBeats / cycleBeats)) : 0;

      for (let pass = minPass; pass <= maxPass; pass += 1) {
        const passOffsetBeats = pass * cycleBeats;
        for (let i = 0; i < this.config.notes.length; i += 1) {
          const n = this.config.notes[i];
          const absBeat = passOffsetBeats + n.startBeat;
          if (absBeat > horizonPlayBeats) continue;
          if (absBeat < currentPlayBeats - 0.15) continue;

          const key = `${pass}:${n.id}`;
          if (this.scheduledNotePassKeys.has(key)) continue;
          this.scheduledNotePassKeys.add(key);

          const hz = noteLabelToFrequency(n.label);
          if (hz != null) {
            const noteWhen = playStartSec + absBeat * beatSec;
            const noteDurSec = Math.max(0.12, n.durationBeats * beatSec * 0.9);
            soundGenerator.scheduleGuitarNote(hz, noteWhen, noteDurSec, {
              gainScale,
              tech: n.tech,
            });
          }
        }
      }
    }
  }
}
