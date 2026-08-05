import type { GenerationJob } from "@gameforge/shared";

export type MeshStyle = "low-poly" | "high-poly";
export type MeshFormat = "glb" | "fbx" | "obj";

export interface Text3DRequest {
  prompt: string;
  style?: MeshStyle;
  format?: MeshFormat;
  /** Ask the vendor to also produce a simplified collision/physics mesh alongside the render mesh. */
  generateCollisionMesh?: boolean;
  negativePrompt?: string;
}

export interface Text3DResult {
  modelUrl: string;
  format: MeshFormat;
  collisionMeshUrl?: string;
  thumbnailUrl?: string;
  polycount?: number;
}

/**
 * Every text-to-3D vendor (Meshy, Tripo3D, Point-E, ...) is implemented
 * behind this interface. Generation is asynchronous everywhere in this
 * space — submit a job, poll it — so the interface mirrors that instead
 * of pretending it's a synchronous call.
 */
export interface Text3DProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: Text3DRequest): Promise<GenerationJob<Text3DResult>>;
  pollJob(jobId: string): Promise<GenerationJob<Text3DResult>>;
}
