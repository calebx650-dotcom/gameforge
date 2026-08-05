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

As of Phase 1: 36 tests across 10 files, all passing, including an automated
end-to-end smoke test (`apps/server/src/e2e.test.ts`) that drives the full
"open project -> list models -> chat -> read file -> edit file -> run
command -> report" loop against a fake Ollama server, with no external
services required.

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

## Connecting Unity

Not implemented yet — see [UNITY_BRIDGE.md](UNITY_BRIDGE.md) for the planned
design and [ROADMAP.md](ROADMAP.md) for when it lands (Phase 7+).

## Adding a new LLM provider

See [PROVIDERS.md](PROVIDERS.md).

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
