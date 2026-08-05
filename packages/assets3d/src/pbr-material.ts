import type { GenerationJob } from "@gameforge/shared";

export interface PBRMaterialRequest {
  /** e.g. "cracked gothic stone with dried blood stains" */
  prompt: string;
  resolution?: 512 | 1024 | 2048 | 4096;
  seamlessTiling?: boolean;
}

export interface PBRMaterialResult {
  albedoUrl: string;
  normalUrl: string;
  roughnessUrl: string;
  metallicUrl: string;
}

/**
 * Behind this interface: any vendor that can produce a full PBR texture
 * set (albedo/normal/roughness/metallic) from a text prompt, whether
 * that's a dedicated texture-generation API (Meshy's text-to-texture) or
 * a generic image model driven four times with channel-specific prompts
 * (see providers/generic-image-pbr.ts).
 */
export interface PBRMaterialProvider {
  readonly id: string;
  readonly displayName: string;
  submitJob(request: PBRMaterialRequest): Promise<GenerationJob<PBRMaterialResult>>;
  pollJob(jobId: string): Promise<GenerationJob<PBRMaterialResult>>;
}
