# Roadmap

Phases as defined in the original spec. Do not skip ahead — each phase
should be working and tested before the next starts.

- [x] **Phase 0** — Repository inspection and architecture proposal.
- [x] **Phase 1** — Desktop shell + UI (React/Vite + Tauri scaffold).
- [x] **Phase 2** — LLM provider abstraction + Ollama (also shipped
      OpenAI-compatible/OpenRouter/Anthropic ahead of schedule since the
      abstraction made them nearly free).
- [x] **Phase 3** — Agent/tool system (modes, permission policy, `Agent.run` loop).
- [x] **Phase 4** — Filesystem/project tools (`read_file`, `edit_file`,
      `create_file`, `delete_file`, `create_directory`, `search_project`,
      `list_directory`, `run_command`).
- [x] **Phase 5** — Git integration. `git_status`/`git_diff`/`git_log`/`git_branch`
      (read-only, always allowed) and `git_commit` (mutating, mode-gated) are
      real agent tools in `packages/tools/src/git-tools.ts`. Before every
      build/autonomous-mode run, `maybeCreateCheckpoint()` auto-commits a
      dirty working tree (no-ops on a clean tree or a non-git project) so a
      bad run always has a known-good state to fall back to — wired into
      `apps/server`'s chat handler, visible in the Tool Activity log.
      `apps/desktop`'s Git panel shows branch/dirty-file status, a diff
      viewer, and a checkpoint list with a "Restore" button
      (`git reset --hard`) — restoring is reachable only through that direct
      REST call, never through the agent's tool set, since a hard reset is
      destructive and shouldn't be one model decision away.
- [x] **Phase 6** — Project memory/context system (`packages/memory`,
      SQLite via `node:sqlite`; compact project context summary via
      `packages/project`).
- [x] **Phase 7** — Engine bridge (generalized beyond just Unity — see
      [UNITY_BRIDGE.md](UNITY_BRIDGE.md) for the design rationale).
      `packages/engine-bridge` implements `EngineBridge` — a
      connect/inspect/create/modify/play/build/screenshot/console
      interface any engine automation surface can sit behind — plus:
      `McpHttpClient`, a real MCP (Model Context Protocol) JSON-RPC-over-HTTP
      client (`tools/list`, `tools/call` — the actual wire format, not a
      guess); `UnityBridge`, mapping those generic verbs onto
      `unity-mcp`'s tool set (`manage_scene`, `manage_gameobject`,
      `manage_editor`, `read_console`); and `GodotBridge`, a second
      implementation over GameForge's own WebSocket command protocol,
      proving the abstraction isn't secretly Unity-shaped. Both are unit
      tested against fake local servers (a real `ws` `WebSocketServer` fake
      for Godot, a real JSON-RPC responder for Unity) — neither has been
      run against a real Unity Editor + `unity-mcp` install or a real Godot
      Editor + bridge plugin, since neither engine is installed in this
      environment. The Godot-side EditorPlugin and any future Unity C#
      package changes are out of scope for this TypeScript codebase to
      write or test.
- [x] **Phase 8** — Unity/engine inspection/control. Twelve tool
      definitions (`inspect_scene`, `inspect_object`, `create_object`,
      `modify_object`, `modify_transform`, `modify_component`, `save_scene`,
      `enter_play_mode`, `exit_play_mode`, `build_project`,
      `capture_screenshot`, `read_console`) are real agent tools in
      `packages/tools/src/engine-tools.ts`, dispatched through the same
      `ToolExecutor` permission path as every other tool — inspection/
      console-reading is read-only and always allowed, everything else is
      mode-gated like any other write. `ToolExecutor` connects lazily to
      whichever `EngineBridge` the session configured.
- [x] **Phase 9** — Build/run/test loop. `build_project`, `enter_play_mode`,
      `exit_play_mode` are part of the same tool set above, going through
      the same `EngineBridge`.
- [x] **Phase 10** — Screenshot capture + vision analysis, actually wired
      into the agent loop. `packages/vision`'s ffmpeg-based extraction,
      `LiveFrameBuffer` real-time ring buffer (the local-first substitute
      for Spout2/NDI GPU-memory sharing — a native Unity-side sender plugin
      is out of scope here), frame-pacing metrics, and `runBacktest`
      comparator are all still available as a library. What's new: after a
      successful `capture_screenshot` tool call, `Agent.run()` splices an
      additional message — the actual image plus a vision-analysis prompt
      (`buildVideoAnalysisMessage`) — into the conversation, so the *next*
      `generate()` call gives the model something to look at instead of an
      opaque JSON blob. Verified end-to-end in `apps/server/src/e2e.test.ts`
      against a fake unity-mcp server: a real WebSocket chat request drives
      `capture_screenshot` through a real `EngineBridge`, and the test
      confirms the image genuinely lands in the next provider call.
