import type { AgentMode, ModelInfo, OperationLogEntry, ProviderSettings, ToolCall } from "@gameforge/shared";

const SERVER_HTTP = "http://localhost:4310";
const SERVER_WS = "ws://localhost:4310/ws/chat";

export interface ProjectSummary {
  id: string;
  root: string;
  contextSummary: string;
  memory: Array<{ id: number; category: string; content: string }>;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_HTTP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function openProject(path: string): Promise<ProjectSummary> {
  return jsonFetch("/api/projects", { method: "POST", body: JSON.stringify({ path }) });
}

export function listModels(settings: Pick<ProviderSettings, "provider" | "baseUrl" | "apiKey">): Promise<ModelInfo[]> {
  return jsonFetch("/api/providers/models", { method: "POST", body: JSON.stringify(settings) });
}

export interface ChatSocketCallbacks {
  onLog: (entry: OperationLogEntry) => void;
  onApprovalRequest: (requestId: string, toolCall: ToolCall, reason: string) => void;
  onResult: (result: { stoppedReason: string; iterations: number; finalText: string }) => void;
  onError: (message: string) => void;
  onOpen?: () => void;
}

export class ChatSocket {
  private socket: WebSocket;

  constructor(private readonly callbacks: ChatSocketCallbacks) {
    this.socket = new WebSocket(SERVER_WS);
    this.socket.onopen = () => this.callbacks.onOpen?.();
    this.socket.onmessage = (event) => this.handleMessage(event.data);
    this.socket.onerror = () => this.callbacks.onError("WebSocket connection error");
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.type === "log") this.callbacks.onLog(msg.entry);
    else if (msg.type === "approval_request") this.callbacks.onApprovalRequest(msg.requestId, msg.toolCall, msg.reason);
    else if (msg.type === "result") {
      const finalMessage = msg.messages[msg.messages.length - 1];
      const finalText = typeof finalMessage?.content === "string" ? finalMessage.content : "";
      this.callbacks.onResult({ stoppedReason: msg.stoppedReason, iterations: msg.iterations, finalText });
    } else if (msg.type === "error") this.callbacks.onError(msg.message);
  }

  sendChat(input: { projectId: string; mode: AgentMode; providerSettings: ProviderSettings; message: string }): void {
    this.socket.send(JSON.stringify({ type: "chat", ...input }));
  }

  respondApproval(requestId: string, approved: boolean): void {
    this.socket.send(JSON.stringify({ type: "approval_response", requestId, approved }));
  }

  cancel(): void {
    this.socket.send(JSON.stringify({ type: "cancel" }));
  }

  close(): void {
    this.socket.close();
  }
}
