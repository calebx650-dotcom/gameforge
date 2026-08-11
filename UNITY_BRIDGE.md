# Unity Bridge

The `GameForgeBridge` integration described here is implemented in
`packages/engine-bridge` (Phase 7-9) as the `EngineBridge` interface plus
a `UnityBridge` adapter. `UnityBridge`/`McpHttpClient`'s own package-level
tests mock `fetch` directly, standing in for the real protocol documented
below; the `apps/server/src/e2e.test.ts` capstone test uses a real local
HTTP responder speaking that same real protocol.

**Real Unity verification (2026-08-09):** this bridge has now been run
against a genuinely running Unity Editor (6000.5.7f1) with
CoplayDev/unity-mcp ("MCP for Unity") v10.1.2 actually installed and
serving — see "Real HTTP transport" below for the protocol details this
uncovered, and "Real verification results" for what was and wasn't proven.

## Status

- `packages/engine-bridge/src/engine-bridge.ts` — the `EngineBridge`
  interface: `connect`/`isConnected`/`inspectScene`/`inspectObject`/
  `createObject`/`modifyObject`/`modifyTransform`/`modifyComponent`/
  `saveScene`/`enterPlayMode`/`exitPlayMode`/`buildProject`/
  `captureScreenshot`/`readConsole`.
- `packages/engine-bridge/src/mcp-client.ts` — `McpHttpClient`, a real client
  for the Model Context Protocol's "Streamable HTTP" transport (`tools/list`,
  `tools/call`, session handshake, SSE-aware response parsing — see below).
- `packages/engine-bridge/src/unity-bridge.ts` — `UnityBridge`, mapping the
  interface above onto `unity-mcp`'s tool set (`manage_scene`,
  `manage_gameobject`, `manage_editor`, `read_console`, `capture_screenshot`),
  default `baseUrl` `http://127.0.0.1:8080` (unity-mcp's real HTTP-transport
  default port — confirmed live; not the legacy `6400` stdio-bridge port an
  earlier version of this doc claimed).
