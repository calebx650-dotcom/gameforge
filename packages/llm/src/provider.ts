import type {
  ChatMessage,
  GenerateChunk,
  GenerateOptions,
  ModelInfo,
  ToolCall,
} from "@gameforge/shared";

/**
 * Every LLM vendor is implemented behind this interface. The agent package
 * only ever talks to `LLMProvider` — adding a new vendor means writing one
 * new file in this package, never touching agent/tools/core logic.
 */
export interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;

  /** List models available from this provider/endpoint right now. */
  listModels(): Promise<ModelInfo[]>;

  /** Non-streaming generation. Returns the full assistant message. */
  generate(options: GenerateOptions): Promise<GenerateResult>;

  /** Streaming generation. Yields incremental chunks, ending with done:true. */
  stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown>;
}

export interface GenerateResult {
  message: ChatMessage;
  toolCalls?: ToolCall[];
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}
