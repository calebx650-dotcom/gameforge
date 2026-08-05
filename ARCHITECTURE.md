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
packages/shared   <- depended on by everything; no dependencies of its own
packages/llm      <- LLMProvider interface + vendor implementations
packages/tools    <- WorkspaceGuard, permission policy, tool implementations
packages/project  <- project scanner + compact context summary
packages/memory   <- SQLite-backed project memory
packages/agent    <- the think/act/observe loop; depends on llm + tools + shared
apps/server       <- wires all packages together behind REST/WS
apps/desktop      <- React UI + Tauri shell; talks to apps/server only
```

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

## Agent loop

`packages/agent/src/agent.ts`: `Agent.run(conversation)` repeats, up to
`maxIterations` (default 10):

1. Call `provider.generate({ model, messages, tools })`.
2. If the model requested no tool calls, stop (`stoppedReason: "completed"`).
3. Otherwise execute each tool call through `ToolExecutor`, append results as
   `role: "tool"` messages, and loop.
4. An `AbortSignal` can cancel between iterations (`stoppedReason: "cancelled"`);
   hitting the iteration cap stops with `"max_iterations"`.

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

Per the spec's phased rollout: Unity bridge, screenshot/vision loop,
autonomous-mode safety limits beyond iteration count (max command time,
rollback via git checkpoints), and OS-keychain-backed credential storage.
See [ROADMAP.md](ROADMAP.md).
