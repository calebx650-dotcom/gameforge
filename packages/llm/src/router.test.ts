import { describe, expect, it } from "vitest";
import { ProviderError, type ChatMessage, type GenerateChunk, type GenerateOptions, type ProviderSettings } from "@gameforge/shared";
import type { GenerateResult, LLMProvider } from "./provider.js";
import { ModelRouter, type RoutingEvent } from "./router.js";

/** A minimal fake LLMProvider — scripted to succeed, fail, or fail on stream, so router behavior can be tested without any real network call. */
class FakeProvider implements LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;
  generateCalls = 0;
  streamCalls = 0;

  constructor(
    opts: {
      id: string;
      supportsVision?: boolean;
      supportsTools?: boolean;
      failGenerate?: boolean;
      failStreamBeforeYield?: boolean;
      failStreamAfterYield?: boolean;
    },
  ) {
    this.id = opts.id;
    this.displayName = opts.id;
    this.supportsVision = opts.supportsVision ?? true;
    this.supportsTools = opts.supportsTools ?? true;
    this.failGenerate = opts.failGenerate ?? false;
    this.failStreamBeforeYield = opts.failStreamBeforeYield ?? false;
    this.failStreamAfterYield = opts.failStreamAfterYield ?? false;
  }

  private readonly failGenerate: boolean;
  private readonly failStreamBeforeYield: boolean;
  private readonly failStreamAfterYield: boolean;

  async listModels() {
    return [{ id: "fake-model" }];
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    this.generateCalls++;
    if (this.failGenerate) throw new ProviderError(`${this.id} is down`, true);
    return { message: { role: "assistant", content: `${this.id}:${options.model} says hi` } };
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    this.streamCalls++;
    if (this.failStreamBeforeYield) throw new ProviderError(`${this.id} rejected the stream`, true);
    yield { textDelta: `${this.id}:${options.model}:chunk1` };
    if (this.failStreamAfterYield) throw new ProviderError(`${this.id} dropped mid-stream`, true);
    yield { textDelta: "chunk2", done: true };
  }
}

function settingsFor(id: string, model = "m"): ProviderSettings {
  return { provider: id, model };
}

const userMessage: ChatMessage = { role: "user", content: "hello" };
const imageMessage: ChatMessage = {
  role: "user",
  content: [{ type: "image", data: "abc", mimeType: "image/png" }],
};

