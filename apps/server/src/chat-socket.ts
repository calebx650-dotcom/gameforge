import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { WebSocket } from "ws";
import type { AgentMode, ChatMessage, ContentPart, ProviderSettings, ToolCall } from "@gameforge/shared";
import { createProvider, ModelRouter, type RouterCandidate } from "@gameforge/llm";
import { Agent } from "@gameforge/agent";
import { ToolExecutor, maybeCreateCheckpoint, loadPlugins, type GenerationProviders } from "@gameforge/tools";
import { summarizeProjectContext } from "@gameforge/project";
import { createText3DProvider, createPBRMaterialProvider, type AssetGenerationSettings } from "@gameforge/assets3d";
import { createAutoRigProvider, createMotionProvider, type RiggingSettings } from "@gameforge/rigging";
import { createVoiceProvider, createMusicGenerationProvider, type VoiceSettings } from "@gameforge/audio";
import { createEngineBridge, type EngineBridgeSettings } from "@gameforge/engine-bridge";
import { extractFrames, FfmpegNotAvailableError } from "@gameforge/vision";
import type { ProjectManager } from "./project-manager.js";

/**
 * Per-request settings for whichever generative vendors the user has
 * configured for this session. Every field is optional — an agent tool
 * call that needs a vendor the user hasn't configured fails with a clear
 * "not configured" message rather than the chat request failing outright.
 */
interface GenerationSettings {
  text3d?: AssetGenerationSettings;
  pbr?: AssetGenerationSettings;
  autoRig?: RiggingSettings;
  motion?: RiggingSettings;
  voice?: VoiceSettings;
  music?: VoiceSettings;
}

/**
 * Safety limits applied when mode is "autonomous" — a second, independent
 * lever from the iteration cap (which applies in every mode). Defaults are
 * conservative on purpose; the user can loosen or tighten them per request.
 */
interface AutonomousLimits {
  maxWallClockMs?: number;
  maxFileModifications?: number;
}

const DEFAULT_AUTONOMOUS_MAX_WALL_CLOCK_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_AUTONOMOUS_MAX_FILE_MODIFICATIONS = 50;

interface ChatRequest {
  type: "chat";
  projectId: string;
  mode: AgentMode;
  providerSettings: ProviderSettings;
  /**
   * Optional ordered list of backup providers/models to fall back to if
   * `providerSettings` (or an earlier fallback) errors out before producing
   * any output — see `@gameforge/llm`'s `ModelRouter`. Omit for the
   * existing single-provider behavior (no router involved at all). Each
   * candidate's cost tier is inferred automatically (`ollama` is treated as
   * free/local, everything else as a metered paid API), which the router
   * uses to try free candidates first among whichever ones actually support
   * this request's requirements.
   */
  fallbackProviderSettings?: ProviderSettings[];
  message: string;
  /**
   * Reference images the user is attaching to this message — a screenshot
   * of a UI they want matched, a photo of a level layout, concept art for
   * an asset. Base64 data, no `data:` prefix, alongside its real MIME type.
   * Combined with `message` into the same `ContentPart[]` shape
   * `capture_screenshot`'s vision splice already produces (P0), so this
   * reaches any vision-capable provider through the exact same path — no
   * new provider-side code needed. A provider that doesn't support vision
   * still gets the text; the image is simply invisible to it, the same as
   * any other multimodal content it can't use. Omit for a plain text-only
   * message (the existing behavior, unchanged).
   */
  images?: Array<{ data: string; mimeType: string }>;
  /**
   * A short reference video (gameplay clip, a recorded bug repro, motion
   * reference) to guide this message. Base64 data, no `data:` prefix,
   * alongside its real MIME type (e.g. `video/mp4`). Unlike a live engine
   * screenshot or a still reference image, a video can't go to a vision
   * provider as-is — it's sampled down to a small, bounded set of frames
   * (see `extractReferenceVideoFrames` below) via the same ffmpeg-based
   * extraction `packages/vision` already uses for post-hoc capture
   * analysis, and those frames are spliced into the message as ordinary
   * `ContentPart` images through the exact same path reference images use.
   * Requires ffmpeg on PATH; if it's missing, extraction is skipped with a
   * clear log entry rather than failing the whole chat request — the text
   * message still goes through.
   */
  referenceVideo?: { data: string; mimeType: string };
  systemPromptExtra?: string;
  generationSettings?: GenerationSettings;
  engineSettings?: EngineBridgeSettings;
  autonomousLimits?: AutonomousLimits;
  /**
   * Opt in to streaming the assistant's text as it's generated (`stream_delta`
   * WS messages) instead of only receiving the final `result` once the whole
   * run finishes. Defaults to false so existing non-streaming clients (and
   * fake test servers that only implement a non-streaming response) are
   * unaffected.
   */
  stream?: boolean;
  /**
   * Hard cap on think/act cycles for this run, passed through to
   * `Agent.run()`. Defaults to `Agent`'s own default (10) normally, but to
   * `DEFAULT_ENGINE_MAX_ITERATIONS` when an engine bridge is configured —
   * a real edit/recompile/read-console/fix loop against a game engine
   * routinely needs more turns than a plain file-editing request, and 10
   * was tuned for the latter, not the former.
   */
  maxIterations?: number;
}

