export type { AutoRigProvider, AutoRigRequest, AutoRigResult, RigType } from "./auto-rig.js";
export type { MotionProvider, MotionRequest, MotionResult, ActionType, AnimationFormat } from "./motion.js";
export { MeshyAutoRigProvider } from "./providers/meshy-rig.js";
export { DeepMotionProvider } from "./providers/deepmotion.js";
export {
  createAutoRigProvider,
  createMotionProvider,
  SUPPORTED_AUTORIG_PROVIDERS,
  SUPPORTED_MOTION_PROVIDERS,
} from "./registry.js";
export type { RiggingSettings } from "./registry.js";
