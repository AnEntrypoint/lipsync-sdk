import { LipsyncCore } from './lipsync-core.mjs';
import { LipsyncEn } from './modules/lipsync-en.mjs';
import { LipsyncFi } from './modules/lipsync-fi.mjs';
import { LipsyncDe } from './modules/lipsync-de.mjs';
import { LipsyncFr } from './modules/lipsync-fr.mjs';

const LANG_CTORS = { en: LipsyncEn, fi: LipsyncFi, de: LipsyncDe, fr: LipsyncFr };

export class LipsyncSDK extends LipsyncCore {
  constructor({ langs = ['en'], smoothing = 0.35 } = {}) {
    super({ smoothing });
    for (const lang of langs) {
      const Ctor = LANG_CTORS[lang];
      if (!Ctor) throw new Error(`Unknown lang "${lang}". Available: ${Object.keys(LANG_CTORS).join(', ')}`);
      this.registerLanguage(lang, new Ctor());
    }
    this._audioCtx = null;
    this._currentSource = null;
  }

  static get BLENDSHAPE_NAMES() { return LipsyncCore.BLENDSHAPE_NAMES; }
  static get VISEME_NAMES() { return LipsyncCore.VISEME_NAMES; }
  static get SUPPORTED_LANGS() { return Object.keys(LANG_CTORS); }

  // Speak audio + produce synchronized blendshape callbacks.
  // audioBuffer: ArrayBuffer of any browser-decodable audio format
  // speechData: { words, wtimes, wdurations } — word timestamps in ms
  // onFrame(blendshapes, timeMs): called at ~60fps during playback
  // onEnd(): called when audio finishes
  async speakAudio(audioBuffer, speechData, { lang = 'en', onFrame = null, onEnd = null } = {}) {
    this.stop();
    this._ensureAudioCtx();
    this.resetSmoothing();

    const track = this.wordsToFrames({ ...speechData, lang });
    const decoded = await this._audioCtx.decodeAudioData(audioBuffer.slice(0));

    const source = this._audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(this._audioCtx.destination);
    this._currentSource = source;

    const startTime = this._audioCtx.currentTime;
    let rafId = null;

    const tick = () => {
      const elapsed = (this._audioCtx.currentTime - startTime) * 1000;
      if (onFrame && track.length) {
        const vec = this.sampleTrack(track, elapsed);
        this.applySmoothing(vec);
        onFrame(this.vecToBlendshapes(vec), elapsed);
      }
      rafId = requestAnimationFrame(tick);
    };

    source.onended = () => {
      cancelAnimationFrame(rafId);
      this._currentSource = null;
      onEnd?.();
    };

    source.start(0);
    if (onFrame) rafId = requestAnimationFrame(tick);
    return source;
  }

  // Process audio + speech data offline — returns full blendshape track without playback.
  // Useful for pre-baking or server-side use.
  processOffline(speechData, { lang = 'en' } = {}) {
    this.resetSmoothing();
    return this.wordsToFrames({ ...speechData, lang });
  }

  stop() {
    try { this._currentSource?.stop(); } catch (_) {}
    this._currentSource = null;
  }

  dispose() {
    this.stop();
    try { this._audioCtx?.close(); } catch (_) {}
    this._audioCtx = null;
  }

  _ensureAudioCtx() {
    if (!this._audioCtx || this._audioCtx.state === 'closed') {
      this._audioCtx = new AudioContext();
    } else if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
  }
}

export default LipsyncSDK;
