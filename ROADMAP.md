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
- [ ] **Phase 5** — Git integration (`git_status`, `git_diff`, `git_log`,
      `git_commit`, `git_branch` as agent tools; pre-modification checkpoint
      commits; diff/revert/restore UI). The project scanner already reports
      git branch + dirty-file count today; the tool layer and checkpoint/
      rollback UX are not built yet.
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
      error and graceful degradation when ffmpeg isn't installed),
      objective frame-pacing/jitter metrics, a multi-frame vision-analysis
      prompt builder (`buildVideoAnalysisMessage`) covering motion
      smoothness/pacing/jitter/combo-timing, and a `runBacktest` comparator
      for regression-testing gameplay feel against a stored baseline. What's
      still missing: an actual capture *source* — there's no Unity bridge
      yet to record gameplay from, so `packages/vision` is a tested,
      ready-to-wire library, not yet an agent tool (see UNITY_BRIDGE.md).
- [ ] **Phase 11** — Autonomous development loop (iteration/time/filesystem
      limits beyond the current iteration cap; cancellation is implemented
      via `AbortSignal`; rollback support depends on Phase 5's checkpoints).

## Generative content pipelines (pulled forward from later phases)

Ahead of the Unity bridge, the following provider-agnostic pipelines were
built following the same interface + adapter pattern as `packages/llm`,
each wired into the agent as a tool gated by the `costsMoney` permission
(external-vendor calls always require human approval, in every mode —
see SECURITY.md):

- **`packages/assets3d`** — text-to-3D generation (`Text3DProvider`:
  Meshy, Tripo3D adapters) and PBR material/texture generation
  (`PBRMaterialProvider`: a dedicated Meshy texture adapter, plus a
  vendor-agnostic fallback that drives any OpenAI-compatible image model
  four times with channel-specific prompts).
- **`packages/rigging`** — auto-rigging (`AutoRigProvider`: Meshy adapter)
  and AI motion/animation generation (`MotionProvider`: DeepMotion adapter,
  video-driven motion capture retargeted to a rig).
- **`packages/level-design`** — deterministic, seeded procedural level
  generation for three themes (gothic cathedral, urban arena, asylum
  hallway): room graph + corridors + thematic decor placement, a NavMesh
  bake-input computer (walkable-surface geometry the future Unity bridge
  would bake against), and a horror-tuned lighting-plan generator. Pure
  local computation — no external vendor, no cost.
- **`packages/combat-ai`** — auto-generates a boss's behavior tree (phase
  gating by health threshold, enraged-state cooldown scaling, combo-chain
  sequencing) and combo transition graph from a declarative spec, plus
  hitbox/hurtbox frame-binding and validation (overlap/range checks)
  against an animation clip's frame count. Pure local computation.
- **`packages/audio`** — AI voice synthesis (`VoiceProvider`: ElevenLabs
  adapter) plus deterministic per-room ambient soundscape generation and a
  continuous layered dynamic-music-intensity mixer (crossfades
  "exploration/tension/combat/climax"-style stems based on a 0-1 intensity
  value instead of hard-cutting tracks).

Every vendor-backed provider here follows the exact same shape as
`packages/llm`'s providers: an interface in the package root, one adapter
file per vendor under `providers/`, a `create*Provider()` factory, and
unit tests against a mocked `fetch` — so adding another vendor (a second
voice provider, Wonder Dynamics alongside DeepMotion, Point-E alongside
Meshy/Tripo3D) means one new file and one new registry branch, matching
[PROVIDERS.md](PROVIDERS.md)'s pattern.

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
  adapters (Meshy, Tripo3D, DeepMotion) follow each vendor's publicly
  documented wire format as closely as possible but haven't been
  exercised against a live account/API key in this environment — if a
  vendor's actual response shape differs, the fix is confined to that one
  adapter file, never to the interface or the agent/tool layers above it.
- `packages/vision`'s video pipeline isn't wired into the agent as a tool
  yet — see Phase 10 above.
