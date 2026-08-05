import { ProviderError } from "@gameforge/shared";
import type { ChatMessage, ContentPart, GenerateChunk, GenerateOptions, ModelInfo, ToolCall } from "@gameforge/shared";
import type { GenerateResult, LLMProvider, ProviderConfig } from "../provider.js";

const KNOWN_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", supportsTools: true, supportsVision: true },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", supportsTools: true, supportsVision: true },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", supportsTools: true, supportsVision: true },
];

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly displayName = "Anthropic";
  readonly supportsVision = true;
  readonly supportsTools = true;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig = {}) {
    if (!config.apiKey) throw new ProviderError("Anthropic provider requires an API key");
    this.baseUrl = (config.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic's model-list endpoint requires org access; fall back to a known set.
    return KNOWN_MODELS;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const body = this.buildBody(options, false);
    const res = await this.fetch("/v1/messages", { method: "POST", body: JSON.stringify(body) });
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const toolCalls = this.extractToolCalls(data.content);
    return {
      message: { role: "assistant", content: text, toolCalls },
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const body = this.buildBody(options, true);
    const res = await this.fetch("/v1/messages", { method: "POST", body: JSON.stringify(body), signal: options.signal });
    if (!res.body) throw new ProviderError("Anthropic returned no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallsInProgress: Record<number, { id: string; name: string; argsJson: string }> = {};

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const event = JSON.parse(line.slice(5).trim()) as AnthropicStreamEvent;

        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          toolCallsInProgress[event.index!] = {
            id: event.content_block.id!,
            name: event.content_block.name!,
            argsJson: "",
          };
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta") {
            yield { textDelta: event.delta.text };
          } else if (event.delta?.type === "input_json_delta") {
            const entry = toolCallsInProgress[event.index!];
            if (entry) entry.argsJson += event.delta.partial_json ?? "";
          }
        } else if (event.type === "message_stop") {
          const toolCalls = Object.values(toolCallsInProgress).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: safeParseJson(tc.argsJson),
          }));
          yield { done: true, toolCalls: toolCalls.length ? toolCalls : undefined };
        }
      }
    }
  }

  private extractToolCalls(blocks: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>): ToolCall[] {
    return blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id!, name: b.name!, arguments: b.input ?? {} }));
  }

  private buildBody(options: GenerateOptions, stream: boolean) {
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const conversation = options.messages.filter((m) => m.role !== "system");
    return {
      model: options.model,
      system: systemMessages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n") || undefined,
      messages: conversation.map(toAnthropicMessage),
      stream,
      max_tokens: options.maxOutputTokens ?? 4096,
      temperature: options.temperature,
      tools: options.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach Anthropic: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Anthropic request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string };
}

function toAnthropicMessage(m: ChatMessage) {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: typeof m.content === "string" ? m.content : "" }],
    };
  }
  return {
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(toAnthropicContentPart),
  };
}

function toAnthropicContentPart(p: ContentPart) {
  if (p.type === "text") return { type: "text", text: p.text };
  return { type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } };
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
