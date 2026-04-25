import { LipsyncSDKNode, estimateWordTimings, trackToFrames } from './lipsync-sdk-node.mjs';
import { lipsyncStream } from './lipsync-floosie.mjs';
import { buildAfan, parseAfan, afanChunks, AFAN_MAGIC, AFAN_HEADER_BYTES, AFAN_NUM_BS } from './lipsync-afan.mjs';
import { FacialAnimationPlayer, AnimationReader, mapVisemes, mapEyes, mapEmotionsV1, vecToNamed, ARKIT_NAMES as VRM_NAMES } from './lipsync-vrm.mjs';
import assert from 'assert';

const sdk = new LipsyncSDKNode({ langs: ['en', 'fi', 'de', 'fr'] });

// ── blendshape names ───────────────────────────────────────────────────────
{
  const names = LipsyncSDKNode.BLENDSHAPE_NAMES;
  assert.strictEqual(names.length, 52);
  assert(names.includes('jawOpen'));
  assert(names.includes('mouthSmileLeft'));
}

// ── wordsToFrames en ──────────────────────────────────────────────────────
{
  const track = sdk.wordsToFrames({ words: ['hello', 'world'], wtimes: [0, 400], wdurations: [350, 350], lang: 'en' });
  assert(track.length > 0);
  for (const f of track) {
    assert(typeof f.t === 'number');
    assert(f.vec instanceof Float32Array);
    assert.strictEqual(f.vec.length, 52);
    for (const v of f.vec) assert(v >= 0 && v <= 1, `value ${v} out of [0,1]`);
  }
}

// ── process en produces blendshapes ───────────────────────────────────────
{
  const frames = sdk.process({ words: ['testing', 'one', 'two', 'three'], wtimes: [0, 400, 700, 1000], wdurations: [350, 250, 250, 350] }, { lang: 'en' });
  assert(frames.length > 0);
  const { blendshapes } = frames[0];
  assert.strictEqual(blendshapes.length, 52);
  for (const bs of blendshapes) {
    assert(typeof bs.name === 'string');
    assert(bs.value >= 0 && bs.value <= 1, `${bs.name}=${bs.value} out of range`);
  }
}

// ── process fi ────────────────────────────────────────────────────────────
{
  const frames = sdk.process({ words: ['hei', 'maailma'], wtimes: [0, 300], wdurations: [250, 400] }, { lang: 'fi' });
  assert(frames.length > 0);
}

// ── pre-computed visemes passthrough ─────────────────────────────────────
{
  const track = sdk.wordsToFrames({ words: [], wtimes: [], wdurations: [], visemes: ['aa', 'PP', 'sil', 'E'], vtimes: [0, 200, 400, 600], vdurations: [150, 100, 100, 150] });
  assert(track.length > 0);
}

// ── sampleTrack interpolation ─────────────────────────────────────────────
{
  const track = sdk.wordsToFrames({ words: ['hello'], wtimes: [0], wdurations: [500], lang: 'en' });
  const vec = sdk.sampleTrack(track, track[track.length - 1].t / 2);
  assert(vec instanceof Float32Array);
  assert.strictEqual(vec.length, 52);
}

// ── smoothing resets ──────────────────────────────────────────────────────
{
  sdk.resetSmoothing();
  const vec = new Float32Array(52); vec[24] = 1.0;
  sdk.applySmoothing(vec);
  sdk.resetSmoothing();
  const vec2 = new Float32Array(52);
  sdk.applySmoothing(vec2);
  assert.strictEqual(vec2[24], 0);
}

// ── unknown lang throws ───────────────────────────────────────────────────
{
  assert.throws(() => sdk.wordsToFrames({ words: ['test'], wtimes: [0], wdurations: [300], lang: 'xx' }), /No lipsync module/);
}

// ── empty input ───────────────────────────────────────────────────────────
{
  assert.strictEqual(sdk.wordsToFrames({ words: [], wtimes: [], wdurations: [], lang: 'en' }).length, 0);
}

// ── estimateWordTimings ───────────────────────────────────────────────────
{
  const { words, wtimes, wdurations } = estimateWordTimings('hello beautiful world', 3000);
  assert.strictEqual(words.length, 3);
  assert.strictEqual(wtimes.length, 3);
  assert.strictEqual(wdurations.length, 3);
  assert.strictEqual(wtimes[0], 0);
  assert(wtimes[1] > 0 && wtimes[1] < 3000);
  const totalDur = wdurations.reduce((a, b) => a + b, 0);
  assert(Math.abs(totalDur - 3000) < 1, `total duration ${totalDur} should be ~3000`);
}

// ── processText produces Float32Array frames ──────────────────────────────
{
  const frames = sdk.processText('hello world test', 2000, { fps: 30 });
  assert(Array.isArray(frames));
  assert.strictEqual(frames.length, 60); // 2s @ 30fps
  for (const f of frames) {
    assert(f instanceof Float32Array);
    assert.strictEqual(f.length, 52);
  }
}

// ── trackToFrames helper ──────────────────────────────────────────────────
{
  sdk.resetSmoothing();
  const { words, wtimes, wdurations } = estimateWordTimings('test sentence here', 1500);
  const track = sdk.wordsToFrames({ words, wtimes, wdurations, lang: 'en' });
  const frames = trackToFrames(sdk, track, 1500, 30);
  assert.strictEqual(frames.length, 45); // 1.5s @ 30fps
  assert(frames[0] instanceof Float32Array);
}