const DEFAULT_ENGINE_MAX_ITERATIONS = 25;

/** Timestamp-prefixed so RunLogStore.listRuns()'s lexicographic sort is also chronological order. */
function generateRunId(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Plain text (the existing, unchanged shape) when there are no attached
 * images; a `ContentPart[]` array — text first, then each image — when
 * there are. Keeping the plain-string path for the common no-image case
 * means every existing fake test server/client that only ever sent a
 * string keeps working untouched.
 */
function buildInitialUserContent(
  message: string,
  images: Array<{ data: string; mimeType: string }> | undefined,
  videoFrames: ContentPart[] = [],
): string | ContentPart[] {
  const imageParts: ContentPart[] = [
    ...(images ?? []).map((img): ContentPart => ({ type: "image", data: img.data, mimeType: img.mimeType })),
    ...videoFrames,
  ];
  if (!imageParts.length) return message;
  return [{ type: "text", text: message }, ...imageParts];
}

const REFERENCE_VIDEO_SAMPLE_FPS = 1;
const REFERENCE_VIDEO_MAX_FRAMES = 5;

function videoFileExtensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("quicktime") || mimeType.includes("mov")) return ".mov";
  return ".mp4";
}

/**
 * Samples a short reference video down to a small, bounded set of PNG
 * frames (1 fps, 5 frames max — enough to judge composition/motion intent
 * without ballooning the prompt) and returns them as ordinary image
 * `ContentPart`s, ready to splice alongside a chat message. Writes the
 * incoming base64 payload to a real temp file because `extractFrames`
 * shells out to ffmpeg, which needs a real file path, not an in-memory
 * buffer; the temp file (and its containing directory) is always cleaned
 * up, success or failure.
 *
 * Degrades gracefully rather than failing the request: if ffmpeg isn't on
 * PATH, or extraction otherwise fails, this returns no frames plus a clear
 * `errorMessage` for the caller to log — the text portion of the message
 * still reaches the model, matching how a provider that can't use vision
 * content still gets the text (see `images` above).
 */
