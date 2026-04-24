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
- **modules/lipsync-{en,fi,de,fr,lt}.mjs** — language-specific word→viseme converters

## Upstream lineage

The word→viseme conversion modules and the per-viseme animation envelope
are taken verbatim from **met4citizen/TalkingHead** (MIT License, Mika Suominen).

- `modules/lipsync-{en,fi,de,fr,lt}.mjs` — byte-identical to upstream
- `lipsync-core.mjs _eventsToFrames` envelope timing — verbatim talkinghead.mjs
  (ramp-in at t − 2d/3, peak at t + d/2, ramp-out at t + d + d/2;
  peak 0.9 for PP/FF, 0.6 otherwise)

Unique to this SDK:

- **Oculus viseme → 52-channel ARKit blendshape mapping** (talkinghead emits
  Oculus visemes directly as `viseme_*` morph targets that the avatar GLB must
  define; this SDK maps them to ARKit blendshapes so ARKit-only avatars work)
- **AFAN binary frame format** for streaming to downstream tools
- `trackToFrames` / `estimateWordTimings` helpers for fixed-fps frame arrays

See `NOTICE` for full attribution and license terms.

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

## Diagen Integration Constraint

**lipsync-sdk-node.mjs** is used by the [diagen](C:/dev/diagen) project. During ONNX→talkinghead lipsync migration in diagen, the file `audio2afan_core.mjs` must be refactored to call `LipsyncSDKNode.processText()` instead of ONNX internals — **do NOT delete audio2afan_core.mjs**.

### AFAN Binary Format (Load-bearing)

Diagen requires this binary streaming format for downstream frame processing:

```
Magic:       0x4146414E (4 bytes) = "AFAN"
Version:     2 (1 byte uint8)
FPS:         (1 byte uint8)
NumBS:       52 (1 byte uint8)
NumFrames:   (4 bytes uint32 LE)
Frames:      numFrames × 52 bytes (uint8 blendshape values per frame)
```

Refactor pattern: wrap LipsyncSDKNode output with buildAfan() serializer, preserve class API surface.

## Tooling Caveat: rs-exec Port Leak

**When "Runner startup timed out" recurs despite `exec:runner status` reporting online:**

Root cause: Windows socket leak after ungraceful runner termination (Stop hook kill, OS shutdown, ctrl-C). rs-exec hardcoded PREFERRED_PORT 32882; if the port's listening socket orphans (dead PID), the runner cannot rebind. The runner falls back to a random port, but port_file overwrite is non-atomic and rpc_client caches a stale reading, causing health_check to hit the zombie listener indefinitely.

**Diagnostic** (PowerShell):
```powershell
Get-NetTCPConnection -LocalPort 32882 -State Listen | Select-Object OwningProcess
Get-Process -Id <pid>  # if "Process not found" → orphaned socket
```

**Recovery**: Delete `$env:LOCALAPPDATA\Temp\glootie-runner.port`, stop/start runner. If socket persists, manual cleanup or port range reset may be needed.

**Status**: Fixed in rs-exec @ f6a74a2 (bind to 127.0.0.1:0, atomic port_file). Related fix in rs-search @ d05d7bc (simd feature gate for MinGW).
