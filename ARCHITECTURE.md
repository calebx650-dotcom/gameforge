# Architecture

## Guiding principle

```
USER -> natural language -> GameForge Agent -> LLM Provider -> tool selection
     -> project modification -> build -> run -> observe -> analyze -> fix -> report
```

The LLM is the reasoning engine. GameForge is the orchestration/tooling
environment around it. Nothing in `packages/agent`, `packages/tools`, or
`packages/project` knows which vendor is answering — only `packages/llm` does.

## Why Node backend + Tauri shell, not native Rust

The spec calls for a Tauri desktop shell with "Backend/local services:
TypeScript/Node where practical." Tauri's own backend is Rust, which would mean
either writing the agent/tools/provider logic twice (once in TS for a web
version, once in Rust for Tauri) or writing it all in Rust and losing the
practical TS ecosystem (fetch-based streaming, JSON tool-calling parsing,
`node:sqlite`, npm's LLM SDKs).

Instead:

- **`apps/server`** is a small Node/Express + `ws` process. It owns the
  `ProjectManager`, wires `packages/llm` + `packages/tools` + `packages/agent` +
  `packages/memory` + `packages/project` together, and exposes:
  - REST (`/api/projects`, `/api/providers/models`, `/api/projects/:id/memory`)
  - one WebSocket endpoint (`/ws/chat`) for the live agent loop: tool-activity
    log entries and approval requests stream to the client in real time, and
    approval responses stream back.
- **`apps/desktop`** is the Tauri-wrapped React/Vite UI. It talks to
  `apps/server` exactly the way a browser tab would — plain `fetch` and
  `WebSocket`. Tauri's job is only to be a native window + (later) native
  capabilities the web platform can't reach (OS keychain, native file
  dialogs). It currently adds no custom Tauri commands.

This is the one deliberate deviation from the spec's literal folder listing,
and it's what "REST/WebSocket or Tauri IPC as appropriate" in the spec is
pointing at. Every other module boundary in `/packages` matches the spec.

## Package boundaries

```
packages/shared          <- depended on by everything; no dependencies of its own
packages/llm             <- LLMProvider interface + vendor implementations
packages/assets3d        <- Text3DProvider + PBRMaterialProvider interfaces + cloud/local adapters
packages/rigging         <- AutoRigProvider + MotionProvider interfaces + cloud/local adapters;
                            + humanoid retargeting/Animator/ragdoll spec generators (pure)
packages/audio           <- VoiceProvider + MusicGenerationProvider interfaces + cloud/local adapters;
                            + soundscape/music-mix generators (pure)
packages/level-design    <- procedural level/navmesh/lighting/ProBuilder-export generation (pure, no vendor)
packages/combat-ai       <- boss behavior-tree/combo-graph + hitbox framing (pure, no vendor)
packages/shader-synthesis <- HLSL shader / ShaderGraph spec / post-processing profile generation (pure, no vendor)
packages/vision          <- video frame extraction, live frame relay, pacing metrics, vision-analysis
                            prompt builder, backtest
packages/engine-bridge   <- EngineBridge interface (connect/inspect/create/modify/play/build/
                            screenshot/console) + UnityBridge (MCP/HTTP) + GodotBridge (WebSocket)
packages/tools           <- WorkspaceGuard, permission policy, tool implementations (incl. generation
                            + git + engine tools)
packages/project         <- project scanner + compact context summary
packages/memory          <- SQLite-backed project memory
packages/agent           <- the think/act/observe loop; depends on llm + tools + shared + vision
apps/server              <- wires all packages together behind REST/WS
apps/desktop             <- React UI + Tauri shell; talks to apps/server only
```

`packages/tools` depends on `assets3d`/`rigging`/`audio`/`level-design`/`combat-ai`/`shader-synthesis`
— it's the dispatch layer that turns a model's tool call into a concrete
action, so it's the right place to know about these concrete packages, the
same way it already knows about concrete filesystem/exec implementations.
`packages/agent` still never imports any of them directly; it only sees
`ToolExecutor`.

