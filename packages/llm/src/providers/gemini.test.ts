import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini.js";

describe("GeminiProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requires an API key", () => {
    expect(() => new GeminiProvider({})).toThrow(/requires an API key/);
  });

  it("sends the x-goog-api-key header and the real generateContent request shape", async () => {
    let capturedUrl = "";
    let capturedKeyHeader: string | null = null;
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedKeyHeader = (init?.headers as Record<string, string>)["x-goog-api-key"];
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "hello there" }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "test-key" });
    const result = await provider.generate({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hi" },
      ],
    });

    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(capturedKeyHeader).toBe("test-key");
    expect(capturedBody.systemInstruction).toEqual({ parts: [{ text: "You are a helpful assistant." }] });
    expect(capturedBody.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
    expect(result.message.content).toBe("hello there");
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  it("maps the assistant role to Gemini's 'model' role and tool results to a 'user' role turn", async () => {
    // Confirmed live 2026-08-11 against the real API: a functionResponse turn sent with
    // role "function" 400s ("Role 'function' is not supported. Please use a valid role:
    // SYSTEM, SYSTEM_1, USER, ASSISTANT, DEVELOPER, CONTEXT, USER_CONTEXT, MODEL, USER.").
    // The real API wants functionResponse parts on a "user"-role turn instead.
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    await provider.generate({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "read the file" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "1", name: "read_file", arguments: { path: "a.txt" } }],
        },
        { role: "tool", toolCallId: "1", name: "read_file", content: "file contents" },
      ],
    });

    expect(capturedBody.contents[1]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } } }],
    });
    expect(capturedBody.contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "read_file", response: { content: "file contents" } } }],
    });
  });

  it("round-trips a functionCall's thoughtSignature into providerData and back onto the wire", async () => {
    // Confirmed live 2026-08-11: a real generateContent response's functionCall part
    // carries a sibling `thoughtSignature` string that must be echoed back verbatim on
    // the matching outgoing functionCall part, or the follow-up turn 400s with "Function
    // call is missing a thought_signature in functionCall parts."
    const thoughtSignature = "EsoCCscCARFNMg9opaque-signature-blob";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ functionCall: { name: "list_directory", args: { path: "." } }, thoughtSignature }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    const result = await provider.generate({ model: "gemini-flash-latest", messages: [{ role: "user", content: "hi" }] });
    expect(result.toolCalls?.[0]?.providerData).toBe(thoughtSignature);

    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "done" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    await provider.generate({
      model: "gemini-flash-latest",
      messages: [
        { role: "user", content: "hi" },
        result.message,
        { role: "tool", toolCallId: result.toolCalls![0].id, name: "list_directory", content: "[]" },
      ],
    });
    expect(capturedBody.contents[1].parts[0].thoughtSignature).toBe(thoughtSignature);
  });

  it("maps image content parts to Gemini's inlineData shape", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "I see an image" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    await provider.generate({
      model: "gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", data: "base64data", mimeType: "image/png" },
          ],
        },
      ],
    });

    expect(capturedBody.contents[0].parts).toEqual([
      { text: "what is this?" },
      { inlineData: { mimeType: "image/png", data: "base64data" } },
    ]);
  });

  it("maps GameForge tool definitions to Gemini functionDeclarations", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    await provider.generate({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "read_file", description: "Reads a file", category: "read", parameters: { type: "object", properties: {} } }],
    });

    expect(capturedBody.tools).toEqual([
      { functionDeclarations: [{ name: "read_file", description: "Reads a file", parameters: { type: "object", properties: {} } }] },
    ]);
  });

  it("extracts a functionCall response as a real ToolCall with synthesized id", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { name: "edit_file", args: { path: "a.ts", oldText: "x", newText: "y" } } }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    const result = await provider.generate({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "edit it" }] });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0]).toMatchObject({ name: "edit_file", arguments: { path: "a.ts", oldText: "x", newText: "y" } });
    expect(result.toolCalls?.[0].id).toBeTruthy();
  });

  it("parses the real SSE streamGenerateContent framing and accumulates tool calls across chunks", async () => {
    const sseBody =
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] } }] })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } } }] } }] })}\n\n`;

    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toContain(":streamGenerateContent?alt=sse");
      return new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    const chunks = [];
    for await (const chunk of provider.stream({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    const text = chunks.map((c) => c.textDelta ?? "").join("");
    expect(text).toBe("Hello");
    const final = chunks[chunks.length - 1];
    expect(final.done).toBe(true);
    expect(final.toolCalls).toEqual([{ id: expect.any(String), name: "read_file", arguments: { path: "a.txt" } }]);
  });

  it("surfaces non-2xx responses as a ProviderError", async () => {
    globalThis.fetch = vi.fn(async () => new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
    const provider = new GeminiProvider({ apiKey: "k" });
    await expect(provider.generate({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/429/);
  });

  it("lists models, stripping the models/ name prefix", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }] }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: "k" });
    const models = await provider.listModels();

    expect(models).toEqual([{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", supportsTools: true, supportsVision: true }]);
  });
});
