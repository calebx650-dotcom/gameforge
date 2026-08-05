// Shared, dependency-free types used across all GameForge packages.
// Keeping these in one place is what lets the LLM provider, tools, and
// agent packages evolve independently without importing each other's internals.

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  /** base64-encoded image data, no data: prefix */
  data: string;
  mimeType: string;
}

export type ContentPart = TextPart | ImagePart;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface ChatMessage {
  role: Role;
  content: ContentPart[] | string;
  /** present on assistant messages that request tool execution */
  toolCalls?: ToolCall[];
  /** present on role: "tool" messages */
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: PermissionCategory;
  /** JSON Schema for the tool's arguments */
  parameters: Record<string, unknown>;
}

export type PermissionCategory = "read" | "write" | "execution" | "engine" | "git";

export type AgentMode = "ask" | "assist" | "build" | "autonomous";

export interface UsageInfo {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelInfo {
  id: string;
  label?: string;
  contextWindow?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export interface ProviderSettings {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "off" | "low" | "medium" | "high";
}

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateChunk {
  /** incremental assistant text, if any, for this chunk */
  textDelta?: string;
  /** emitted once, when the model finishes requesting tool calls */
  toolCalls?: ToolCall[];
  /** emitted on the final chunk */
  done?: boolean;
  usage?: UsageInfo;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface OperationLogEntry {
  timestamp: number;
  kind: "tool_call" | "tool_result" | "message" | "approval" | "error";
  summary: string;
  detail?: unknown;
}
