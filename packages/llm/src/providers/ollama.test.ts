import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OllamaProvider } from "./ollama.js";

describe("OllamaProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists models from /api/tags", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: "llama3.1:8b", label: "llama3.1:8b", supportsTools: true }]);
  });

  it("generates a non-streaming response and extracts tool calls", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: {
            content: "",
            tool_calls: [{ function: { name: "read_file", arguments: { path: "a.txt" } } }],
          },
          prompt_eval_count: 10,
          eval_count: 5,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    const result = await provider.generate({ model: "llama3.1:8b", messages: [{ role: "user", content: "hi" }] });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].name).toBe("read_file");
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("wraps network failures in a retryable ProviderError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await expect(provider.listModels()).rejects.toThrow(/Failed to reach Ollama/);
  });

  it("sends image content parts as an images array on the message", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: { content: "I see a red square." } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.generate({
      model: "qwen2.5vl",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          ],
        },
      ],
    });

    expect(capturedBody.messages).toHaveLength(1);
    expect(capturedBody.messages[0].content).toBe("What is in this image?");
    expect(capturedBody.messages[0].images).toEqual(["aGVsbG8="]);
  });

  it("strips a data: URI prefix before sending the base64 payload", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.generate({
      model: "qwen2.5vl",
      messages: [
        {
          role: "user",
          content: [{ type: "image", data: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" }],
        },
      ],
    });

    expect(capturedBody.messages[0].images).toEqual(["aGVsbG8="]);
  });

  it("collects multiple images from one message into one images array", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.generate({
      model: "qwen2.5vl",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", data: "aW1hZ2VvbmU=", mimeType: "image/png" },
            { type: "image", data: "aW1hZ2V0d28=", mimeType: "image/png" },
          ],
        },
      ],
    });

    expect(capturedBody.messages[0].images).toEqual(["aW1hZ2VvbmU=", "aW1hZ2V0d28="]);
  });

  it("does not include an images field on text-only messages", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.generate({ model: "llama3.1:8b", messages: [{ role: "user", content: "hi" }] });
    expect(capturedBody.messages[0]).not.toHaveProperty("images");

    await provider.generate({
      model: "llama3.1:8b",
      messages: [{ role: "user", content: [{ type: "text", text: "hi again" }] }],
    });
    expect(capturedBody.messages[0]).not.toHaveProperty("images");
  });

  it("preserves existing text-only mapping behavior for string and array content", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    await provider.generate({
      model: "llama3.1:8b",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }] },
      ],
    });

    expect(capturedBody.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(capturedBody.messages[1].content).toBe("line one\nline two");
  });

  it("sends the images array through the streaming request body as well", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init: any) => {
      capturedBody = JSON.parse(init.body);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: "ok" }, done: true }) + "\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
    const iterator = provider.stream({
      model: "qwen2.5vl",
      messages: [{ role: "user", content: [{ type: "image", data: "c3RyZWFt", mimeType: "image/png" }] }],
    });
    for await (const _chunk of iterator) {
      // drain
    }

    expect(capturedBody.messages[0].images).toEqual(["c3RyZWFt"]);
  });
});
