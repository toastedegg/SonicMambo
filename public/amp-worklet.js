class SonicMamboWasmAmpProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.stopped = false;
    this.wasmProcess = null;
    this.in0 = null;
    this.in1 = null;
    this.outL = null;
    this.outR = null;
    this.paramsView = null;

    const procOpts = (options && options.processorOptions) || {};
    if (procOpts.wasmBytes) {
      this.instantiateWasm(procOpts.wasmBytes, procOpts.initialParams);
    }

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'params' && this.paramsView && msg.params) {
        this.paramsView.set(msg.params);
      } else if (msg.type === 'stop') {
        this.stopped = true;
      }
    };
  }

  instantiateWasm(wasmBytes, initialParams) {
    const mod = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(mod);
    const buf = instance.exports.memory.buffer;
    this.wasmProcess = instance.exports.process;
    this.in0 = new Float32Array(buf, 0, 128);
    this.in1 = new Float32Array(buf, 512, 128);
    this.outL = new Float32Array(buf, 1024, 128);
    this.outR = new Float32Array(buf, 1536, 128);
    this.paramsView = new Float32Array(buf, 2048, 18);
    if (initialParams) {
      this.paramsView.set(initialParams);
    }
  }

  process(inputs, outputs) {
    if (this.stopped) return false;
    if (!this.wasmProcess) return true;

    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outChL = output[0];
    const outChR = output.length > 1 ? output[1] : null;
    const frames = outChL.length;
    if (frames === 0 || frames > 128) return true;

    if (input && input.length > 0 && input[0]) {
      this.in0.set(input[0]);
    } else {
      this.in0.fill(0, 0, frames);
    }

    if (input && input.length > 1 && input[1]) {
      this.in1.set(input[1]);
    } else {
      this.in1.fill(0, 0, frames);
    }

    // Native WebAssembly f32 DSP execution (~2.3 microseconds per 128 frames)
    this.wasmProcess(frames);

    outChL.set(this.outL.subarray(0, frames));
    if (outChR) {
      outChR.set(this.outR.subarray(0, frames));
    }

    return true;
  }
}

registerProcessor('sonicmambo-wasm-amp-processor', SonicMamboWasmAmpProcessor);
