import { LipsyncCore } from './lipsync-core.mjs';
import { LipsyncEn } from './modules/lipsync-en.mjs';
import { LipsyncFi } from './modules/lipsync-fi.mjs';
import { LipsyncDe } from './modules/lipsync-de.mjs';
import { LipsyncFr } from './modules/lipsync-fr.mjs';

const LANG_CTORS = { en: LipsyncEn, fi: LipsyncFi, de: LipsyncDe, fr: LipsyncFr };

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
