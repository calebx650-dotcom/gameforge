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
  /**
   * Opaque, vendor-specific data a provider attached to this tool call that must be echoed
   * back verbatim on the next request for multi-turn tool calling to keep working — e.g.
   * Gemini's OpenAI-compatible endpoint rejects a follow-up turn with a 400 if the assistant
   * tool-call message doesn't repeat the `extra_content.google.thought_signature` it returned
   * (confirmed live 2026-08-11). Providers that don't need this simply never set it; everything
   * outside the provider that produced it treats it as inert passthrough.
   */
  providerData?: unknown;
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
  /**
   * Set for tools that call a metered external service (3D generation,
   * voice synthesis, motion capture, ...). Like a dangerous shell command,
   * these always require human approval regardless of agent mode, because
   * unlike a local file edit they cost real money and can't be undone by
   * reverting a git commit.
   */
  costsMoney?: boolean;
  /**
   * Overrides the default mutating/non-mutating inference (which is just
   * `category !== "read"`). Needed for categories like "git" that mix
   * read-only tools (git_status, git_diff, git_log, git_branch) with a
   * mutating one (git_commit) — without this, every "git" tool would be
   * treated as mutating just because its category isn't literally "read".
   */
  mutating?: boolean;
}

export type PermissionCategory = "read" | "write" | "execution" | "engine" | "git" | "generation";

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

/**
 * Common shape for any pipeline that submits work to an external
 * generative service and polls for a result: 3D mesh generation, PBR
 * texture generation, rigging/motion capture, voice synthesis. Keeping
 * this in shared lets packages/agent and apps/server treat every such
 * pipeline the same way (submit -> poll -> download) without knowing
 * which vendor is behind it.
 */
export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export interface GenerationJob<TResult = unknown> {
  id: string;
  status: GenerationStatus;
  progress?: number;
  result?: TResult;
  error?: string;
}