describe("ModelRouter", () => {
  it("uses the first candidate when it succeeds", async () => {
    const primary = new FakeProvider({ id: "primary" });
    const backup = new FakeProvider({ id: "backup" });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("primary") }, { settings: settingsFor("backup") }],
      createProvider: (s) => (s.provider === "primary" ? primary : backup),
    });

    const result = await router.generate({ model: "ignored", messages: [userMessage] });

    expect(result.message.content).toBe("primary:m says hi");
    expect(primary.generateCalls).toBe(1);
    expect(backup.generateCalls).toBe(0);
  });

  it("falls back to the next candidate when the first one throws", async () => {
    const primary = new FakeProvider({ id: "primary", failGenerate: true });
    const backup = new FakeProvider({ id: "backup" });
    const events: RoutingEvent[] = [];
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("primary") }, { settings: settingsFor("backup") }],
      createProvider: (s) => (s.provider === "primary" ? primary : backup),
      onRoute: (e) => events.push(e),
    });

    const result = await router.generate({ model: "ignored", messages: [userMessage] });

    expect(result.message.content).toBe("backup:m says hi");
    expect(primary.generateCalls).toBe(1);
    expect(backup.generateCalls).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ attempt: 1, providerId: "primary" });
    expect(events[1]).toMatchObject({ attempt: 2, providerId: "backup" });
    expect(events[1].fallbackReason).toMatch(/primary is down/);
  });

  it("throws an aggregate error when every candidate fails", async () => {
    const a = new FakeProvider({ id: "a", failGenerate: true });
    const b = new FakeProvider({ id: "b", failGenerate: true });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("a") }, { settings: settingsFor("b") }],
      createProvider: (s) => (s.provider === "a" ? a : b),
    });

    await expect(router.generate({ model: "ignored", messages: [userMessage] })).rejects.toThrow(
      /All 2 candidate provider\(s\) failed/,
    );
  });

  it("skips a candidate that doesn't support vision when the request has an image", async () => {
    const textOnly = new FakeProvider({ id: "text-only", supportsVision: false });
    const vision = new FakeProvider({ id: "vision-capable", supportsVision: true });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("text-only") }, { settings: settingsFor("vision-capable") }],
      createProvider: (s) => (s.provider === "text-only" ? textOnly : vision),
    });

    const result = await router.generate({ model: "ignored", messages: [imageMessage] });

    expect(result.message.content).toBe("vision-capable:m says hi");
    expect(textOnly.generateCalls).toBe(0);
  });

  it("skips a candidate that doesn't support tools when the request has tools", async () => {
    const noTools = new FakeProvider({ id: "no-tools", supportsTools: false });
    const withTools = new FakeProvider({ id: "with-tools", supportsTools: true });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("no-tools") }, { settings: settingsFor("with-tools") }],
      createProvider: (s) => (s.provider === "no-tools" ? noTools : withTools),
    });

    const result = await router.generate({
      model: "ignored",
      messages: [userMessage],
      tools: [{ name: "t", description: "d", category: "read", parameters: {} }],
    });

    expect(result.message.content).toBe("with-tools:m says hi");
  });

  it("throws a clear error when no candidate satisfies the request's requirements", async () => {
    const textOnly = new FakeProvider({ id: "text-only", supportsVision: false });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("text-only") }],
      createProvider: () => textOnly,
    });

    await expect(router.generate({ model: "ignored", messages: [imageMessage] })).rejects.toThrow(
      /No candidate provider supports this request/,
    );
  });

  it("tries free-tier candidates before paid ones regardless of list order", async () => {
    const paid = new FakeProvider({ id: "paid" });
    const free = new FakeProvider({ id: "free" });
    const router = new ModelRouter({
      // paid listed first, but free should still be tried first.
      candidates: [{ settings: settingsFor("paid"), costTier: "paid" }, { settings: settingsFor("free"), costTier: "free" }],
      createProvider: (s) => (s.provider === "paid" ? paid : free),
    });

    const result = await router.generate({ model: "ignored", messages: [userMessage] });

    expect(result.message.content).toBe("free:m says hi");
    expect(paid.generateCalls).toBe(0);
  });

  it("streams from the first candidate and forwards every chunk", async () => {
    const primary = new FakeProvider({ id: "primary" });
    const router = new ModelRouter({ candidates: [{ settings: settingsFor("primary") }], createProvider: () => primary });

    const chunks: GenerateChunk[] = [];
    for await (const chunk of router.stream({ model: "ignored", messages: [userMessage] })) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.textDelta)).toEqual(["primary:m:chunk1", "chunk2"]);
  });

  it("falls back to the next candidate if a stream fails before yielding anything", async () => {
    const primary = new FakeProvider({ id: "primary", failStreamBeforeYield: true });
    const backup = new FakeProvider({ id: "backup" });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("primary") }, { settings: settingsFor("backup") }],
      createProvider: (s) => (s.provider === "primary" ? primary : backup),
    });

    const chunks: GenerateChunk[] = [];
    for await (const chunk of router.stream({ model: "ignored", messages: [userMessage] })) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.textDelta)).toEqual(["backup:m:chunk1", "chunk2"]);
    expect(primary.streamCalls).toBe(1);
  });

  it("does NOT fall back once a stream has already yielded output — propagates the error instead", async () => {
    const primary = new FakeProvider({ id: "primary", failStreamAfterYield: true });
    const backup = new FakeProvider({ id: "backup" });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("primary") }, { settings: settingsFor("backup") }],
      createProvider: (s) => (s.provider === "primary" ? primary : backup),
    });

    const chunks: GenerateChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of router.stream({ model: "ignored", messages: [userMessage] })) {
          chunks.push(chunk);
        }
      })(),
    ).rejects.toThrow(/dropped mid-stream/);

    // Got the first, real chunk before the failure — and backup was never touched,
    // since silently switching backends mid-stream would duplicate/corrupt output.
    expect(chunks.map((c) => c.textDelta)).toEqual(["primary:m:chunk1"]);
    expect(backup.streamCalls).toBe(0);
  });

  it("caches provider instances instead of constructing a new one per call", async () => {
    let constructions = 0;
    const provider = new FakeProvider({ id: "primary" });
    const router = new ModelRouter({
      candidates: [{ settings: settingsFor("primary") }],
      createProvider: () => {
        constructions++;
        return provider;
      },
    });

    await router.generate({ model: "ignored", messages: [userMessage] });
    await router.generate({ model: "ignored", messages: [userMessage] });

    expect(constructions).toBe(1);
  });

  it("rejects an empty candidate list at construction time", () => {
    expect(() => new ModelRouter({ candidates: [] })).toThrow(/at least one candidate/);
  });
});
