import { ProviderError } from "@gameforge/shared";
import type { Text3DProvider } from "./text-to-3d.js";
import type { PBRMaterialProvider } from "./pbr-material.js";
import { MeshyProvider } from "./providers/meshy.js";
import { Tripo3DProvider } from "./providers/tripo3d.js";
import { TripoSRProvider } from "./providers/triposr.js";
import { TrellisProvider } from "./providers/trellis.js";
import { MeshyPBRProvider } from "./providers/meshy-pbr.js";
import { GenericImagePBRProvider } from "./providers/generic-image-pbr.js";

export interface AssetGenerationSettings {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export function createText3DProvider(settings: AssetGenerationSettings): Text3DProvider {
  switch (settings.provider) {
    case "meshy":
      return new MeshyProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "tripo3d":
      return new Tripo3DProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "triposr":
      return new TripoSRProvider({ baseUrl: settings.baseUrl });
    case "trellis":
      return new TrellisProvider({ baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown text-to-3D provider: ${settings.provider}`);
  }
}

export function createPBRMaterialProvider(settings: AssetGenerationSettings): PBRMaterialProvider {
  switch (settings.provider) {
    case "meshy-pbr":
      return new MeshyPBRProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "generic-image-pbr":
      return new GenericImagePBRProvider({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model });
    default:
      throw new ProviderError(`Unknown PBR material provider: ${settings.provider}`);
  }
}

export const SUPPORTED_TEXT3D_PROVIDERS = ["meshy", "tripo3d", "triposr", "trellis"] as const;
export const SUPPORTED_PBR_PROVIDERS = ["meshy-pbr", "generic-image-pbr"] as const;
