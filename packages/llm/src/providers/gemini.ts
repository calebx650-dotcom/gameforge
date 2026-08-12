import { ProviderError } from "@gameforge/shared";
import type { ChatMessage, ContentPart, GenerateChunk, GenerateOptions, ModelInfo, ToolCall, ToolDefinition } from "@gameforge/shared";
import type { GenerateResult, LLMProvider, ProviderConfig } from "../provider.js";

/**
 * Adapter for Google's Generative Language API (Gemini): `generativelanguage.googleapis.com`,
 * `POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent?alt=sse`.
 *
 * **Verified live 2026-08-11** against a real Google AI Studio API key and
 * `gemini-flash-latest` — real chat, a real `list_directory` tool call, and a real
 * multi-turn follow-up all confirmed working end-to-end through the actual desktop UI.
 * That live run surfaced two real wire-format bugs versus what this file originally
 * assumed (both fixed here, both noted inline where they're handled):
 * - A tool-result turn's role is `"user"`, not `"function"` — the latter 400s with
 *   "Role 'function' is not supported" against the current API.
 * - Every `functionCall` part comes back with a sibling `thoughtSignature` string that
 *   must be echoed back verbatim on that same functionCall part in the next request, or
 *   the follow-up turn 400s with "Function call is missing a thought_signature."
 *
 * Notable format differences from the other providers in this package, each handled by
 * the mapping functions below:
 * - Gemini has no `system` role in `contents`; a system message becomes a
 *   separate top-level `systemInstruction` field.
 * - The assistant role is called `"model"`, not `"assistant"`.
 * - A tool result is sent back as a `"user"`-role turn containing a
 *   `functionResponse` part (`{name, response}`), not a `"tool"` role.
 * - Tool calls come back as `functionCall` parts (`{name, args}`) mixed
 *   into the same `parts` array as any text, with no separate stable ID the
 *   way Anthropic/OpenAI-style tool-call blocks have — one is synthesized
 *   here so the rest of GameForge's `ToolCall.id` contract still holds.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly displayName = "Google Gemini";
  readonly supportsVision = true;
  readonly supportsTools = true;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig = {}) {
    if (!config.apiKey) throw new ProviderError("Gemini provider requires an API key");
    this.baseUrl = (config.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.fetch("/v1beta/models");
    const data = (await res.json()) as { models?: Array<{ name: string; displayName?: string }> };
    return (data.models ?? []).map((m) => {
      const id = m.name.replace(/^models\//, "");
      return { id, label: m.displayName ?? id, supportsTools: true, supportsVision: true };
    });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const body = this.buildBody(options);
    const res = await this.fetch(`/v1beta/models/${options.model}:generateContent`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as GeminiGenerateContentResponse;
    return this.toResult(data);
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const body = this.buildBody(options);
    const res = await this.fetch(`/v1beta/models/${options.model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.body) throw new ProviderError("Gemini returned no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let toolCallSeq = 0;
    const allToolCalls: ToolCall[] = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        const chunk = JSON.parse(data) as GeminiGenerateContentResponse;

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p) => p.text !== undefined).map((p) => p.text).join("");
        const toolCalls = parts
          .filter((p): p is GeminiResponsePart & { functionCall: { name: string; args?: Record<string, unknown> } } => Boolean(p.functionCall))
          .map((p) => ({
            id: `gemini-call-${toolCallSeq++}`,
            name: p.functionCall.name,
            arguments: p.functionCall.args ?? {},
            ...(p.thoughtSignature !== undefined ? { providerData: p.thoughtSignature } : {}),
          }));
        allToolCalls.push(...toolCalls);

        yield {
          textDelta: text || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        };
      }
    }

    yield {
      done: true,
      toolCalls: allToolCalls.length ? allToolCalls : undefined,
    };
  }

  private toResult(data: GeminiGenerateContentResponse): GenerateResult {
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.text !== undefined).map((p) => p.text).join("");
    let seq = 0;
    const toolCalls: ToolCall[] = parts
      .filter((p): p is GeminiResponsePart & { functionCall: { name: string; args?: Record<string, unknown> } } => Boolean(p.functionCall))
      .map((p) => ({
        id: `gemini-call-${seq++}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args ?? {},
        ...(p.thoughtSignature !== undefined ? { providerData: p.thoughtSignature } : {}),
      }));

    return {
      message: { role: "assistant", content: text, toolCalls: toolCalls.length ? toolCalls : undefined },
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: data.usageMetadata
        ? {
            promptTokens: data.usageMetadata.promptTokenCount,
            completionTokens: data.usageMetadata.candidatesTokenCount,
            totalTokens: data.usageMetadata.totalTokenCount,
          }
        : undefined,
    };
  }

  private buildBody(options: GenerateOptions) {
    const systemMessages = options.messages.filter((m) => m.role === "system");
    const conversation = options.messages.filter((m) => m.role !== "system");
    const systemText = systemMessages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");

    return {
      contents: conversation.map(toGeminiContent),
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(options.tools?.length ? { tools: [{ functionDeclarations: options.tools.map(toGeminiFunctionDeclaration) }] } : {}),
      generationConfig: {
        ...(options.temperature != null ? { temperature: options.temperature } : {}),
        ...(options.maxOutputTokens != null ? { maxOutputTokens: options.maxOutputTokens } : {}),
      },
    };
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
          ...(init.headers ?? {}),
        },
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach Gemini: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Gemini request failed (${res.status}): ${text}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiResponsePart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface GeminiResponsePart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  /**
   * Sibling of `functionCall` on the same part (not nested inside it) — confirmed against
   * a real generateContent response, 2026-08-11. Must be echoed back verbatim on the
   * matching outgoing functionCall part (see toGeminiFunctionCallPart) or the next turn
   * 400s with "Function call is missing a thought_signature in functionCall parts."
   */
  thoughtSignature?: string;
}

function toGeminiContent(m: ChatMessage): { role: string; parts: unknown[] } {
  if (m.role === "tool") {
    // Not "function": confirmed live 2026-08-11 against the real API — a functionResponse
    // turn sent with role "function" 400s with "Role 'function' is not supported. Please
    // use a valid role: SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT,
    // USER_CONTEXT, MODEL, USER." "function" was apparently a real role in an earlier API
    // version (the doc comment atop this file pre-dates that live check); the current API
    // wants functionResponse parts on a "user"-role turn instead.
    return {
      role: "user",
      parts: [{ functionResponse: { name: m.name ?? "unknown", response: { content: typeof m.content === "string" ? m.content : "" } } }],
    };
  }
  const role = m.role === "assistant" ? "model" : "user";
  if (typeof m.content === "string") {
    const parts: unknown[] = m.content ? [{ text: m.content }] : [];
    if (m.toolCalls?.length) parts.push(...m.toolCalls.map(toGeminiFunctionCallPart));
    return { role, parts };
  }
  return { role, parts: m.content.map(toGeminiPart) };
}

function toGeminiPart(p: ContentPart): unknown {
  if (p.type === "text") return { text: p.text };
  return { inlineData: { mimeType: p.mimeType, data: p.data } };
}

function toGeminiFunctionCallPart(tc: ToolCall): unknown {
  return {
    functionCall: { name: tc.name, args: tc.arguments },
    // See GeminiResponsePart.thoughtSignature's doc comment — echoed back as a sibling of
    // functionCall, matching the shape the real API returned it in.
    ...(tc.providerData !== undefined ? { thoughtSignature: tc.providerData } : {}),
  };
}

function toGeminiFunctionDeclaration(t: ToolDefinition) {
  return { name: t.name, description: t.description, parameters: t.parameters };
}
