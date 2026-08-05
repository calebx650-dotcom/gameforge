# Providers

GameForge never hard-codes a vendor into the agent or tool system — not for
the LLM itself, and not for the generative content pipelines (3D, rigging/
motion, voice) built on the same pattern. This doc covers the LLM provider
abstraction first, then the generation-vendor abstractions that mirror it.

## LLM providers

Everything goes through the `LLMProvider` interface in `packages/llm/src/provider.ts`:

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
follow-up to wire through). `packages/vision`'s `buildVideoAnalysisMessage()`
already builds exactly this kind of multi-image message from extracted
video frames — see [ROADMAP.md](ROADMAP.md) for why it isn't wired into the
agent as a tool yet (no capture source without the Unity bridge).

## Generation-vendor providers

Every generative pipeline (3D, PBR textures, auto-rigging, motion, voice)
follows the identical shape as `LLMProvider`, adapted for the fact that
generation is asynchronous almost everywhere in this space:

```ts
interface Text3DProvider {        // packages/assets3d
  submitJob(request): Promise<GenerationJob<Text3DResult>>;
  pollJob(jobId): Promise<GenerationJob<Text3DResult>>;
}
```

`GenerationJob<T>` (`packages/shared`) is `{ id, status: "queued"|"running"|
"succeeded"|"failed", progress?, result?: T, error? }` — the same shape used
by `PBRMaterialProvider`, `AutoRigProvider`, `MotionProvider`, and
`VoiceProvider`. A vendor whose API is actually synchronous (ElevenLabs
returns audio bytes directly; the generic image-based PBR fallback does too)
just does the real work in `submitJob()` and returns an already-`"succeeded"`
job, echoing it back from `pollJob()` — so a synchronous vendor and an
asynchronous one look identical to every caller.

| Package | Interface | Vendors wired today |
|---|---|---|
| `packages/assets3d` | `Text3DProvider` | `meshy`, `tripo3d` |
| `packages/assets3d` | `PBRMaterialProvider` | `meshy-pbr`, `generic-image-pbr` (drives any OpenAI-compatible image endpoint four times, once per PBR channel) |
| `packages/rigging` | `AutoRigProvider` | `meshy-rig` |
| `packages/rigging` | `MotionProvider` | `deepmotion` (video-driven motion capture) |
| `packages/audio` | `VoiceProvider` | `elevenlabs` |

Each package has its own `createXProvider(settings)` factory in a
`registry.ts`, exactly mirroring `packages/llm/src/registry.ts` — the single
place that maps a provider id to a concrete class.

### Adding a new generation vendor

Same recipe as adding an LLM provider:

1. Add `packages/<pipeline>/src/providers/your-vendor.ts` implementing the
   relevant interface (`Text3DProvider`, `PBRMaterialProvider`,
   `AutoRigProvider`, `MotionProvider`, or `VoiceProvider`).
2. Wrap network/HTTP errors in `ProviderError` (`@gameforge/shared`), same
   retryable-on-5xx/429 convention as the LLM providers.
3. Add one branch to that package's `create*Provider()` factory.
4. Add unit tests mocking `globalThis.fetch` — see
   `packages/assets3d/src/providers/meshy.test.ts` or
   `packages/audio/src/providers/elevenlabs.test.ts` for the pattern.

Nothing in `packages/agent` changes. `packages/tools/src/generation-tools.ts`
(the dispatch layer the agent's tool calls go through) only depends on the
interfaces, not the concrete vendor classes — the concrete instances are
built once per chat session in `apps/server`'s `buildGenerationProviders()`
from a `generationSettings` field on the WebSocket `chat` request, and handed
into `ToolExecutor`'s constructor. See [ARCHITECTURE.md](ARCHITECTURE.md)'s
"Generation tools" section and [SECURITY.md](SECURITY.md) for why
credentials live there and never in the tool-call arguments the model sees.

### A note on the wire formats above

Meshy's, Tripo3D's, and DeepMotion's adapters follow each vendor's publicly
documented REST API shape as closely as possible, but haven't been
exercised against a live account/API key in this environment. If a vendor's
actual response fields differ from what's coded, the fix is confined to
that one adapter file — the interface, the tool dispatch layer, and
everything above it stays untouched. ElevenLabs' adapter is the most
straightforward of the five (a single synchronous POST returning audio
bytes) and closely matches their documented API.
