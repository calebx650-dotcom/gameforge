import type { GenerationJob } from "@gameforge/shared";

export type RigType = "humanoid" | "quadruped" | "weapon" | "custom";

export interface AutoRigRequest {
  /** URL to the source mesh (typically the output of a text-to-3D job). */
  meshUrl: string;
  rigType: RigType;
  heightMeters?: number;
}

export interface AutoRigResult {
  riggedModelUrl: string;
  boneCount?: number;
  skeletonType?: string;
}

/**
 * Behind this interface: any vendor/service that takes an unrigged mesh
 * and returns one with a skeleton bound to it (bones + skin weights) —
 * for humanoids, monsters, or weapons that need a grip/swing pivot rig.
 */
export interface AutoRigProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: AutoRigRequest): Promise<GenerationJob<AutoRigResult>>;
  pollJob(jobId: string): Promise<GenerationJob<AutoRigResult>>;
}
