# GameForge

GameForge is a local-first AI game-development workstation. It is not a chatbot —
it's an orchestration layer that sits on top of game engines and dev tools, lets
you drive development with natural language, and stays independent of any single
AI vendor.

This repository has the Phase 1 foundation (project management,
provider-agnostic LLM layer, a permission-gated tool system, an agent loop, and a
desktop UI) built and tested, plus several generative content pipelines
(3D assets, rigging/animation, procedural levels, boss combat AI, audio/voice,
video playtesting) pulled forward from later phases as provider-agnostic
packages. Unity integration itself is still ahead — see [ROADMAP.md](ROADMAP.md).

## What works right now

1. Open a project folder; GameForge scans it (engine, language, git status, docs).
2. Pick an LLM provider (Ollama, OpenAI, OpenRouter, Anthropic, or any
   OpenAI-compatible endpoint) and a model.
3. Pick an agent mode (`ask` / `assist` / `build` / `autonomous`).
4. Type a natural-language instruction.
5. The agent reads project files, edits them, and runs shell commands — each
   step gated by the permission system for the current mode — and reports back.
6. The agent can also generate a 3D model, a PBR texture set, an auto-rigged
   skeleton, a motion clip, or a voice line via a configured external vendor
   (Meshy, Tripo3D, DeepMotion, ElevenLabs) — these always require your
   explicit approval first, in every mode, because they cost real money.
7. The agent can generate a procedural level layout or a boss's combat
   behavior tree/combo graph entirely locally, for free, no vendor needed.
8. Everything is visible in the Tool Activity panel as it happens.

## Repository layout

```
/apps
  /server       Node/Express + WebSocket backend: hosts the agent, tools, memory,
                and project scanner; talks REST + WS to the desktop UI.
  /desktop      React + Vite UI, wrapped in a Tauri shell.
/packages
  /shared       Cross-cutting types (ChatMessage, ToolCall, AgentMode, GenerationJob, ...).
  /llm          LLMProvider interface + Ollama/OpenAI-compatible/Anthropic providers.
  /assets3d     Text-to-3D + PBR material generation (Meshy, Tripo3D adapters).
  /rigging      Auto-rigging + AI motion generation (DeepMotion adapter).
  /audio        AI voice synthesis (ElevenLabs) + soundscape/music-mix generation.
  /level-design Procedural level/navmesh/lighting generation (pure, no vendor).
  /combat-ai    Boss behavior-tree/combo-graph generation + hitbox framing (pure).
  /vision       Video frame extraction, pacing metrics, vision-analysis prompts, backtest.
  /tools        Read/write/execution/generation tools, workspace sandbox, permission policy.
  /project      Project scanner + compact context summarizer.
  /memory       SQLite-backed project memory (node:sqlite, no native build step).
  /agent        The think -> act -> observe loop tying providers + tools together.
/docs           Architecture, security, provider, and Unity bridge documentation.
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it's shaped this way.

## Setup

Requirements: Node.js 22+ (for the built-in `node:sqlite` module), npm.

```bash
npm install
npm run build      # builds all packages
npm test           # runs the full test suite (114 tests across 30 files, latest count)
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

## Connecting a generative content vendor

Optional — only needed for `generate_3d_model`, `generate_pbr_material`,
`auto_rig_model`, `generate_motion_clip`, or `generate_voice_line`.
Currently wired: Meshy and Tripo3D (3D/rigging/texture), DeepMotion (motion),
ElevenLabs (voice). See [ROADMAP.md](ROADMAP.md)'s "Generative content
pipelines" section and [PROVIDERS.md](PROVIDERS.md) for how to add another
vendor. Every one of these tools always requires your explicit approval
before running, in every agent mode, because it calls a paid external
service (see SECURITY.md).

## Known limitations

- No Unity bridge yet (Phase 7+) — see [UNITY_BRIDGE.md](UNITY_BRIDGE.md).
- `packages/vision`'s video-analysis pipeline is a tested library, not yet
  wired into the agent as a tool — it needs a real capture source, which
  depends on the Unity bridge existing first.
- API keys (LLM and generation vendors alike) are typed into the UI
  per-session; OS keychain-backed storage is not yet wired up (see SECURITY.md).
- The Tauri shell is scaffolded but not build-verified in this environment
  (missing system webview dependencies) — verified instead via the Vite dev
  server in a headless browser.
- Streaming responses are implemented in the provider layer but the current UI
  uses the non-streaming `generate()` path; wiring `stream()` into the chat UI
  is a good next increment.
- The Meshy/Tripo3D/DeepMotion adapters follow each vendor's publicly
  documented API shape but haven't been exercised against a live account in
  this environment — see the note in ROADMAP.md.
