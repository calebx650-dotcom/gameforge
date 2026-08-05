import { ProviderError } from "@gameforge/shared";
import type { AutoRigProvider } from "./auto-rig.js";
import type { MotionProvider } from "./motion.js";
import { MeshyAutoRigProvider } from "./providers/meshy-rig.js";
import { BlenderAutoRigProvider } from "./providers/blender-auto-rig.js";
import { DeepMotionProvider } from "./providers/deepmotion.js";
import { MotionGPTProvider } from "./providers/motiongpt.js";

export interface RiggingSettings {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export function createAutoRigProvider(settings: RiggingSettings): AutoRigProvider {
  switch (settings.provider) {
    case "meshy-rig":
      return new MeshyAutoRigProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "blender-auto-rig":
      return new BlenderAutoRigProvider();
    default:
      throw new ProviderError(`Unknown auto-rig provider: ${settings.provider}`);
  }
}

export function createMotionProvider(settings: RiggingSettings): MotionProvider {
  switch (settings.provider) {
    case "deepmotion":
      return new DeepMotionProvider({ apiKey: settings.apiKey ?? "", baseUrl: settings.baseUrl });
    case "motiongpt":
      return new MotionGPTProvider({ baseUrl: settings.baseUrl });
    default:
      throw new ProviderError(`Unknown motion provider: ${settings.provider}`);
  }
}

export const SUPPORTED_AUTORIG_PROVIDERS = ["meshy-rig", "blender-auto-rig"] as const;
export const SUPPORTED_MOTION_PROVIDERS = ["deepmotion", "motiongpt"] as const;
