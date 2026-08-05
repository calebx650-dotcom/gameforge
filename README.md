# GameForge

GameForge is a local-first AI game-development workstation. It is not a chatbot —
it's an orchestration layer that sits on top of game engines and dev tools, lets
you drive development with natural language, and stays independent of any single
AI vendor.

This repository is at the end of **Phase 1**: the foundation (project management,
provider-agnostic LLM layer, a permission-gated tool system, an agent loop, and a
desktop UI) is built and tested. Unity integration and the visual feedback loop
come in later phases — see [ROADMAP.md](ROADMAP.md).

## What works right now

1. Open a project folder; GameForge scans it (engine, language, git status, docs).
2. Pick an LLM provider (Ollama, OpenAI, OpenRouter, Anthropic, or any
   OpenAI-compatible endpoint) and a model.
3. Pick an agent mode (`ask` / `assist` / `build` / `autonomous`).
4. Type a natural-language instruction.
5. The agent reads project files, edits them, and runs shell commands — each
   step gated by the permission system for the current mode — and reports back.
6. Everything is visible in the Tool Activity panel as it happens.

## Repository layout

```
/apps
  /server    Node/Express + WebSocket backend: hosts the agent, tools, memory,
             and project scanner; talks REST + WS to the desktop UI.
  /desktop   React + Vite UI, wrapped in a Tauri shell.
/packages
  /shared    Cross-cutting types (ChatMessage, ToolCall, AgentMode, ...).
  /llm       LLMProvider interface + Ollama/OpenAI-compatible/Anthropic providers.
  /tools     Read/write/execution tools, workspace sandbox, permission policy.
  /project   Project scanner + compact context summarizer.
  /memory    SQLite-backed project memory (node:sqlite, no native build step).
  /agent     The think -> act -> observe loop tying providers + tools together.
/docs        Architecture, security, provider, and Unity bridge documentation.
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it's shaped this way.

## Setup

Requirements: Node.js 22+ (for the built-in `node:sqlite` module), npm.

```bash
npm install
npm run build      # builds all packages
npm test           # runs the full test suite (36 tests as of Phase 1)
```

## Running it

Start the backend:

```bash
npm run dev:server   # http://localhost:4310, ws://localhost:4310/ws/chat
```

Start the UI (separate terminal):

```bash
npm run dev:desktop  # http://localhost:4311
```

Open `http://localhost:4311` in a browser, enter a project path, open it, pick a
provider/model, pick a mode, and send a prompt.

To use the Tauri desktop shell instead of a browser tab, see
[DEVELOPMENT.md](DEVELOPMENT.md) — it requires the Tauri CLI and platform
webview dependencies that are **not** part of this sandbox's toolchain, so the
shell is scaffolded but has only been exercised via the browser-facing dev
server here.

## Connecting a real LLM

- **Ollama**: install and run Ollama locally (`ollama serve`), pick "ollama" as
  the provider with base URL `http://127.0.0.1:11434`. See [PROVIDERS.md](PROVIDERS.md).
- **OpenAI / OpenRouter / Anthropic**: pick the provider and paste an API key.
  Keys are only ever used for outbound requests to that vendor — see
  [SECURITY.md](SECURITY.md) for how they're handled.

## Known limitations (Phase 1)

- No Unity bridge yet (Phase 7+).
- No screenshot/vision feedback loop yet (Phase 10).
- API keys are typed into the UI per-session; OS keychain-backed storage is not
  yet wired up (see SECURITY.md).
- The Tauri shell is scaffolded but not build-verified in this environment
  (missing system webview dependencies) — verified instead via the Vite dev
  server in a headless browser.
- Streaming responses are implemented in the provider layer but the current UI
  uses the non-streaming `generate()` path; wiring `stream()` into the chat UI
  is a good next increment.
