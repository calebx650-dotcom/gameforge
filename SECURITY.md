# Security

GameForge treats every model-generated action as potentially unsafe. This
document describes the controls in place today and what's explicitly
deferred to a later phase.

## Threat model

The adversary is not (necessarily) malicious — it's an LLM that can be
confidently wrong, prompt-injected by content it reads from the project, or
simply given an ambiguous instruction. The controls below assume the model
might request anything, at any time, and are designed to bound the blast
radius rather than to trust the model's judgment.

## Workspace restriction

Every filesystem tool (`read_file`, `list_directory`, `search_project`,
`create_file`, `edit_file`, `delete_file`, `create_directory`) goes through
`WorkspaceGuard` (`packages/tools/src/workspace.ts`), which:

- Resolves the requested path against the project root.
- Rejects `..` traversal and absolute paths that land outside the root.
- Resolves symlinks (`resolveReal`) and rejects a real path that escapes the
  root even if the un-resolved path looked fine — this catches a symlink
  planted inside the project that points outside it.

There is currently **no OS-level sandbox** (no container, no chroot, no
seccomp) around `run_command` beyond this path restriction — see "Command
execution" below.

## Permission system / agent modes

`packages/tools/src/permissions.ts` — `decidePermission({ mode, category,
dangerous, costsMoney })`:

| Category                    | ask  | assist  | build | autonomous |
|------------------------------|------|---------|-------|------------|
| read                          | allow | allow   | allow | allow      |
| write / execution / engine / git-mutation / generation (local) | deny | approve | allow | allow      |
| any command matching the dangerous-pattern list | approve | approve | approve | approve |
| any tool marked `costsMoney: true` | approve | approve | approve | approve |

"Approve" means the tool call is suspended and a human must respond before it
runs — in the current UI, an approval card in the chat panel with
Approve/Deny buttons, round-tripped over the same WebSocket as the chat
session. There is no "auto-approve everything" switch; autonomous mode still
requires per-call approval for anything the dangerous-pattern check flags.

## Metered/external generation tools

`generate_3d_model`, `generate_pbr_material`, `auto_rig_model`,
`generate_motion_clip`, `generate_voice_line`, and `generate_ambient_audio`
(`packages/tools/src/generation-tools.ts`) each call a configured vendor —
which may be a paid cloud API (Meshy, Tripo3D, DeepMotion, ElevenLabs) **or**
a free local model you run yourself (TripoSR, TRELLIS, Blender, MotionGPT,
Kokoro, XTTS-v2, AudioCraft — see PROVIDERS.md). Their `ToolDefinition`s set
`costsMoney: true` regardless of which kind of vendor is actually
configured, which — like the dangerous-command check — forces approval in
every mode, `autonomous` included.

This is deliberately not provider-aware: the permission check has no way to
know at approval time whether the session's configured `Text3DProvider` is
a paid API or a local server, so it treats every call to one of these six
tools the same way. The cost of that simplicity is one extra approval click
for a free local generation; the alternative — a permission system that
skips approval for "probably free" providers — risks silently approving a
call that turns out to hit a paid API after all. Unlike a file edit, a paid
generation job can't be undone by reverting a commit once it's been
submitted (the vendor has already billed for it), so this errs toward the
stricter option.

`generate_level_layout`, `generate_boss_combat_design`, `generate_shader`,
`generate_post_processing_profile`, `export_level_geometry`,
`generate_animator_controller`, `generate_humanoid_avatar_mapping`, and
`generate_ragdoll_config` are local, free, pure computation (no network
call, no vendor of any kind) and are treated as ordinary generation tools —
approved automatically in `build`/`autonomous`, same as any other write.

