import { LipsyncSDKNode, estimateWordTimings } from './lipsync-sdk-node.mjs';

// Floosie operator: text+durationMs → stream of blendshape frame JSON chunks.
// Each output chunk: { type: 'json', data: { t: ms, blendshapes: [{name,value}] } }
// Compatible with floosie's json() chunk factory shape.
//
// Usage with floosie pipe():
//   import { source, pipe } from 'floosie'
//   import { lipsyncOperator } from '../a2f/lipsync-floosie.mjs'
//   const frames = pipe(source([{ type:'json', data:{ text, durationMs } }]), lipsyncOperator())
//
// For raw use without floosie (async generator):
//   for await (const frame of lipsyncStream(text, durationMs)) { ... }

const _sdk = new LipsyncSDKNode({ langs: ['en', 'fi', 'de', 'fr'] });

// Standalone async generator — no floosie dependency required.
// Yields blendshape frames at the given fps as { t, blendshapes }.
export async function* lipsyncStream(text, durationMs, { lang = 'en', fps = 30 } = {}) {
  const sdk = _sdk;
  sdk.resetSmoothing();
  const speechData = estimateWordTimings(text, durationMs);
  const track = sdk.wordsToFrames({ ...speechData, lang });
  const numFrames = Math.ceil((durationMs / 1000) * fps);
  for (let i = 0; i < numFrames; i++) {
    const t = (i / fps) * 1000;
    const vec = sdk.sampleTrack(track, t);
    sdk.applySmoothing(vec);
    yield { t, blendshapes: sdk.vecToBlendshapes(vec) };
  }
}

// Floosie StreamNode factory.
// Input chunks: json chunks with { text: string, durationMs: number, lang?: string, fps?: number }
// Output chunks: json chunks with { t: number, blendshapes: [{name,value}][] }
export function lipsyncOperator(defaultOpts = {}) {
  return {
    name: 'lipsync',
    transform: (flow) => flow.flatMap(async function*(chunk) {
      if (chunk.type !== 'json') throw new Error(`lipsyncOperator expects json chunks, got: ${chunk.type}`);
      const { text, durationMs, lang, fps } = chunk.data;
      if (!text || !durationMs) throw new Error('lipsyncOperator: chunk.data must have { text, durationMs }');
      const opts = { lang: lang ?? defaultOpts.lang ?? 'en', fps: fps ?? defaultOpts.fps ?? 30 };
      for await (const frame of lipsyncStream(text, durationMs, opts)) {
        yield { type: 'json', data: frame };
      }
    }),
    pipe(next) { return { name: `${this.name}→${next.name}`, transform: (f) => next.transform(this.transform(f)), pipe: next.pipe.bind(next), run: (s) => next.run(this.run(s)) }; },
    run(source) { return this.transform({ flatMap: (fn) => ({ [Symbol.asyncIterator]: async function*() { for await (const c of source) yield* fn(c); } }) }); },
  };
}

export { LipsyncSDKNode, estimateWordTimings };
