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
builds exactly this kind of multi-image message, and it's wired into the
agent loop: after a successful `capture_screenshot` engine-bridge tool call,
`Agent.run()` splices the built message into the conversation so the next
`generate()` call actually gives a vision-capable model the captured image
to look at. See ARCHITECTURE.md's "Agent loop" and "Engine bridge" sections.

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

| Package | Interface | Cloud vendors | Local-first vendors |
|---|---|---|---|
| `packages/assets3d` | `Text3DProvider` | `meshy`, `tripo3d` | `triposr` (VAST-AI-Research/TripoSR, image-to-3D, <0.5s/GPU), `trellis` (microsoft/TRELLIS) |
| `packages/assets3d` | `PBRMaterialProvider` | `meshy-pbr` | `generic-image-pbr` (drives any OpenAI-compatible image endpoint, cloud or local, four times — once per PBR channel) |
| `packages/rigging` | `AutoRigProvider` | `meshy-rig` | `blender-auto-rig` (headless Blender/bpy, no addon required) |
| `packages/rigging` | `MotionProvider` | `deepmotion` (video-driven) | `motiongpt` (text-driven, wraps MotionGPT/ReGenNet-style models) |
| `packages/audio` | `VoiceProvider` | `elevenlabs` | `kokoro` (hexgrad/kokoro, 82M params, millisecond synthesis), `xtts` (coqui-ai/TTS XTTS-v2, zero-shot voice cloning) |
| `packages/audio` | `MusicGenerationProvider` | — (no cloud vendor wired) | `audiocraft` (facebookresearch/audiocraft: MusicGen for music beds, AudioGen for sfx/ambience) |

Each package has its own `createXProvider(settings)` factory in a
`registry.ts`, exactly mirroring `packages/llm/src/registry.ts` — the single
place that maps a provider id to a concrete class. **The agent, the tool
dispatch layer, and the permission system cannot tell which kind of vendor
is behind a given tool call** — a cloud API and a local inference server
both just implement the same interface. That's deliberate: it's what makes
"run entirely on local GPUs when offline" an actual capability of this
architecture rather than a promise contradicted by what's wired up. See
"Running local-first" below for how the local options actually work.

### Running local-first

Every local-first provider above talks to a small HTTP (or, for
`blender-auto-rig`, a CLI) server you run yourself — GameForge doesn't
bundle or manage these model runtimes:

- **TripoSR / TRELLIS**: run the upstream repo's inference code behind a
  thin FastAPI/Flask wrapper exposing `POST /generate` (see
  `packages/assets3d/src/providers/triposr.ts`/`trellis.ts` for the exact
  expected request/response shape — deliberately minimal, easy to wrap
  around either repo's existing Python entrypoint).
- **Blender auto-rig**: just needs `blender` on `PATH` — no server, no
  addon. `BlenderAutoRigProvider` shells out to a headless
  `blender --background --python ...` invocation with a built-in rigging
  script (basic bone placement + automatic-weight skinning); see
  `packages/rigging/src/providers/blender-auto-rig.ts`.
- **MotionGPT**: same local-HTTP-server shape as TripoSR/TRELLIS.
- **Kokoro**: the community **Kokoro-FastAPI** wrapper already speaks
  OpenAI's `/v1/audio/speech` shape, so `KokoroProvider` needs zero
  Kokoro-specific protocol work.
- **Coqui XTTS-v2**: `coqui-ai/TTS`'s built-in `tts-server` (or an
  equivalent wrapper) exposing `POST /api/tts` with a `speaker_wav`
  reference-audio path for cloning.
- **AudioCraft**: a thin wrapper around `facebookresearch/audiocraft`'s
  `MusicGen`/`AudioGen` pipelines, routed by the `kind` field
  (`ambient_music` -> MusicGen, `sound_effect` -> AudioGen).

None of these adapters have been exercised against a real running instance
of the wrapped model in this environment (no GPU here) — see the note at
the bottom of this file for what that means in practice.

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
straightforward of the cloud vendors (a single synchronous POST returning
audio bytes) and closely matches their documented API.

