// VRM driver for AFAN/blendshape frames.
//
// Lifted and consolidated from spawnpoint (client/facial-animation.js +
// FacialMappings.js). Drives @pixiv/three-vrm avatars for both VRM0 and
// VRM1, with viseme/eye/emotion mapping and per-frame decay.
//
// Usage:
//   import { FacialAnimationPlayer } from 'lipsync-sdk/vrm'
//   const player = new FacialAnimationPlayer(vrm)
//   player.loadAnimation(afanArrayBuffer)
//   await player.loadAudio(mp3ArrayBuffer)
//   player.play()
//   // in render loop:
//   player.update(dt)

import { parseAfan, AFAN_MAGIC } from './lipsync-afan.mjs';

const ARKIT_NAMES = [
  'browInnerUp','browDownLeft','browDownRight','browOuterUpLeft','browOuterUpRight',
  'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight',
  'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
  'eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight',
  'eyeWideLeft','eyeWideRight','cheekPuff','cheekSquintLeft','cheekSquintRight',
  'noseSneerLeft','noseSneerRight','jawOpen','jawForward','jawLeft','jawRight',
  'mouthFunnel','mouthPucker','mouthLeft','mouthRight',
  'mouthRollUpper','mouthRollLower','mouthShrugUpper','mouthShrugLower',
  'mouthOpen','mouthClose','mouthSmileLeft','mouthSmileRight',
  'mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight',
  'mouthUpperUpLeft','mouthUpperUpRight','mouthLowerDownLeft','mouthLowerDownRight',
  'mouthPressLeft','mouthPressRight','mouthStretchLeft','mouthStretchRight',
];

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function detectVRMVersion(vrm) {
  if (!vrm) return '1';
  if (vrm.meta?.version === '0' || vrm.meta?.specVersion?.startsWith('0')) return '0';
  if (vrm.expressionManager) {
    const names = vrm.expressionManager.expressions.map(e => e.expressionName);
    if (names.includes('fun') || names.includes('sorrow')) return '0';
    if (names.includes('happy') || names.includes('sad')) return '1';
  }
  return '1';
}

export function mapVisemes(bs) {
  const stretch = Math.max(bs.mouthStretchLeft || 0, bs.mouthStretchRight || 0);
  const upperUp = Math.max(bs.mouthUpperUpLeft || 0, bs.mouthUpperUpRight || 0);
  const lowerDown = Math.max(bs.mouthLowerDownLeft || 0, bs.mouthLowerDownRight || 0);
  const jaw = bs.jawOpen || 0;
  const funnel = bs.mouthFunnel || 0;
  const pucker = bs.mouthPucker || 0;
  return {
    aa: clamp(jaw * 0.7 + lowerDown * 0.3),
    ih: clamp(upperUp * 0.6 + stretch * 0.4),
    ou: clamp(funnel * 0.5 + pucker * 0.5),
    ee: clamp(stretch * 0.7 + (1 - jaw) * 0.3),
    oh: clamp(pucker * 0.4 + jaw * 0.4 + funnel * 0.2),
  };
}

export function mapEyes(bs) {
  const bL = bs.eyeBlinkLeft || 0, bR = bs.eyeBlinkRight || 0;
  const sL = bs.eyeSquintLeft || 0, sR = bs.eyeSquintRight || 0;
  return {
    blinkLeft: clamp(bL + sL * 0.3),
    blinkRight: clamp(bR + sR * 0.3),
    blink: clamp((bL + bR) / 2),
    lookUp: clamp(Math.max(bs.eyeLookUpLeft || 0, bs.eyeLookUpRight || 0)),
    lookDown: clamp(Math.max(bs.eyeLookDownLeft || 0, bs.eyeLookDownRight || 0)),
    lookLeft: clamp(Math.max(bs.eyeLookInLeft || 0, bs.eyeLookOutRight || 0)),
    lookRight: clamp(Math.max(bs.eyeLookInRight || 0, bs.eyeLookOutLeft || 0)),
  };
}

export function mapEmotionsV0(bs) {
  const smile = Math.max(bs.mouthSmileLeft || 0, bs.mouthSmileRight || 0);
  const frown = Math.max(bs.mouthFrownLeft || 0, bs.mouthFrownRight || 0);
  const browDown = Math.max(bs.browDownLeft || 0, bs.browDownRight || 0);
  const squint = Math.max(bs.eyeSquintLeft || 0, bs.eyeSquintRight || 0);
  const sneer = Math.max(bs.noseSneerLeft || 0, bs.noseSneerRight || 0);
  return {
    joy: clamp(smile * 0.8 + (1 - browDown) * 0.2),
    fun: clamp(smile * 0.6 + (bs.cheekPuff || 0) * 0.3 + squint * 0.1),
    angry: clamp(browDown * 0.6 + sneer * 0.3 + frown * 0.1),
    sorrow: clamp(frown * 0.5 + browDown * 0.3 + (1 - smile) * 0.2),
  };
}

