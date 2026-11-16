const HOP_SIZE = 256;

class SonicMamboCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.workerPort = null;
    this.stopped = false;
    this.buffer = new Float32Array(HOP_SIZE);
    this.writeIndex = 0;
    this.hopStartSec = 0;
    this.channelMode = 'auto'; // 'auto' | 'sum' | number (0-indexed channel)
    this.activeChannel = 0;
    this.lastChannelCount = 0;
    this.blocksSinceStatus = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'connect-worker' && event.ports && event.ports[0]) {
        this.workerPort = event.ports[0];
        if (typeof msg.channelMode !== 'undefined') {
          this.channelMode = msg.channelMode;
        }
      } else if (msg.type === 'set-channel') {
        this.channelMode = msg.channelMode;
      } else if (msg.type === 'stop') {
        this.stopped = true;
        if (this.workerPort) {
          try {
            this.workerPort.close();
          } catch {
            // ignore
          }
          this.workerPort = null;
        }
      }
    };
  }

  pickActiveChannel(input) {
    const channelCount = input.length;
    if (channelCount <= 1) {
      this.activeChannel = 0;
      return 0;
    }

    if (typeof this.channelMode === 'number') {
      const clamped = Math.max(0, Math.min(channelCount - 1, this.channelMode));
      this.activeChannel = clamped;
      return clamped;
    }

    // 'auto': lock onto whichever channel carries actual guitar energy (e.g. Ch 2 on Focusrite Scarlett).
    let bestCh = Math.min(this.activeChannel, channelCount - 1);
    let bestEnergy = 0;
    let currentEnergy = 0;

    for (let ch = 0; ch < channelCount; ch += 1) {
      const data = input[ch];
      if (!data || data.length === 0) continue;
      let energy = 0;
      for (let i = 0; i < data.length; i += 1) {
        const s = data[i];
        energy += s * s;
      }
      if (ch === bestCh) currentEnergy = energy;
      if (energy > bestEnergy) {
        bestEnergy = energy;
        bestCh = ch;
      }
    }

    // Switch channel when the strongest channel clearly exceeds current channel and isn't pure digital zero.
    const meanSq = bestEnergy / Math.max(1, input[0].length);
    if (bestCh !== this.activeChannel && meanSq > 1e-8 && bestEnergy > currentEnergy * 1.35) {
      this.activeChannel = bestCh;
    } else if (this.activeChannel >= channelCount) {
      this.activeChannel = 0;
    }

    return this.activeChannel;
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelCount = input.length;
    const firstCh = input[0];
    if (!firstCh || firstCh.length === 0) return true;
    const blockLen = firstCh.length;

    const useSum = this.channelMode === 'sum' && channelCount > 1;
    const chosenCh = useSum ? 0 : this.pickActiveChannel(input);

    this.blocksSinceStatus += 1;
    if (channelCount !== this.lastChannelCount || this.blocksSinceStatus >= 90) {
      this.lastChannelCount = channelCount;
      this.blocksSinceStatus = 0;
      this.port.postMessage({
        type: 'input-status',
        channelCount,
        activeChannel: useSum ? -1 : chosenCh,
      });
    }

    for (let i = 0; i < blockLen; i += 1) {
      if (this.writeIndex === 0) {
        this.hopStartSec = currentTime + i / sampleRate;
      }

      let sample = 0;
      if (useSum) {
        for (let ch = 0; ch < channelCount; ch += 1) {
          const chBuf = input[ch];
          if (chBuf) sample += chBuf[i];
        }
        // Normalize lightly so dual-mono doesn't clip while keeping stereo-one-side strong
        sample *= 0.7071;
      } else {
        const chBuf = input[chosenCh];
        sample = chBuf ? chBuf[i] : 0;
      }

      this.buffer[this.writeIndex] = sample;
      this.writeIndex += 1;

      if (this.writeIndex >= HOP_SIZE) {
        const hop = this.buffer;
        this.buffer = new Float32Array(HOP_SIZE);
        this.writeIndex = 0;

        if (this.workerPort) {
          this.workerPort.postMessage(
            { type: 'hop', samples: hop, audioTimeSec: this.hopStartSec },
            [hop.buffer],
          );
        }
      }
    }
    return true;
  }
}

registerProcessor('sonicmambo-capture-processor', SonicMamboCaptureProcessor);