async function extractReferenceVideoFrames(video: { data: string; mimeType: string }): Promise<{ frames: ContentPart[]; errorMessage?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gf-refvideo-"));
  const videoPath = join(dir, `input${videoFileExtensionFor(video.mimeType)}`);
  try {
    await writeFile(videoPath, Buffer.from(video.data, "base64"));
    const extracted = await extractFrames(videoPath, { fps: REFERENCE_VIDEO_SAMPLE_FPS, maxFrames: REFERENCE_VIDEO_MAX_FRAMES });
    return { frames: extracted.map((frame): ContentPart => ({ type: "image", data: frame.base64Png, mimeType: "image/png" })) };
  } catch (err) {
    const message =
      err instanceof FfmpegNotAvailableError ? err.message : `Failed to extract frames from reference video: ${(err as Error).message}`;
    return { frames: [], errorMessage: message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Builds live provider instances for whichever generation vendors the
 * request configured. Failures building one vendor (bad provider id,
 * missing key) don't block the others — they just mean that specific
 * tool call will fail with a clear error when the agent tries to use it.
 */
function buildGenerationProviders(settings: GenerationSettings | undefined): GenerationProviders {
  if (!settings) return {};
  const providers: GenerationProviders = {};
  try {
    if (settings.text3d) providers.text3d = createText3DProvider(settings.text3d);
  } catch {
    /* left unconfigured; the tool call itself will report the missing provider */
  }
  try {
    if (settings.pbr) providers.pbr = createPBRMaterialProvider(settings.pbr);
  } catch {
    /* left unconfigured */
  }
  try {
    if (settings.autoRig) providers.autoRig = createAutoRigProvider(settings.autoRig);
  } catch {
    /* left unconfigured */
  }
  try {
    if (settings.motion) providers.motion = createMotionProvider(settings.motion);
  } catch {
    /* left unconfigured */
  }
  try {
    if (settings.voice) providers.voice = createVoiceProvider(settings.voice);
  } catch {
    /* left unconfigured */
  }
  try {
    if (settings.music) providers.music = createMusicGenerationProvider(settings.music);
  } catch {
    /* left unconfigured */
  }
  return providers;
}

/** `ollama` runs against a local endpoint the user already has, regardless of how many requests they make; every other provider here is a metered cloud API. */
function inferCostTier(providerId: string): "free" | "paid" {
  return providerId === "ollama" ? "free" : "paid";
}

/**
 * Builds a `ModelRouter` from an ordered candidate list (primary first,
 * then fallbacks) and surfaces its routing decisions into the same
 * `log`-message stream `Agent.onLogEntry` already sends, so a fallback is
 * visible in the Tool Activity panel exactly like any other thing that
 * happened during the run, not a silent behind-the-scenes swap.
 */
function buildRouter(settingsList: ProviderSettings[], socket: WebSocket): ModelRouter {
  const candidates: RouterCandidate[] = settingsList.map((settings) => ({ settings, costTier: inferCostTier(settings.provider) }));
  return new ModelRouter({
    candidates,
    onRoute: (event) => {
      const summary =
        event.attempt === 1
          ? `Routing to ${event.providerId}/${event.model}.`
          : `Falling back to ${event.providerId}/${event.model} (attempt ${event.attempt}) after: ${event.fallbackReason ?? "previous candidate failed"}`;
      send(socket, { type: "log", entry: { timestamp: Date.now(), kind: event.attempt === 1 ? "message" : "error", summary } });
    },
  });
}

interface ApprovalResponse {
  type: "approval_response";
  requestId: string;
  approved: boolean;
}

type CancelRequest = { type: "cancel" };
type ClientMessage = ChatRequest | ApprovalResponse | CancelRequest;

const SYSTEM_PROMPT_BASE = `You are GameForge, an AI pair-programmer embedded in a game-development workstation.
You have tools to read, search, create, edit, and delete files within the current project, and to run shell commands.
inspect_dependencies looks up which files a given file imports and which files import it, from a real import graph —
use it before changing a shared file to see what else might be affected, instead of guessing or grepping by hand.
It's TypeScript/JavaScript only (real relative-import resolution); it returns empty results for other languages like
C#, where that information genuinely isn't available this way — that's not a bug, don't retry it expecting a fix.
You also have tools for generative game-content pipelines: 3D model generation, PBR texture generation, auto-rigging,
AI motion/animation generation, AI voice synthesis, and ambient audio/music generation. Each of these can be backed
by either a cloud vendor (Meshy, Tripo3D, DeepMotion, ElevenLabs) or a local-first, run-it-yourself model (TripoSR,
TRELLIS, Blender auto-rig, MotionGPT, Kokoro, Coqui XTTS-v2, AudioCraft) depending on what the user configured this
session — you don't need to know or care which; the tool call is identical either way. These vendor-backed tools
always cost money or GPU time and always require human approval before running, regardless of mode — never assume
one was approved implicitly.
You also have purely local, free tools that need no vendor at all: procedural level layout, boss combat design
(behavior tree + combo graph), ProBuilder graybox geometry export, Unity Animator Controller / humanoid avatar
mapping / ragdoll config generation, and HLSL shader / post-processing profile synthesis.
You have git tools: git_status, git_diff, git_log, and git_branch are read-only and always available; git_commit
modifies history and is gated by mode like any other write. If the project is a git repository and in build or
autonomous mode, a checkpoint commit is made automatically before you start working, so the user can always recover
the pre-change state — you don't need to create that checkpoint yourself, but you may use git_commit to save your
own progress at meaningful points.
If an engine bridge is configured for this session (Unity or Godot), you have engine tools: inspect_scene,
inspect_object, and read_console are read-only; create_object, modify_object, modify_transform, modify_component,
save_scene, enter_play_mode, exit_play_mode, and build_project modify the engine and are gated by mode like any
other write. capture_screenshot is read-only, and whatever it captures is shown to you directly as an image in your
next turn — use it to visually verify a change instead of guessing whether it worked. If no engine bridge is
configured, engine tool calls fail with a clear message; don't keep retrying them.
build_project forces the engine to recompile and reports whether the result has compiler errors — it is the fast
"did my last edit actually compile" check, not a full distributable player build; call it after every meaningful
script edit, not just once at the end. When implementing a code change against a connected engine, follow this
loop: (1) inspect the project/scene and read the relevant existing scripts before writing anything, so you match
the project's real structure instead of assuming one; (2) make your edit; (3) call build_project; (4) if it reports
errors, read them carefully, fix the specific reported problem (don't rewrite unrelated code), and call
build_project again; (5) repeat step 4 up to about 5 times total — if it's still failing after that, stop, explain
exactly what's failing and why, and ask the user rather than continuing to guess blindly; (6) once it compiles
clean, if the change is testable at runtime, use enter_play_mode and read_console (and capture_screenshot if useful)
to check for runtime errors before reporting success, then exit_play_mode. Never report a feature as working from
compiling alone — "no compiler errors" and "the feature actually works" are different claims; only make the second
one if you've actually checked at runtime.
run_tests runs the project's real automated test suite (or a filtered subset) and waits for the result — use it if
the project has tests relevant to your change, in addition to (not instead of) the build/play-mode check above. It
blocks until the run settles, up to 5 minutes, so only call it when you actually want to wait for that. Currently
gives a real result on Unity only.
In autonomous mode, this run is bounded by a wall-clock time limit and a cap on how many files you may modify,
in addition to the iteration limit that applies in every mode — if you hit either, the run stops automatically so
the user can check in, and that is expected behavior, not a failure to explain away.
You have set_plan, set_requirements, and update_requirement_status for tracking non-trivial work — internal
bookkeeping only, never gated by mode. For anything more than a one-step request: call set_requirements early with
the discrete, individually checkable things the user actually asked for (a request for "a stamina bar that drains on
sprint and regenerates" is at least three separate requirements — the UI bar, the drain behavior, the regen behavior
— not one). Optionally call set_plan with your ordered approach. Before telling the user the task is done, call
update_requirement_status for each requirement — "met" only if you actually verified it (read the result, ran it,
checked the console), "unmet" if you've confirmed it's NOT satisfied, and leave it "pending" rather than guessing if
you genuinely didn't check. A requirement marked "met" is a claim someone may rely on without re-checking your work
themselves — treat it that way. Skip all of this for a genuinely trivial one-step request; it's not worth the
overhead of tracking "read this one file." Note: marking a requirement "met" is refused with an error if no
read/build/test/console/play-mode tool call has happened since you created it — go actually check, then try again;
this isn't a bug, it's catching exactly the "declared done without checking" mistake this whole system exists to
prevent.
You have delegate_subtask (build/autonomous mode only) to spawn a focused sub-agent for a genuinely separable piece
of work — it shares your real project and tools, cannot delegate further itself, and gets a short iteration budget
(default 5, max 8), so give it a clear, self-contained task rather than something needing back-and-forth. Most tasks
don't need this — reach for it only when a piece of work is truly independent (e.g. "investigate why the build is
failing" while you keep working on something else), not as a default way to make progress.
Stay within the project workspace. Explain what you changed and why. Ask before doing anything destructive.`;

/**
 * Wires one WebSocket connection to one Agent run at a time. Tool
 * approval requests round-trip over the same socket (approval_request /
 * approval_response) so the UI's tool-activity panel and the actual
 * execution stay in lockstep instead of the server guessing.
 */
export function handleChatConnection(socket: WebSocket, projects: ProjectManager): void {
  const pendingApprovals = new Map<string, (approved: boolean) => void>();
  let activeAbortController: AbortController | undefined;

  socket.on("message", async (raw) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Malformed JSON message" });
      return;
    }

    if (parsed.type === "approval_response") {
      const resolve = pendingApprovals.get(parsed.requestId);
      if (resolve) {
        resolve(parsed.approved);
        pendingApprovals.delete(parsed.requestId);
      }
      return;
    }

    if (parsed.type === "cancel") {
      activeAbortController?.abort();
      return;
    }

    if (parsed.type === "chat") {
      // Confirmed live 2026-08-10: an unhandled error here (e.g. maybeCreateCheckpoint
      // throwing on a real git failure) is an unhandled promise rejection from this
      // WebSocket "message" listener — Node doesn't route that to any try/catch, and
      // crashed the *entire* server process, killing every connected client's session,
      // not just this one request. A single bad tool call shouldn't take the whole
      // server down.
      try {
        await runChat(parsed);
      } catch (err) {
        send(socket, { type: "error", message: `Chat run failed: ${(err as Error).message}` });
      }
    }
  });

  async function runChat(request: ChatRequest): Promise<void> {
    const session = projects.get(request.projectId);
    if (!session) {
      send(socket, { type: "error", message: `Unknown project: ${request.projectId}` });
      return;
    }

    activeAbortController = new AbortController();
    const runId = generateRunId();
    // Persists each log entry in order without blocking the live WS send that
    // happens alongside it — but awaited once, right before reporting the run
    // as done (below), so the on-disk log is genuinely complete by then, not
    // a fire-and-forget best-effort that might still be mid-write.
    let logWriteQueue: Promise<void> = Promise.resolve();

    const checkpoint = await maybeCreateCheckpoint(session.guard, request.mode, request.message.slice(0, 72));
    if (checkpoint.created) {
      send(socket, {
        type: "log",
        entry: { timestamp: Date.now(), kind: "message", summary: `Checkpoint committed (${checkpoint.hash?.slice(0, 8)}) before this run.` },
      });
    }

    let engineBridge;
    try {
      engineBridge = request.engineSettings ? createEngineBridge(request.engineSettings, activeAbortController.signal) : undefined;
    } catch (err) {
      send(socket, { type: "log", entry: { timestamp: Date.now(), kind: "error", summary: `Engine bridge not configured: ${(err as Error).message}` } });
    }

    // Loaded fresh per request (cheap for the handful of files a project realistically
    // has) rather than cached, so an edited plugin is picked up on the next message
    // without restarting the server. See plugin-loader.ts for the file shape and the
    // real security posture (full process privileges, same trust level as run_command).
    const { plugins, errors: pluginErrors } = await loadPlugins(join(session.guard.root, ".gameforge", "plugins"));
    for (const error of pluginErrors) {
      send(socket, { type: "log", entry: { timestamp: Date.now(), kind: "error", summary: `Plugin failed to load (${error.filePath}): ${error.message}` } });
    }

    const executor = new ToolExecutor(
      session.guard,
      (call: ToolCall, reason: string) => {
        const requestId = randomUUID();
        return new Promise<boolean>((resolve) => {
          pendingApprovals.set(requestId, resolve);
          send(socket, { type: "approval_request", requestId, toolCall: call, reason });
        });
      },
      buildGenerationProviders(request.generationSettings),
      engineBridge,
      plugins,
    );

    let provider;
    try {
      provider = request.fallbackProviderSettings?.length
        ? buildRouter([request.providerSettings, ...request.fallbackProviderSettings], socket)
        : createProvider(request.providerSettings);
    } catch (err) {
      send(socket, { type: "error", message: (err as Error).message });
      return;
    }

    const systemPrompt = [SYSTEM_PROMPT_BASE, "", "PROJECT CONTEXT:", memoryAndProjectSummary(session), request.systemPromptExtra]
      .filter(Boolean)
      .join("\n");

    const autonomousLimits =
      request.mode === "autonomous"
        ? {
            maxWallClockMs: request.autonomousLimits?.maxWallClockMs ?? DEFAULT_AUTONOMOUS_MAX_WALL_CLOCK_MS,
            maxFileModifications: request.autonomousLimits?.maxFileModifications ?? DEFAULT_AUTONOMOUS_MAX_FILE_MODIFICATIONS,
          }
        : {};
    const maxIterations = request.maxIterations ?? (request.engineSettings ? DEFAULT_ENGINE_MAX_ITERATIONS : undefined);

    const agent = new Agent({
      provider,
      model: request.providerSettings.model,
      systemPrompt,
      executor,
      mode: request.mode,
      temperature: request.providerSettings.temperature,
      maxOutputTokens: request.providerSettings.maxOutputTokens,
      signal: activeAbortController.signal,
      onLogEntry: (entry) => {
        send(socket, { type: "log", entry });
        // Queued, not fire-and-forget: chained onto the prior write so entries land in
        // order and are guaranteed flushed once logWriteQueue is awaited below, while
        // still never blocking the live WS send above. One JSONL file per run under
        // .gameforge/logs/ — see run-log-store.ts.
        logWriteQueue = logWriteQueue.then(() => session.runLogs.append(runId, entry)).catch(() => {});
      },
      ...(request.stream ? { onTextDelta: (delta: string) => send(socket, { type: "stream_delta", text: delta }) } : {}),
      ...(maxIterations != null ? { maxIterations } : {}),
      ...autonomousLimits,
    });

    let referenceVideoFrames: ContentPart[] = [];
    if (request.referenceVideo) {
      const { frames, errorMessage } = await extractReferenceVideoFrames(request.referenceVideo);
      referenceVideoFrames = frames;
      if (errorMessage) {
        send(socket, { type: "log", entry: { timestamp: Date.now(), kind: "error", summary: `Reference video frame extraction skipped: ${errorMessage}` } });
      }
    }

    const conversation: ChatMessage[] = [
      { role: "user", content: buildInitialUserContent(request.message, request.images, referenceVideoFrames) },
    ];

    try {
      const result = await agent.run(conversation);
      session.memory.recordRun({
        requestSummary: request.message.slice(0, 200),
        stoppedReason: result.stoppedReason,
        iterations: result.iterations,
        requirementsSummary: summarizeRequirements(result.taskPlan.requirements),
      });
      await logWriteQueue;
      send(socket, { type: "result", runId, ...result });
    } catch (err) {
      await logWriteQueue;
      send(socket, { type: "error", message: (err as Error).message });
    }
  }
}

function memoryAndProjectSummary(session: ReturnType<ProjectManager["get"]>): string {
  if (!session) return "";
  return [
    summarizeProjectContext(session.context),
    "",
    "PROJECT MEMORY:",
    session.memory.summarize(),
    "",
    "RECENT RUN HISTORY (what you or a prior run already tried on this project — check before repeating work):",
    session.memory.summarizeRunHistory(),
  ].join("\n");
}

/** "2 met, 1 unmet, 3 pending" — omitted entirely (not "0 met, 0 unmet, 0 pending") when the run never used the planning tools, since that's a materially different fact from "used them and nothing was resolved yet." */
function summarizeRequirements(requirements: { status: string }[]): string | undefined {
  if (requirements.length === 0) return undefined;
  const counts = { met: 0, unmet: 0, pending: 0 } as Record<string, number>;
  for (const r of requirements) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return `${counts.met} met, ${counts.unmet} unmet, ${counts.pending} pending`;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
