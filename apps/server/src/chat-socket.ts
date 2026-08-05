import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { AgentMode, ChatMessage, ProviderSettings, ToolCall } from "@gameforge/shared";
import { createProvider } from "@gameforge/llm";
import { Agent } from "@gameforge/agent";
import { ToolExecutor, maybeCreateCheckpoint, type GenerationProviders } from "@gameforge/tools";
import { summarizeProjectContext } from "@gameforge/project";
import { createText3DProvider, createPBRMaterialProvider, type AssetGenerationSettings } from "@gameforge/assets3d";
import { createAutoRigProvider, createMotionProvider, type RiggingSettings } from "@gameforge/rigging";
import { createVoiceProvider, createMusicGenerationProvider, type VoiceSettings } from "@gameforge/audio";
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

interface ChatRequest {
  type: "chat";
  projectId: string;
  mode: AgentMode;
  providerSettings: ProviderSettings;
  message: string;
  systemPromptExtra?: string;
  generationSettings?: GenerationSettings;
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

interface ApprovalResponse {
  type: "approval_response";
  requestId: string;
  approved: boolean;
}

type CancelRequest = { type: "cancel" };
type ClientMessage = ChatRequest | ApprovalResponse | CancelRequest;

const SYSTEM_PROMPT_BASE = `You are GameForge, an AI pair-programmer embedded in a game-development workstation.
You have tools to read, search, create, edit, and delete files within the current project, and to run shell commands.
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
      await runChat(parsed);
    }
  });

  async function runChat(request: ChatRequest): Promise<void> {
    const session = projects.get(request.projectId);
    if (!session) {
      send(socket, { type: "error", message: `Unknown project: ${request.projectId}` });
      return;
    }

    activeAbortController = new AbortController();

    const checkpoint = await maybeCreateCheckpoint(session.guard, request.mode, request.message.slice(0, 72));
    if (checkpoint.created) {
      send(socket, {
        type: "log",
        entry: { timestamp: Date.now(), kind: "message", summary: `Checkpoint committed (${checkpoint.hash?.slice(0, 8)}) before this run.` },
      });
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
    );

    let provider;
    try {
      provider = createProvider(request.providerSettings);
    } catch (err) {
      send(socket, { type: "error", message: (err as Error).message });
      return;
    }

    const systemPrompt = [SYSTEM_PROMPT_BASE, "", "PROJECT CONTEXT:", memoryAndProjectSummary(session), request.systemPromptExtra]
      .filter(Boolean)
      .join("\n");

    const agent = new Agent({
      provider,
      model: request.providerSettings.model,
      systemPrompt,
      executor,
      mode: request.mode,
      temperature: request.providerSettings.temperature,
      maxOutputTokens: request.providerSettings.maxOutputTokens,
      signal: activeAbortController.signal,
      onLogEntry: (entry) => send(socket, { type: "log", entry }),
    });

    const conversation: ChatMessage[] = [{ role: "user", content: request.message }];

    try {
      const result = await agent.run(conversation);
      send(socket, { type: "result", ...result });
    } catch (err) {
      send(socket, { type: "error", message: (err as Error).message });
    }
  }
}

function memoryAndProjectSummary(session: ReturnType<ProjectManager["get"]>): string {
  if (!session) return "";
  return [summarizeProjectContext(session.context), "", "PROJECT MEMORY:", session.memory.summarize()].join("\n");
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}
