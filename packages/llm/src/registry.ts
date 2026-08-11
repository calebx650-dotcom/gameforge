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
  switch (settings.provider) {
    case "ollama":
      return new OllamaProvider({ baseUrl: settings.baseUrl });
    case "openai":
      return new OpenAICompatibleProvider({
        id: "openai",
        displayName: "OpenAI",
        baseUrl: settings.baseUrl ?? "https://api.openai.com/v1",
        apiKey: settings.apiKey,
      });
    case "openrouter":
      return new OpenAICompatibleProvider({
        id: "openrouter",
        displayName: "OpenRouter",
        baseUrl: settings.baseUrl ?? "https://openrouter.ai/api/v1",
        apiKey: settings.apiKey,
        extraHeaders: { "HTTP-Referer": "https://gameforge.local", "X-Title": "GameForge" },
      });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        id: "openai-compatible",
        displayName: "OpenAI-compatible",
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      });
    case "anthropic":
      return new AnthropicProvider({ apiKey: settings.apiKey, baseUrl: settings.baseUrl });
    case "gemini":
      return new GeminiProvider({ apiKey: settings.apiKey, baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown provider: ${settings.provider}`);
  }
}

export const SUPPORTED_PROVIDERS = ["ollama", "openai", "openrouter", "openai-compatible", "anthropic", "gemini"] as const;
