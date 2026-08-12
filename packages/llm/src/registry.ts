import { ProviderError, type ProviderSettings } from "@gameforge/shared";
import type { LLMProvider } from "./provider.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";

/**
 * Turns user-chosen provider settings into a live LLMProvider instance.
 * This is the ONLY place that knows about concrete vendor classes —
 * adding a vendor means adding one branch here and one file under providers/.
 */
export function createProvider(settings: ProviderSettings): LLMProvider {
  // Every provider constructor below falls back to its own real default with
  // `config.baseUrl ?? "https://...")`, which only catches null/undefined — an empty
  // string (e.g. a UI text field the user left blank) sails right through `??` and
  // becomes the literal baseUrl, producing a relative-URL fetch failure instead of
  // the intended default. Confirmed live 2026-08-11: the desktop UI's "Refresh
  // Models" sent `baseUrl: ""` for Gemini and got "Failed to parse URL from
  // /v1beta/models". Normalizing here, in the one place that knows about every
  // vendor, means no individual adapter has to special-case "" vs undefined itself.
  const baseUrl = settings.baseUrl?.trim() ? settings.baseUrl : undefined;

  switch (settings.provider) {
    case "ollama":
      return new OllamaProvider({ baseUrl });
    case "openai":
      return new OpenAICompatibleProvider({
        id: "openai",
        displayName: "OpenAI",
        baseUrl: baseUrl ?? "https://api.openai.com/v1",
        apiKey: settings.apiKey,
      });
    case "openrouter":
      return new OpenAICompatibleProvider({
        id: "openrouter",
        displayName: "OpenRouter",
        baseUrl: baseUrl ?? "https://openrouter.ai/api/v1",
        apiKey: settings.apiKey,
        extraHeaders: { "HTTP-Referer": "https://gameforge.local", "X-Title": "GameForge" },
      });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        id: "openai-compatible",
        displayName: "OpenAI-compatible",
        baseUrl,
        apiKey: settings.apiKey,
      });
    case "anthropic":
      return new AnthropicProvider({ apiKey: settings.apiKey, baseUrl });
    case "gemini":
      return new GeminiProvider({ apiKey: settings.apiKey, baseUrl });
    default:
      throw new ProviderError(`Unknown provider: ${settings.provider}`);
  }
}

export const SUPPORTED_PROVIDERS = ["ollama", "openai", "openrouter", "openai-compatible", "anthropic", "gemini"] as const;
