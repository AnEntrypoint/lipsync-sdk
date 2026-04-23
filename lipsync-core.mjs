// Oculus viseme → ARKit blendshape weights
// Each viseme maps to a sparse set of blendshape { name: weight } pairs
// Weights derived from Meta Codec Avatar reference + empirical tuning
const VISEME_BLENDSHAPES = {
  sil: {},
  PP: { mouthClose: 0.8, mouthPressLeft: 0.5, mouthPressRight: 0.5, mouthRollLower: 0.3, mouthRollUpper: 0.3 },
  FF: { mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3, mouthRollLower: 0.2, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
  TH: { mouthClose: 0.1, mouthFunnel: 0.1, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, mouthRollLower: 0.1, mouthUpperUpLeft: 0.1, mouthUpperUpRight: 0.1 },
  DD: { jawOpen: 0.2, mouthLowerDownLeft: 0.4, mouthLowerDownRight: 0.4, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
  kk: { jawOpen: 0.25, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
  CH: { jawOpen: 0.15, mouthFunnel: 0.5, mouthPucker: 0.2, mouthRollLower: 0.2, mouthRollUpper: 0.1 },
  SS: { mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1, mouthSmileLeft: 0.3, mouthSmileRight: 0.3, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  nn: { jawOpen: 0.1, mouthClose: 0.2, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1, mouthRollLower: 0.1 },
  RR: { jawOpen: 0.2, mouthFunnel: 0.3, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, mouthPucker: 0.2 },
  aa: { cheekSquintLeft: 0.1, cheekSquintRight: 0.1, jawOpen: 0.7, mouthLowerDownLeft: 0.5, mouthLowerDownRight: 0.5, mouthUpperUpLeft: 0.3, mouthUpperUpRight: 0.3 },
  E:  { jawOpen: 0.4, mouthLowerDownLeft: 0.4, mouthLowerDownRight: 0.4, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  I:  { jawOpen: 0.2, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2, mouthSmileLeft: 0.7, mouthSmileRight: 0.7, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },
  O:  { cheekSquintLeft: 0.05, cheekSquintRight: 0.05, jawOpen: 0.5, mouthFunnel: 0.6, mouthPucker: 0.3, mouthRollLower: 0.1, mouthRollUpper: 0.1 },
  U:  { jawOpen: 0.2, mouthFunnel: 0.4, mouthPucker: 0.7, mouthRollLower: 0.2, mouthRollUpper: 0.2 },
};

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

const ARKIT_INDEX = Object.fromEntries(ARKIT_NAMES.map((n, i) => [n, i]));

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// Pre-build viseme → sparse Float32Array blendshape vectors
const VISEME_VECTORS = Object.fromEntries(
  Object.entries(VISEME_BLENDSHAPES).map(([vis, weights]) => {
    const vec = new Float32Array(ARKIT_NAMES.length);
    for (const [name, w] of Object.entries(weights)) {
      const idx = ARKIT_INDEX[name];
      if (idx !== undefined) vec[idx] = w;
    }
    return [vis, vec];
  })
);

export class LipsyncCore {
  static get BLENDSHAPE_NAMES() { return ARKIT_NAMES; }
  static get VISEME_NAMES() { return Object.keys(VISEME_BLENDSHAPES); }

  constructor({ lipsyncModules = null, smoothing = 0.35 } = {}) {
    this._modules = lipsyncModules || {};
    this._smoothing = clamp(smoothing);
    this._prev = new Float32Array(ARKIT_NAMES.length);
  }

  // Register a lipsync language module (LipsyncEn, LipsyncFi, etc.)
  registerLanguage(lang, instance) {
    this._modules[lang] = instance;
  }

  // Convert word+timestamp data to a timed blendshape animation track.
  // Returns: Array of { t: ms, blendshapes: [{name, value}] }
  // If visemes pre-provided, uses them directly.
  wordsToFrames({ words, wtimes, wdurations, visemes, vtimes, vdurations, lang = 'en' }) {
    const events = visemes
      ? this._precomputedVisemeEvents(visemes, vtimes, vdurations)
      : this._wordsToVisemeEvents(words, wtimes, wdurations, lang);
    return this._eventsToFrames(events);
  }

  // Get blendshape values at a given time (ms) by interpolating the track.
  // track = output of wordsToFrames; returns Float32Array
  sampleTrack(track, timeMs) {
    if (!track.length) return new Float32Array(ARKIT_NAMES.length);
    if (timeMs <= track[0].t) return track[0].vec.slice();
    if (timeMs >= track[track.length - 1].t) return track[track.length - 1].vec.slice();

    let lo = 0, hi = track.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (track[mid].t <= timeMs) lo = mid; else hi = mid;
    }
    const a = track[lo], b = track[hi];
    const alpha = (timeMs - a.t) / (b.t - a.t);
    const out = new Float32Array(ARKIT_NAMES.length);
    for (let i = 0; i < out.length; i++) out[i] = a.vec[i] * (1 - alpha) + b.vec[i] * alpha;
    return out;
  }

  // Smooth consecutive blendshape vectors (EMA), mutates vec in place
  applySmoothing(vec) {
    const f = this._smoothing;
    for (let i = 0; i < vec.length; i++) vec[i] = this._prev[i] * f + vec[i] * (1 - f);
    this._prev.set(vec);
    return vec;
  }

  resetSmoothing() { this._prev.fill(0); }

  vecToBlendshapes(vec) {
    return ARKIT_NAMES.map((name, i) => ({ name, value: vec[i] }));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  _wordsToVisemeEvents(words, wtimes, wdurations, lang) {
    const mod = this._modules[lang];
    if (!mod) throw new Error(`No lipsync module for lang "${lang}". Register one via registerLanguage().`);
    const events = [];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const startMs = wtimes[i];
      const durMs = Math.min(wdurations[i], words[i].length * 200);
      if (!word.length) continue;

      const preprocessed = mod.preProcessText ? mod.preProcessText(word) : word;
      const val = mod.wordsToVisemes(preprocessed);
      if (!val || !val.visemes.length) continue;

      const dTotal = val.times[val.visemes.length - 1] + val.durations[val.visemes.length - 1];
      if (dTotal <= 0) continue;

      for (let j = 0; j < val.visemes.length; j++) {
        const t = startMs + (val.times[j] / dTotal) * durMs;
        const d = (val.durations[j] / dTotal) * durMs;
        events.push({ viseme: val.visemes[j], t, d });
      }
    }
    return events;
  }

  _precomputedVisemeEvents(visemes, vtimes, vdurations) {
    return visemes.map((v, i) => ({ viseme: v, t: vtimes[i], d: vdurations[i] }));
  }

  _eventsToFrames(events) {
    if (!events.length) return [];
    // Each viseme becomes 3 keyframes: ramp-in, peak, ramp-out
    const keyframes = new Map(); // t → Float32Array (additive)

    for (const { viseme, t, d } of events) {
      const vec = VISEME_VECTORS[viseme] || VISEME_VECTORS.sil;
      const tIn = t - Math.min(60, 2 * d / 3);
      const tPeak = t + Math.min(25, d / 2);
      const tOut = t + d + Math.min(60, d / 2);
      const peak = (viseme === 'PP' || viseme === 'FF') ? 0.9 : 0.7;

      this._addKeyframe(keyframes, tIn, vec, 0);
      this._addKeyframe(keyframes, tPeak, vec, peak);
      this._addKeyframe(keyframes, tOut, vec, 0);
    }

    const times = [...keyframes.keys()].sort((a, b) => a - b);
    return times.map(t => ({ t, vec: keyframes.get(t) }));
  }

  _addKeyframe(map, t, vec, scale) {
    let existing = map.get(t);
    if (!existing) { existing = new Float32Array(ARKIT_NAMES.length); map.set(t, existing); }
    for (let i = 0; i < vec.length; i++) existing[i] = clamp(existing[i] + vec[i] * scale);
  }
}

export default LipsyncCore;
