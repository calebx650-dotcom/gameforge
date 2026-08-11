import { ProviderError } from "@gameforge/shared";
import type { EngineBridge } from "./engine-bridge.js";
import { UnityBridge } from "./unity-bridge.js";
import { GodotBridge } from "./godot-bridge.js";

export interface EngineBridgeSettings {
  engine: string;
  url?: string;
}

/**
 * `signal`, when passed, aborts any in-flight call the returned bridge is
 * making the moment the run it belongs to is cancelled — see
 * `McpHttpClient`/`GodotWsClient`'s doc comments for what "in-flight" means
 * for each transport. A bridge is constructed fresh per chat request in
 * `apps/server`, so binding one fixed signal at construction time covers
 * every call the bridge makes for that request's whole lifetime.
 */
export function createEngineBridge(settings: EngineBridgeSettings, signal?: AbortSignal): EngineBridge {
  switch (settings.engine) {
    case "unity":
      return new UnityBridge({ baseUrl: settings.url, signal });
    case "godot":
      return new GodotBridge({ url: settings.url, signal });
    default:
      throw new ProviderError(`Unknown or unsupported engine: ${settings.engine}`);
  }
}

export const SUPPORTED_ENGINES = ["unity", "godot"] as const;
