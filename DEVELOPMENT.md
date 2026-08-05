# Development

## Requirements

- Node.js 22+ (uses the built-in `node:sqlite` module — no native compiler
  toolchain needed for the memory package).
- npm (workspaces are used for the monorepo).
- Optional, for the native desktop shell: [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  (Rust toolchain + platform webview libraries — `webkit2gtk` on Linux,
  WebView2 on Windows, none extra on macOS) and the Tauri CLI
  (`npm install -g @tauri-apps/cli` or use the `tauri` script in
  `apps/desktop/package.json`).
- Optional, to actually talk to a local model: [Ollama](https://ollama.com).
- Optional, for `packages/vision`'s video frame extraction: `ffmpeg` on PATH.
  Its absence is handled gracefully (a clear `FfmpegNotAvailableError`, not a
  crash) — this repository's own test/dev environment doesn't have ffmpeg
  installed, which is exactly the path those tests exercise.
- Optional, for local-first generation instead of a cloud vendor: the
  `blender` binary on PATH (auto-rigging), and/or a locally-running
  inference server for whichever local model you want (TripoSR, TRELLIS,
  MotionGPT, Kokoro, Coqui XTTS-v2, AudioCraft) — see PROVIDERS.md's
  "Running local-first" section. None of these are required to build, test,
  or run GameForge itself; they're only needed to actually invoke the
  corresponding generation tool with a local provider selected.

## Install

```bash
npm install
```

This installs and links every workspace (`packages/*`, `apps/*`) via npm
workspaces — no separate per-package install step.

## Build

```bash
npm run build          # builds every package (tsc project references)
npx tsc -b packages/X   # build just one package while iterating
```

## Test

```bash
npm test               # vitest, runs every package + app test suite
npx vitest run packages/tools   # scope to one package
npx vitest watch                # watch mode while iterating
```

Latest count: 233 tests across 48 files, all passing, including several
automated end-to-end tests in `apps/server/src/e2e.test.ts`: the original
smoke test driving "open project -> list models -> chat -> read file -> edit
file -> run command -> report" against a fake Ollama server; a checkpoint
test verifying `maybeCreateCheckpoint()` runs before a build-mode request;
and a Phase 7-10 capstone test that drives `capture_screenshot` through a
real `EngineBridge` (a fake `unity-mcp` HTTP server speaking real JSON-RPC)
and confirms the captured image is spliced into the next model turn — all
with no external services required. The generation-vendor packages
(`assets3d`, `rigging`, `audio`) are tested the same way — mocked `fetch`,
no live vendor calls. `packages/engine-bridge` is tested against real local
fake servers instead: a real `ws` `WebSocketServer` standing in for the
Godot bridge plugin, and a real JSON-RPC-over-HTTP responder standing in for
`unity-mcp`, so the actual wire protocol is exercised, not a mocked
`fetch`/`WebSocket` call. The CLI-based local adapters
(`BlenderAutoRigProvider`, `packages/vision`'s ffmpeg extraction) are tested
against this environment's real (lack of) installation instead of mocking
`child_process`, so the graceful-degradation path is genuinely exercised,
not just asserted.

## Running the app locally

Two long-running processes, in separate terminals:

```bash
npm run dev:server    # apps/server, http://localhost:4310
npm run dev:desktop   # apps/desktop, http://localhost:4311 (Vite dev server)
```

Then open `http://localhost:4311` in any browser. This is the fastest local
loop and is also how this feature was verified in a sandboxed CI-like
environment without a display or the Tauri toolchain installed.

To run inside the actual Tauri window (requires the prerequisites above):

```bash
cd apps/desktop
npm run tauri dev
```

`apps/desktop/src-tauri/tauri.conf.json` points `devUrl` at
`http://localhost:4311`, so Tauri will start the Vite dev server for you via
`beforeDevCommand`.

## Connecting Ollama

```bash
ollama serve                 # if not already running as a service
ollama pull llama3.1:8b      # or any tool-calling-capable model
```

In the GameForge UI: provider = `ollama`, base URL = `http://127.0.0.1:11434`
(the default), click "Refresh Models", pick one. No API key needed.

Not every local model supports tool calling well — if the agent's tool calls
come back malformed, try a model explicitly documented as supporting Ollama's
`tools` field (e.g. Llama 3.1+, Qwen 2.5+, Mistral Nemo).

## Connecting an engine bridge (Unity or Godot)

In the GameForge UI's "Engine Bridge" panel, pick `unity` or `godot` and
optionally override the default URL (`http://127.0.0.1:6400` for Unity,
`ws://127.0.0.1:6401` for Godot). For Unity, this expects a running
[CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) server started
by the Unity Editor package; for Godot, a bridge plugin speaking GameForge's
WebSocket command protocol (see [UNITY_BRIDGE.md](UNITY_BRIDGE.md) for the
`EngineBridge` design and [ARCHITECTURE.md](ARCHITECTURE.md) for the
implementation). Neither has been exercised against a real Editor in this
environment — `packages/engine-bridge`'s tests run against fake local
servers instead, so the wire protocol is verified even without an Editor
installed here.

## Running a local generation model instead of a cloud vendor

See [PROVIDERS.md](PROVIDERS.md)'s "Running local-first" section for what
each local adapter (TripoSR, TRELLIS, Blender, MotionGPT, Kokoro, XTTS-v2,
AudioCraft) expects — in short, a small HTTP wrapper around the upstream
repo's inference call, except Blender (just needs the `blender` binary) and
Kokoro (the community Kokoro-FastAPI wrapper already speaks the right
shape). Point the corresponding tool's `baseUrl` setting at wherever that
server is listening.

## Adding a new LLM, generation-vendor, or engine-bridge provider

See [PROVIDERS.md](PROVIDERS.md) — LLM providers, generation-vendor
providers (3D, rigging, motion, voice, music), and engine bridges (Unity,
Godot, or a future engine) all follow the same interface + adapter +
registry pattern.

## Project structure conventions

- Every package builds independently via TypeScript project references
  (`tsconfig.json` + `references`) — `npm run build` builds them in dependency
  order.
- Packages export a single `src/index.ts` barrel; nothing outside a package
  imports from its internal files directly.
- Tests live next to the code they test (`*.test.ts`), not in a separate
  `__tests__` tree.

## Known limitations

See the "Known limitations" section of [README.md](README.md).
