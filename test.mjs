import { LipsyncSDKNode } from './lipsync-sdk-node.mjs';
import assert from 'assert';

const sdk = new LipsyncSDKNode({ langs: ['en', 'fi', 'de', 'fr'] });

// ── blendshape names ───────────────────────────────────────────────────────
{
  const names = LipsyncSDKNode.BLENDSHAPE_NAMES;
  assert.strictEqual(names.length, 52, 'should have 52 ARKit blendshapes');
  assert(names.includes('jawOpen'), 'should include jawOpen');
  assert(names.includes('mouthSmileLeft'), 'should include mouthSmileLeft');
}

// ── wordsToFrames en ──────────────────────────────────────────────────────
{
  const track = sdk.wordsToFrames({
    words: ['hello', 'world'],
    wtimes: [0, 400],
    wdurations: [350, 350],
    lang: 'en',
  });
  assert(track.length > 0, 'track should have frames');
  for (const f of track) {
    assert(typeof f.t === 'number', 'frame t should be number');
    assert(f.vec instanceof Float32Array, 'frame vec should be Float32Array');
    assert.strictEqual(f.vec.length, 52, 'frame vec length should be 52');
    for (const v of f.vec) assert(v >= 0 && v <= 1, `blendshape value ${v} out of [0,1]`);
  }
}

// ── process en produces blendshapes ───────────────────────────────────────
{
  const frames = sdk.process({
    words: ['testing', 'one', 'two', 'three'],
    wtimes: [0, 400, 700, 1000],
    wdurations: [350, 250, 250, 350],
  }, { lang: 'en' });
  assert(frames.length > 0, 'frames should be non-empty');
  const frame = frames[0];
  assert(Array.isArray(frame.blendshapes), 'blendshapes should be array');
  assert.strictEqual(frame.blendshapes.length, 52);
  for (const bs of frame.blendshapes) {
    assert(typeof bs.name === 'string', 'blendshape name should be string');
    assert(typeof bs.value === 'number', 'blendshape value should be number');
    assert(bs.value >= 0 && bs.value <= 1, `${bs.name} value ${bs.value} out of range`);
  }
}

// ── process fi ────────────────────────────────────────────────────────────
{
  const frames = sdk.process({
    words: ['hei', 'maailma'],
    wtimes: [0, 300],
    wdurations: [250, 400],
  }, { lang: 'fi' });
  assert(frames.length > 0, 'fi track should produce frames');
}

// ── pre-computed visemes passthrough ─────────────────────────────────────
{
  const track = sdk.wordsToFrames({
    words: [],
    wtimes: [],
    wdurations: [],
    visemes: ['aa', 'PP', 'sil', 'E'],
    vtimes: [0, 200, 400, 600],
    vdurations: [150, 100, 100, 150],
    lang: 'en',
  });
  assert(track.length > 0, 'pre-computed viseme track should produce frames');
}

// ── sampleTrack interpolation ──────────────────────────────────────────────
{
  const track = sdk.wordsToFrames({
    words: ['hello'],
    wtimes: [0],
    wdurations: [500],
    lang: 'en',
  });
  const end = track[track.length - 1].t;
  const mid = end / 2;
  const vec = sdk.sampleTrack(track, mid);
  assert(vec instanceof Float32Array);
  assert.strictEqual(vec.length, 52);
}

// ── smoothing resets between calls ────────────────────────────────────────
{
  sdk.resetSmoothing();
  const vec = new Float32Array(52);
  vec[24] = 1.0; // jawOpen = 1
  sdk.applySmoothing(vec);
  sdk.resetSmoothing();
  const vec2 = new Float32Array(52);
  sdk.applySmoothing(vec2);
  assert.strictEqual(vec2[24], 0, 'after reset, smoothing should not bleed');
}

// ── unknown lang throws ───────────────────────────────────────────────────
{
  assert.throws(
    () => sdk.wordsToFrames({ words: ['test'], wtimes: [0], wdurations: [300], lang: 'xx' }),
    /No lipsync module/
  );
}

// ── empty input returns empty track ──────────────────────────────────────
{
  const track = sdk.wordsToFrames({ words: [], wtimes: [], wdurations: [], lang: 'en' });
  assert.strictEqual(track.length, 0);
}

console.log('All tests passed.');
