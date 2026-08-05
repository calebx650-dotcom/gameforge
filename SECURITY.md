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
`generate_motion_clip`, and `generate_voice_line` (`packages/tools/src/generation-tools.ts`)
each call an external, paid vendor (Meshy, Tripo3D, DeepMotion, ElevenLabs,
or a generic OpenAI-compatible image endpoint). Their `ToolDefinition`s set
`costsMoney: true`, which — like the dangerous-command check — forces
approval in every mode, `autonomous` included. Unlike a file edit, a
generation job can't be undone by reverting a commit once it's been
submitted (the vendor has already billed for it), so this is treated as a
harder gate than ordinary mutation, not merely mode-gated.

`generate_level_layout` and `generate_boss_combat_design` are local, free,
pure computation (no network call) and are treated as ordinary generation
tools — approved automatically in `build`/`autonomous`, same as any other
write.

Vendor credentials for these tools are supplied per chat session (a
`generationSettings` field alongside the main LLM's `providerSettings`) and
used only to construct the vendor's provider instance server-side —
they're never included in the tool call arguments the model sees, the
system prompt, or the operation log, the same handling as the primary
LLM's API key described below.

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
- **Not yet implemented**: OS-keychain-backed persistent storage (Keychain
  on macOS, Credential Manager on Windows, Secret Service on Linux). Today
  the desktop UI holds keys in memory for the session; nothing persists them
  to disk. This is called out explicitly rather than left ambiguous — do not
  assume keys survive a restart yet.

## Git safety

Not yet implemented in this phase: automatic pre-modification checkpoint
commits, diff/revert UI, and checkpoint restore. The project scanner does
report git status (branch, dirty file count) so the agent's system prompt at
least reflects whether there's uncommitted work before it starts. See
[ROADMAP.md](ROADMAP.md).

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
