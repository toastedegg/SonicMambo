import { midiToNoteLabel } from '../utils/noteFromFrequency.ts';

export interface AsioBridgeStatus {
  bridgeReachable: boolean;
  asioConnected: boolean;
  driverName: string;
  availableDrivers: string[];
  sampleRate: number;
  bufferSize: number;
  latencyMs: number;
  inputChannels: number;
  activeChannel: number;
  error: string | null;
}

export interface AsioTelemetryPacket {
  timeMs: number;
  rms: number;
  rawHz: number | null;
  smoothedHz: number | null;
  midi: number | null;
  centsOffset: number | null;
  label: string | null;
  confidence: number;
  tuningOffsetCents: number;
  activeChannel: number;
}

type StatusListener = (status: AsioBridgeStatus) => void;
type TelemetryListener = (packet: AsioTelemetryPacket) => void;

const BRIDGE_HTTP_URL = 'http://127.0.0.1:17420/status';
const BRIDGE_WS_URL = 'ws://127.0.0.1:17420/';

const DISCONNECTED_STATUS: AsioBridgeStatus = {
  bridgeReachable: false,
  asioConnected: false,
  driverName: '',
  availableDrivers: [],
  sampleRate: 48000,
  bufferSize: 64,
  latencyMs: 0,
  inputChannels: 0,
  activeChannel: 0,
  error: null,
};

class AsioBridgeClient {
  private ws: WebSocket | null = null;
  private status: AsioBridgeStatus = { ...DISCONNECTED_STATUS };
  private statusListeners = new Set<StatusListener>();
  private telemetryListeners = new Set<TelemetryListener>();
  private connecting = false;
  private autoPollTimer = 0;

  getStatus(): AsioBridgeStatus {
    return this.status;
  }

  /** True when the local C#/C++ ASIO daemon is connected AND driving an active ASIO interface. */
  isAsioActive(): boolean {
    return this.status.bridgeReachable && this.status.asioConnected;
  }

  subscribeStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  subscribeTelemetry(cb: TelemetryListener): () => void {
    this.telemetryListeners.add(cb);
    return () => {
      this.telemetryListeners.delete(cb);
    };
  }

  private emitStatus(next: AsioBridgeStatus): void {
    this.status = next;
    this.statusListeners.forEach((cb) => cb(next));
  }

  /**
   * Quietly checks if `sonicmambo-bridge` is listening on `127.0.0.1:17420` and upgrades
   * to a binary `TCP_NODELAY` WebSocket if reachable.
   */
  async probeAndConnect(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.status.asioConnected;
    }
    if (this.connecting) return false;