- [x] **Phase 11** — Autonomous development loop hardening.
      `Agent.run()` now takes `maxWallClockMs` (checked between iterations;
      a single slow tool call can still run past the budget, but no new
      iteration starts after it) and `maxFileModifications` (counts
      successful `create_file`/`edit_file`/`delete_file` calls only — a
      failed edit doesn't count against the cap), each producing a new,
      distinct `stoppedReason` (`"timed_out"` / `"file_limit_reached"`) so
      the caller can tell a safety stop from a normal completion.
      `apps/server` applies conservative defaults (30 minutes,
      50 file modifications) automatically whenever `mode === "autonomous"`,
      overridable per request. Rollback was already covered by Phase 5's
      checkpoint commits and restore endpoint. What's still open: filesystem
      restrictions *within* a single run beyond `WorkspaceGuard`'s root
      restriction (e.g., a per-run allowlist of directories) — not built,
      since the project-root sandbox already bounds the worst case and a
      finer-grained scheme didn't have an obvious design to commit to yet.

## Generative content pipelines (pulled forward from later phases)

Ahead of the Unity bridge, the following provider-agnostic pipelines were
built following the same interface + adapter pattern as `packages/llm`,
each wired into the agent as a tool. Vendor-backed tools are gated by the
`costsMoney` permission (always requires human approval, in every mode —
see SECURITY.md); purely local/pure-computation tools are not.

- **`packages/assets3d`** — text-to-3D generation (`Text3DProvider`:
  cloud — Meshy, Tripo3D; **local-first** — TripoSR, TRELLIS) and PBR
  material/texture generation (`PBRMaterialProvider`: cloud — a dedicated
  Meshy texture adapter; **local-capable** — a vendor-agnostic fallback that
  drives any OpenAI-compatible image model, cloud or local, four times with
  channel-specific prompts).
- **`packages/rigging`** — auto-rigging (`AutoRigProvider`: cloud — Meshy;
  **local-first** — a headless Blender/bpy adapter, no addon required) and
  AI motion/animation generation (`MotionProvider`: cloud — DeepMotion,
  video-driven; **local-first** — a MotionGPT-style adapter, text-driven).
  Also: offline animation retargeting — `generateHumanoidAvatarMapping()`
  (Mixamo/Blender/plain bone-name heuristics -> Mecanim Humanoid slots),
  `generateLocomotionAnimatorController()` (locomotion blend tree + attack
  states + hit-reaction interrupt, as data for Unity's `AnimatorController`
  scripting API), `generateRagdollConfig()` (per-bone joint/collider limits
  using limb-appropriate presets), and `generateRootMotionConfig()`. All
  pure local computation.
- **`packages/level-design`** — deterministic, seeded procedural level
  generation for three themes (gothic cathedral, urban arena, asylum
  hallway): room graph + corridors + thematic decor placement, a NavMesh
  bake-input computer, a horror-tuned lighting-plan generator, and
  `generateProBuilderCommands()` (translates a level layout into graybox
  geometry build commands for a future Unity-side ProBuilder script — see
  UNITY_BRIDGE.md). Pure local computation — no external vendor, no cost.
- **`packages/combat-ai`** — auto-generates a boss's behavior tree (phase
  gating by health threshold, enraged-state cooldown scaling, combo-chain
  sequencing) and combo transition graph from a declarative spec, plus
  hitbox/hurtbox frame-binding and validation (overlap/range checks)
  against an animation clip's frame count. Pure local computation.
- **`packages/audio`** — AI voice synthesis (`VoiceProvider`: cloud —
  ElevenLabs; **local-first** — Kokoro for fast fixed-voice synthesis,
  Coqui XTTS-v2 for zero-shot voice cloning) and ambient
  music/sound-effect generation (`MusicGenerationProvider`: **local-only
  today** — AudioCraft/MusicGen+AudioGen; no cloud vendor wired), plus
  deterministic per-room ambient soundscape generation and a continuous
  layered dynamic-music-intensity mixer.
- **`packages/shader-synthesis`** — HLSL/ShaderLab shader generators
  (atmospheric fog, grime/decal overlay, night-vision post-process — full
  compilable-looking shader text, not just parameters), a typed
  `ShaderGraphSpec` intermediate representation + a distance-based
  grime-blend graph generator (see UNITY_BRIDGE.md for why this targets
  GameForge's own IR rather than Unity's internal `.shadergraph` format
  directly), and a themed post-processing Volume profile generator (bloom/
  vignette/color-grading/fog/film-grain/chromatic-aberration per level
  theme). Pure local computation, no vendor, no GPU needed to generate.

