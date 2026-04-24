import { LipsyncCore } from './lipsync-core.mjs';
import { LipsyncEn } from './modules/lipsync-en.mjs';
import { LipsyncFi } from './modules/lipsync-fi.mjs';
import { LipsyncDe } from './modules/lipsync-de.mjs';
import { LipsyncFr } from './modules/lipsync-fr.mjs';
import { LipsyncLt } from './modules/lipsync-lt.mjs';

const LANG_CTORS = { en: LipsyncEn, fi: LipsyncFi, de: LipsyncDe, fr: LipsyncFr, lt: LipsyncLt };

// Estimate word timings from text + total audio duration when no TTS timestamps available.
// Distributes duration proportionally by syllable count (vowel runs), not raw chars.
// Returns: { words, wtimes, wdurations } all in ms.
export function estimateWordTimings(text, durationMs) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { words: [], wtimes: [], wdurations: [] };
  const syllables = words.map(w => Math.max(1, (w.match(/[aeiouAEIOU]+/g) || []).length));
  const total = syllables.reduce((a, b) => a + b, 0);
  const wtimes = [], wdurations = [];
  let t = 0;
  for (let i = 0; i < words.length; i++) {
    const dur = (syllables[i] / total) * durationMs;
    wtimes.push(t);
    wdurations.push(dur);
    t += dur;
  }
  return { words, wtimes, wdurations };
}

// Build a fixed-fps blendshape frame array (Float32Array per frame) from a track.
// Compatible with diagen's buildAfan() which expects Float32Array[52] per frame.
export function trackToFrames(sdk, track, durationMs, fps = 30) {
  const numFrames = Math.ceil((durationMs / 1000) * fps);
  const frames = [];
  for (let i = 0; i < numFrames; i++) {
    const t = (i / fps) * 1000;
    const vec = sdk.sampleTrack(track, t);
    sdk.applySmoothing(vec);
    frames.push(vec);
  }
  return frames;
}

export class LipsyncSDKNode extends LipsyncCore {
  constructor({ langs = ['en'], smoothing = 0.35 } = {}) {
    super({ smoothing });
    for (const lang of langs) {
      const Ctor = LANG_CTORS[lang];
      if (!Ctor) throw new Error(`Unknown lang "${lang}". Available: ${Object.keys(LANG_CTORS).join(', ')}`);
      this.registerLanguage(lang, new Ctor());
    }
  }

  static get BLENDSHAPE_NAMES() { return LipsyncCore.BLENDSHAPE_NAMES; }
  static get VISEME_NAMES() { return LipsyncCore.VISEME_NAMES; }
  static get SUPPORTED_LANGS() { return Object.keys(LANG_CTORS); }

  // Process speech data → full blendshape track (offline, no audio playback).
  // speechData: { words, wtimes, wdurations } — wtimes/wdurations in ms
  // Returns: Array<{ t: ms, blendshapes: [{name, value}] }>
  process(speechData, { lang = 'en' } = {}) {
    this.resetSmoothing();
    const track = this.wordsToFrames({ ...speechData, lang });
    return track.map(({ t, vec }) => {
      this.applySmoothing(vec);
      return { t, blendshapes: this.vecToBlendshapes(vec) };
    });
  }

  // Process text + audio duration → fixed-fps Float32Array frames (no timestamps needed).
  // Useful when TTS returns audio without word timestamps.
  processText(text, durationMs, { lang = 'en', fps = 30 } = {}) {
    this.resetSmoothing();
    const speechData = estimateWordTimings(text, durationMs);
    const track = this.wordsToFrames({ ...speechData, lang });
    return trackToFrames(this, track, durationMs, fps);
  }

  // Sample track at specific timestamps (ms array).
  // Returns: Array<{ t: ms, blendshapes: [{name, value}] }>
  sampleAt(track, timesMs) {
    this.resetSmoothing();
    return timesMs.map(t => {
      const vec = this.sampleTrack(track, t);
      this.applySmoothing(vec);
      return { t, blendshapes: this.vecToBlendshapes(vec) };
    });
  }
}

export default LipsyncSDKNode;
