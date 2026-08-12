import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "./registry.js";

describe("createProvider", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Confirmed live 2026-08-11: the desktop UI can send `baseUrl: ""` for a provider
  // whose Base URL field was left blank (see apps/desktop/src/App.tsx). Every provider
  // constructor's own `config.baseUrl ?? "https://real-default"` only catches
  // null/undefined, so "" used to sail through as a literal (empty) baseUrl and produce
  // a relative-URL fetch failure instead of falling back to the real default.
  it("treats an empty-string baseUrl as absent, falling back to the provider's real default", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createProvider({ provider: "gemini", model: "gemini-2.5-flash", apiKey: "k", baseUrl: "" });
    await provider.generate({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] });

    expect(capturedUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  });

  it("still honors an explicit non-empty baseUrl override", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "k",
      baseUrl: "https://my-proxy.example.com/v1",
    });
    await provider.generate({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });

    expect(capturedUrl).toBe("https://my-proxy.example.com/v1/chat/completions");
  });
});