Every vendor-backed provider here follows the exact same shape as
`packages/llm`'s providers: an interface in the package root, one adapter
file per vendor under `providers/`, a `create*Provider()` factory, and
unit tests against a mocked `fetch` (or, for the Blender/ffmpeg CLI-based
adapters, a real-environment availability check with graceful
degradation) — so adding another vendor (Hunyuan3D-2 alongside TripoSR/
TRELLIS, Wonder Dynamics alongside DeepMotion/MotionGPT) means one new file
and one new registry branch, matching [PROVIDERS.md](PROVIDERS.md)'s
pattern.

## Smaller known gaps, not phase-blocking

- OS-keychain-backed API key storage (currently session-only, see SECURITY.md).
- Streaming (`LLMProvider.stream()`) is implemented per-provider but not yet
  wired into the chat UI, which currently uses `generate()`.
- ~~`OllamaProvider` doesn't send image content~~ — **fixed and verified**
  (Game Forge Local Verification Phase 1). `ImagePart` content now maps to
  Ollama's message-level `images: string[]` array (base64, `data:` prefix
  stripped). Unit-tested against a mocked server, and confirmed against a
  real local Ollama 0.32.6 install running `qwen2.5vl:7b`: a real screenshot
  sent through Game Forge's actual `OllamaProvider` produced a correct,
  specific description of the image's contents, in both `generate()` and
  `stream()`. See PROVIDERS.md's "Ollama vision support" section for the
  full results, including the one real limitation found (image + tool
  calling together is rejected by this particular model — an Ollama/model
  capability limit, not a Game Forge bug).
- ~~All 39 tools sent to every provider on every turn regardless of
  session config~~ — **fixed and verified** (Game Forge Local Verification
  Phase 2). `ToolExecutor.getAvailableTools()`
  (`packages/tools/src/tool-scope.ts`) now filters the schema set sent to
  the model down to what the session can actually use — see
  ARCHITECTURE.md's "Agent loop" section. Unit- and agent-level tested (9
  new tests), and confirmed on real hardware: the same Ollama 0.32.6
  install from Phase 1, model `llama3.2:latest` (3.2B — the smallest
  tool-calling model available, deliberately chosen as the harder case),
  driven through Game Forge's real `Agent.run()` loop
  (`scripts/verify-tool-scoping.mjs`) against a real temp project on disk
  with no engine bridge or generation vendor configured. The model was
  handed 21 tools instead of the full 39, correctly chose a real
  file-reading tool (`search_project`, a reasonable alternative to
  `read_file` for a "find X in this file" prompt) on its own, and reported
  back the real value read from a real file, character-for-character
  correct. A small local model reliably using the trimmed set is
  confirmed, not assumed.
- Persisting the operation log to disk (currently in-memory per agent run).
- Generation tool calls block one agent iteration for the whole
  submit-then-poll job duration (bounded by a timeout) rather than exposing
  job polling as a separate tool — simpler for the model, but means a slow
  external job holds up that turn. Revisit if that proves too slow in
  practice.
- The vendor API field names in `packages/assets3d`/`packages/rigging`'s
  cloud adapters (Meshy, Tripo3D, DeepMotion) follow each vendor's publicly
  documented wire format as closely as possible but haven't been
  exercised against a live account/API key in this environment — if a
  vendor's actual response shape differs, the fix is confined to that one
  adapter file, never to the interface or the agent/tool layers above it.
  Similarly, none of the local-first adapters (TripoSR, TRELLIS, Blender,
  MotionGPT, Kokoro, XTTS-v2, AudioCraft) have been run against an actual
  local inference server in this environment (no GPU, no Blender install
  here) — see PROVIDERS.md's "Running local-first" section.
- `packages/vision`'s screenshot-analysis path is wired into the agent loop
  (Phase 10). The ffmpeg static-extraction path and the `LiveFrameBuffer`
  real-time ring buffer are still library-only — nothing currently drives
  them as agent tools, since the agent's own screenshot capture goes
  through `EngineBridge.captureScreenshot()` instead.
- The Unity/Godot engine bridges (Phase 7-9) are unit-tested against fake
  local servers only — neither has been run against a real Unity Editor +
  `unity-mcp` install or a real Godot Editor + bridge plugin, since neither
  engine is installed in this environment. The Unity engine-assembly
  translation layer (`generateProBuilderCommands`, the Animator Controller/
  humanoid-mapping/ragdoll generators, the `ShaderGraphSpec` IR) produces
  data those bridges' `create_object`/`modify_component` calls would need
  to consume on the Unity/Godot side — still unverified against a real
  Editor for the same reason. See UNITY_BRIDGE.md.
- Autonomous-mode per-run filesystem restrictions beyond `WorkspaceGuard`'s
  project-root sandbox (e.g., a per-run directory allowlist) — not built,
  see Phase 11 above.
