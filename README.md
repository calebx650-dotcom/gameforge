# GameForge

GameForge is a local-first AI game-development workstation. It is not a chatbot —
it's an orchestration layer that sits on top of game engines and dev tools, lets
you drive development with natural language, and stays independent of any single
AI vendor.

This repository has the full Phase 0-11 roadmap built and tested: project
management, a provider-agnostic LLM layer, a permission-gated tool system,
an agent loop, a desktop UI, git integration with checkpoint/restore, an
engine-agnostic `EngineBridge` (Unity via `unity-mcp`, Godot via a custom
WebSocket protocol) with scene/object/play-mode/build/screenshot tools,
screenshot-to-vision-analysis wired into the agent loop, and autonomous-mode
safety limits (wall-clock timeout, file-modification cap) — plus several
generative content pipelines (3D assets, rigging/animation, procedural
levels, boss combat AI, audio/voice, video playtesting, shader/material
synthesis) pulled forward from later phases as provider-agnostic packages —
each with **both** a cloud-vendor option and a local-first, run-it-yourself
option behind the same interface, so working entirely offline on your own
GPU is an actual capability, not just a stated goal. Neither engine bridge
has been run against a real Editor in this environment — see
[ROADMAP.md](ROADMAP.md) and [UNITY_BRIDGE.md](UNITY_BRIDGE.md).

## What works right now

1. Open a project folder; GameForge scans it (engine, language, git status, docs).
2. Pick an LLM provider (Ollama, OpenAI, OpenRouter, Anthropic, or any
   OpenAI-compatible endpoint) and a model.
3. Pick an agent mode (`ask` / `assist` / `build` / `autonomous`).
4. Type a natural-language instruction.
5. The agent reads project files, edits them, and runs shell commands — each
   step gated by the permission system for the current mode — and reports back.
6. The agent can generate a 3D model, a PBR texture set, an auto-rigged
   skeleton, a motion clip, a voice line, or ambient audio via a configured
   vendor — either a cloud API (Meshy, Tripo3D, DeepMotion, ElevenLabs) or a
   local model you run yourself (TripoSR, TRELLIS, Blender, MotionGPT,
   Kokoro, Coqui XTTS-v2, AudioCraft). Either way, these always require your
   explicit approval first, in every mode.
7. The agent can generate a procedural level layout, a boss's combat
   behavior tree/combo graph, ProBuilder graybox geometry, a Unity Animator
   Controller/humanoid avatar mapping/ragdoll config, an HLSL shader, or a
   themed post-processing profile — entirely locally, for free, no vendor
   needed.
8. The agent can inspect git status/diff/log/branches (read-only, always
   available) and commit changes (mode-gated). Before every build/autonomous
   run on a git-backed project, GameForge auto-commits a checkpoint of any
   dirty working tree, so a bad run always has a fallback — the desktop UI's
   Git panel shows status, diffs, and a one-click "Restore" per checkpoint.
9. Everything is visible in the Tool Activity panel as it happens.
10. Connect an engine bridge (Unity via `unity-mcp`, or Godot via GameForge's
    own WebSocket bridge) from the desktop UI's "Engine Bridge" panel, and
    the agent gains scene inspection, object creation/modification, play
    mode, build, screenshot, and console-reading tools. After a screenshot,
    the captured image is spliced into the agent's next turn so a
    vision-capable model actually sees it, not just a JSON description of it.
11. In `autonomous` mode, runs are bounded by a wall-clock timeout and a
    file-modification cap (30 minutes / 50 files by default) so an unattended
    run can't run forever or rewrite the whole project unsupervised.
12. Chat responses stream live (token by token) instead of appearing all at
    once when the run finishes.
13. In the native desktop app, "Save to OS Keychain" persists an API key to
    the real OS credential store (Keychain/Credential Manager/Secret
    Service) per provider, so it survives app restarts without retyping —
    opt-in, never automatic, with a "Forget" button to remove it.

## Repository layout

```
/apps
  /server           Node/Express + WebSocket backend: hosts the agent, tools, memory,
                    and project scanner; talks REST + WS to the desktop UI.
  /desktop          React + Vite UI, wrapped in a Tauri shell.
/packages
  /shared           Cross-cutting types (ChatMessage, ToolCall, AgentMode, GenerationJob, ...).
  /llm              LLMProvider interface + Ollama/OpenAI-compatible/Anthropic providers.
  /assets3d         Text-to-3D + PBR generation: Meshy/Tripo3D (cloud), TripoSR/TRELLIS (local).
  /rigging          Auto-rig + motion: Meshy/DeepMotion (cloud), Blender/MotionGPT (local);
                    + humanoid retargeting, Animator Controller, and ragdoll config generators.
  /audio            Voice + music: ElevenLabs (cloud), Kokoro/XTTS-v2/AudioCraft (local);
                    + soundscape/music-mix generation.
  /level-design     Procedural level/navmesh/lighting/ProBuilder-export generation (pure, no vendor).
  /combat-ai        Boss behavior-tree/combo-graph generation + hitbox framing (pure).
  /shader-synthesis HLSL shader / ShaderGraph spec / post-processing profile generation (pure).
  /vision           Video frame extraction, live frame relay, pacing metrics, vision-analysis, backtest.
  /engine-bridge    EngineBridge interface + UnityBridge (MCP/HTTP) + GodotBridge (WebSocket).
  /tools            Read/write/execution/generation/git/engine tools, workspace sandbox, permission policy.
  /project          Project scanner + compact context summarizer.
  /memory           SQLite-backed project memory (node:sqlite, no native build step).
  /agent            The think -> act -> observe loop tying providers + tools together.
/docs               Architecture, security, provider, and Unity bridge documentation.
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it's shaped this way.

## Setup

Requirements: Node.js 22+ (for the built-in `node:sqlite` module), npm.

```bash
npm install
npm run build      # builds all packages
npm test           # runs the full test suite (233 tests across 48 files, latest count)
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
[DEVELOPMENT.md](DEVELOPMENT.md). This has now been real-build-verified
(Game Forge Local Verification Phase 5): with the Rust toolchain and Linux
webview prerequisites installed, `npx tauri build` produces a genuine
native binary and installable `.deb`/`.rpm`/`.AppImage` packages, launched
and confirmed rendering the real app UI via a screenshot under a virtual
display — not just scaffolded and untested. See ROADMAP.md's "Smaller
known gaps" section for what that verification found and fixed (a missing
icon asset) and what's still unverified (macOS/Windows builds).

