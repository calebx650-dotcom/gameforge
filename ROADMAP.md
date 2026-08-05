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
- [ ] **Phase 10** — Screenshot capture + vision analysis (multimodal
      `ContentPart` plumbing already exists in `packages/shared` and is
      wired into the OpenAI-compatible and Anthropic providers; the capture
      side depends on Phase 7-9).
- [ ] **Phase 11** — Autonomous development loop (iteration/time/filesystem
      limits beyond the current iteration cap; cancellation is implemented
      via `AbortSignal`; rollback support depends on Phase 5's checkpoints).

## Smaller known gaps, not phase-blocking

- OS-keychain-backed API key storage (currently session-only, see SECURITY.md).
- Streaming (`LLMProvider.stream()`) is implemented per-provider but not yet
  wired into the chat UI, which currently uses `generate()`.
- `OllamaProvider` doesn't yet send image content in chat messages (text-only
  today); the other two providers do.
- Persisting the operation log to disk (currently in-memory per agent run).
