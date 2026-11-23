/**
 * Stateful 2nd-order Butterworth High-Pass IIR Filter (Direct Form II Transposed).
 * Removes DC offset, pick/body handling thumps, and mains hum (< 60 Hz) across frames.
 */
export class HighPassBiquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private configuredSampleRate = 0;
  private readonly cutoffHz: number;
  private readonly q: number;

  constructor(cutoffHz: number = 60, q: number = Math.SQRT1_2) {
    this.cutoffHz = cutoffHz;
    this.q = q;
  }

  private ensureCoefficients(sampleRate: number): void {
    if (sampleRate === this.configuredSampleRate || sampleRate <= 0) return;
    this.configuredSampleRate = sampleRate;

    const w0 = (2 * Math.PI * this.cutoffHz) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * this.q);

    const a0 = 1 + alpha;
    this.b0 = (1 + cosW0) / 2 / a0;
    this.b1 = -(1 + cosW0) / a0;
    this.b2 = (1 + cosW0) / 2 / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input: Float32Array, output: Float32Array, sampleRate: number): Float32Array {
    this.ensureCoefficients(sampleRate);
    const { b0, b1, b2, a1, a2 } = this;
    let z1 = this.z1;
    let z2 = this.z2;

    for (let i = 0; i < input.length; i += 1) {
      const x = input[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      output[i] = y;
    }

    this.z1 = z1;
    this.z2 = z2;
    return output;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}
