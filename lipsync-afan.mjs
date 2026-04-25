// AFAN binary frame format — compact streaming of ARKit blendshape frames.
//
//   Magic:     0x4146414E ("AFAN", 4 bytes LE)
//   Version:   2          (uint8)
//   FPS:                  (uint8)
//   NumBS:     52         (uint8)
//   Reserved:  0          (uint8 — pad to 4-byte align)
//   NumFrames:            (uint32 LE)
//   Frames:    numFrames × numBS bytes (uint8 0..255 = blendshape * 255)
//
// Uses Uint8Array + DataView so it works in both Node and the browser.

const MAGIC = 0x4146414E;
const VERSION = 2;
const NUM_BS = 52;
const HEADER_BYTES = 12;

const q8 = v => v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;

// frames: Float32Array[52][] (or named-key objects { jawOpen: 0.5, ... }).
// Returns Uint8Array.
export function buildAfan(frames, fps = 30, { blendshapeNames = null } = {}) {
  const numFrames = frames.length;
  const buf = new Uint8Array(HEADER_BYTES + numFrames * NUM_BS);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, MAGIC, true);
  buf[4] = VERSION;
  buf[5] = fps & 0xff;
  buf[6] = NUM_BS;
  buf[7] = 0;
  dv.setUint32(8, numFrames, true);
  let off = HEADER_BYTES;
  for (let f = 0; f < numFrames; f++) {
    const frame = frames[f];
    const indexed = typeof frame.length === 'number';
    for (let i = 0; i < NUM_BS; i++) {
      const raw = indexed ? frame[i] : (blendshapeNames ? frame[blendshapeNames[i]] : 0);
      buf[off++] = q8(raw == null ? 0 : raw);
    }
  }
  return buf;
}

// Returns { fps, numFrames, frames: Float32Array[52][] }.
export function parseAfan(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`AFAN magic mismatch: 0x${magic.toString(16)}`);
  const version = buf[4];
  if (version !== VERSION) throw new Error(`AFAN version ${version} unsupported (expected ${VERSION})`);
  const fps = buf[5];
  const numBS = buf[6];
  if (numBS !== NUM_BS) throw new Error(`AFAN numBS ${numBS} (expected ${NUM_BS})`);
  const numFrames = dv.getUint32(8, true);
  const expected = HEADER_BYTES + numFrames * numBS;
  if (buf.byteLength < expected) throw new Error(`AFAN truncated: ${buf.byteLength} < ${expected}`);
  const frames = new Array(numFrames);
  let off = HEADER_BYTES;
  for (let f = 0; f < numFrames; f++) {
    const v = new Float32Array(numBS);
    for (let i = 0; i < numBS; i++) v[i] = buf[off++] / 255;
    frames[f] = v;
  }
  return { fps, numFrames, frames };
}

// Async generator: chunks of N frames as AFAN packets — one header per chunk.
// Useful for streaming over WebSocket / Response body / floosie pipelines.
export async function* afanChunks(frameSource, fps = 30, framesPerChunk = 30) {
  let batch = [];
  for await (const frame of frameSource) {
    batch.push(frame);
    if (batch.length >= framesPerChunk) {
      yield buildAfan(batch, fps);
      batch = [];
    }
  }
  if (batch.length) yield buildAfan(batch, fps);
}

export const AFAN_MAGIC = MAGIC;
export const AFAN_VERSION = VERSION;
export const AFAN_NUM_BS = NUM_BS;
export const AFAN_HEADER_BYTES = HEADER_BYTES;
