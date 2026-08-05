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
- [ ] **Phase 7** — Unity `GameForgeBridge` (see [UNITY_BRIDGE.md](UNITY_BRIDGE.md)
      for the planned design — not yet implemented).
- [ ] **Phase 8** — Unity inspection/control (scene/object/component tools).
- [ ] **Phase 9** — Build/run/test loop (Unity build triggers, editor play
      mode control).
- [~] **Phase 10** — Screenshot capture + vision analysis. Multimodal
      `ContentPart` plumbing already exists in `packages/shared` and is
      wired into the OpenAI-compatible and Anthropic providers. The video
      half of this phase has been pulled forward and built as
      **`packages/vision`**: ffmpeg-based frame extraction (with a clear
      error and graceful degradation when ffmpeg isn't installed), a
      `LiveFrameBuffer` in-memory ring buffer for real-time frame streaming
      (drop-oldest backpressure, zero disk writes — the practical
      local-first substitute for true Spout2/NDI GPU-memory sharing, which
      needs a native Unity-side plugin out of scope here), objective
      frame-pacing/jitter metrics, a multi-frame vision-analysis prompt
      builder (`buildVideoAnalysisMessage`) covering motion
      smoothness/pacing/jitter/combo-timing, and a `runBacktest` comparator
      for regression-testing gameplay feel against a stored baseline. What's
      still missing: an actual capture *source* — there's no Unity bridge
      yet to record gameplay from, so `packages/vision` is a tested,
      ready-to-wire library, not yet an agent tool (see UNITY_BRIDGE.md).
- [~] **Phase 11** — Autonomous development loop. Iteration cap and
      cancellation (`AbortSignal`) were already in place; rollback now has
      its foundation via Phase 5's checkpoint commits and the restore
      endpoint. Still missing: max command execution *time* and filesystem
      restrictions beyond the current per-command timeout and
      `WorkspaceGuard` root restriction (i.e., finer-grained limits within
      a single autonomous run, not just at the tool-call level).

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
- `OllamaProvider` doesn't yet send image content in chat messages (text-only
  today); the other two providers do.
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
- `packages/vision`'s video pipeline (both the ffmpeg static-extraction
  path and the `LiveFrameBuffer` real-time path) isn't wired into the agent
  as a tool yet — see Phase 10 above.
- The Unity engine-assembly translation layer (`generateProBuilderCommands`,
  the Animator Controller/humanoid-mapping/ragdoll generators, the
  `ShaderGraphSpec` IR) produces data a Unity-side script would consume —
  none of it has been run against an actual Unity Editor, since there is no
  Unity install in this environment. See UNITY_BRIDGE.md's adoption of
  `unity-mcp` as the concrete bridge protocol.
