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
});
