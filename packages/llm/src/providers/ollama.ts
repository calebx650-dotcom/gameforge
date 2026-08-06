import { ProviderError } from "@gameforge/shared";
import type { ChatMessage, ContentPart, GenerateChunk, GenerateOptions, ModelInfo, ToolCall } from "@gameforge/shared";
import type { GenerateResult, LLMProvider, ProviderConfig } from "../provider.js";

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

/** Strips a `data:<mime>;base64,` prefix if present — Ollama's `images` array wants raw base64 only. */
function stripDataUriPrefix(data: string): string {
  const commaIndex = data.indexOf(",");
  return data.startsWith("data:") && commaIndex !== -1 ? data.slice(commaIndex + 1) : data;
}

function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const text = m.content
      .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    const images = m.content
      .filter((p): p is Extract<ContentPart, { type: "image" }> => p.type === "image")
      .map((p) => stripDataUriPrefix(p.data));
    return { role: m.role, content: text, ...(images.length > 0 ? { images } : {}) };
  });
}

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  readonly displayName = "Ollama (local)";
  readonly supportsVision = true;
  readonly supportsTools = true;

  private readonly baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetch("/api/tags");
    const data = (await res.json()) as { models?: Array<{ name: string; details?: { family?: string } }> };
    return (data.models ?? []).map((m) => ({ id: m.name, label: m.name, supportsTools: true }));
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const body = this.buildBody(options, false);
    const res = await this.fetch("/api/chat", { method: "POST", body: JSON.stringify(body) });
    const data = (await res.json()) as {
      message: { content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const toolCalls = this.extractToolCalls(data.message.tool_calls);
    return {
      message: { role: "assistant", content: data.message.content, toolCalls },
      toolCalls,
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) || undefined,
      },
    };
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const body = this.buildBody(options, true);
    const res = await this.fetch("/api/chat", { method: "POST", body: JSON.stringify(body), signal: options.signal });
    if (!res.body) throw new ProviderError("Ollama returned no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as {
          message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const toolCalls = this.extractToolCalls(chunk.message?.tool_calls);
        yield {
          textDelta: chunk.message?.content || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          done: chunk.done,
          usage: chunk.done
            ? { promptTokens: chunk.prompt_eval_count, completionTokens: chunk.eval_count }
            : undefined,
        };
      }
    }
  }

  private extractToolCalls(
    raw?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>,
  ): ToolCall[] {
    if (!raw) return [];
    return raw.map((tc, i) => ({ id: `${Date.now()}-${i}`, name: tc.function.name, arguments: tc.function.arguments }));
  }

  private buildBody(options: GenerateOptions, stream: boolean) {
    return {
      model: options.model,
      messages: toOllamaMessages(options.messages),
      stream,
      options: {
        temperature: options.temperature,
        num_predict: options.maxOutputTokens,
      },
      tools: options.tools?.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach Ollama at ${this.baseUrl}: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Ollama request failed (${res.status}): ${text}`, res.status >= 500);
    }
    return res;
  }
}
