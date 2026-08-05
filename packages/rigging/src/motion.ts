import type { GenerationJob } from "@gameforge/shared";

export type ActionType =
  | "attack"
  | "execution"
  | "wall-climb"
  | "hit-reaction"
  | "idle"
  | "locomotion"
  | "custom";

export type AnimationFormat = "fbx" | "glb" | "bvh";

export interface MotionRequest {
  actionType: ActionType;
  /** Freeform description used when actionType is "custom" or to steer style, e.g. "heavy two-handed overhead execution". */
  prompt?: string;
  /** Optional reference video to drive motion capture instead of pure text-to-motion. */
  referenceVideoUrl?: string;
  rigType?: "humanoid" | "quadruped" | "custom";
  loop?: boolean;
}

export interface MotionResult {
  animationClipUrl: string;
  format: AnimationFormat;
  durationSeconds?: number;
  frameRate?: number;
}

/**
 * Behind this interface: AI motion tools (DeepMotion, Wonder Dynamics, or
 * any future text/video-to-motion vendor). Like text-to-3D, generation is
 * asynchronous — submit, then poll.
 */
export interface MotionProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: MotionRequest): Promise<GenerationJob<MotionResult>>;
  pollJob(jobId: string): Promise<GenerationJob<MotionResult>>;
}
