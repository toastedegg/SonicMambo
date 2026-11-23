/**
 * Pure TypeScript RIFF/WAVE PCM decoder & encoder (16-bit PCM and 32-bit IEEE float).
 * Safely scans chunks by tag ('fmt ' and 'data') so WAVs containing JUNK/LIST chunks work.
 */
export function decodeWav(input: ArrayBuffer | Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input, 0, input.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < 44) {
    throw new Error('WAV buffer too short (< 44 bytes)');
  }
  const riff = readAscii(bytes, 0, 4);
  const wave = readAscii(bytes, 8, 4);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error(`Invalid RIFF/WAVE header: ${riff}/${wave}`);
  }

  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const bodyOffset = offset + 8;

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(bodyOffset, true);
      numChannels = view.getUint16(bodyOffset + 2, true);
      sampleRate = view.getUint32(bodyOffset + 4, true);
      bitsPerSample = view.getUint16(bodyOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = bodyOffset;
      dataLength = Math.min(chunkSize, bytes.byteLength - bodyOffset);
      break;
    }

    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || numChannels < 1 || sampleRate <= 0) {
    throw new Error('WAV missing fmt or data chunk');
  }

  const bytesPerSample = bitsPerSample >> 3;
  const frameStride = bytesPerSample * numChannels;
  const frameCount = Math.floor(dataLength / frameStride);
  const mono = new Float32Array(frameCount);

  if (audioFormat === 1 && bitsPerSample === 16) {
    for (let i = 0; i < frameCount; i += 1) {
      let sum = 0;
      const base = dataOffset + i * frameStride;
      for (let ch = 0; ch < numChannels; ch += 1) {
        sum += view.getInt16(base + ch * 2, true) / 32768;
      }
      mono[i] = sum / numChannels;
    }
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    for (let i = 0; i < frameCount; i += 1) {
      let sum = 0;
      const base = dataOffset + i * frameStride;
      for (let ch = 0; ch < numChannels; ch += 1) {
        sum += view.getFloat32(base + ch * 4, true);
      }
      mono[i] = sum / numChannels;
    }
  } else {
    throw new Error(
      `Unsupported WAV encoding: format=${audioFormat}, bits=${bitsPerSample}`,
    );
  }

  return { samples: mono, sampleRate };
}

export function encodeWavMono16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);

  writeAscii(out, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(out, 8, 'WAVE');

  writeAscii(out, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeAscii(out, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(44 + i * 2, int16, true);
  }

  return out;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i += 1) {
    s += String.fromCharCode(bytes[offset + i]);
  }
  return s;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    bytes[offset + i] = text.charCodeAt(i);
  }
}
