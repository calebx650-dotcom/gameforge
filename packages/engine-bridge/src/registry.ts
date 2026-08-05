import { ProviderError } from "@gameforge/shared";
import type { EngineBridge } from "./engine-bridge.js";
import { UnityBridge } from "./unity-bridge.js";
import { GodotBridge } from "./godot-bridge.js";

export interface EngineBridgeSettings {
  engine: string;
  url?: string;
}

export function createEngineBridge(settings: EngineBridgeSettings): EngineBridge {
  switch (settings.engine) {
    case "unity":
      return new UnityBridge({ baseUrl: settings.url });
    case "godot":
      return new GodotBridge({ url: settings.url });
    default:
      throw new ProviderError(`Unknown or unsupported engine: ${settings.engine}`);
  }
}

export const SUPPORTED_ENGINES = ["unity", "godot"] as const;
