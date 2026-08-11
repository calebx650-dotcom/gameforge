import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "@gameforge/shared";

/**
 * The shape a plugin file (`.mjs`, default-exported nothing — named
 * exports) must have: a real `ToolDefinition` (subject to the exact same
 * `decidePermission` mode-gating every built-in tool goes through — a
 * plugin doesn't get to declare itself exempt from approval, `costsMoney`,
 * or mode restrictions) plus a `dispatch` function that receives the raw
 * arguments the model called it with and returns the tool result content.
 */
export interface PluginModule {
  definition: ToolDefinition;
  dispatch: (args: Record<string, unknown>) => Promise<string> | string;
}

export interface LoadedPlugin extends PluginModule {
  filePath: string;
}

export interface PluginLoadError {
  filePath: string;
  message: string;
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[];
  errors: PluginLoadError[];
}

function isValidPluginModule(mod: unknown): mod is PluginModule {
  if (!mod || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;
  const def = m.definition as Partial<ToolDefinition> | undefined;
  return (
    typeof def?.name === "string" &&
    typeof def?.description === "string" &&
    typeof def?.category === "string" &&
    typeof def?.parameters === "object" &&
    typeof m.dispatch === "function"
  );
}

/**
 * Loads every `.mjs` plugin in `pluginsDir` (typically `<project>/.gameforge/
 * plugins/`) — the P4 "plugin architecture" gap: external tool definitions
 * registered into the agent's tool set without touching this codebase's own
 * source. Errors (a malformed plugin, one that throws on import) are
 * collected and returned rather than either crashing the whole load or
 * silently skipping — the caller decides what to do with them (surface to
 * the user, log, etc.), matching this project's "no silent failures"
 * discipline elsewhere. A missing plugins directory is not an error — most
 * projects will never have one — and returns an empty result.
 *
 * **Security note, stated plainly, not hidden in a doc file**: a plugin is
 * an arbitrary Node module, imported and run with full process privileges —
 * the same trust level as `run_command`, not a sandboxed extension API.
 * Only load plugins from directories you trust. The permission system still
 * applies in full to whatever `ToolDefinition` a plugin declares (mode
 * gating, `costsMoney` approval, etc.) — a plugin cannot grant itself an
 * exemption — but that governs when the *tool call* runs, not what the
 * plugin's own module-level code could already have done at import time.
 */
export async function loadPlugins(pluginsDir: string): Promise<PluginLoadResult> {
  const files = await readdir(pluginsDir).catch(() => [] as string[]);
  const plugins: LoadedPlugin[] = [];
  const errors: PluginLoadError[] = [];

  for (const file of files) {
    if (!file.endsWith(".mjs")) continue;
    const filePath = join(pluginsDir, file);
    try {
      // Cache-busting query so a plugin edited between loads is actually re-read,
      // not served from Node's module cache under the same file:// URL.
      const mod: unknown = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
      if (!isValidPluginModule(mod)) {
        errors.push({ filePath, message: "Plugin must export a 'definition' (ToolDefinition) and a 'dispatch' function." });
        continue;
      }
      plugins.push({ definition: mod.definition, dispatch: mod.dispatch, filePath });
    } catch (err) {
      errors.push({ filePath, message: (err as Error).message });
    }
  }

  return { plugins, errors };
}
