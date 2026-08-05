import { ProviderError, type GenerationJob } from "@gameforge/shared";
import type { PBRMaterialProvider, PBRMaterialRequest, PBRMaterialResult } from "../pbr-material.js";

export interface GenericImagePBRConfig {
  apiKey?: string;
  /** OpenAI-compatible image-generation endpoint, e.g. https://api.openai.com/v1 */
  baseUrl?: string;
  model?: string;
}

const CHANNEL_SUFFIXES: Record<keyof PBRMaterialResult, string> = {
  albedoUrl: "albedo/diffuse base color texture, flat lighting, no shadows, seamless tiling",
  normalUrl: "tangent-space normal map, purple-blue color scheme, seamless tiling",
  roughnessUrl: "grayscale roughness map, seamless tiling",
  metallicUrl: "grayscale metallic map, seamless tiling",
};

/**
 * Fallback PBR provider that needs no dedicated texture-generation API:
 * it drives any OpenAI-compatible image-generation endpoint four times,
 * once per channel, with a channel-specific prompt suffix. This is the
 * "works with whatever image model the user already has" option — a
 * worse result than a purpose-built texture model, but zero new vendor
 * integration required.
 *
 * Image generation is synchronous on this API shape, so submitJob does
 * all the work and returns an already-"succeeded" job; pollJob just
 * echoes it back.
 */
export class GenericImagePBRProvider implements PBRMaterialProvider {
  readonly id = "generic-image-pbr";
  readonly displayName = "Generic image model (PBR via 4 prompts)";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly completedJobs = new Map<string, GenerationJob<PBRMaterialResult>>();

  constructor(config: GenericImagePBRConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model ?? "dall-e-3";
  }

  async submitJob(request: PBRMaterialRequest): Promise<GenerationJob<PBRMaterialResult>> {
    const id = `generic-pbr-${Date.now()}`;
    try {
      const [albedoUrl, normalUrl, roughnessUrl, metallicUrl] = await Promise.all([
        this.generateChannel(request.prompt, "albedoUrl"),
        this.generateChannel(request.prompt, "normalUrl"),
        this.generateChannel(request.prompt, "roughnessUrl"),
        this.generateChannel(request.prompt, "metallicUrl"),
      ]);
      const job: GenerationJob<PBRMaterialResult> = {
        id,
        status: "succeeded",
        result: { albedoUrl, normalUrl, roughnessUrl, metallicUrl },
      };
      this.completedJobs.set(id, job);
      return job;
    } catch (err) {
      const job: GenerationJob<PBRMaterialResult> = { id, status: "failed", error: (err as Error).message };
      this.completedJobs.set(id, job);
      return job;
    }
  }

  async pollJob(jobId: string): Promise<GenerationJob<PBRMaterialResult>> {
    const job = this.completedJobs.get(jobId);
    if (!job) throw new ProviderError(`Unknown generation job: ${jobId}`);
    return job;
  }

  private async generateChannel(prompt: string, channel: keyof PBRMaterialResult): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, prompt: `${prompt}, ${CHANNEL_SUFFIXES[channel]}`, n: 1 }),
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach image endpoint for ${channel}: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`Image generation failed for ${channel} (${res.status}): ${text}`, res.status >= 500);
    }
    const data = (await res.json()) as { data: Array<{ url?: string; b64_json?: string }> };
    const image = data.data[0];
    if (image?.url) return image.url;
    if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
    throw new ProviderError(`Image endpoint returned no image for ${channel}`);
  }
}