The local-first adapters (TripoSR, TRELLIS, MotionGPT, AudioCraft) define
their own small local-server wire contract (`POST /generate`, `GET /jobs/:id`)
rather than mimicking a vendor's public API, because these are self-hosted
model runtimes without one standardized wire format — the contract is
intentionally minimal so wrapping the upstream repo's inference call in a
matching HTTP handler is a short script, not a project. Kokoro and Blender
are the exceptions: Kokoro-FastAPI already speaks OpenAI's TTS shape, and
`blender-auto-rig` needs no server at all (a direct CLI invocation). None of
the local adapters have been run against an actual local inference server in
this environment (no GPU, no Blender install here) — the graceful-degradation
tests (`packages/rigging/src/providers/blender-auto-rig.test.ts`,
`packages/vision/src/ffmpeg.test.ts`) specifically verify the "tool isn't
installed" path works cleanly, since that's the one guaranteed to be
exercised by this repo's own CI.

## Engine-bridge providers

The same interface + adapter + registry pattern applies a third time, for
game-engine automation surfaces rather than generative content:

```ts
interface EngineBridge {        // packages/engine-bridge
  connect(): Promise<void>;
  isConnected(): boolean;
  inspectScene(): Promise<SceneInfo>;
  createObject(request): Promise<SceneObjectSummary>;
  captureScreenshot(): Promise<ScreenshotResult>;
  // ...modifyObject, modifyTransform, modifyComponent, saveScene,
  //    enterPlayMode, exitPlayMode, buildProject, readConsole
}
```

| id | Transport | Notes |
|---|---|---|
| `unity` | MCP JSON-RPC over HTTP (`McpHttpClient`) | `UnityBridge` maps the generic verbs onto `unity-mcp`'s tool set (`manage_scene`, `manage_gameobject`, `manage_editor`, `read_console`, `capture_screenshot`). Default `http://127.0.0.1:6400`. |
| `godot` | Raw WebSocket, `{id, command, args}`/`{id, result\|error}` | `GodotBridge` talks GameForge's own command protocol (`scene.get_hierarchy`, `editor.play`, ...) via `GodotWsClient`. Default `ws://127.0.0.1:6401`. |

`createEngineBridge(settings: EngineBridgeSettings)` in
`packages/engine-bridge/src/registry.ts` is the factory, exactly mirroring
`createProvider()`/`create*Provider()` above — `packages/tools`'s
`dispatchEngineTool()` only ever sees the `EngineBridge` interface, never a
concrete `UnityBridge`/`GodotBridge` instance directly.

### Adding a new engine

1. Add `packages/engine-bridge/src/your-engine-bridge.ts` implementing
   `EngineBridge`.
2. Add one branch to `createEngineBridge()` and one entry to
   `SUPPORTED_ENGINES`.
3. Add unit tests against a real local fake server for whatever transport
   the engine actually speaks — see `unity-bridge.test.ts` (fake JSON-RPC
   HTTP responder) and `godot-bridge.test.ts` (fake `ws.WebSocketServer`)
   for the pattern; don't mock at the `fetch`/`WebSocket` call level, stand
   up the real protocol.

Neither `UnityBridge` nor `GodotBridge` has been run against a real Editor
in this environment — see UNITY_BRIDGE.md.

## Free, purely local generation tools (no vendor of any kind)

Not every generative tool needs a model at all. `packages/level-design`,
`packages/combat-ai`, `packages/shader-synthesis`, and the retargeting
additions to `packages/rigging` are pure algorithms/codegen — procedural
level layout, boss behavior trees, ProBuilder graybox export, HLSL shaders,
post-processing profiles, humanoid avatar mapping, Animator Controller
specs, and ragdoll configs. These have no `costsMoney` flag, run instantly,
and need no configuration. See [ARCHITECTURE.md](ARCHITECTURE.md)'s
"Generation tools" section for the full list.
