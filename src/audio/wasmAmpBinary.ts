/**
 * Pure WebAssembly (`f32` native machine code) Guitar Tube Preamp, 12" Speaker Cabinet,
 * and Stereo Room DSP kernel.
 *
 * Memory map (1 WASM page = 64 KiB):
 * - 0x0000 (0):     in0     f32[128]
 * - 0x0200 (512):   in1     f32[128]
 * - 0x0400 (1024):  outL    f32[128]
 * - 0x0600 (1536):  outR    f32[128]
 * - 0x0800 (2048):  params  f32[18]
 * - 0x0900 (2304):  state   f32[8]
 * - 0x0980 (2432):  delayIdx i32
 * - 0x1000 (4096):  delayL  f32[2048]
 * - 0x3000 (12288): delayR  f32[2048]
 */

export const WASM_AMP_OFFSETS = {
  in0Bytes: 0,
  in1Bytes: 512,
  outLBytes: 1024,
  outRBytes: 1536,
  paramsBytes: 2048,
  stateBytes: 2304,
} as const;

function uleb(val: number): number[] {
  const out: number[] = [];
  let v = val >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function sleb(val: number): number[] {
  const out: number[] = [];
  let v = val | 0;
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    out.push(byte);
  }
  return out;
}

function f32Bytes(val: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, val, true);
  return Array.from(new Uint8Array(buf));
}

function strBytes(s: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(s));
  return [...uleb(bytes.length), ...bytes];
}

function section(id: number, payload: number[]): number[] {
  return [id, ...uleb(payload.length), ...payload];
}

// WASM opcodes
const OP = {
  block: 0x02,
  loop: 0x03,
  end: 0x0b,
  br: 0x0c,
  br_if: 0x0d,
  select: 0x1b,
  local_get: 0x20,
  local_set: 0x21,
  local_tee: 0x22,
  i32_load: 0x28,
  f32_load: 0x2a,
  i32_store: 0x36,
  f32_store: 0x38,
  i32_const: 0x41,
  f32_const: 0x43,
  i32_ge_s: 0x4e,
  f32_ge: 0x60,
  i32_add: 0x6a,
  i32_sub: 0x6b,
  i32_and: 0x71,
  i32_shl: 0x74,
  f32_add: 0x92,
  f32_sub: 0x93,
  f32_mul: 0x94,
  f32_div: 0x95,
  f32_min: 0x96,
  f32_max: 0x97,
} as const;

const F32 = 0x7d;
const I32 = 0x7f;
const VOID_BLOCK = 0x40;

function fLoad(offset: number, addrExpr: number[] = [OP.i32_const, 0]): number[] {
  return [...addrExpr, OP.f32_load, 0x02, ...uleb(offset)];
}

function fStore(offset: number, addrExpr: number[], valExpr: number[]): number[] {
  return [...addrExpr, ...valExpr, OP.f32_store, 0x02, ...uleb(offset)];
}

let cachedBinary: Uint8Array | null = null;

/**
 * Builds and caches the compiled `.wasm` binary for the Guitar Amp DSP kernel (~760 bytes).
 */