## Connecting a real LLM

- **Ollama**: install and run Ollama locally (`ollama serve`), pick "ollama" as
  the provider with base URL `http://127.0.0.1:11434`. See [PROVIDERS.md](PROVIDERS.md).
- **OpenAI / OpenRouter / Anthropic**: pick the provider and paste an API key.
  Keys are only ever used for outbound requests to that vendor — see
  [SECURITY.md](SECURITY.md) for how they're handled.

## Connecting a generative content vendor — cloud or local

Optional — only needed for `generate_3d_model`, `generate_pbr_material`,
`auto_rig_model`, `generate_motion_clip`, `generate_voice_line`, or
`generate_ambient_audio`. Every one of these tools always requires your
explicit approval before running, in every agent mode (see SECURITY.md).

- **Cloud**: Meshy, Tripo3D (3D/rigging/texture), DeepMotion (motion),
  ElevenLabs (voice) — need an API key.
- **Local-first** (no account, no cost, runs on your own GPU): TripoSR,
  TRELLIS (3D), Blender auto-rig, MotionGPT (rigging/motion), Kokoro, Coqui
  XTTS-v2 (voice), AudioCraft (ambient music/sfx) — need the corresponding
  model server (or, for Blender, just the `blender` binary) running
  locally. See [PROVIDERS.md](PROVIDERS.md)'s "Running local-first" section
  for what each one expects.

The level layout, boss combat design, ProBuilder export, Animator
Controller/avatar-mapping/ragdoll, and shader/post-processing generators
need **no vendor of any kind** — see [ROADMAP.md](ROADMAP.md)'s "Generative
content pipelines" section.

## Known limitations

- `UnityBridge` (`packages/engine-bridge`) has been run against a real
  Unity Editor + `unity-mcp` install (`connect()`/`readConsole()`
  verified live, 2026-08-09); its remaining tool calls (scene/object
  mutation, play mode, builds, screenshots) and `GodotBridge` in full have
  not — see [UNITY_BRIDGE.md](UNITY_BRIDGE.md)'s "Real verification
  results". Both are unit-tested against fake local servers speaking the
  real protocol regardless.
- `packages/vision`'s screenshot-analysis path is wired into the agent loop
  (via `EngineBridge.captureScreenshot()`); the static ffmpeg frame
  extraction path and the real-time `LiveFrameBuffer` relay remain
  library-only, since nothing yet drives a video file or a live frame
  stream as an agent tool.
- ~~OS keychain-backed API key storage not wired up~~ — implemented and
  real-verified (the native Tauri window only — the browser-tab dev mode
  still holds keys in memory for the session, since there's no OS keychain
  a browser tab can reach). Opt-in per provider via "Save to OS Keychain"
  in the Provider panel. See ROADMAP.md's "Smaller known gaps" section for
  what real-hardware verification found and fixed, including a Linux-only
  fallback for when the Secret Service backend isn't reachable.
- ~~The Tauri shell is scaffolded but not build-verified~~ — fixed; real
  Linux build verified (Game Forge Local Verification Phase 5). macOS and
  Windows builds remain unverified — see ROADMAP.md.
- ~~Streaming responses not wired into the chat UI~~ — fixed; the desktop UI
  now streams assistant text live (opt-in per request via `stream: true`),
  verified against both a real NDJSON-streaming fake server and a real
  headless browser session. See ROADMAP.md's "Smaller known gaps" section.
- None of the cloud adapters (Meshy, Tripo3D, DeepMotion) or local-first
  adapters (TripoSR, TRELLIS, Blender, MotionGPT, Kokoro, XTTS-v2,
  AudioCraft) have been exercised against a live account or a real running
  local model server in this environment (no GPU, no Blender install here)
  — see the notes in ROADMAP.md and PROVIDERS.md.
- The `ShaderGraphSpec` intermediate representation is GameForge's own typed
  data model, not a byte-exact serialization of Unity's internal
  `.shadergraph` JSON format — see UNITY_BRIDGE.md for why, and what the
  alternatives are once there's a real Unity Editor to test against.
- Autonomous-mode's `maxWallClockMs`/`maxFileModifications` are the only
  per-run safety limits; there's no finer-grained per-run filesystem
  allowlist beyond `WorkspaceGuard`'s project-root sandbox yet.
