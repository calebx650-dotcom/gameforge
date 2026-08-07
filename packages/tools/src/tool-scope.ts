import type { ToolDefinition } from "@gameforge/shared";
import type { EngineBridge } from "@gameforge/engine-bridge";
import { TOOL_DEFINITIONS } from "./definitions.js";
import { GENERATION_TOOL_PROVIDER_KEY, type GenerationProviders } from "./generation-tools.js";

/**
 * Filters the full 42-tool `TOOL_DEFINITIONS` list down to what a given
 * session can actually use, before it's sent to the model. Every prior
 * session sent every tool on every turn regardless of configuration —
 * fine for large-context cloud models, but it meant a small local model
 * was handed a dozen engine-tool schemas it could never successfully call
 * because no engine bridge was connected, and likewise for whichever
 * generation tools had no vendor configured. Filesystem/exec/git tools are
 * always available and always included; engine tools require a connected
 * `EngineBridge`; generation tools are included if they're pure/local
 * (no entry in `GENERATION_TOOL_PROVIDER_KEY`) or their required vendor is
 * configured in `generationProviders`.
 *
 * This only changes what's *advertised* to the model — `ToolExecutor`'s
 * permission checks and the generation/engine tools' own "not configured"
 * error messages still apply unconditionally as a second layer, in case a
 * model calls a tool it wasn't offered.
 */
export function getAvailableTools(
  generationProviders: GenerationProviders,
  engineBridge: EngineBridge | undefined,
): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((definition) => {
    if (definition.category === "engine") {
      return engineBridge !== undefined;
    }
    if (definition.category === "generation") {
      const providerKey = GENERATION_TOOL_PROVIDER_KEY[definition.name];
      if (!providerKey) return true;
      return generationProviders[providerKey] !== undefined;
    }
    return true;
  });
}
