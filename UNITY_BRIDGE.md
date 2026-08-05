# Unity Bridge (design doc — not yet implemented)

This describes the planned `GameForgeBridge` Unity package and its protocol.
Nothing in this document is implemented yet; it exists so Phase 7/8 has a
concrete target and so the rest of the system (tool definitions, permission
categories) was designed with it in mind rather than bolted on later.

## Why it doesn't exist yet

Per the spec's phased rollout, Unity integration starts only after the
non-Unity vertical slice (provider abstraction, tools, agent loop, project
scanning, memory) is working end-to-end — which is what this repository
delivers in Phase 1. Building the bridge before that foundation existed would
mean re-plumbing it once the core abstractions were figured out.

## Planned architecture

```
Unity Editor (GameForgeBridge package, C#)
        |  HTTP/WebSocket, localhost only
        v
apps/server (Node) -- new "engine" tool implementations --
        |
        v
packages/agent (unchanged) -> LLMProvider (unchanged)
```

`GameForgeBridge` runs inside the Unity Editor as an `EditorWindow` +
background HTTP listener (or a lightweight embedded WebSocket server — TBD
during implementation), analogous to how Unity MCP-style tools work today.
`apps/server` talks to it the same way it talks to any other tool backend —
new implementations behind the existing `PermissionCategory: "engine"` tools
already defined in `packages/tools/src/definitions.ts`'s spirit (the concrete
`inspect_unity_project` etc. tool definitions will be added alongside the
bridge, not before, so they aren't speculative).

## Planned bridge capabilities (Phase 7/8)

Project/scene inspection:
- Project identification, Unity version
- Active scene, scene hierarchy, GameObjects, components, transforms
- Materials, lights, cameras
- Console errors/warnings
- Play mode status, build status

Commands:
- `inspect_scene`, `inspect_object`
- `create_object`, `modify_object`, `modify_transform`, `modify_component_properties`
- `save_scene`
- `enter_play_mode`, `exit_play_mode`
- `build_project`

## Deliberately out of scope for the first bridge version

Per the spec: not every Unity API, no 3D asset generation, no animation
generation, no autonomous scene authoring beyond what the command list above
covers. The bridge should stay modular enough that new commands are additive.

## Visual feedback loop (Phase 9/10)

```
GameForge -> Unity -> run game -> screenshot -> vision-capable LLM -> analysis -> GameForge -> modification
```

Screenshot capture is planned as a bridge command (`capture_screenshot`)
returning a base64 PNG, which the agent attaches as an `ImagePart`
(`packages/shared`'s `ContentPart` already supports this) to a vision-capable
model's next `generate()` call. `OpenAICompatibleProvider` and
`AnthropicProvider` already translate `ImagePart` to their respective image
formats — see [PROVIDERS.md](PROVIDERS.md) — so this is expected to be a
small addition once the bridge exists, not a redesign. Video analysis is
explicitly deferred until the screenshot pipeline is stable, per the spec.

## Open questions for implementation time

- Transport: raw TCP/HTTP listener inside the Editor vs. Unity's built-in
  `EditorApplication.update` polling a request queue vs. a dedicated
  WebSocket library — needs a spike before committing.
- How build/test triggers map to Unity's `BuildPipeline` API and what subset
  of build targets Phase 1 of the bridge supports (likely just the editor's
  current active build target, not a full multi-platform matrix).
- Error surface: how Unity console errors get deduplicated/rate-limited
  before being handed to the agent's context.
