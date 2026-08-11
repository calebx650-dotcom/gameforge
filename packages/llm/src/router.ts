import { ProviderError, type ChatMessage, type GenerateChunk, type GenerateOptions, type ProviderSettings } from "@gameforge/shared";
import type { GenerateResult, LLMProvider } from "./provider.js";
import { createProvider } from "./registry.js";

/**
 * One provider/model this router may route a request to, in the order the
 * caller wants them tried. `costTier` drives cost-aware ordering: within the
 * set of candidates that satisfy a request's capability requirements,
 * `"free"` candidates (a local/self-hosted endpoint the user already pays
 * for regardless of usage — Ollama being the obvious case) are tried before
 * `"paid"` ones (a metered cloud API), with the caller's given order used as
 * the tiebreaker within each tier. Omit `costTier` (or leave it `"paid"`,
 * the default) for anything metered; there's no cost introspection here
 * beyond this coarse two-tier hint the caller supplies.
 */
export interface RouterCandidate {
  settings: ProviderSettings;
  costTier?: "free" | "paid";
}

export interface RoutingEvent {
  /** Which attempt this is, 1-indexed. */
  attempt: number;
  providerId: string;
  model: string;
  /** Set from the second attempt onward: why the previous candidate was skipped. */
  fallbackReason?: string;
}

export interface ModelRouterOptions {
  candidates: RouterCandidate[];
  /** Defaults to packages/llm's own createProvider — override in tests or for a custom vendor set. */
  createProvider?: (settings: ProviderSettings) => LLMProvider;
  /** Called once per attempt, before it's made, so a caller can log/display which provider is actually handling this request. */
  onRoute?: (event: RoutingEvent) => void;
}

function messagesNeedVision(messages: ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"));
}

/**
 * A router that is itself an `LLMProvider`, so `Agent` (or anything else
 * that only knows about the `LLMProvider` interface) can use one without any
 * changes — it has no idea routing is happening underneath. Two things drive
 * candidate selection:
 *
 * - **Capability filtering**: a candidate whose provider doesn't support
 *   vision is skipped for a request whose messages carry an image; one that
 *   doesn't support tool calling is skipped for a request with `tools`.
 *   Neither check requires a network call — `LLMProvider.supportsVision`/
 *   `supportsTools` are static per-provider facts.
 * - **Automatic fallback**: if a candidate's call throws, the router tries
 *   the next eligible candidate — but *only* before any output has been
 *   produced. Once `generate()`/`stream()` has started returning content to
 *   the caller, a later failure is never silently retried on a different
 *   backend, since that could duplicate or corrupt output the caller has
 *   already consumed; it propagates as a normal error instead.
 *
 * Candidate `LLMProvider` instances are constructed lazily and cached, so a
 * router with several candidates doesn't eagerly stand up connections to
 * providers it may never actually need for a given request.
 */
export class ModelRouter implements LLMProvider {
  readonly id = "router";
  readonly displayName = "Model router";
  // A router's own static capability flags aren't meaningful (they vary per
  // request depending which candidate actually serves it) — true here means
  // "don't rule out a request needing this before routing even runs."
  readonly supportsVision = true;
  readonly supportsTools = true;

  private readonly providerCache = new Map<string, LLMProvider>();

  constructor(private readonly options: ModelRouterOptions) {
    if (options.candidates.length === 0) {
      throw new ProviderError("ModelRouter requires at least one candidate.");
    }
  }

  async listModels() {
    const provider = this.getProvider(this.options.candidates[0].settings);
    return provider.listModels();
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const order = this.eligibleCandidatesInOrder(options);
    let lastError: unknown;

    for (let i = 0; i < order.length; i++) {
      const candidate = order[i];
      this.options.onRoute?.({
        attempt: i + 1,
        providerId: candidate.settings.provider,
        model: candidate.settings.model,
        fallbackReason: lastError ? (lastError as Error).message : undefined,
      });
      try {
        const provider = this.getProvider(candidate.settings);
        return await provider.generate({ ...options, model: candidate.settings.model });
      } catch (err) {
        lastError = err;
      }
    }
    throw this.exhaustedError(order, lastError);
  }

  async *stream(options: GenerateOptions): AsyncGenerator<GenerateChunk, void, unknown> {
    const order = this.eligibleCandidatesInOrder(options);
    let lastError: unknown;

    for (let i = 0; i < order.length; i++) {
      const candidate = order[i];
      this.options.onRoute?.({
        attempt: i + 1,
        providerId: candidate.settings.provider,
        model: candidate.settings.model,
        fallbackReason: lastError ? (lastError as Error).message : undefined,
      });
      const provider = this.getProvider(candidate.settings);
      // Buffer nothing: forward chunks as they arrive. If the very first
      // chunk throws before yielding, fall through to the next candidate
      // below. Once at least one chunk has reached the caller, a later
      // failure propagates immediately instead of silently switching
      // backends mid-stream — see the class doc comment for why.
      let yielded = false;
      try {
        for await (const chunk of provider.stream({ ...options, model: candidate.settings.model })) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (err) {
        if (yielded) throw err;
        lastError = err;
      }
    }
    throw this.exhaustedError(order, lastError);
  }

  /** Filters candidates down to ones whose provider's static capabilities satisfy this request, preserving cost-tier ordering. */
  private eligibleCandidatesInOrder(options: GenerateOptions): RouterCandidate[] {
    const needsVision = messagesNeedVision(options.messages);
    const needsTools = Boolean(options.tools?.length);

    const eligible = this.options.candidates.filter((c) => {
      const provider = this.getProvider(c.settings);
      if (needsVision && !provider.supportsVision) return false;
      if (needsTools && !provider.supportsTools) return false;
      return true;
    });

    if (eligible.length === 0) {
      throw new ProviderError(
        `No candidate provider supports this request's requirements (vision: ${needsVision}, tools: ${needsTools}). ` +
          `Configured candidates: ${this.options.candidates.map((c) => `${c.settings.provider}/${c.settings.model}`).join(", ")}`,
      );
    }

    // Stable sort: "free" tier first, "paid" (or unset, which defaults to
    // paid) after — ties keep the caller's original relative order.
    return eligible
      .map((c, index) => ({ c, index }))
      .sort((a, b) => tierRank(a.c.costTier) - tierRank(b.c.costTier) || a.index - b.index)
      .map(({ c }) => c);
  }

  private getProvider(settings: ProviderSettings): LLMProvider {
    const key = `${settings.provider}::${settings.baseUrl ?? ""}::${settings.apiKey ?? ""}`;
    let provider = this.providerCache.get(key);
    if (!provider) {
      provider = (this.options.createProvider ?? createProvider)(settings);
      this.providerCache.set(key, provider);
    }
    return provider;
  }

  private exhaustedError(order: RouterCandidate[], lastError: unknown): ProviderError {
    const tried = order.map((c) => `${c.settings.provider}/${c.settings.model}`).join(", ");
    return new ProviderError(
      `All ${order.length} candidate provider(s) failed [${tried}]. Last error: ${(lastError as Error)?.message ?? "unknown"}`,
      false,
      lastError,
    );
  }
}

function tierRank(tier: "free" | "paid" | undefined): number {
  return tier === "free" ? 0 : 1;
}
