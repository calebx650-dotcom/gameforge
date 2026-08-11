# Roadmap

Game Forge's roadmap is organized by outcome tier, not build order: each
tier is a capability the product needs, and lower tiers are dependencies
for the ones above them. Don't invest in a higher tier while a lower one
still has open gaps — P0 came first because nothing else matters if the
one real demo doesn't work; P1/P1.5 come next because reliability and
model flexibility are load-bearing for everything built on top of them.

Status legend: **Done** (real code, real tests, and where the environment
allows it, live-verified against real hardware) · **Partial** (real code
exists but doesn't cover the whole item) · **Not started**.

For the detailed, dated build history behind every "Done"/"Partial" claim
below — what was built in which phase, what bugs were found live and how —
see [Appendix: build history by phase](#appendix-build-history-by-phase).
That history isn't being thrown away, just moved out of the way of the
current plan.

## P0 — Real end-to-end proof

**Status: Done**, pending final live confirmation on real hardware
(in progress — see the buildProject entry in the appendix for the fix,
and the live Unity/Ollama session for the demo run itself).

- [x] Unity MCP — real transport (MCP Streamable HTTP), real tool names,
      real response shapes. `packages/engine-bridge/src/unity-bridge.ts` +
      `mcp-client.ts`.
- [x] Natural language → implementation — the agent loop reads real
      project files and writes real edits via `create_file`/`edit_file`.
- [x] Build — `buildProject()` now calls `refresh_unity` (fast recompile
      check) + `read_console`, the real tool pair, not the nonexistent
      `manage_editor`/`"build"` pair it used to call.
- [x] Play Mode — `enter_play_mode`/`exit_play_mode` tools exist and are
      unit-tested; genuinely entering Play Mode and checking runtime
      behavior for a specific feature (sprint/stamina) is the one leg of
      this tier not yet confirmed live.
- [x] Screenshot/console feedback — `capture_screenshot` splices the real
      image into the agent's next turn (Phase 10); `read_console` unwraps
      the real `unity-mcp` response envelope.
- [x] Automatic repair — the build/fix loop (edit → build_project → read
      errors → fix → rebuild, capped ~5 attempts) is real system-prompt
      guidance plus a raised iteration budget when an engine bridge is
      configured, proven end-to-end against a fake server in
      `apps/server/src/e2e.test.ts`.

## P1 — Reliability

**Status: Done.**

- [x] Checkpoints — `maybeCreateCheckpoint()` auto-commits a dirty working
      tree before every build/autonomous run.
- [x] Rollback — a direct REST restore endpoint (`git reset --hard` to a
      checkpoint), deliberately not exposed as an agent tool.
- [x] Error recovery — covered for the build/fix loop specifically (P0's
      "Automatic repair"); general-purpose recovery for other tool
      failures is whatever `Agent.run()`'s normal error-message-back-to-
      the-model path provides, not a dedicated subsystem.
- [x] MCP recovery — `McpHttpClient.request()` now detects a stale session
      (a real MCP server 404s an unrecognized `Mcp-Session-Id`) or a dropped
      connection mid-call, forgets the session, re-runs `initialize`, and
      replays the exact call once — bounded to a single retry so a
      genuinely broken server still fails loudly. Unit-tested (3 new cases
      in `mcp-client.test.ts`); not yet exercised against a real Unity
      Editor's session actually expiring. See UNITY_BRIDGE.md.
- [x] Task cancellation — the gap was real: `Agent.run()` only checked its
      `AbortSignal` between iterations, so cancelling mid-tool-call (a slow
      `run_command`, an in-flight engine-bridge HTTP request) previously had
      to be waited out. The signal now threads all the way into the tool
      layer: `ToolExecutor.execute()` takes it and forwards it to
      `run_command` (kills the process immediately instead of waiting for
      its own up-to-120s timeout) and to `McpHttpClient`/`GodotWsClient`
      (aborts the in-flight HTTP/WebSocket call immediately, without
      triggering the MCP-recovery retry above — a deliberate cancellation
      isn't a fault to recover from). Finding this out required actually
      writing a "does abort really kill a sleeping command" test, which
      surfaced a second, independent real bug: killing a `shell: true`
      child alone doesn't reliably terminate it, because a shell that
      *forks* rather than exec-replaces itself for a command leaves the
      real process running and holding the output pipe open, so `close`
      never fires — fixed by spawning detached and killing the whole
      process group (`process.kill(-pid, "SIGKILL")` on POSIX; Windows
      falls back to killing just the immediate child, untested there).
      That fix also applies to the pre-existing timeout path, not just the
      new cancellation path — a genuine `run_command` bug this work
      happened to uncover. Real regression tests for both: a sleeping
      command that's genuinely killed on its own timeout, and one killed
      immediately on abort rather than running to completion, exercised
      through the real `ToolExecutor` and the real `Agent.run()` loop.
- [x] Failure handling — `stoppedReason` gained `"repeated_failures"`:
      `Agent.run()` now tracks *consecutive* tool-call errors (reset by any
      success) and stops once `maxConsecutiveToolFailures` (default 3) is
      hit, instead of burning the entire iteration budget retrying the same
      broken tool call one failure at a time — a misconfigured engine
      bridge or a vendor that's down previously looked identical to
      `max_iterations` in the result, now it's distinguishable and stops
      faster. Unit-tested: a run that hits the guard after exactly 3
      consecutive failures, and one where an occasional failure sits
      between two successes and correctly does *not* trip it.

## P1.5 — Model orchestration

**Status: Done.** A session can still pick exactly one provider/model
manually (unchanged, default behavior); it can now also hand the router an
ordered candidate list and let it pick and fall back automatically.

- [x] Model router — `packages/llm/src/router.ts`'s `ModelRouter`
      implements `LLMProvider` itself, so `Agent` (or anything else that
      only knows the `LLMProvider` interface) uses one with zero code
      changes — it has no idea routing is happening underneath. Provider
      instances for each candidate are constructed lazily and cached, so a
      router configured with several candidates doesn't eagerly stand up
      connections to ones a given request never needs.
- [x] Codex, Claude, Gemini, OpenRouter, Ollama as interchangeable backends
      — Claude/OpenRouter/Ollama adapters already existed; **Gemini is new**
      (`packages/llm/src/providers/gemini.ts`, against Google's real
      documented Generative Language API — `generateContent`/
      `streamGenerateContent?alt=sse`, `x-goog-api-key` header — following
      the same "coded against the vendor's real documented wire format, not
      exercised against a live account in this environment" pattern as the
      Meshy/Tripo3D/DeepMotion cloud adapters elsewhere in this repo; see
      PROVIDERS.md). "Codex" isn't a separate adapter — OpenAI's Codex
      models are reached through the existing `OpenAICompatibleProvider`
      exactly like any other OpenAI model, so there was nothing new to
      build there.
- [x] Automatic fallback on provider error — `ModelRouter.generate()`/
      `stream()` try each eligible candidate in order and fall back to the
      next on failure, *except* mid-stream after a candidate has already
      yielded real output to the caller (switching backends at that point
      could duplicate or corrupt what the caller already consumed — that
      case propagates the error instead of silently rerouting). Unit-tested
      (12 cases in `router.test.ts`): success on the first try, fallback on
      failure, fallback mid-stream-before-any-output vs. no-fallback-after-
      output, and an aggregate error when every candidate fails. Wired into
      the actual product, not just the library: `ChatRequest` gained an
      optional `fallbackProviderSettings` list
      (`apps/server/src/chat-socket.ts`) — when set, the server builds a
      `ModelRouter` instead of a single provider, and every routing
      decision (including *why* a fallback happened) streams to the client
      as a normal `log` message, visible in the Tool Activity panel like
      anything else that happened during the run. Proven end-to-end in
      `apps/server/src/e2e.test.ts`: a real WebSocket chat request with an
      unreachable primary provider and a working fallback genuinely
      completes via the fallback, with the fallback event visible in the
      log stream.
- [x] Capability/cost-aware routing — a candidate whose provider doesn't
      support vision is skipped for a request with an image; one that
      doesn't support tool calling is skipped for a request with `tools` —
      both are static per-provider facts (`LLMProvider.supportsVision`/
      `supportsTools`), so this needs no network call to decide. Cost-aware
      ordering is a coarse two-tier hint (`"free"` vs `"paid"`) the caller
      attaches per candidate; within the set that satisfies a request's
      capability requirements, free candidates are tried first, with the
      caller's given order as the tiebreaker. `apps/server` infers the tier
      automatically per request (`ollama` = free/local, everything else =
      paid) rather than requiring the client to specify it.

## P2 — Game intelligence

**Status: Partial.**

- [x] Project memory — `packages/memory` (SQLite via `node:sqlite`).
- [x] Project indexing — `packages/project`'s scanner (engine/language/git
      status/docs), basic rather than deep.
- [x] Dependency graph — a real file-level import graph, **TypeScript/
      JavaScript only** by deliberate scope, not oversight
      (`packages/project/src/dependency-graph.ts`). A TS/JS `import`
      names a real relative file path, resolvable on disk (including the
      "`.js` specifier resolves to a real `.ts` file" case TS's own ESM
      output produces, and directory-index imports); C#'s `using` names a
      *namespace*, not a file, so answering "what does this file depend
      on" for C# honestly needs real symbol resolution this file-path
      approach can't do — a non-JS/TS project gets an empty graph back,
      not a fabricated one built from `using` statements. Exposed as a
      new read-only `inspect_dependencies` agent tool (path in, `{dependsOn,
      dependedOnBy}` out) so the model can check "what would this change
      affect" without reading every file by hand. Unit-tested against real
      fixture files on disk (8 cases: resolution, external-package
      exclusion, `require()`, directory-index imports, a dangling import
      correctly dropped rather than fabricated, reverse lookup, node_modules
      never walked, and the empty-graph-for-non-JS/TS case) plus executor-
      level tests proving the tool dispatch and path normalization.
- [x] Context selection — `ToolExecutor.getAvailableTools()`
      (`packages/tools/src/tool-scope.ts`) scopes which *tools* a session
      sees; there's no analogous system for selecting which *project
      files/context* go into a prompt beyond what the model asks for via
      tool calls.
- [x] Task planning / requirement tracking — not an enforced separate
      phase (the agent loop is still turn-by-turn; nothing blocks a run
      that skips this), but the model now has a real, structured place to
      put a plan and a checklist instead of that living only in prose:
      three new always-available tools (`set_plan`, `set_requirements`,
      `update_requirement_status` — `packages/tools/src/planning-tools.ts`'s
      `TaskPlanTracker`, one instance per chat request, owned by
      `ToolExecutor`). `set_requirements` takes the discrete, individually
      checkable things the user actually asked for and assigns each an id;
      `update_requirement_status` marks one `"met"`/`"unmet"`/`"pending"`,
      optionally with a note. `Agent.run()`'s result now includes a
      `taskPlan` snapshot (empty if the model never used these tools —
      nothing requires it to) — the system prompt instructs the model to
      call `set_requirements` early for anything non-trivial, and to only
      mark something `"met"` after actually verifying it, not from
      assuming a change worked. Surfaced in the desktop UI's Final Result
      block as a Plan list and a Requirements checklist with status
      coloring. Unit-tested at the executor level (real state changes,
      the always-allowed-even-in-`ask`-mode permission behavior, the
      "replaces not appends" `set_requirements` semantics, a clear error
      for an unknown requirement id) and at the `Agent.run()` level (a
      full set_plan → set_requirements → verify → update_requirement_status
      sequence ending up in the real result). This is deliberately a
      recording/bookkeeping mechanism, not a full trust mechanism — a
      requirement marked `"met"` is only as reliable as whatever the model
      actually checked before saying so, and nothing here confirms the
      model checked the *right* thing. It does now block the *worst* case
      of that gap — marking something met with zero verification at all —
      see P2.5's "Requirement verification" entry below for the guard.

## P2.5 — Verification

**Status: Done** — every capability exists as a tool, and
`update_requirement_status`'s verification-call guard (below) is the
unifying layer tying "met" claims to something actually having been
checked, even though it stops short of confirming the *right* thing was
checked.

- [x] Compile — `build_project`.
- [x] Run — `enter_play_mode`/`exit_play_mode`.
- [x] Test — a new `run_tests` agent tool, submit-then-poll-internally like
      the generation tools (one blocking call, bounded to 5 minutes, rather
      than exposing raw submit/poll tools the model would have to sequence
      itself). `UnityBridge.runTests()` drives real `mcp-for-unity` tools —
      `run_tests` (submit) and `get_test_job` (poll) — found by reading the
      actual C# source (`Editor/Tools/RunTests.cs`,
      `Editor/Services/TestJobManager.cs`), the same way the `buildProject`
      fix was found; see UNITY_BRIDGE.md for the exact fields confirmed
      this way vs. one field (the per-test `result` payload's exact shape)
      that's inferred by analogy to `read_console`'s confirmed response
      wrapper rather than independently confirmed. `GodotBridge.runTests()`
      defines the matching `editor.run_tests` command on GameForge's own
      protocol, consistent with the rest of that bridge — unverified
      against a real Editor for the same reason every other Godot bridge
      call is. Unit-tested: real argument names, polling multiple times
      before settling (fake timers), a bounded timeout when a job never
      stops running, and both success/failure result shapes.
- [x] Screenshot — `capture_screenshot`, spliced into the model's next turn.
- [x] Console inspection — `read_console`.
- [x] Requirement verification — a real structural guard, not a semantic
      one, and the distinction is documented explicitly rather than
      overclaimed: `TaskPlanTracker.updateRequirementStatus()`
      (`packages/tools/src/planning-tools.ts`) now refuses to mark a
      requirement `"met"` unless at least one verification-shaped tool call
      (`read_file`, `read_console`, `run_tests`, `build_project`,
      `enter_play_mode`, `git_diff`, etc. — a curated allowlist) happened
      *since that requirement was created* — `ToolExecutor` reports every
      successful dispatch to the tracker for this. This catches "declared
      met with zero checking" for free, a real and common failure mode —
      it does **not** confirm the model checked the *right* thing, only
      that it checked *something*; a full independent re-check (a second
      model call, or a deterministic assertion tied to the specific
      requirement) is a different, harder problem this doesn't solve.
      `"unmet"`/`"pending"` are never gated — claiming a problem or leaving
      something unverified are never the risky direction. Unit-tested:
      blocks a bare "met" with no prior verification, allows it once a
      real verification call happened, correctly does *not* count a
      verification call made *before* the requirement existed, never gates
      `"unmet"`/`"pending"`, and doesn't count a *failed* tool call as
      verification.

## P3 — Creation

**Status: Done, breadth-wise** (per-package verification status varies —
see the appendix). Six generative packages exist, each with a cloud vendor
and a local-first option behind the same interface:

- [x] 3D assets — `packages/assets3d` (Meshy/Tripo3D cloud;
      TripoSR/TRELLIS local).
- [x] Animation/rigging — `packages/rigging` (Meshy/DeepMotion cloud;
      Blender/MotionGPT local; plus offline retargeting/Animator
      Controller/ragdoll generators).
- [x] Audio — `packages/audio` (ElevenLabs cloud; Kokoro/XTTS-v2/AudioCraft
      local).
- [x] Images — the vendor-agnostic PBR material path in `packages/assets3d`.
- [x] Reference-image input — deliberately scoped to still images, not
      video (see below for why that's a separate item, not an unfinished
      part of this one). `ChatRequest.images` (`apps/server/src/
      chat-socket.ts`) lets a chat request carry reference images
      (screenshot of a target UI, concept art, a level-layout photo)
      alongside the text message; the server combines them into the same
      `ContentPart[]` shape `capture_screenshot`'s existing vision splice
      (P0) already produces, so it reaches any vision-capable provider
      through the exact path already proven to work — no new provider-side
      code needed. The desktop UI gained a basic attach-image control
      (file picker, preview thumbnail, cleared after sending). Proven
      end-to-end in `apps/server/src/e2e.test.ts`: a real WebSocket chat
      request with an attached image lands in GameForge's own message
      history *and* is confirmed forwarded onto the real Ollama wire
      request body (`OllamaProvider`'s `images` array mapping).
- [ ] Video reference input — genuinely out of scope for now, not a small
      remainder of the item above: a real video pipeline needs frame
      extraction/sampling and a decision about how many/which frames reach
      a vision model's context window, a materially different (and
      heavier) engineering problem than "attach one image." `packages/
      vision`'s existing ffmpeg-based extraction is the natural foundation
      for this if it's built later, but wiring it into chat input hasn't
      been started.
- [x] Multimodal workflows — narrower than it used to be: multimodal
      *input* exists in two real forms (a captured engine screenshot
      spliced in automatically, P0; a user-attached reference image,
      above), both landing through the identical `ContentPart[]` path —
      this is a genuine input pipeline now, not just "the model can see a
      screenshot." A general document/multi-file/video multimodal
      pipeline beyond images is not built (see the video item above).

## P3.5 — Autonomous development

**Status: Done.**

- [x] Multi-step tasks — the agent loop is inherently multi-step within a
      single run.
- [x] Agent memory — the real gap was exactly the one identified: `packages/
      memory`'s existing `MemoryStore` held project facts, never what the
      agent itself had tried across separate runs. It now also records run
      *history*: `MemoryStore.recordRun()` (new `run_history` SQLite table,
      same per-project database) logs each run's request summary, real
      `stoppedReason`, iteration count, and a derived requirements summary
      (`"2 met, 1 unmet, 0 pending"`, omitted entirely — not shown as
      zeroes — when a run never used the planning tools). `apps/server/src/
      chat-socket.ts` calls this once per chat request right after
      `agent.run()` settles, and splices `summarizeRunHistory()`'s
      chronological summary into every future system prompt for that
      project, right below the existing project-memory summary, so a new
      run can see what a prior one already tried instead of repeating it
      blind. Unit-tested (`store.test.ts`): real id/timestamp on record,
      most-recent-first ordering, chronological summary text, and the
      empty-history case. Proven end-to-end in `apps/server/src/
      e2e.test.ts`: two real sequential chat requests against the same
      project over real WebSocket connections — the first run's system
      prompt correctly shows no history yet, the second run's system
      prompt genuinely contains the first run's real recorded request and
      outcome, captured from the actual wire request sent to the fake
      Ollama server, not just asserted against local state.
- [x] Long-running jobs — autonomous mode's wall-clock timeout and
      file-modification cap (Phase 11).
- [x] Human approval — the mode-gated permission system, required for
      every mutating/costs-money tool call.
- [x] Multi-agent orchestration — a real, deliberately minimal primitive,
      not the full space of possible orchestration patterns: a new
      `delegate_subtask` tool (`packages/agent/src/agent.ts`) lets an
      agent spawn a genuinely independent nested `Agent` for one focused
      task and get its final response back as the tool result. The
      sub-agent shares the parent's real provider/model/executor/mode —
      it operates on the actual project through the same permission-gated
      tools, not a sandbox — but gets its own short iteration budget
      (default 5, hard-capped at 8 regardless of what's requested) and
      `allowDelegation: false`, so recursion is bounded at exactly one
      level rather than needing a depth counter threaded through
      everything. Requires `build`/`autonomous` mode — `ask`/`assist` get
      a clear denial, since there's no way to route a mid-delegation
      approval prompt back through this path (only `ToolExecutor`'s
      approval callback can do that, and delegation bypasses
      `ToolExecutor` for the delegation call itself since only `Agent` has
      the provider/model access needed to construct a sub-agent).
      Sub-agent activity streams into the parent's own log, prefixed
      `[sub-agent]`, so it's visible in the Tool Activity panel like
      anything else. **Known, documented limitation**: a sub-agent's file
      modifications count toward its own cap, not the parent's
      `maxFileModifications` budget — real shared-state plumbing would be
      needed to fix that if delegation becomes a primary way work gets
      done, not just an occasional escape hatch for separable work.
      Unit-tested: a real sub-agent spawned, run to completion, and its
      result returned to the parent; the mode restriction; the tools list
      correctly not offering delegation to a sub-agent, plus a defense-in-
      depth check proving a forced nested call is refused even if
      requested anyway; and the iteration-budget cap actually holding at 8
      even when 100 was requested.

## P4 — Production

**Status: Partial.**

- [x] Security — `WorkspaceGuard` project-root sandboxing, mode-gated
      permissions, `costsMoney` gating on every vendor call. See
      SECURITY.md.
- [x] Reliability — see P1 above, now Done.
- [x] Performance — not a profiler (a real one is a bigger, separate
      undertaking this doesn't claim to be), but two real, concrete things
      that didn't exist before: **real timing instrumentation**, and
      **budgets already enforced in code, now cataloged in one place**.

      `Agent.run()`'s result gains a `timing` field
      (`packages/agent/src/agent.ts`) — real `startedAt`/`endedAt`/
      `wallClockMs` for the whole run, and `perToolCall`, keyed by tool
      name, accumulating real `callCount`/`totalMs`/`errorCount` across
      every call to that tool in the run (so `totalMs / callCount` is a
      real per-call average, not an estimate). This is wall-clock
      measurement at points the loop already visits, not sampling
      profiling — it tells you *which tool* was slow, not *why*.
      Unit-tested: real positive timestamps, `wallClockMs` matching the
      timestamp delta exactly, and per-tool stats accumulating correctly
      across multiple calls to the same tool including a mix of success
      and error.

      Every numeric bound already enforced somewhere in this codebase,
      gathered into one list rather than left scattered as implicit facts
      only findable by reading source:
      - `run_command`: 30s default timeout, 120s hard max
        (`packages/tools/src/exec-tool.ts`).
      - `Agent.run()`: 10 iterations default, 25 when an engine bridge is
        configured (`apps/server/src/chat-socket.ts`); autonomous mode
        additionally bounds wall-clock (30 min default) and file
        modifications (50 default); 3 consecutive tool failures before
        stopping (P1, above); `delegate_subtask` sub-agents get 5
        iterations by default, 8 as a hard ceiling (P3.5, above).
      - Generation vendor jobs (3D/PBR/rigging/motion/voice/music):
        2-minute default poll timeout, 2s poll interval
        (`packages/tools/src/generation-tools.ts`).
      - `UnityBridge.runTests()`: 5-minute poll bound, 2s poll interval
        (P2.5, above) — genuinely longer than the generation-job bound,
        since a real test suite can legitimately take longer than a
        generation API call.
      - `McpHttpClient`: a single retry on a stale/dropped MCP session
        (P1 MCP recovery, above) — no explicit request timeout beyond
        that; relies on the underlying Node `fetch`/OS-level behavior.
      - `GodotWsClient`: 10s default per-command timeout as a standalone
        client; `GodotBridge` raises this to 5 minutes for the whole
        client so `runTests()` isn't cut short by every other command's
        much shorter budget (P2.5, above).

      None of these numbers changed as part of this entry — this is
      documentation of real existing behavior plus new real
      instrumentation to observe it, not new tuning. Actual profiling
      (where does wall-clock time really go under realistic load) needs a
      live environment with a real Unity Editor/Ollama install this
      sandbox doesn't have — see the live-verification caveats throughout
      this document.
- [x] Logging — `RunLogStore` (`apps/server/src/run-log-store.ts`) persists
      every run's `OperationLogEntry` stream to `.gameforge/logs/
      <runId>.jsonl`, one file per run, one JSON entry per line so a
      partial write (crash mid-run) still leaves every prior line
      readable. `chat-socket.ts`'s `onLogEntry` hook queues each entry
      onto the same per-request write chain that already streams it to
      the client over the socket — queued, not truly fire-and-forget:
      writes are chained in order and the whole chain is awaited once,
      right before the run reports itself done, so the on-disk log is
      genuinely complete by the time a caller could go looking for it.
      **A real bug this caught, not a hypothetical**: the first version
      really was fire-and-forget (`.append(...).catch(() => {})`, nothing
      awaited), and the first attempt at an end-to-end test — reading the
      log file immediately after receiving the "run done" message — hit a
      real `ENOENT`, proving the file wasn't reliably written yet by the
      time the client was told the run was finished. Read access: two new
      REST endpoints (`GET /projects/:id/runs`, `GET /projects/:id/runs/
      :runId`), and the `result` WS message now includes the real `runId`
      so a client can look a run up later. Unit-tested (`run-log-store.
      test.ts`): append/read-back ordering, separate files per run, an
      unrecorded run reading back empty rather than throwing, listing.
      Proven end-to-end: a real chat run over a real WebSocket connection,
      reading the actual file back off disk afterward (not just through
      the API) and confirming the API and the raw file agree.
- [ ] Installer — Tauri build verified on Linux only (Phase 5); macOS/
      Windows packaging unexercised.
- [x] Documentation — README/ARCHITECTURE/SECURITY/PROVIDERS/
      UNITY_BRIDGE.md/this file, kept current as of each real change.
- [ ] Plugin architecture — **not built.**
- [ ] Release — no release process exists yet.

---

## Appendix: build history by phase

The phase-by-phase build order and every live-verification finding
(real bugs found on real hardware, exact test evidence) that the
tier statuses above summarize. Kept for provenance — this is where the
receipts are.

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
      proving the abstraction isn't secretly Unity-shaped. Test rigor
      differs by layer, corrected here after Game Forge Local Verification
      Phase 4 audited the original (overstated) claim: `GodotBridge`'s own
      package-level tests (`packages/engine-bridge/src/godot-bridge.test.ts`)
      spin up a real `ws` `WebSocketServer`; `UnityBridge`/`McpHttpClient`'s
      package-level tests (`mcp-client.test.ts`, `unity-bridge.test.ts`) only
      mock `fetch` directly. The one place `UnityBridge` is actually
      exercised against a real HTTP JSON-RPC responder is the capstone test
      in `apps/server/src/e2e.test.ts`, which spins up a real
      `http.createServer` standing in for `unity-mcp`. Neither bridge has
      been run against a real Unity Editor + `unity-mcp` install or a real
      Godot Editor + bridge plugin, since neither engine is installed in
      this environment. The Godot-side EditorPlugin and any future Unity C#
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
      the same `EngineBridge`. `UnityBridge.buildProject()`'s mapping onto
      real `unity-mcp` tools was wrong at the design level until the
      Working Demo Sprint fixed it — see the "buildProject" entry below and
      UNITY_BRIDGE.md for the finding.
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

### Generative content pipelines (pulled forward from later phases)

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

### Smaller known gaps, not phase-blocking

- ~~OS-keychain-backed API key storage~~ — **implemented and real-verified**
  (Game Forge Local Verification Phase 5). Three new Tauri commands
  (`keychain_set`/`keychain_get`/`keychain_delete`,
  `apps/desktop/src-tauri/src/lib.rs`) wrap the `keyring` crate — macOS
  Keychain, Windows Credential Manager, Linux Secret Service, selected via
  real per-platform Cargo feature flags (`apple-native` /
  `windows-native` / `linux-native-sync-persistent` — `keyring` 3.x ships
  with **zero** default backend features, confirmed live: without an
  explicit choice, `set_password()` silently no-ops instead of erroring, a
  real bug caught by the Rust-level test before it ever reached the UI).
  `apps/desktop/src/keychain.ts` wraps the three commands for the
  frontend, a no-op outside the native Tauri window (so the plain
  browser-tab dev mode is unaffected) via `"__TAURI_INTERNALS__" in
  window` detection. The Provider panel gained "Save to OS Keychain" /
  "Forget" buttons, keyed per-provider (`llm:${provider}`), and loads a
  saved key automatically when switching providers.

  Real, live-driven verification (not just `cargo test`): the actual
  compiled Tauri binary was launched under a virtual display and driven
  with `xdotool` clicks/keystrokes — typing a key, clicking Save, watching
  it read back correctly after switching providers away and back (proving
  real OS-level persistence, not just React state), and clicking Forget
  and confirming it's genuinely gone. Two real bugs were caught and fixed
  by this process, not by inspection: (1) the missing default-features bug
  above, and (2) the frontend's error handler assumed `invoke()` rejects
  with an `Error` instance — it actually rejects with the plain string a
  Rust `Result<T, String>` command returns, so `(err as Error).message`
  was silently `undefined` on every failure until fixed.

  One more real finding, Linux-specific: under a genuine X11 `DISPLAY`
  (unlike a plain `cargo test` process), libdbus's autolaunch mechanism
  activates and tries spawning `dbus-launch` to find a Secret Service
  provider — which fails hard in this sandbox's incomplete headless setup
  (no GNOME Keyring/KWallet running) instead of gracefully degrading.
  Added an explicit Linux-only fallback: if the default (Secret
  Service-preferring) entry fails, retry with an explicitly-constructed
  kernel-keyutils-backed entry (session-scoped, not disk-persistent
  across reboots, but still genuine OS-level secure storage, not
  plaintext) — confirmed live to make Save/Get/Delete all succeed in this
  environment. On a real desktop Linux session with a running keyring
  daemon, the primary Secret Service path is expected to just work and
  the fallback never triggers; that combination (real desktop, real
  daemon) hasn't been tested here. macOS/Windows use their single native
  backend with no such fallback needed — untested on those platforms
  (this sandbox is Linux-only), but Windows Credential Manager in
  particular has none of Linux's D-Bus-autolaunch complexity, so it's the
  most likely of the three to "just work" without surprises.
- ~~The Tauri shell is scaffolded but not build-verified~~ — **fixed and
  verified** (Game Forge Local Verification Phase 5), with two real
  scaffold bugs found and fixed along the way:
  - `apps/desktop/src-tauri/icons/` was completely empty — nobody had ever
    run `tauri icon`. Tauri's `generate_context!()` macro hard-requires
    `icon.png` to exist regardless of `tauri.conf.json`'s (empty)
    `bundle.icon` list, so the build failed immediately. Fixed by
    generating a full icon set (`tauri icon <source.png>`) and committing
    it, and by populating `bundle.icon` with the real generated paths
    (leaving it empty additionally broke AppImage bundling specifically,
    which panics without a square icon to use).
  - Real build environment: Rust/Cargo were already present in this
    sandbox (contradicting earlier docs that claimed otherwise — corrected),
    but the Linux webview dev headers were not (`libwebkit2gtk-4.1-dev`,
    `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`,
    `libxdo-dev`, `libssl-dev`, `patchelf` — Tauri's documented Linux
    prerequisites). Installing them let `npx tauri build` complete for
    real, producing a genuine native ELF binary plus installable
    `.deb`/`.rpm`/`.AppImage` packages (confirmed with `file`/`dpkg-deb
    --info`, not just "the command exited 0"). The binary was then
    actually launched under a virtual X display (`Xvfb`) and a screenshot
    confirmed it renders the real Game Forge UI as a native window — the
    Project/Provider/Agent Mode/Engine Bridge panels, not a blank or
    crashed window.
  - **Still unverified**: macOS and Windows builds (this sandbox is
    Linux-only) — the Rust/Tauri code itself is cross-platform and the
    fixes above (icons, `bundle.icon`) apply universally, but the actual
    `.dmg`/`.msi`/`.exe` build path on those OSes has not been exercised.
- ~~Streaming implemented per-provider but not wired into the chat UI~~ —
  **fixed and verified** (Game Forge Local Verification Phase 5).
  `Agent` gains an optional `onTextDelta` callback (`packages/agent/src/
  agent.ts`): when set, each iteration calls `provider.stream()` instead of
  `generate()` and accumulates the chunks into the same result shape, so
  the rest of the loop (tool dispatch, message history, safety limits) is
  unchanged either way — fully backward-compatible, opt-in per request.
  `chat-socket.ts`'s `ChatRequest` gained `stream?: boolean` (default off,
  so existing non-streaming clients and fake test servers are unaffected);
  when set, incremental text streams to the client as `stream_delta`
  WebSocket messages. `apps/desktop` sends `stream: true` and renders a
  live-updating bubble as text arrives, replaced by the final message on
  completion. Verified two ways: a new `apps/server/src/e2e.test.ts` case
  drives the real WebSocket protocol against a fake Ollama server speaking
  real NDJSON streaming chunks (not a single JSON blob), and a real headless
  Chromium browser session against the real dev server confirmed the UI
  genuinely shows partial text before the final result arrives, not just a
  spinner-then-pop.
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
- ~~`UnityBridge.buildProject()` called a tool/action pair
  (`manage_editor`, `action: "build"`) that doesn't exist in real
  `mcp-for-unity`~~ — **found and fixed** (Working Demo Sprint), while
  building the autonomous edit/build/fix repair loop the demo needs.
  Reading the actual server source (`Editor/Tools/ManageBuild.cs`,
  `Editor/Tools/RefreshUnity.cs`) showed the real picture: `manage_build`
  is a separate tool that triggers a full distributable player build via
  `BuildPipeline.BuildPlayer` — async/pollable, up to 30 minutes, the
  wrong shape for "did my last script edit compile." The right tool for
  that is `refresh_unity` (`mode: "force", scope: "scripts", compile:
  "request", wait_for_ready: true`, which blocks until Unity finishes
  recompiling) followed by the already-fixed `read_console`.
  `UnityBridge.buildProject()` now does exactly that and is documented as
  deliberately *not* covering a real player/export build — UNITY_BRIDGE.md
  explains the scope decision and what a future full-build capability
  would still need (the `manage_build` async poll protocol). Unit-tested
  (`unity-bridge.test.ts`, both a clean-console success case and an
  error-reporting failure case) and exercised through the full real stack
  in a new `apps/server/src/e2e.test.ts` case that drives a genuine
  create-file → build_project → error → edit-file → build_project →
  success repair loop end to end against a fake unity-mcp server speaking
  this real protocol, asserting both the exact tool-call sequence and that
  the fixed file content actually lands on disk.

  A live Unity Editor + Ollama session (Working Demo Sprint continuation)
  independently confirmed the real Unity MCP transport still connects and
  found and fixed **seven additional real bugs** while wiring the full
  live loop together — wrong tool names/response shapes, two Windows-
  specific path-comparison bugs, and a server-crash bug. That session was
  interrupted before completing the final live Play Mode check (does
  sprint actually drain/regenerate stamina with a working UI bar) — see
  P0 above for exactly what's confirmed vs. still pending.

  Alongside the buildProject fix: `Agent.run()`'s iteration budget is now
  configurable per chat request (`ChatRequest.maxIterations`,
  `apps/server/src/chat-socket.ts`) and defaults to 25 instead of `Agent`'s
  own default of 10 whenever a session has an engine bridge configured —
  a real edit/recompile/read-console/fix loop routinely needs more turns
  than a plain file-editing request. The agent's system prompt also gained
  explicit build/fix-loop guidance: call `build_project` after every
  meaningful script edit (not just once at the end), read reported errors
  and fix the specific problem rather than rewriting unrelated code, cap
  fix attempts at roughly 5 before stopping to explain and ask rather than
  guessing indefinitely, and never report a feature as "working" from a
  clean compile alone — use `enter_play_mode`/`read_console` to check for
  runtime errors before making that claim.

  The desktop UI's activity panel gained three views derived client-side
  from that same `OperationLogEntry` stream — no server changes needed,
  since `tool_call`/`tool_result` entries already carry the real
  `ToolCall`/`ToolResultMessage` as `detail`
  (`apps/desktop/src/build-status.ts`): a build-status badge in the title
  bar (BUILDING/FAILED/FIXING/SUCCESS, with an attempt counter — "fixing"
  is inferred as a failed attempt followed by more activity before the
  next build, not a status the server reports explicitly), a "Build
  Attempts" list showing each attempt's outcome and reported compiler
  errors, a "Files Changed" list from `create_file`/`edit_file`/
  `delete_file` calls, and a "Final Result" block once the run completes.
  Unit-tested (`build-status.test.ts`) against log entries shaped exactly
  like `Agent.executeAndRecord()`'s real output, mirroring the same
  create → build → fail → fix → build → succeed sequence
  `apps/server/src/e2e.test.ts` drives against a real WebSocket
  connection — proving the derivation reads the real shape, not one
  invented for the test. Compiles clean (`tsc --noEmit && vite build`);
  not yet confirmed rendering correctly in a live browser.
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
  Similarly, most of the local-first adapters (TripoSR, TRELLIS, Blender,
  MotionGPT, XTTS-v2, AudioCraft) have not been run against an actual local
  inference server (no GPU, no Blender install in this sandbox) — see
  PROVIDERS.md's "Running local-first" section, which now also explains
  why they're a different kind of unverified than the cloud adapters (they're
  coded against a wire contract Game Forge invented, not a real server's
  documented API). **Kokoro is the exception** — verified end-to-end against
  a real `kokoro-fastapi-cpu` Docker container in Game Forge Local
  Verification Phase 3: real audio, decoded and played back, confirmed
  correct by a human listener, through both the direct provider path and
  the real `generate_voice_line` tool-dispatch path. See PROVIDERS.md's
  "Kokoro voice — verification status" section.
- `packages/vision`'s screenshot-analysis path is wired into the agent loop
  (Phase 10). The ffmpeg static-extraction path and the `LiveFrameBuffer`
  real-time ring buffer are still library-only — nothing currently drives
  them as agent tools, since the agent's own screenshot capture goes
  through `EngineBridge.captureScreenshot()` instead.
- The Godot engine bridge (Phase 7-9) is unit-tested against a fake local
  server only — it has not been run against a real Godot Editor + bridge
  plugin, since Godot isn't installed in this environment. (The Unity
  bridge's real-hardware status is tracked under P0 above, not here.) The
  Unity engine-assembly translation layer (`generateProBuilderCommands`,
  the Animator Controller/humanoid-mapping/ragdoll generators, the
  `ShaderGraphSpec` IR) produces data those bridges' `create_object`/
  `modify_component` calls would need to consume on the Unity/Godot side —
  still unverified against a real Editor for the same reason. See
  UNITY_BRIDGE.md.
- Autonomous-mode per-run filesystem restrictions beyond `WorkspaceGuard`'s
  project-root sandbox (e.g., a per-run directory allowlist) — not built,
  see Phase 11 above.
