import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class FfmpegNotAvailableError extends Error {
  constructor() {
    super(
      "ffmpeg was not found on PATH. Video capture/analysis requires ffmpeg " +
        "to extract frames — install it (e.g. `apt install ffmpeg`, `brew install ffmpeg`) " +
        "and try again. GameForge falls back to single-screenshot analysis when ffmpeg is unavailable.",
    );
    this.name = "FfmpegNotAvailableError";
  }
}

export interface ExtractedFrame {
  path: string;
  timestampMs: number;
  base64Png: string;
}

export interface ExtractFramesOptions {
  /** Frames per second to sample from the source video. Defaults to 4 — enough to judge pacing/jitter without an enormous payload. */
  fps?: number;
  /** Hard cap on frames returned, to bound the size of what gets sent to a vision model. */
  maxFrames?: number;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") reject(new FfmpegNotAvailableError());
      else reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runFfmpeg(["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts evenly spaced frames from a video file as PNGs, base64-encoded
 * for direct use as ImagePart content in an LLMProvider.generate() call.
 * Shells out to ffmpeg rather than pulling in a native binding — ffmpeg is
 * a single well-known external dependency, consistent with this project
 * already assuming Unity/Ollama are installed separately when needed.
 */
export async function extractFrames(videoPath: string, options: ExtractFramesOptions = {}): Promise<ExtractedFrame[]> {
  const fps = options.fps ?? 4;
  const maxFrames = options.maxFrames ?? 40;
  const dir = await mkdtemp(join(tmpdir(), "gf-frames-"));

  try {
    await runFfmpeg(["-i", videoPath, "-vf", `fps=${fps}`, "-frames:v", String(maxFrames), join(dir, "frame_%05d.png")]);

    const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < files.length; i++) {
      const path = join(dir, files[i]);
      const bytes = await readFile(path);
      frames.push({ path, timestampMs: Math.round((i * 1000) / fps), base64Png: bytes.toString("base64") });
    }
    return frames;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