export function getGuitarAmpWasmBinary(): Uint8Array {
  if (cachedBinary) return cachedBinary;

  // Local indices for `process(frames: i32)`:
  // 0: frames (param i32)
  // i32 locals (1..5):
  // 1: i, 2: byteOff, 3: dIdx, 4: readOffL, 5: readOffR
  // f32 locals (6..34):
  // 6: ch0W, 7: ch1W, 8: hpC, 9: drive, 10: makeup,
  // 11: b10, 12: b11, 13: b12, 14: a11, 15: a12,
  // 16: b20, 17: b21, 18: b22, 19: a21, 20: a22,
  // 21: roomWet, 22: roomFb, 23: master,
  // 24: hpIn, 25: hpOut, 26: z11, 27: z12, 28: z21, 29: z22, 30: lpL, 31: lpR,
  // 32: x, 33: y, 34: cab
  const L = {
    frames: 0,
    i: 1,
    byteOff: 2,
    dIdx: 3,
    readOffL: 4,
    readOffR: 5,
    ch0W: 6,
    ch1W: 7,
    hpC: 8,
    drive: 9,
    makeup: 10,
    b10: 11,
    b11: 12,
    b12: 13,
    a11: 14,
    a12: 15,
    b20: 16,
    b21: 17,
    b22: 18,
    a21: 19,
    a22: 20,
    roomWet: 21,
    roomFb: 22,
    master: 23,
    hpIn: 24,
    hpOut: 25,
    z11: 26,
    z12: 27,
    z21: 28,
    z22: 29,
    lpL: 30,
    lpR: 31,
    x: 32,
    y: 33,
    cab: 34,
  } as const;

  const body: number[] = [];

  // Load 18 float parameters into WASM registers once per block
  for (let p = 0; p < 18; p += 1) {
    body.push(...fLoad(2048 + p * 4), OP.local_set, ...uleb(L.ch0W + p));
  }

  // Load persistent filter state into registers
  for (let s = 0; s < 8; s += 1) {
    body.push(...fLoad(2304 + s * 4), OP.local_set, ...uleb(L.hpIn + s));
  }
  body.push(OP.i32_const, 0, OP.i32_load, 0x02, ...uleb(2432), OP.local_set, L.dIdx);

  // i = 0
  body.push(OP.i32_const, 0, OP.local_set, L.i);

  // Sample loop: block { loop { if (i >= frames) br 1; ... i++; br 0; } }
  body.push(
    OP.block,
    VOID_BLOCK,
    OP.loop,
    VOID_BLOCK,
    OP.local_get,
    L.i,
    OP.local_get,
    L.frames,
    OP.i32_ge_s,
    OP.br_if,
    1,

    // byteOff = i << 2
    OP.local_get,
    L.i,
    OP.i32_const,
    2,
    OP.i32_shl,
    OP.local_set,
    L.byteOff,

    // x = in0[i] * ch0W + in1[i] * ch1W
    ...fLoad(0, [OP.local_get, L.byteOff]),
    OP.local_get,
    L.ch0W,
    OP.f32_mul,
    ...fLoad(512, [OP.local_get, L.byteOff]),
    OP.local_get,
    L.ch1W,
    OP.f32_mul,
    OP.f32_add,
    OP.local_set,
    L.x,

    // 85 Hz High-Pass Tightener: y = x - hpIn + hpC * hpOut
    OP.local_get,
    L.x,
    OP.local_get,
    L.hpIn,
    OP.f32_sub,
    OP.local_get,
    L.hpC,
    OP.local_get,
    L.hpOut,
    OP.f32_mul,
    OP.f32_add,
    OP.local_set,
    L.hpOut,
    OP.local_get,
    L.x,
    OP.local_set,
    L.hpIn,

    // Asymmetric triode drive: u = hpOut * drive; u = (u >= 0) ? u : u * 0.82
    OP.local_get,
    L.hpOut,
    OP.local_get,
    L.drive,
    OP.f32_mul,
    OP.local_tee,
    L.x,
    OP.local_get,
    L.x,
    OP.f32_const,
    ...f32Bytes(0.82),
    OP.f32_mul,
    OP.local_get,
    L.x,
    OP.f32_const,
    ...f32Bytes(0),
    OP.f32_ge,
    OP.select,

    // Clamp u to [-3.0, +3.0]
    OP.f32_const,
    ...f32Bytes(-3.0),
    OP.f32_max,
    OP.f32_const,
    ...f32Bytes(3.0),
    OP.f32_min,
    OP.local_set,
    L.x,

    // Padé soft-saturation: sat = (x * (27 + x*x)) / (27 + 9 * x*x) * makeup
    // y = x * x
    OP.local_get,
    L.x,
    OP.local_get,
    L.x,
    OP.f32_mul,
    OP.local_set,
    L.y,

    OP.local_get,
    L.x,
    OP.f32_const,
    ...f32Bytes(27.0),
    OP.local_get,
    L.y,
    OP.f32_add,
    OP.f32_mul,

    OP.f32_const,
    ...f32Bytes(27.0),
    OP.f32_const,
    ...f32Bytes(9.0),
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.f32_add,
    OP.f32_div,
    OP.local_get,
    L.makeup,
    OP.f32_mul,
    OP.local_set,
    L.x,

    // Biquad 1 (Mid Voicing + Resonance, DF2T):
    // y = b10 * x + z11
    OP.local_get,
    L.b10,
    OP.local_get,
    L.x,
    OP.f32_mul,
    OP.local_get,
    L.z11,
    OP.f32_add,
    OP.local_set,
    L.y,
    // z11 = b11 * x - a11 * y + z12
    OP.local_get,
    L.b11,
    OP.local_get,
    L.x,
    OP.f32_mul,
    OP.local_get,
    L.a11,
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.f32_sub,
    OP.local_get,
    L.z12,
    OP.f32_add,
    OP.local_set,
    L.z11,
    // z12 = b12 * x - a12 * y
    OP.local_get,
    L.b12,
    OP.local_get,
    L.x,
    OP.f32_mul,
    OP.local_get,
    L.a12,
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.f32_sub,
    OP.local_set,
    L.z12,

    // Biquad 2 (12" Speaker Cabinet Steep Lowpass, DF2T):
    // cab = b20 * y + z21
    OP.local_get,
    L.b20,
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.local_get,
    L.z21,
    OP.f32_add,
    OP.local_set,
    L.cab,
    // z21 = b21 * y - a21 * cab + z22
    OP.local_get,
    L.b21,
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.local_get,
    L.a21,
    OP.local_get,
    L.cab,
    OP.f32_mul,
    OP.f32_sub,
    OP.local_get,
    L.z22,
    OP.f32_add,
    OP.local_set,
    L.z21,
    // z22 = b22 * y - a22 * cab
    OP.local_get,
    L.b22,
    OP.local_get,
    L.y,
    OP.f32_mul,
    OP.local_get,
    L.a22,
    OP.local_get,
    L.cab,
    OP.f32_mul,
    OP.f32_sub,
    OP.local_set,
    L.z22,

    // Stereo Room Delay Taps inside Haas fusion window (<18ms -> tight pick transient, zero slapback lag!)
    // readOffL = ((dIdx - 528) & 2047) << 2  (~11.0 ms @ 48kHz)
    OP.local_get,
    L.dIdx,
    OP.i32_const,
    ...sleb(528),
    OP.i32_sub,
    OP.i32_const,
    ...sleb(2047),
    OP.i32_and,
    OP.i32_const,
    2,
    OP.i32_shl,
    OP.local_set,
    L.readOffL,

    // readOffR = ((dIdx - 816) & 2047) << 2  (~17.0 ms @ 48kHz)
    OP.local_get,
    L.dIdx,
    OP.i32_const,
    ...sleb(816),
    OP.i32_sub,
    OP.i32_const,
    ...sleb(2047),
    OP.i32_and,
    OP.i32_const,
    2,
    OP.i32_shl,
    OP.local_set,
    L.readOffR,

    // lpL = lpL + 0.35 * (delayL[readOffL] - lpL)
    OP.local_get,
    L.lpL,
    OP.f32_const,
    ...f32Bytes(0.35),
    ...fLoad(4096, [OP.local_get, L.readOffL]),
    OP.local_get,
    L.lpL,
    OP.f32_sub,
    OP.f32_mul,
    OP.f32_add,
    OP.local_set,
    L.lpL,

    // lpR = lpR + 0.35 * (delayR[readOffR] - lpR)
    OP.local_get,
    L.lpR,
    OP.f32_const,
    ...f32Bytes(0.35),
    ...fLoad(12288, [OP.local_get, L.readOffR]),
    OP.local_get,
    L.lpR,
    OP.f32_sub,
    OP.f32_mul,
    OP.f32_add,
    OP.local_set,
    L.lpR,

    // Write cross-fed room reflections into delayL[dIdx] and delayR[dIdx]
    ...fStore(
      4096,
      [OP.local_get, L.dIdx, OP.i32_const, 2, OP.i32_shl],
      [
        OP.local_get,
        L.cab,
        OP.local_get,
        L.lpR,
        OP.local_get,
        L.roomFb,
        OP.f32_mul,
        OP.f32_add,
      ],
    ),
    ...fStore(
      12288,
      [OP.local_get, L.dIdx, OP.i32_const, 2, OP.i32_shl],
      [
        OP.local_get,
        L.cab,
        OP.local_get,
        L.lpL,
        OP.local_get,
        L.roomFb,
        OP.f32_mul,
        OP.f32_add,
      ],
    ),

    // dIdx = (dIdx + 1) & 2047
    OP.local_get,
    L.dIdx,
    OP.i32_const,
    1,
    OP.i32_add,
    OP.i32_const,
    ...sleb(2047),
    OP.i32_and,
    OP.local_set,
    L.dIdx,

    // outL[i] = (cab + lpL * roomWet) * master
    ...fStore(
      1024,
      [OP.local_get, L.byteOff],
      [
        OP.local_get,
        L.cab,
        OP.local_get,
        L.lpL,
        OP.local_get,
        L.roomWet,
        OP.f32_mul,
        OP.f32_add,
        OP.local_get,
        L.master,
        OP.f32_mul,
      ],
    ),

    // outR[i] = (cab + lpR * roomWet) * master
    ...fStore(
      1536,
      [OP.local_get, L.byteOff],
      [
        OP.local_get,
        L.cab,
        OP.local_get,
        L.lpR,
        OP.local_get,
        L.roomWet,
        OP.f32_mul,
        OP.f32_add,
        OP.local_get,
        L.master,
        OP.f32_mul,
      ],
    ),

    // i = i + 1; continue
    OP.local_get,
    L.i,
    OP.i32_const,
    1,
    OP.i32_add,
    OP.local_set,
    L.i,
    OP.br,
    0,
    OP.end,
    OP.end,
  );

  // Persist updated filter state back to linear memory
  for (let s = 0; s < 8; s += 1) {
    body.push(
      ...fStore(2304 + s * 4, [OP.i32_const, 0], [OP.local_get, ...uleb(L.hpIn + s)]),
    );
  }
  body.push(
    OP.i32_const,
    0,
    OP.local_get,
    L.dIdx,
    OP.i32_store,
    0x02,
    ...uleb(2432),
    OP.end,
  );

  // Function locals declaration: 5 x i32, 29 x f32
  const localsDecl = [
    ...uleb(2),
    ...uleb(5),
    I32,
    ...uleb(29),
    F32,
  ];
  const funcPayload = [...localsDecl, ...body];
  const codeSectionPayload = [
    ...uleb(1),
    ...uleb(funcPayload.length),
    ...funcPayload,
  ];

  // Type section: 1 func type (i32) -> ()
  const typeSectionPayload = [
    ...uleb(1),
    0x60,
    ...uleb(1),
    I32,
    ...uleb(0),
  ];

  // Function section: 1 function of type 0
  const funcSectionPayload = [...uleb(1), ...uleb(0)];

  // Memory section: 1 memory, min 1 page (64 KiB), max 1 page
  const memSectionPayload = [...uleb(1), 0x01, ...uleb(1), ...uleb(1)];

  // Export section: export memory "memory" (kind 2, idx 0) and func "process" (kind 0, idx 0)
  const exportSectionPayload = [
    ...uleb(2),
    ...strBytes('memory'),
    0x02,
    ...uleb(0),
    ...strBytes('process'),
    0x00,
    ...uleb(0),
  ];

  const wasm = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // "\0asm"
    0x01, 0x00, 0x00, 0x00, // version 1
    ...section(1, typeSectionPayload),
    ...section(3, funcSectionPayload),
    ...section(5, memSectionPayload),
    ...section(7, exportSectionPayload),
    ...section(10, codeSectionPayload),
  ]);

  cachedBinary = wasm;
  return wasm;
}

/** Audio EQ Cookbook Peaking Biquad coefficients normalized by a0. */
export function computePeakingBiquad(
  freqHz: number,
  q: number,
  gainDb: number,
  sampleRate: number,
): [number, number, number, number, number] {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freqHz) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha / A;

  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Audio EQ Cookbook 2nd-Order Lowpass Biquad (12" Speaker Cab Roll-Off). */
export function computeLowpassBiquad(
  cutoffHz: number,
  q: number,
  sampleRate: number,
): [number, number, number, number, number] {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);

  const b0 = (1 - cosW) / 2;
  const b1 = 1 - cosW;
  const b2 = (1 - cosW) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;

  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