Every vendor-backed interface in `assets3d`/`rigging`/`audio` has both a
cloud implementation and at least one local-first implementation (see
PROVIDERS.md's "Running local-first" section) — `packages/tools` and
`packages/agent` cannot tell which kind is behind a given provider
instance, and don't need to. This is what makes "run entirely on local
GPUs, no cloud account, offline" an actual property of the architecture,
not just a stated goal contradicted by what's wired up.

Rule: `packages/agent` never imports a concrete provider or tool
implementation directly — only the `LLMProvider` interface and
`ToolExecutor`. Adding a new LLM vendor means: one new file in
`packages/llm/src/providers/`, one new branch in `packages/llm/src/registry.ts`.
Nothing else changes.

## LLM provider abstraction

`packages/llm/src/provider.ts` defines `LLMProvider`:

```ts
interface LLMProvider {
  listModels(): Promise<ModelInfo[]>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncGenerator<GenerateChunk>;
}
```

Implemented today: `OllamaProvider`, `OpenAICompatibleProvider` (covers OpenAI
and OpenRouter — they speak the same wire format, only `baseUrl`/headers
differ), `AnthropicProvider`. `createProvider(settings)` in `registry.ts` is the
single factory function; it's the only place that imports concrete classes.
See [PROVIDERS.md](PROVIDERS.md) for how to add a new one.

## Tool + permission system

`packages/tools`:

- `WorkspaceGuard` resolves every path against a single project root and
  rejects anything that escapes it (`..` traversal, absolute paths outside
  root, symlink escapes). No filesystem tool touches `node:fs` without going
  through it first.
- `decidePermission({ mode, category, dangerous })` is a pure function: given
  the current `AgentMode` and what a tool call would do, it returns
  `"allow" | "approve" | "deny"`. Read tools always allow. Write/execution/
  engine/git-mutation tools are denied in `ask`, require approval in `assist`,
  and are allowed in `build`/`autonomous` — **except** commands matching the
  dangerous-pattern heuristic (`rm -rf`, `sudo`, force-push, fork bombs, piping
  a remote script into a shell, etc.), which always require approval,
  regardless of mode.
- `ToolExecutor.execute(call, mode)` is the single entry point: look up the
  tool definition, run the permission check, await human approval if
  required (via an injected async callback — the caller decides how approval
  is actually surfaced, e.g. over the chat WebSocket), then dispatch.
- A `ToolDefinition` can also be marked `costsMoney: true`. Like the
  dangerous-command heuristic, this **always** forces `"approve"`,
  regardless of mode — a tool that calls a metered external vendor (3D
  generation, voice synthesis, motion capture) can't be silently allowed
  in `autonomous` mode the way a local file edit can, because it spends
  real money and can't be undone with a git revert.

## Generation tools (`packages/tools/src/generation-tools.ts`)

Thirteen tools sit alongside the filesystem/execution tools, dispatched by
`ToolExecutor` exactly the same way, in two groups:

**Vendor-backed** (`costsMoney: true`, always requires human approval,
regardless of mode and regardless of whether the configured vendor happens
to be a paid cloud API or a free local model — see the note below):
`generate_3d_model`, `generate_pbr_material`, `auto_rig_model`,
`generate_motion_clip`, `generate_voice_line`, `generate_ambient_audio`.

**Purely local, free, no vendor configuration needed** (ordinary `generation`
category — gated by mode like any other write, no forced approval):
`generate_level_layout`, `generate_boss_combat_design`, `generate_shader`,
`generate_post_processing_profile`, `export_level_geometry`,
`generate_animator_controller`, `generate_humanoid_avatar_mapping`,
`generate_ragdoll_config`.

**Why vendor-backed tools always require approval even when the configured
provider is a free local model**: `costsMoney` lives on the `ToolDefinition`,
not on the concrete provider instance — the permission check in
`packages/tools/src/permissions.ts` has no visibility into which vendor a
session happens to have configured for a given tool, only the tool's static
definition. Making that decision provider-aware would be more precise (a
local Kokoro call really does cost nothing) but adds real complexity for
comparatively little safety benefit — clicking one extra "approve" on a free
local call costs the user a second, while a wrongly-silent approval on an
actually-paid cloud call could cost real money. Simplicity won this
trade-off deliberately; revisit if it proves annoying in practice.

Every vendor-backed tool follows the same submit -> poll pattern as the
underlying `GenerationJob` interface (`packages/shared`): the tool call
submits the job, then `pollUntilSettled()` blocks (bounded by a timeout,
default 120s) until it succeeds or fails, returning the settled
`GenerationJob` as the tool result. Which concrete vendor backs each tool
is decided per chat session, not per tool call — `apps/server`'s
`buildGenerationProviders()` builds live provider instances from a
`generationSettings` field on the WebSocket `chat` request (mirroring how
`providerSettings` picks the main LLM vendor) and hands them to
`ToolExecutor`'s constructor. This keeps vendor credentials out of the
tool-call arguments the model sees and out of the operation log, the same
way the main LLM's API key never enters the system prompt.

## Git integration (`packages/tools/src/git-tools.ts`)

Five tools, split by mutation the same way as everything else: `git_status`,
`git_diff`, `git_log`, `git_branch` are read-only (`ToolDefinition.mutating:
false`, always allowed); `git_commit` mutates history and follows the same
`ask`-deny / `assist`-approve / `build`+`autonomous`-allow gating as any
other write. This is what the `mutating` field on `ToolDefinition` was added
for — `decidePermission()`'s default (`mutating = category !== "read"`)
would otherwise treat every tool in the `"git"` category as mutating just
because the category isn't literally `"read"`.

Two more pieces exist outside the agent's tool set entirely, both in
`git-tools.ts` but never routed through `ToolExecutor`:

- `maybeCreateCheckpoint(guard, mode, label)` runs automatically at the
  start of every `build`/`autonomous` chat request (`apps/server`'s
  `chat-socket.ts` calls it before constructing the `Agent`), auto-committing
  a dirty working tree so the run has a rollback point. It's a no-op on a
  clean tree or a non-repo, and it isn't a tool the model calls — the server
  runs it unconditionally, before the model sees the request.
- `restoreCheckpoint(guard, hash)` performs `git reset --hard` after
  validating the hash resolves to a real commit. It's reachable only via
  `apps/server`'s `POST /projects/:id/git/restore` REST endpoint, called by
  `apps/desktop`'s Git panel "Restore" button — deliberately not exposed as
  an agent tool at all, the same treatment as the dangerous-command list:
  a hard reset is destructive enough that it shouldn't be one model decision
  away, approved or not.

## Engine bridge (`packages/engine-bridge`)

`EngineBridge` is an engine-agnostic interface — `connect`/`isConnected`/
`inspectScene`/`inspectObject`/`createObject`/`modifyObject`/
`modifyTransform`/`modifyComponent`/`saveScene`/`enterPlayMode`/
`exitPlayMode`/`buildProject`/`captureScreenshot`/`readConsole` — with two
implementations proving the abstraction is real, not secretly shaped around
one engine:

- `UnityBridge` talks to a locally-running `unity-mcp` server via
  `McpHttpClient`, a real MCP JSON-RPC-over-HTTP client (`tools/list`,
  `tools/call`), mapping the generic verbs onto `unity-mcp`'s tool set
  (`manage_scene`, `manage_gameobject`, `manage_editor`, `read_console`,
  `capture_screenshot`). Default `http://127.0.0.1:8080` (unity-mcp's real
  HTTP-transport default port, confirmed live — see UNITY_BRIDGE.md).
- `GodotBridge` talks to a bridge plugin over a *different* transport
  entirely — a raw WebSocket carrying `{id, command, args}` requests and
  `{id, result|error}` responses (`GodotWsClient`), with Godot-flavored
  command names (`scene.get_hierarchy`, `editor.play`). Default
  `ws://127.0.0.1:6401`.
- `createEngineBridge(settings)` in `registry.ts` is the factory, mirroring
  `packages/llm`'s `createProvider(settings)` pattern exactly.

`packages/tools/src/engine-tools.ts` exposes twelve `EngineBridge` methods
as real agent tools (`ENGINE_TOOL_NAMES`), dispatched by `ToolExecutor`
through `dispatchEngineTool(name, args, bridge)` — connecting lazily on
first use. Inspection/console-reading tools are non-mutating and always
allowed; everything else (`create_object`, `modify_*`, `save_scene`,
`enter_play_mode`/`exit_play_mode`, `build_project`) follows the same
mode-gated `write` path as any other mutating tool. `apps/server`'s chat
handler builds the bridge per-session from a `engineSettings: { engine, url }`
field on the WebSocket `chat` request and passes it into `ToolExecutor`'s
constructor, the same shape as `providerSettings`/`generationSettings`.
`apps/desktop`'s "Engine Bridge" panel is the UI for picking `unity`/`godot`
and an optional URL override.

Both bridges are unit-tested against real fake local servers (a real `ws`
`WebSocketServer` for Godot, a real JSON-RPC responder for Unity) — neither
has been run against an actual Unity Editor + `unity-mcp` install or Godot
Editor + bridge plugin, since neither engine is installed in this
environment. See UNITY_BRIDGE.md.

## Agent loop

`packages/agent/src/agent.ts`: `Agent.run(conversation)` repeats, up to
`maxIterations` (default 10):

1. Call `provider.generate({ model, messages, tools: executor.getAvailableTools() })`.
   `tools` is *not* the full, static `TOOL_DEFINITIONS` list — `getAvailableTools()`
   (`packages/tools/src/tool-scope.ts`) filters it down to what this
   session can actually use: engine tools only if an `EngineBridge` is
   connected, each vendor-backed generation tool only if its specific
   provider is configured (`generate_3d_model` needs `text3d`, etc. — see
   `GENERATION_TOOL_PROVIDER_KEY`), and everything else (fs/exec/git/pure
   generation tools) always. Before this, every session was handed all 39
   tool schemas (`TOOL_DEFINITIONS.length`) on every turn regardless of what
   was actually configured — a session with no engine bridge and no
   generation vendors configured now sees 21 instead of 39. That
   cost context for every provider and specifically hurt smaller
   local models more likely to mis-select from a schema set full of tools
   guaranteed to fail. This only changes what's *advertised*; `ToolExecutor`'s
   permission checks and each tool's own "not configured" error still apply
   unconditionally if a model calls something it wasn't offered.
2. If the model requested no tool calls, stop (`stoppedReason: "completed"`).
3. Otherwise execute each tool call through `ToolExecutor`, append results as
   `role: "tool"` messages, and loop.
4. An `AbortSignal` can cancel between iterations (`stoppedReason: "cancelled"`);
   hitting the iteration cap stops with `"max_iterations"`.

After a successful `capture_screenshot` tool call, `Agent.run()` splices in
an *additional* user-role message — built by `packages/vision`'s
`buildVideoAnalysisMessage()` — containing the actual captured image plus a
vision-analysis prompt, right after the tool-result message. This matters
because `ToolResultMessage.content` is string-only, so a JSON blob
describing a screenshot is not the same thing as the model actually seeing
it; the splice is what makes the *next* `generate()` call give a
vision-capable model real pixels to look at instead of an opaque result
string. Verified end-to-end in `apps/server/src/e2e.test.ts` against a fake
`unity-mcp` server.

Two more limits apply only in `autonomous` mode (`AgentOptions.maxWallClockMs`,
`maxFileModifications`): wall-clock is checked between iterations (a single
slow tool call can still run past budget, but no new iteration starts after
it exceeds the limit), and file-modification count only increments on
successful `create_file`/`edit_file`/`delete_file` calls (a failed edit
doesn't count against the cap). Each produces its own `stoppedReason`
(`"timed_out"` / `"file_limit_reached"`) distinct from a normal completion.
`apps/server` applies conservative defaults (30 minutes, 50 file
modifications) automatically whenever `mode === "autonomous"`, overridable
per request.

Every step is recorded as an `OperationLogEntry` and forwarded via
`onLogEntry`, which `apps/server` uses to stream tool activity to the UI live.

## Project scanning

`packages/project/src/scanner.ts` walks the project once per open (or rescan),
detecting engine (Unity via `Assets/` + `ProjectSettings/`, Godot via
`project.godot`, Unreal via `*.uproject`), languages present, package/manifest
files, top-level source directories, scene files, docs, and git status.
`summarizeProjectContext()` renders a compact plain-text summary for the
agent's system prompt — deliberately **not** file contents. The agent uses
`read_file`/`search_project` for targeted retrieval instead of the project
being dumped into context.

## Memory

`packages/memory` wraps `node:sqlite`'s `DatabaseSync` — Node's built-in
SQLite binding, not a native npm module — so the package installs identically
on every platform with no compiler toolchain required. One database per
project, at `<project>/.gameforge/memory.sqlite3`. Entries are categorized
(`known_bug`, `completed_feature`, `convention`, ...) and summarized into the
agent's system prompt alongside the project context.

## What's deliberately not built yet

OS-keychain-backed credential storage (currently session-only), streaming
wired into the chat UI (per-provider `stream()` exists but the UI still uses
`generate()`), and a finer-grained per-run filesystem allowlist beyond
`WorkspaceGuard`'s project-root sandbox. See [ROADMAP.md](ROADMAP.md)'s
"Smaller known gaps" section.
