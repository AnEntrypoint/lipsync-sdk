# Agent Runbook — lipsync-sdk (a2f)

## Overview

**lipsync-sdk** is a fast text-driven lipsync codec that generates ARKit blendshapes from word timestamps, without ML inference. The project exports both Node.js and browser APIs.

- **Repo**: C:/dev/a2f
- **Version**: 1.0.0
- **Type**: ESM module
- **Main files**: lipsync-core.mjs, lipsync-sdk-node.mjs, lipsync-sdk-browser.js

## Key Architecture

- **lipsync-core.mjs** — core processing logic
- **lipsync-sdk-node.mjs** — Node.js bindings
- **lipsync-sdk-browser.js** — browser bindings
- **modules/** — supporting modules

## Floosie Integration Context

When working with [floosie](C:/dev/floosie) (universal stream processing platform, TypeScript/ESM v0.6.3):

### Key Chunk Types

Floosie's chunk factories (src/chunk-factories.ts) define:

- **audio(data: Uint8Array, meta?)** → AudioChunk — raw audio bytes with optional metadata
- **frame(data: FrameData, meta?)** → FrameChunk — where FrameData = { width, height, format, data: Uint8Array }
- **tensor(data: TensorData, meta?)** → TensorChunk — for numeric array data

### Use Case

Build a floosie operator that:
1. Accepts text + audio stream
2. Emits blendshape frame chunks (via lipsync-sdk processing)

Operator model: src/pipeline.ts, src/operators.ts in floosie. Compiled output in dist/.

### Integration Pattern

- Import chunk factories from floosie/src/chunk-factories.ts
- Use lipsync-sdk to process text+audio → blendshape data
- Emit frame chunks with FrameData containing blendshape vertices/indices