// ── lipsyncStream async generator ────────────────────────────────────────
{
  const frames = [];
  for await (const f of lipsyncStream('hello world', 1000, { fps: 30 })) {
    frames.push(f);
  }
  assert.strictEqual(frames.length, 30); // 1s @ 30fps
  assert(typeof frames[0].t === 'number');
  assert(Array.isArray(frames[0].blendshapes));
  assert.strictEqual(frames[0].blendshapes.length, 52);
}

// ── AFAN binary roundtrip ────────────────────────────────────────────────
{
  const frames = sdk.processText('hello binary world', 1000, { fps: 30 });
  assert.strictEqual(frames.length, 30);
  const buf = buildAfan(frames, 30);
  assert(buf instanceof Uint8Array);
  assert.strictEqual(buf.byteLength, AFAN_HEADER_BYTES + 30 * AFAN_NUM_BS);
  const dv = new DataView(buf.buffer);
  assert.strictEqual(dv.getUint32(0, true), AFAN_MAGIC);
  assert.strictEqual(buf[4], 2);   // version
  assert.strictEqual(buf[5], 30);  // fps
  assert.strictEqual(buf[6], 52);  // numBS
  assert.strictEqual(dv.getUint32(8, true), 30);

  const { fps, numFrames, frames: out } = parseAfan(buf);
  assert.strictEqual(fps, 30);
  assert.strictEqual(numFrames, 30);
  assert.strictEqual(out.length, 30);
  for (let f = 0; f < 30; f++) {
    for (let i = 0; i < 52; i++) {
      assert(Math.abs(frames[f][i] - out[f][i]) < 0.01, `frame ${f} bs ${i}: ${frames[f][i]} vs ${out[f][i]}`);
    }
  }
}

// ── AFAN streaming chunks ────────────────────────────────────────────────
{
  async function* gen() {
    for await (const f of lipsyncStream('streaming chunks test', 2000, { fps: 30 })) {
      const v = new Float32Array(52);
      for (let i = 0; i < 52; i++) v[i] = f.blendshapes[i].value;
      yield v;
    }
  }
  const chunks = [];
  for await (const c of afanChunks(gen(), 30, 15)) chunks.push(c);
  assert(chunks.length >= 4); // 60 frames / 15 per chunk
  let total = 0;
  for (const c of chunks) {
    const { numFrames } = parseAfan(c);
    total += numFrames;
  }
  assert.strictEqual(total, 60);
}

// ── VRM driver: mock expressionManager, drive frame, verify writes ───────
{
  const writes = new Map();
  const exps = ['aa','ih','ou','ee','oh','blink','blinkLeft','blinkRight','lookUp','lookDown','lookLeft','lookRight','happy','sad','angry','relaxed','surprised'];
  const vrm = {
    meta: { specVersion: '1.0' },
    expressionManager: {
      expressions: exps.map(n => ({ expressionName: n })),
      setValue(n, v) { writes.set(n, v); },
      getValue(n) { return writes.get(n) || 0; },
    },
  };
  const player = new FacialAnimationPlayer(vrm);
  assert.strictEqual(player.vrmVersion, '1');
  // Build AFAN with jaw open + smile, decode + apply
  const v = new Float32Array(52);
  v[VRM_NAMES.indexOf('jawOpen')] = 0.8;
  v[VRM_NAMES.indexOf('mouthSmileLeft')] = 0.7;
  v[VRM_NAMES.indexOf('mouthSmileRight')] = 0.7;
  const afan = buildAfan([v, v, v], 30);
  player.loadAnimation(afan);
  assert.strictEqual(player.animation.fps, 30);
  assert.strictEqual(player.animation.numFrames, 3);
  player.applyFrame(player.animation.frames[0].blendshapes);
  assert(writes.get('aa') > 0.4, `aa expected open, got ${writes.get('aa')}`);
  assert(writes.get('happy') > 0.5, `happy expected, got ${writes.get('happy')}`);
}

// ── VRM driver: VRM0 detection by expression names ───────────────────────
{
  const v0Vrm = {
    expressionManager: {
      expressions: [{ expressionName: 'fun' }, { expressionName: 'sorrow' }, { expressionName: 'aa' }],
      setValue() {}, getValue() { return 0; },
    },
  };
  const player = new FacialAnimationPlayer(v0Vrm);
  assert.strictEqual(player.vrmVersion, '0');
}

// ── End-to-end: text → AFAN → VRM driver ────────────────────────────────
{
  const frames = sdk.processText('hello vrm world', 1500, { fps: 30 });
  const afan = buildAfan(frames, 30);
  const reader = AnimationReader.fromAfanV2(afan);
  assert.strictEqual(reader.numFrames, 45);
  assert.strictEqual(reader.fps, 30);
  // first frame named-key should have 52 entries
  assert.strictEqual(Object.keys(reader.frames[0].blendshapes).length, 52);
  assert(typeof reader.frames[0].blendshapes.jawOpen === 'number');
}

console.log('All tests passed.');