export function mapEmotionsV1(bs) {
  const smile = Math.max(bs.mouthSmileLeft || 0, bs.mouthSmileRight || 0);
  const frown = Math.max(bs.mouthFrownLeft || 0, bs.mouthFrownRight || 0);
  const browUp = (bs.browInnerUp || 0) + Math.max(bs.browOuterUpLeft || 0, bs.browOuterUpRight || 0);
  const browDown = Math.max(bs.browDownLeft || 0, bs.browDownRight || 0);
  const squint = Math.max(bs.eyeSquintLeft || 0, bs.eyeSquintRight || 0);
  const wide = Math.max(bs.eyeWideLeft || 0, bs.eyeWideRight || 0);
  const sneer = Math.max(bs.noseSneerLeft || 0, bs.noseSneerRight || 0);
  return {
    happy: clamp(smile * 0.9 + squint * 0.1),
    sad: clamp(frown * 0.6 + browDown * 0.3 + (1 - smile) * 0.1),
    angry: clamp(browDown * 0.5 + sneer * 0.3 + frown * 0.2),
    relaxed: clamp((1 - browDown) * 0.5 + smile * 0.3 + (bs.cheekPuff || 0) * 0.2),
    surprised: clamp(browUp * 0.6 + wide * 0.3 + (bs.jawOpen || 0) * 0.1),
  };
}

// Convert a Float32Array(52) blendshape vector → named-key object the
// mappers above expect.
export function vecToNamed(vec) {
  const out = {};
  for (let i = 0; i < ARKIT_NAMES.length; i++) out[ARKIT_NAMES[i]] = vec[i];
  return out;
}

// AFAN reader supporting both v1 (named-key header) and v2 (indexed, fixed
// 52 ARKit channels). Result frames have shape { time, blendshapes:{name:val} }.
export class AnimationReader {
  constructor() { this.fps = 30; this.numBlendshapes = 0; this.numFrames = 0; this.names = ARKIT_NAMES; this.frames = []; }

  fromBuffer(input) {
    const buf = input instanceof ArrayBuffer ? input : input.buffer;
    const byteOffset = input instanceof ArrayBuffer ? 0 : input.byteOffset;
    const dv = new DataView(buf, byteOffset, input.byteLength ?? buf.byteLength);
    let off = 0;
    if (dv.getUint32(off, true) !== AFAN_MAGIC) throw new Error('Invalid AFAN file');
    off += 4;
    const ver = dv.getUint8(off++);
    if (ver < 1 || ver > 2) throw new Error(`Unsupported AFAN version: ${ver}`);
    this.fps = dv.getUint8(off++);
    this.numBlendshapes = dv.getUint8(off++);
    off += 1; // reserved/pad
    this.numFrames = dv.getUint32(off, true); off += 4;

    if (ver === 1) {
      this.names = [];
      for (let i = 0; i < this.numBlendshapes; i++) {
        const len = dv.getUint8(off++);
        this.names.push(new TextDecoder().decode(new Uint8Array(buf, byteOffset + off, len)));
        off += len;
      }
    } else {
      this.names = ARKIT_NAMES.slice(0, this.numBlendshapes);
    }

    this.frames = new Array(this.numFrames);
    for (let f = 0; f < this.numFrames; f++) {
      const fr = {};
      for (let i = 0; i < this.numBlendshapes; i++) fr[this.names[i]] = dv.getUint8(off++) / 255;
      this.frames[f] = { time: f / this.fps, blendshapes: fr };
    }
    return this;
  }

  static fromAfanV2(bytes) {
    const r = new AnimationReader();
    const { fps, numFrames, frames } = parseAfan(bytes);
    r.fps = fps; r.numBlendshapes = 52; r.numFrames = numFrames;
    r.names = ARKIT_NAMES.slice();
    r.frames = frames.map((vec, i) => ({ time: i / fps, blendshapes: vecToNamed(vec) }));
    return r;
  }

  getFrame(i) { return this.frames[Math.max(0, Math.min(i, this.frames.length - 1))]; }
  getFrameAtTime(t) { return this.getFrame(Math.floor(t * this.fps)); }
}

export class FacialAnimationPlayer {
  constructor(vrm, opts = {}) {
    this.vrm = vrm;
    this.expressionManager = vrm?.expressionManager || null;
    this.vrmVersion = detectVRMVersion(vrm);
    this.animation = null;
    this.audio = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.currentTime = 0;
    this.onComplete = null;
    this.volume = opts.volume ?? 1.0;
    this.availableExpressions = new Set();
    this.storedExpressions = new Map();
    this.lastApplied = new Map();
    if (this.expressionManager)
      this.expressionManager.expressions.forEach(e => this.availableExpressions.add(e.expressionName));
  }