    this.connecting = true;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 350);
      let ok = false;
      try {
        const resp = await fetch(BRIDGE_HTTP_URL, {
          method: 'GET',
          mode: 'cors',
          signal: controller.signal,
        });
        ok = resp.ok;
      } catch {
        ok = false;
      } finally {
        window.clearTimeout(timeout);
      }

      if (!ok) {
        if (this.status.bridgeReachable) {
          this.emitStatus({ ...DISCONNECTED_STATUS });
        }
        return false;
      }

      return await this.openWebSocket();
    } finally {
      this.connecting = false;
    }
  }

  startAutoDiscovery(): void {
    if (typeof window === 'undefined' || this.autoPollTimer) return;
    void this.probeAndConnect();
    this.autoPollTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        void this.probeAndConnect();
      }
    }, 3500);
  }

  private openWebSocket(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(BRIDGE_WS_URL);
        ws.binaryType = 'arraybuffer';
        let settled = false;

        ws.onopen = () => {
          this.ws = ws;
        };

        ws.onmessage = (ev: MessageEvent) => {
          if (typeof ev.data === 'string') {
            try {
              const msg = JSON.parse(ev.data) as Partial<AsioBridgeStatus> & { type?: string };
              if (msg.type === 'status') {
                const next: AsioBridgeStatus = {
                  bridgeReachable: true,
                  asioConnected: Boolean(msg.asioConnected),
                  driverName: msg.driverName ?? '',
                  availableDrivers: Array.isArray(msg.availableDrivers) ? msg.availableDrivers : [],
                  sampleRate: typeof msg.sampleRate === 'number' ? msg.sampleRate : 48000,
                  bufferSize: typeof msg.bufferSize === 'number' ? msg.bufferSize : 64,
                  latencyMs: typeof msg.latencyMs === 'number' ? msg.latencyMs : 0,
                  inputChannels: typeof msg.inputChannels === 'number' ? msg.inputChannels : 2,
                  activeChannel: typeof msg.activeChannel === 'number' ? msg.activeChannel : 0,
                  error: msg.error ?? null,
                };
                this.emitStatus(next);
                if (!settled) {
                  settled = true;
                  resolve(next.asioConnected);
                }
              }
            } catch {
              // ignore
            }
            return;
          }

          if (ev.data instanceof ArrayBuffer && ev.data.byteLength >= 36) {
            const f = new Float32Array(ev.data);
            if (f[0] !== 1.0) return;

            const timeMs = f[1];
            const rms = f[2];
            const rawHz = f[3] > 0 ? f[3] : null;
            const smoothedHz = f[4] > 0 ? f[4] : null;
            const midi = f[5] >= 0 ? f[5] : null;
            const confidence = f[6];
            const tuningOffsetCents = f[7];
            const activeChannel = Math.round(f[8]);

            let label: string | null = null;
            let centsOffset: number | null = null;
            if (midi != null) {
              const nearest = Math.round(midi);
              label = midiToNoteLabel(nearest);
              centsOffset = (midi - nearest) * 100;
            }

            const pkt: AsioTelemetryPacket = {
              timeMs,
              rms,
              rawHz,
              smoothedHz,
              midi,
              centsOffset,
              label,
              confidence,
              tuningOffsetCents,
              activeChannel,
            };
            this.telemetryListeners.forEach((cb) => cb(pkt));
          }
        };

        ws.onerror = () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };

        ws.onclose = () => {
          if (this.ws === ws) {
            this.ws = null;
            this.emitStatus({ ...DISCONNECTED_STATUS });
          }
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };
      } catch {
        resolve(false);
      }
    });
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendAmpSettings(settings: {
    enabled: boolean;
    preset: string;
    drive: number;
    reverb: number;
    volume: number;
  }): void {
    this.sendJson({ type: 'amp', ...settings });
  }

  sendConfig(partial: {
    rmsThreshold?: number;
    channelMode?: string;
    inputGated?: boolean;
    mixVolume?: number;
  }): void {
    this.sendJson({ type: 'config', ...partial });
  }

  resetDsp(): void {
    this.sendJson({ type: 'reset-dsp' });
  }

  clearVoices(): void {
    this.sendJson({ type: 'clear-voices' });
  }

  triggerVoice(params: {
    kind: 'kick' | 'snare' | 'hat-closed' | 'hat-open' | 'click' | 'click-accent' | 'guitar';
    delayMs: number;
    freqHz?: number;
    durSec?: number;
    vel?: number;
    slide?: boolean;
    vibrato?: boolean;
  }): void {
    this.sendJson({
      type: 'voice',
      kind: params.kind,
      delayMs: Math.max(0, params.delayMs),
      freqHz: params.freqHz ?? 220,
      durSec: params.durSec ?? 0.2,
      vel: params.vel ?? 0.85,
      slide: Boolean(params.slide),
      vibrato: Boolean(params.vibrato),
    });
  }

  selectDriver(driverName: string, bufferSize?: number): void {
    this.sendJson({ type: 'select-driver', driverName, bufferSize });
  }

  setBufferSize(bufferSize: number): void {
    this.sendJson({ type: 'set-buffer', bufferSize });
  }

  openControlPanel(): void {
    this.sendJson({ type: 'open-panel' });
  }
}

export const asioBridgeClient = new AsioBridgeClient();
