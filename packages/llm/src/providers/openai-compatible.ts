import { ProviderError } from "@gameforge/shared";
import type { ChatMessage, ContentPart, GenerateChunk, GenerateOptions, ModelInfo, ToolCall } from "@gameforge/shared";
import type { GenerateResult, LLMProvider, ProviderConfig } from "../provider.js";

/**
 * Covers any vendor that speaks the OpenAI chat-completions wire format:
 * OpenAI itself, OpenRouter, and most self-hosted OpenAI-compatible servers.
 * Only `baseUrl` (and sometimes extra headers) differ between them.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsVision: boolean;
  readonly supportsTools = true;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(
    config: ProviderConfig & { id?: string; displayName?: string; extraHeaders?: Record<string, string>; supportsVision?: boolean } = {},
  ) {
    this.id = config.id ?? "openai-compatible";
    this.displayName = config.displayName ?? "OpenAI-compatible";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.extraHeaders = config.extraHeaders ?? {};
    this.supportsVision = config.supportsVision ?? true;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetch("/models");
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => ({ id: m.id, label: m.id, supportsTools: true }));
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const body = this.buildBody(options, false);
    const res = await this.fetch("/chat/completions", { method: "POST", body: JSON.stringify(body) });
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: OpenAIToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices[0];
    const toolCalls = this.extractToolCalls(choice.message.tool_calls);
    return {
      message: { role: "assistant", content: choice.message.content ?? "", toolCalls },
      toolCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const body = this.buildBody(options, true);
    const res = await this.fetch("/chat/completions", { method: "POST", body: JSON.stringify(body), signal: options.signal });
    if (!res.body) throw new ProviderError(`${this.displayName} returned no stream body`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pendingToolCalls: Record<number, { id: string; name: string; arguments: string; extraContent?: unknown }> = {};

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          yield { done: true };
          continue;
        }
        const chunk = JSON.parse(payload) as {
          choices: Array<{
            delta: {
              content?: string;
              tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }>;
            };
            finish_reason?: string | null;
          }>;
        };
        const delta = chunk.choices[0]?.delta;
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls[tc.index] ?? { id: tc.id ?? `${tc.index}`, name: "", arguments: "" };
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            if (tc.extra_content !== undefined) existing.extraContent = tc.extra_content;
            pendingToolCalls[tc.index] = existing;
          }
        }
        const finished = chunk.choices[0]?.finish_reason;
        const hasPendingToolCalls = Object.keys(pendingToolCalls).length > 0;
        yield {
          textDelta: delta?.content || undefined,
          // Vendors disagree on what finish_reason accompanies a tool call: OpenAI/OpenRouter
          // send "tool_calls", but Gemini's OpenAI-compatible endpoint sends "stop" even when
          // the response was purely tool calls (confirmed live against a real Gemini API key,
          // 2026-08-11) — gating strictly on "tool_calls" silently dropped every accumulated
          // tool call for Gemini, since generate() has no such gate and worked fine; only
          // stream() had this bug. Finalizing on any terminal chunk that has accumulated tool
          // call deltas covers both vendors' conventions.
          toolCalls: finished != null && hasPendingToolCalls ? this.finalizeToolCalls(pendingToolCalls) : undefined,
          done: finished != null,
        };
      }
    }
  }

  private finalizeToolCalls(pending: Record<number, { id: string; name: string; arguments: string; extraContent?: unknown }>): ToolCall[] {
    return Object.values(pending).map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: safeParseJson(tc.arguments),
      ...(tc.extraContent !== undefined ? { providerData: tc.extraContent } : {}),
    }));
  }

  private extractToolCalls(raw?: OpenAIToolCall[]): ToolCall[] {
    if (!raw) return [];
    return raw.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
      ...(tc.extra_content !== undefined ? { providerData: tc.extra_content } : {}),
    }));
  }

  private buildBody(options: GenerateOptions, stream: boolean) {
    return {
      model: options.model,
      messages: options.messages.map(toOpenAIMessage),
      stream,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
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
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          ...this.extraHeaders,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach ${this.displayName}: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`${this.displayName} request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
  extra_content?: unknown;
}

function toOpenAIMessage(m: ChatMessage) {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: typeof m.content === "string" ? m.content : "" };
  }
  return {
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map(toOpenAIContentPart),
    ...(m.toolCalls?.length
      ? {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            // Echoed back verbatim when present — see ToolCall.providerData's doc comment
            // (@gameforge/shared) for why: Gemini's OpenAI-compatible endpoint 400s a
            // multi-turn tool-calling request that omits the thought_signature it originally
            // attached to this same tool call. A no-op for vendors (OpenAI, OpenRouter) that
            // never set providerData in the first place.
            ...(tc.providerData !== undefined ? { extra_content: tc.providerData } : {}),
          })),
        }
      : {}),
  };
}

function toOpenAIContentPart(p: ContentPart) {
  if (p.type === "text") return { type: "text", text: p.text };
  return { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } };
}

function safeParseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}