  loadAnimation(buf) { this.animation = new AnimationReader().fromBuffer(buf); return this.animation; }

  loadAudio(buf, mime = 'audio/mpeg') {
    this.audio = new Audio();
    this.audio.src = URL.createObjectURL(new Blob([buf], { type: mime }));
    this.audio.volume = this.volume;
    return new Promise((res, rej) => {
      this.audio.oncanplaythrough = () => res(this);
      this.audio.onerror = () => rej(new Error('Failed to load audio'));
    });
  }

  async load(anim, audio, mime) {
    if (anim) this.loadAnimation(anim);
    if (audio) await this.loadAudio(audio, mime);
    return this;
  }

  play() {
    if (!this.animation) return;
    this.storedExpressions.clear();
    this.lastApplied.clear();
    if (this.expressionManager) {
      for (const n of ['blink', 'blinkLeft', 'blinkRight']) {
        if (this.availableExpressions.has(n)) {
          const v = this.expressionManager.getValue(n);
          if (v > 0) this.storedExpressions.set(n, v);
        }
      }
    }
    this.isPlaying = true;
    this.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this.audio) { this.audio.currentTime = 0; this.audio.play().catch(() => {}); }
  }

  stop() {
    this.isPlaying = false;
    if (this.audio) { this.audio.pause(); this.audio.currentTime = 0; }
    this.resetExpressions();
  }

  resetExpressions() {
    if (!this.expressionManager) return;
    for (const n of this.availableExpressions)
      this.expressionManager.setValue(n, this.storedExpressions.has(n) ? this.storedExpressions.get(n) : 0);
    this.lastApplied.clear();
  }

  update(_dt) {
    if (!this.isPlaying || !this.animation) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const elapsed = (now - this.startTime) / 1000;
    this.currentTime = elapsed;
    const frame = this.animation.getFrameAtTime(elapsed);
    if (!frame) return;
    this.applyFrame(frame.blendshapes);
    if (elapsed >= this.animation.frames.length / this.animation.fps) {
      this.isPlaying = false;
      this.onComplete?.();
    }
  }

  applyFrame(bs) {
    if (!this.expressionManager) return;
    const vals = new Map();
    const has = n => this.availableExpressions.has(n);
    const set = (n, v) => { if (has(n) && v > 0.001) vals.set(n, clamp(v)); };

    const vis = mapVisemes(bs);
    set('aa', vis.aa); set('ih', vis.ih); set('ou', vis.ou); set('ee', vis.ee); set('oh', vis.oh);

    const eyes = mapEyes(bs);
    set('blinkLeft', eyes.blinkLeft); set('blinkRight', eyes.blinkRight); set('blink', eyes.blink);
    set('lookUp', eyes.lookUp); set('lookDown', eyes.lookDown); set('lookLeft', eyes.lookLeft); set('lookRight', eyes.lookRight);

    const emo = this.vrmVersion === '0' ? mapEmotionsV0(bs) : mapEmotionsV1(bs);
    if (this.vrmVersion === '0') {
      set('joy', emo.joy); set('fun', emo.fun); set('angry', emo.angry); set('sorrow', emo.sorrow);
    } else {
      set('happy', emo.happy); set('sad', emo.sad); set('angry', emo.angry);
      set('relaxed', emo.relaxed); set('surprised', emo.surprised);
    }

    for (const [n, v] of vals) {
      if (!this.storedExpressions.has(n)) {
        this.expressionManager.setValue(n, v);
        this.lastApplied.set(n, v);
      }
    }
    for (const n of [...this.lastApplied.keys()]) {
      if (!vals.has(n)) {
        const d = this.lastApplied.get(n) * 0.6;
        if (d < 0.01) { this.expressionManager.setValue(n, 0); this.lastApplied.delete(n); }
        else { this.expressionManager.setValue(n, d); this.lastApplied.set(n, d); }
      }
    }
  }

  applyVec(vec) { this.applyFrame(vecToNamed(vec)); }

  getDuration() { return this.animation ? this.animation.frames.length / this.animation.fps : 0; }
  setVolume(v) { this.volume = clamp(v); if (this.audio) this.audio.volume = this.volume; }
  dispose() {
    this.stop();
    if (this.audio) { URL.revokeObjectURL(this.audio.src); this.audio = null; }
    this.animation = null;
  }
}

export function createFacialPlayer(vrm, opts = {}) { return new FacialAnimationPlayer(vrm, opts); }
export { ARKIT_NAMES };
export default FacialAnimationPlayer;