- `packages/tools/src/engine-tools.ts` — twelve real agent tools dispatching
  through whichever `EngineBridge` the session configured (see
  ARCHITECTURE.md's "Engine bridge" section).
- `apps/desktop`'s "Engine Bridge" panel lets a user pick `unity`/`godot` and
  an optional URL override per chat request.
- A second implementation, `GodotBridge`, proves the interface isn't secretly
  Unity-shaped (see ARCHITECTURE.md) — it talks GameForge's own WebSocket
  command protocol instead of MCP/HTTP.

## Real HTTP transport (found 2026-08-09, not documented anywhere in unity-mcp's own docs at the time)

An earlier version of `McpHttpClient` assumed a bespoke bare-JSON-over-HTTP
wire format: POST `{jsonrpc, id, method, params}` straight to the server's
base URL, expect a bare `{result}`/`{error}` JSON body back. Against a real
`mcp-for-unity` 10.1.2 server (built on the `fastmcp`/Starlette/uvicorn
stack, not aiohttp) this produced a persistent, genuine HTTP 404 on every
path tried — the real routes only became clear after downloading and
reading the actual PyPI package (`pip install mcpforunityserver`) and then
confirming each finding against the live process. The real transport is the
Model Context Protocol's standard **"Streamable HTTP"** transport:

1. **Every request goes to `POST {baseUrl}/mcp`**, not the bare base URL.
2. **Every request needs `Accept: application/json, text/event-stream`**
   (in addition to `Content-Type: application/json`) — without it the server
   returns `406 Not Acceptable`.
3. **A session must be opened first** with an `initialize` JSON-RPC call.
   The server's response carries an `Mcp-Session-Id` HTTP header, which the
   client must echo back as a request header (`Mcp-Session-Id: <id>`) on
   every subsequent call. There is no bare-JSON-RPC path that skips this —
   calling `tools/list`/`tools/call` without a valid session ID either 404s
   or the server silently has nothing to route the call to.
4. **Responses — including ordinary single-shot `tools/list`/`tools/call`
   results, not just long-lived streams — commonly come back as a single
   `text/event-stream` chunk** (`event: message\ndata: {...}`), not a bare
   JSON body. `res.json()` on such a response throws. A compliant client has
   to accept both framings.
5. Sending `notifications/initialized` after `initialize` matches the MCP
   spec and is what real MCP SDKs do, though this particular server
   tolerated its absence in testing — `McpHttpClient` sends it anyway,
   treating failure as non-fatal.

`McpHttpClient` now implements all five points; see its module doc comment
for the implementation. This is a real, general MCP "Streamable HTTP" client
now — not something unity-mcp-specific — so it should work unmodified
against any other MCP server using the same standard transport.

The default port also needed a fix: `http_port = args.http_port or ... or
8080` in unity-mcp's own `main.py` confirmed **8080** is the actual HTTP
transport default, not the `6400` this doc previously claimed (`6400` is the
*legacy stdio-mode* bridge's TCP port — a completely different, non-HTTP
mechanism `McpHttpClient` was never going to be able to talk to).

## Real verification results (2026-08-09)

Environment: Unity 6000.5.7f1, `com.coplaydev.unity-mcp` 10.1.2 (both the
Unity-side C# package and the `mcpforunityserver` PyPI package it launches
via `uvx`), real project at `GameForgeUnityTest`, HTTP transport, port 8080.

- **`createEngineBridge({ engine: "unity", url }).connect()` — passed.**
  Ran the real `initialize` handshake, obtained a real session ID, called
  `tools/list` over the real session, got back unity-mcp's real ~29-tool
  list (`manage_scene`, `manage_gameobject`, `read_console`, etc.).
- **`readConsole()` — passed, after a real bug fix.** The first live run
  threw (`messages.slice is not a function`): `read_console`'s default/
  "plain" format returns `{success, data: string[]}` (raw formatted log
  lines), not the `ConsoleMessage[]`-shaped array `UnityBridge.readConsole()`
  assumed. Fixed by passing `format: "json"`, which returns
  `{success, data: [{type, message, file, line, stackTrace}]}` — `type` is
  Unity's `LogType` name (`Log`/`Warning`/`Error`/`Exception`/`Assert`),
  mapped onto `ConsoleMessage["level"]`. Rerunning
  `scripts/verify-unity-bridge.mjs` afterward returned real console entries
  from the real Editor (its own `MCP-FOR-UNITY` startup log lines).
- **`buildProject()` was wrong at the design level, not just the transport
  level — found and fixed while building the Working Demo Sprint's
  build/fix repair loop.** It originally called `manage_editor` with
  `action: "build"`, a tool/action pair that doesn't exist in real
  `mcp-for-unity`. Reading the actual C# source
  (`Editor/Tools/ManageBuild.cs`, `Editor/Tools/RefreshUnity.cs`) found the
  real picture: the real build tool is `manage_build`, a *separate* tool
  that triggers a full distributable player build via
  `BuildPipeline.BuildPlayer` — async and pollable (`RequiresPolling =
  true`, up to 30 minutes), the wrong shape entirely for "did my last
  script edit compile." The right tool for that is `refresh_unity`
  (`mode: "force", scope: "scripts", compile: "request", wait_for_ready:
  true`, which blocks the call until Unity finishes recompiling) followed
  by the already-correct `read_console`. `UnityBridge.buildProject()` now
  does exactly that, and is documented as deliberately *not* covering a
  real player/export build — that's a different, heavier operation a
  future caller needing it would have to implement against `manage_build`
  directly, polling included. Unit-tested against a fake server speaking
  this real two-call sequence; not yet exercised against a live Editor
  (the earlier `connect()`/`readConsole()` live session predates this fix).
- **`McpHttpClient` had no recovery path if the MCP session dropped
  mid-run** — found while scoping the P1 reliability tier (ROADMAP.md).
  Per the MCP "Streamable HTTP" spec, a server responds `404` to a request
  carrying an `Mcp-Session-Id` it no longer recognizes (the session
  expired, or the server restarted); before this fix, that 404 — or a
  plain connection drop mid-call — just failed the call outright, forcing
  a whole new `UnityBridge`/`McpHttpClient` instance to recover. Now
  `McpHttpClient.request()` treats both cases the same way: forget the
  stale session, re-run `initialize` to get a fresh one, and replay the
  exact same call once. Bounded to a single retry — a server that's
  genuinely down still fails loudly instead of looping. Unit-tested with
  three new cases in `mcp-client.test.ts`: a stale-session 404 that
  recovers on retry, a connection that stays broken across the retry (and
  correctly gives up rather than looping), and a `fetch` rejection
  mid-tool-call (not just during `initialize`) that also recovers. Not
  yet exercised against a real Unity Editor — there's no cheap way to
  force a real `mcp-for-unity` session to expire on demand outside of
  restarting the server mid-session, which hasn't been done live yet.
- **`run_tests`/`get_test_job` (P2.5 "Test" tier)** — real unity-mcp tools,
  confirmed by reading the actual C# source directly (not guessed):
  `Editor/Tools/RunTests.cs` for `run_tests`'s exact argument names
  (`mode`, `testNames`, `groupNames`, `categoryNames`, `assemblyNames`,
  `includeDetails`, `includeFailedTests`, plus a `clear_stuck` escape
  hatch this bridge doesn't expose) and its immediate response
  (`{job_id, status: "running", mode, include_details, include_failed_tests}`,
  or `{reason: "tests_running", retry_after_ms}` if a run is already in
  progress — this bridge doesn't special-case that error, it just
  surfaces it); `Editor/Services/TestJobManager.cs` for
  `get_test_job`'s real polled-status fields (`job_id`, `status`
  — `"running"`/`"succeeded"`/`"failed"` — `mode`, a `progress` object
  with `completed`/`total`/`failures_so_far`/etc., `error`, and `result`).
  **One field is inferred, not confirmed**: `get_test_job`'s response
  wrapper is assumed to be `{success, data}` like `read_console`'s
  confirmed shape, and the per-test `result` payload once a run succeeds
  (`TestRunResult.ToSerializable()` server-side — a different class from
  this bridge's own same-named return type) is passed through as
  `unknown` rather than typed, since that method's source wasn't
  reachable to confirm its exact fields. `UnityBridge.runTests()` submits
  then polls internally (2s interval, 5-minute bound) rather than
  exposing two raw tools, matching the generation tools' established
  submit-then-poll convention. Unit-tested against a fake server speaking
  this real two-tool sequence, including multi-poll-before-settling (fake
  timers) and the bounded-timeout case; not yet exercised against a live
  Editor.
- **Everything else in `UnityBridge`** (`inspectScene`, `createObject`,
  `modifyObject`/`modifyTransform`/`modifyComponent`, `saveScene`,
  `enterPlayMode`/`exitPlayMode`, `captureScreenshot`) is still unverified
  against a real Editor — only the transport-level fix (which applies to
  every call) and `readConsole()`'s response-shape fix were exercised
  live. If any of those tools' argument/response shapes are also wrong,
  the "Real HTTP transport" section above shows the working pattern (call
  the real tool over curl, compare against what the code assumes) for
  finding out.
- Getting a Unity-side bridge *session* connected (not just the HTTP server
  reachable) turned out to be its own small yak-shave: `unity-mcp`'s "Start
  Server" UI button both starts the local HTTP server process *and* connects
  a separate Unity-side session that tool calls actually route through —
  starting only the server left every tool call returning
  `"Unity session not available; please retry"`. The reliable
  headless-launch path was enabling `unity-mcp`'s own "Auto-Start on Editor
  Load" preference (`EditorPrefs` keys `MCPForUnity.UseHttpTransport` /
  `MCPForUnity.AutoStartOnLoad`) and letting its `[InitializeOnLoad]`
  handler — which is domain-reload-safe by design — do both steps itself on
  the next Editor launch, rather than trying to drive `MCPServiceLocator`
  directly from a `-executeMethod` script (an ad-hoc `EditorApplication.
  delayCall` subscribed that way gets silently wiped by the domain reload
  unity-mcp's own startup path triggers). This is a one-time local Editor
  setup concern, not something `McpHttpClient`/`UnityBridge` need to handle.

## Why Unity integration came after the non-Unity vertical slice

Per the spec's phased rollout, Unity integration started only after the
non-Unity vertical slice (provider abstraction, tools, agent loop, project
scanning, memory) was working end-to-end — delivered in Phase 1. Several
later-phase pieces were pulled forward as **provider-agnostic,
Unity-independent data generators** (see `packages/level-design`,
`packages/combat-ai`, `packages/shader-synthesis`, and the
animation-retargeting additions to `packages/rigging`) specifically so that
once this bridge existed, it would have real, tested data to consume on day
one instead of starting from nothing.

## Concrete protocol choice: adopt `unity-mcp`, don't build one from scratch

The original version of this doc proposed a from-scratch `GameForgeBridge`
Editor package with a bespoke HTTP/WebSocket protocol. That's now considered
the wrong call: **[CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)**
is an MIT-licensed, actively maintained Model Context Protocol bridge for
Unity with 47+ pre-built tool entrypoints already covering scene management,
GameObject/component editing, Roslyn-backed C# script validation, asset
management, and build triggers. Building a second implementation of
"LLM talks to the Unity Editor" from zero would be redundant effort spent
re-solving a problem this project has already solved well, not a
differentiator for GameForge.

```
Unity Editor (unity-mcp package, C#)
        |  MCP over stdio/HTTP, localhost only
        v
apps/server (Node) -- a thin MCP client wrapping unity-mcp's tools as
                       GameForge ToolDefinitions (category: "engine") --
        |
        v
packages/agent (unchanged) -> LLMProvider (unchanged)
```

`UnityBridge` (in `packages/engine-bridge`) is that MCP client: it connects
to a locally-running `unity-mcp` server (started by the Unity Editor
package) via `McpHttpClient`, and `packages/tools/src/engine-tools.ts`
re-exposes the generic `EngineBridge` verbs through the same
`ToolExecutor`/permission-policy path every other GameForge tool goes
through — so `decidePermission()`'s mode gating and approval flow apply to
Unity scene edits exactly the way they apply to file edits, with no separate
code path to keep in sync. The twelve engine tool definitions are mapped
onto `PermissionCategory: "engine"`; mutating ones (create/modify/build/
play-mode) follow the same ask/assist/build/autonomous gating as `write`,
non-mutating ones (inspect/read) follow `read`.

## Scene assembly: consuming GameForge's own generated data

This is the piece the original design doc didn't have an answer for yet —
what actually turns procedural level/combat/shader data into a real Unity
scene:

- **Graybox geometry** — `packages/level-design`'s `generateProBuilderCommands()`
  turns a generated `LevelLayout` into `BuildRoomShell`/`BuildCorridorFloor`
  command data. A small Unity-side script (invoked via a `unity-mcp` C#
  script-execution tool) walks that list and builds the actual meshes
  through `com.unity.probuilder`'s scripting API
  (`Unity-Technologies/com.unity.probuilder` — `ShapeGenerator.GenerateCube`
  for room shells, a custom `ProBuilderMesh` for the corridor floor strips).
- **Lighting** — `packages/level-design`'s `generateLightingPlan()` output
  maps directly onto `Light` component creation (type/color/intensity/flicker
  per placement).
- **Post-processing / atmosphere** — `packages/shader-synthesis`'s
  `generatePostProcessingProfile()` maps onto a Unity `VolumeProfile` asset's
  component values (Bloom/Vignette/ColorGrading/Fog/FilmGrain/ChromaticAberration).
- **Shaders/materials** — `generateAtmosphericFogShader()` /
  `generateGrimeOverlayShader()` / `generateNightVisionPostProcessShader()`
  produce complete `.shader` file text ready to write directly into the
  project's `Assets/` folder (via the existing `create_file` tool — no Unity
  bridge even required for this part). `generateDistanceGrimeBlendGraph()`
  produces GameForge's own typed node-graph IR; materializing that into an
  actual Shader Graph asset is a real open question — see below.
- **Rigs/retargeting** — `packages/rigging`'s `generateHumanoidAvatarMapping()`
  maps onto Unity's `HumanBoneName` Avatar configuration;
  `generateLocomotionAnimatorController()` maps onto `AnimatorController`'s
  scripting API (`AnimatorState`/`AnimatorStateTransition`/`BlendTree`);
  `generateRagdollConfig()` maps onto `CharacterJoint` + collider setup per
  bone (Unity's `Ragdoll Wizard` does this manually — this is that wizard's
  logic, callable programmatically); `generateRootMotionConfig()` maps
  directly onto `Animator.applyRootMotion` and the clip's
  `AnimationClipSettings` bake-into-pose flags.
- **Combat AI** — `packages/combat-ai`'s behavior tree/combo-graph output
  is intentionally engine-agnostic data (see that package's own docs); it
  maps onto whichever BT/FSM runtime the project uses (a custom interpreter,
  a third-party asset), not directly onto a Unity built-in system.

## Bridge capabilities (unity-mcp tool categories GameForge re-exposes)

Project/scene inspection (category: `engine`, non-mutating -> follows `read` gating):
- Project identification, Unity version, active scene, scene hierarchy,
  GameObjects, components, transforms, materials, lights, cameras, console
  errors/warnings, play mode status, build status.

Mutating commands (category: `engine`, follows `write`/mode gating):
- `create_object`, `modify_object`, `modify_transform`,
  `modify_component_properties`, `save_scene`, `enter_play_mode`,
  `exit_play_mode`, `build_project`, plus running the scene-assembly scripts
  described above (ProBuilder geometry, Animator Controller construction,
  ragdoll setup) as script-execution calls.

## Real-time visual feedback (upgraded from the original screenshot-only plan)

```
GameForge -> Unity -> run game -> live frame stream -> vision-capable LLM -> analysis -> GameForge -> modification
```

The original plan was `capture_screenshot` -> static PNG -> vision model.
That's still supported (and is the simpler fallback), but
`packages/vision`'s `LiveFrameBuffer` is built for the better version: a
bounded in-memory ring buffer that a Unity-side sender pushes frames into
over a WebSocket, with drop-oldest backpressure so a live game is never
stalled waiting on the vision loop. This is deliberately **not** a claim of
true zero-copy GPU-memory streaming (Spout2/NDI) — that needs a native
Unity-side sender plugin (the NDI Unity SDK, or a Spout2 wrapper) which is
out of scope for this Node/TS codebase to build or test without a GPU and a
running Unity Editor. What `LiveFrameBuffer` provides is the practical,
buildable-today substitute: whatever encodes and pushes frames (an NDI/Spout
plugin's output piped through a small relay, or a simpler
`Application.CaptureScreenshot`-into-memory-then-push loop) has somewhere
zero-disk-write to push them, and the vision-analysis prompt builder
(`buildVideoAnalysisMessage`) already knows how to turn a batch of buffered
frames into a proper multi-image LLM request. Static ffmpeg file extraction
(`packages/vision`'s `extractFrames`) remains the right tool for analyzing a
pre-recorded capture; `LiveFrameBuffer` is for "what's happening right now."

## Deliberately out of scope for the first bridge version

Per the spec: not every Unity API surface, no full 3D asset generation
pipeline running inside the Editor (that stays in `packages/assets3d`/
`packages/rigging`, producing files the bridge then imports), no autonomous
scene authoring beyond the command list above. The bridge should stay
modular enough that new commands are additive — which `unity-mcp`'s existing
tool-registration pattern already supports.

## Open questions for implementation time

- Whether to run `unity-mcp`'s MCP server over stdio (spawned as a child
  process by `apps/server`) or HTTP (a persistent Unity-side listener) —
  affects how "is Unity currently open" gets detected.
- How to materialize `packages/shader-synthesis`'s `ShaderGraphSpec` IR into
  an actual `.shadergraph` asset: Unity's ShaderGraph scripting API is
  internal/unstable across versions, so the alternative (skip Shader Graph
  entirely, always emit hand-written HLSL via the generators that already
  exist) may turn out to be the more maintainable choice — a decision to
  make once there's a real Unity Editor to test both approaches against.
- What actually pushes frames into `LiveFrameBuffer` from the Unity side:
  the honest options are a `RenderTexture.ReadPixels`-into-memory loop over
  a `unity-mcp`-adjacent WebSocket (buildable with what this repo already
  has), versus a true NDI/Spout native plugin (higher performance, real
  native-code work outside this repo's current scope).
- How build/test triggers map to Unity's `BuildPipeline` API and what subset
  of build targets the first bridge version supports (likely just the
  editor's current active build target, not a full multi-platform matrix).
- Error surface: how Unity console errors get deduplicated/rate-limited
  before being handed to the agent's context.
