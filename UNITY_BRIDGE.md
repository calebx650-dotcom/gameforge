# Unity Bridge (design doc — not yet implemented)

This describes the planned `GameForgeBridge` Unity integration. Nothing in
this document is implemented yet — there's no Unity Editor in this build
environment to implement or test it against — but the concrete protocol
choice, the data formats the rest of GameForge already produces for it, and
the open questions are now specific enough that building it is mostly wiring,
not design.

## Why it doesn't exist yet

Per the spec's phased rollout, Unity integration starts only after the
non-Unity vertical slice (provider abstraction, tools, agent loop, project
scanning, memory) is working end-to-end — which is what this repository
delivers in Phase 1. Several later-phase pieces have since been pulled
forward as **provider-agnostic, Unity-independent data generators** (see
`packages/level-design`, `packages/combat-ai`, `packages/shader-synthesis`,
and the animation-retargeting additions to `packages/rigging`) specifically
so that once this bridge exists, it has real, tested data to consume on day
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

`apps/server` gains an MCP client that connects to a locally-running
`unity-mcp` server (started by the Unity Editor package) and re-exposes its
tools through the same `ToolExecutor`/permission-policy path every other
GameForge tool goes through — so `decidePermission()`'s mode gating and
approval flow apply to Unity scene edits exactly the way they apply to file
edits, with no separate code path to keep in sync. `unity-mcp`'s own tool
names get mapped 1:1 onto `PermissionCategory: "engine"` `ToolDefinition`s;
mutating ones (create/modify/build/play-mode) follow the same
ask/assist/build/autonomous gating as `write`, non-mutating ones
(inspect/read) follow `read`.

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

## Bridge capabilities (unity-mcp tool categories GameForge will re-expose)

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
