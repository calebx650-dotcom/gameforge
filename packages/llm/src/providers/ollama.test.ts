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
});
