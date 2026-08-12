import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

describe("OpenAICompatibleProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends bearer auth and parses tool calls", async () => {
    let capturedAuth: string | null = null;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? null;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: "1", function: { name: "edit_file", arguments: '{"path":"a.ts"}' } }],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" });
    const result = await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(capturedAuth).toBe("Bearer sk-test");
    expect(result.toolCalls?.[0]).toEqual({ id: "1", name: "edit_file", arguments: { path: "a.ts" } });
    expect(result.usage?.totalTokens).toBe(7);
  });

  it("surfaces non-2xx responses as ProviderError", async () => {
    globalThis.fetch = vi.fn(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider({ apiKey: "sk-test" });
    await expect(provider.generate({ model: "gpt-4o", messages: [] })).rejects.toThrow(/429/);
  });

  function sseResponse(lines: string[]): Response {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  it("finalizes streamed tool calls when finish_reason is \"tool_calls\" (OpenAI/OpenRouter convention)", async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "1", function: { name: "list_directory", arguments: '{"path"' } }] }, finish_reason: null }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"."}' } }] }, finish_reason: "tool_calls" }],
        }),
        "[DONE]",
      ]),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ apiKey: "sk-test" });
    const chunks = [];
    for await (const chunk of provider.stream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }
    const finalCall = chunks.find((c) => c.toolCalls?.length);
    expect(finalCall?.toolCalls?.[0]).toEqual({ id: "1", name: "list_directory", arguments: { path: "." } });
  });

  it("finalizes streamed tool calls when finish_reason is \"stop\" (real Gemini OpenAI-compatible-endpoint convention)", async () => {
    // Confirmed live against the real Gemini API 2026-08-11: unlike OpenAI, Gemini's
    // OpenAI-compatible endpoint sends finish_reason: "stop" even for a pure tool-call
    // response, never "tool_calls". Gating strictly on "tool_calls" silently dropped
    // every Gemini tool call in the streaming path the agent always uses.
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: { role: "assistant", tool_calls: [{ index: 0, id: "gZB27rxM", function: { name: "list_directory", arguments: '{"path":"."}' } }] },
              index: 0,
            },
          ],
        }),
        JSON.stringify({ choices: [{ delta: { role: "assistant" }, finish_reason: "stop", index: 0 }] }),
        "[DONE]",
      ]),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ apiKey: "sk-test", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" });
    const chunks = [];
    for await (const chunk of provider.stream({ model: "models/gemini-flash-latest", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }
    const finalCall = chunks.find((c) => c.toolCalls?.length);
    expect(finalCall?.toolCalls?.[0]).toEqual({ id: "gZB27rxM", name: "list_directory", arguments: { path: "." } });
  });

  it("round-trips a tool call's extra_content (Gemini thought_signature) into providerData and back onto the wire", async () => {
    // Confirmed live against the real Gemini API 2026-08-11: a follow-up request whose
    // assistant tool-call message omits the original response's extra_content.google.thought_signature
    // gets rejected with a 400 ("Function call is missing a thought_signature ..."). generate()
    // must capture that field and toOpenAIMessage() must echo it back verbatim on the next call.
    const thoughtSignature = { google: { thought_signature: "opaque-signature-blob" } };
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: "1", function: { name: "list_directory", arguments: '{"path":"."}' }, extra_content: thoughtSignature },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new OpenAICompatibleProvider({ apiKey: "sk-test", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" });
    const result = await provider.generate({ model: "models/gemini-flash-latest", messages: [{ role: "user", content: "hi" }] });
    expect(result.toolCalls?.[0]?.providerData).toEqual(thoughtSignature);

    let capturedBody: { messages: Array<{ tool_calls?: Array<{ extra_content?: unknown }> }> } | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await provider.generate({
      model: "models/gemini-flash-latest",
      messages: [
        { role: "user", content: "hi" },
        result.message,
        { role: "tool", toolCallId: "1", name: "list_directory", content: "[]" },
      ],
    });
    expect(capturedBody?.messages[1]?.tool_calls?.[0]?.extra_content).toEqual(thoughtSignature);
  });
});
