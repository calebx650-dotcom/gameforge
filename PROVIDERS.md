# LLM Providers

GameForge never hard-codes a vendor into the agent or tool system. Everything
goes through the `LLMProvider` interface in `packages/llm/src/provider.ts`:

```ts
interface LLMProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsVision: boolean;
  readonly supportsTools: boolean;
  listModels(): Promise<ModelInfo[]>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncGenerator<GenerateChunk>;
}
```

## Supported today

| id                 | Wire format             | Notes |
|--------------------|--------------------------|-------|
| `ollama`           | Ollama `/api/chat`, `/api/tags` | Local models, no API key. Default base URL `http://127.0.0.1:11434`. |
| `openai`           | OpenAI chat-completions | Requires an API key. Default base URL `https://api.openai.com/v1`. |
| `openrouter`       | OpenAI chat-completions | Requires an API key. Default base URL `https://openrouter.ai/api/v1`. Adds `HTTP-Referer`/`X-Title` headers OpenRouter expects. |
| `openai-compatible`| OpenAI chat-completions | Any self-hosted or third-party server that speaks the same format — just supply `baseUrl` (and `apiKey` if it requires one). This is how Google/Gemini-compatible or other future OpenAI-shaped endpoints plug in without new code. |
| `anthropic`        | Anthropic Messages API  | Requires an API key. |

`openai`, `openrouter`, and `openai-compatible` are all one class,
`OpenAICompatibleProvider` (`packages/llm/src/providers/openai-compatible.ts`)
— they differ only in default `baseUrl` and headers, because they speak the
identical wire format. This is deliberate: most "add support for vendor X"
requests turn into "point `openai-compatible` at vendor X's URL," not new code.

`createProvider(settings: ProviderSettings)` in
`packages/llm/src/registry.ts` is the only place that maps a provider id to a
concrete class. The agent and tool system never see concrete provider
classes — only the `LLMProvider` interface.

## Adding a new provider

1. If it speaks the OpenAI chat-completions format (most new "OpenAI-compatible"
   servers do): no new code needed. Users select `openai-compatible` and supply
   `baseUrl`/`apiKey` from the UI. If it needs a small header tweak (like
   OpenRouter's `HTTP-Referer`), add a case in `registry.ts` the way
   `openrouter` is handled — a few lines, not a new class.
2. If it speaks a genuinely different wire format (like Ollama's or
   Anthropic's), add a new file under `packages/llm/src/providers/your-vendor.ts`
   implementing `LLMProvider`:
   - `listModels()` — hit whatever "list models" endpoint the vendor has, or
     return a small hard-coded list if it doesn't have one (see
     `AnthropicProvider`).
   - `generate()` — non-streaming call, returning `{ message, toolCalls, usage }`.
   - `stream()` — an async generator yielding `{ textDelta?, toolCalls?, done?, usage? }`.
   - Wrap network/HTTP errors in `ProviderError` from `@gameforge/shared`,
     setting `retryable` based on the status code (5xx/429 → retryable).
3. Add one branch to `createProvider()` in `registry.ts` and one entry to
   `SUPPORTED_PROVIDERS`.
4. Add unit tests mirroring `packages/llm/src/providers/ollama.test.ts` or
   `openai-compatible.test.ts` — mock `globalThis.fetch`, don't hit the network.

Nothing in `packages/agent`, `packages/tools`, `apps/server`, or
`apps/desktop` needs to change.

## Model/provider settings

`ProviderSettings` (`packages/shared`):

```ts
interface ProviderSettings {
  provider: string;       // "ollama" | "openai" | "openrouter" | "openai-compatible" | "anthropic"
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: "off" | "low" | "medium" | "high"; // reserved for reasoning-capable models; not yet wired to any provider
}
```

These are chosen per-chat-request in the UI (provider/model/mode selectors)
and sent to `apps/server` on the WebSocket `chat` message — nothing is
persisted server-side beyond the lifetime of that request.

## Vision / multimodal

`ContentPart` (`packages/shared`) supports `{ type: "image", data, mimeType }`
alongside text, and `OpenAICompatibleProvider`/`AnthropicProvider` already
translate it to each vendor's image format. `OllamaProvider` currently only
sends text content (Ollama's multimodal message format needs a small
follow-up to wire through). No caller sends images yet — that lands with the
screenshot/vision feedback loop in Phase 10.