Vendor credentials (cloud API keys; local providers typically need none —
they're just a `baseUrl` pointing at your own machine) are supplied per
chat session (a `generationSettings` field alongside the main LLM's
`providerSettings`) and used only to construct the vendor's provider
instance server-side — they're never included in the tool call arguments
the model sees, the system prompt, or the operation log, the same handling
as the primary LLM's API key described below.

## Engine bridge tools

`packages/tools/src/engine-tools.ts`'s twelve tools go through the exact same
`decidePermission()` path as any other tool, split by mutation:
`inspect_scene`, `inspect_object`, `read_console` are read-only (`mutating:
false`) and always allowed. `create_object`, `modify_object`,
`modify_transform`, `modify_component`, `save_scene`, `enter_play_mode`,
`exit_play_mode`, `build_project`, and `capture_screenshot` are treated as
ordinary writes — denied in `ask`, requiring approval in `assist`, allowed in
`build`/`autonomous`. `capture_screenshot` is mutating only in the sense that
it changes the engine's play-mode/viewport state to grab a frame; it doesn't
touch project files.

The engine bridge's trust boundary is the URL a session configures
(`engineSettings: { engine, url }` on the WebSocket `chat` request) — by
default `http://127.0.0.1:8080` (Unity/`unity-mcp`) or
`ws://127.0.0.1:6401` (Godot), always a local process the user started
themselves, never a remote endpoint GameForge reaches out to on its own.
There is no authentication on that connection beyond "something is listening
on the configured local port" — the same trust level as `run_command`
talking to the local shell. Nothing about the bridge grants the model access
beyond what the connected `unity-mcp`/Godot-plugin process itself exposes.

After a successful `capture_screenshot`, the agent loop splices the actual
returned image into the next model turn (see ARCHITECTURE.md's "Agent loop"
section) — this is a one-way flow (engine state -> model), it does not open
any new write surface.

## Autonomous-mode limits

`Agent.run()`'s `maxWallClockMs` and `maxFileModifications` (Phase 11) bound
how long and how much an unattended `autonomous`-mode run can do before
stopping on its own, independent of the per-call approval gates above.
`apps/server` applies defaults of 30 minutes / 50 file modifications
whenever `mode === "autonomous"`. These are safety backstops, not a
replacement for the mode-gating and dangerous-command checks — a single
tool call inside the budget is still subject to every control described
elsewhere in this document.

## Dangerous command detection

`packages/tools/src/dangerous-commands.ts` is a **heuristic**, not a sandbox:
regex checks for `rm -rf`-style recursive deletes, `sudo`, disk-device
writes, fork bombs, `curl | sh` / `wget | sh` patterns, force-push and
`reset --hard`/`clean -f`, reading well-known secret env vars, and
shutdown/reboot/kill-1. It catches the obvious cases; it is not exhaustive
and should not be treated as a security boundary on its own — combine it with
workspace restriction, timeouts, and human approval.

## Command execution controls

`packages/tools/src/exec-tool.ts` (`run_command`):

- Runs with `cwd` pinned to the project root.
- Enforced timeout, default 30s, hard cap 120s regardless of what the model
  requests — the process is `SIGKILL`ed on timeout.
- Environment variables matching `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, or
  `_CREDENTIALS` (case-insensitive) are stripped before the child process
  spawns, so a compromised or over-eager command can't `env | curl ...` its
  way to the provider API keys the server holds for the current session.
- stdout/stderr are each capped at 50,000 characters before being returned to
  the model, to bound how much can be exfiltrated into the model's context
  (and cost) in one call.

## Secrets / API keys

- API keys are supplied per-request from the UI to `apps/server` and used
  only for the outbound call to that provider; they are never written to the
  operation log, never included in the system prompt, and never passed
  through to `run_command`'s environment (see above).
- **OS-keychain-backed persistent storage** (Keychain on macOS, Credential
  Manager on Windows, Secret Service — with a kernel-keyutils fallback — on
  Linux) is implemented and opt-in: keys stay in-memory/session-only unless
  the user explicitly clicks "Save to OS Keychain" per provider (never
  persisted automatically), and can be removed with "Forget." This is a
  native Tauri capability (`apps/desktop/src-tauri/src/lib.rs`'s
  `keychain_set`/`keychain_get`/`keychain_delete` commands, wrapping the
  `keyring` crate) — it does not exist in the plain browser-tab dev mode,
  which still holds keys in memory only for the session, by design (there's
  no OS keychain a browser tab can reach). See ROADMAP.md's "Smaller known
  gaps" section for what real-hardware verification of this found and fixed.

## Git safety

Before every `build`/`autonomous`-mode agent run, `maybeCreateCheckpoint()`
(`packages/tools/src/git-tools.ts`) auto-commits a dirty working tree with
message `GameForge checkpoint: <first 72 chars of the prompt>` — a no-op if
the tree is already clean or the project isn't a git repo, so it never
creates empty commits or forces git onto a non-git project. This runs
automatically; the agent doesn't decide whether it happens.

The agent's own git tools are split by mutation:
- `git_status`, `git_diff`, `git_log`, `git_branch` are read-only
  (`mutating: false` on their `ToolDefinition`s) and always allowed,
  matching how filesystem reads are always allowed.
- `git_commit` mutates history and is gated like any other write:
  denied in `ask`, requires approval in `assist`, allowed in
  `build`/`autonomous`.

**Restoring a checkpoint (`git reset --hard`) is deliberately not an agent
tool at all.** It's exposed only via a direct REST endpoint
(`POST /projects/:id/git/restore`) that the desktop UI's "Restore" button
calls — there is no path from a model's tool call to a hard reset. This is
the same reasoning as the dangerous-command list: some operations are risky
enough that they shouldn't be one model decision (even an approved one)
away, and a hard reset that discards uncommitted work since the checkpoint
is one of them. The restore endpoint validates the given hash actually
resolves to a real commit in the repo before running (`InvalidCommitReferenceError`
on a malformed or nonexistent reference) — not a substitute for the
approval gate above, just protection against restoring to a typo'd hash.

## Local model execution (Blender CLI, local HTTP inference servers)

`BlenderAutoRigProvider` (`packages/rigging`) shells out to a headless
`blender --background --python ...` invocation — a second, separate code
path from `packages/tools`'s `run_command`, and it does **not** go through
`WorkspaceGuard` or the dangerous-command heuristic, because it isn't
running an arbitrary model-authored shell command; it runs one fixed,
hand-written rigging script against a mesh path the tool call supplies.
The mesh path itself is not currently validated against the project
workspace — a call to `auto_rig_model` with `provider: "blender-auto-rig"`
could in principle point Blender at a file outside the project. Since
`auto_rig_model` already requires human approval on every call (`costsMoney:
true`, see above), the approval prompt is the control that catches this
today; a workspace check on `meshUrl` specifically would be a reasonable
hardening follow-up.

The other local-first providers (TripoSR, TRELLIS, MotionGPT, Kokoro,
XTTS-v2, AudioCraft) only ever make outbound HTTP requests to a
user-configured `baseUrl` — no different in kind from any cloud vendor call,
just typically pointed at `127.0.0.1`. They inherit the same `costsMoney`
approval gate.

## Audit log

Every tool call, its result, and every permission decision is recorded as an
`OperationLogEntry` (`packages/shared`) and streamed to the UI in real time
via the chat WebSocket. It is currently in-memory per agent run, not
persisted to disk — persistence is a natural Phase 2+ addition once
autonomous mode's rollback support is built out.

## Reporting a concern

This is a local, single-user development tool; there is no hosted service or
user data store to report against. If you find a way to escape
`WorkspaceGuard`, bypass the dangerous-command check, or leak a secret
through a tool result, treat it as a real bug in the relevant package listed
above.
