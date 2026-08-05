import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { AgentMode, ChatMessage, ProviderSettings, ToolCall } from "@gameforge/shared";
import { createProvider } from "@gameforge/llm";
import { Agent } from "@gameforge/agent";
import { ToolExecutor } from "@gameforge/tools";
import { summarizeProjectContext } from "@gameforge/project";
import type { ProjectManager } from "./project-manager.js";

interface ChatRequest {
  type: "chat";
  projectId: string;
  mode: AgentMode;
  providerSettings: ProviderSettings;
  message: string;
  systemPromptExtra?: string;
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

    const executor = new ToolExecutor(session.guard, (call: ToolCall, reason: string) => {
      const requestId = randomUUID();
      return new Promise<boolean>((resolve) => {
        pendingApprovals.set(requestId, resolve);
        send(socket, { type: "approval_request", requestId, toolCall: call, reason });
      });
    });

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
