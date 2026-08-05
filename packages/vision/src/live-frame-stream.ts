export interface LiveFrame {
  /** Base64-encoded image bytes (PNG/JPEG), matching ImagePart's `data` field. */
  base64: string;
  mimeType: string;
  timestampMs: number;
  byteLength: number;
}

export interface LiveFrameBufferOptions {
  /** Maximum number of frames retained. Default 30 (a few seconds at typical sampling rates). */
  maxFrames?: number;
  /** Maximum total bytes retained across all buffered frames. Default 64 MiB. */
  maxBytesTotal?: number;
}

export interface LiveFrameBufferStats {
  frameCount: number;
  totalBytes: number;
  droppedFrameCount: number;
  oldestTimestampMs?: number;
  newestTimestampMs?: number;
}

/**
 * A bounded in-memory ring buffer for frames pushed live from a running
 * game (e.g. a Unity-side sender relaying its game view over a WebSocket,
 * in place of Spout2/NDI GPU-texture sharing — genuine GPU-memory
 * sharing needs a native sender plugin this package can't provide, but a
 * pushed-frame WebSocket relay is a real, zero-disk-write local
 * alternative to writing an .mp4 to disk and shelling out to ffmpeg
 * every time the vision loop wants to look at recent gameplay).
 *
 * Backpressure policy: drop the oldest frame(s) rather than blocking the
 * producer or growing unbounded — a live game shouldn't stall waiting for
 * the vision loop to keep up, and a slightly stale buffer is fine for
 * "how does the last few seconds look," which is what this is for.
 */
export class LiveFrameBuffer {
  private readonly maxFrames: number;
  private readonly maxBytesTotal: number;
  private frames: LiveFrame[] = [];
  private totalBytes = 0;
  private droppedFrameCount = 0;

  constructor(options: LiveFrameBufferOptions = {}) {
    this.maxFrames = options.maxFrames ?? 30;
    this.maxBytesTotal = options.maxBytesTotal ?? 64 * 1024 * 1024;
  }

  pushFrame(frame: Omit<LiveFrame, "byteLength"> & { byteLength?: number }): void {
    const byteLength = frame.byteLength ?? Math.ceil((frame.base64.length * 3) / 4);
    this.frames.push({ ...frame, byteLength });
    this.totalBytes += byteLength;
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.frames.length > this.maxFrames || this.totalBytes > this.maxBytesTotal) {
      const dropped = this.frames.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.byteLength;
      this.droppedFrameCount++;
    }
  }

  /** Most recent `n` frames, oldest-first (matching capture order). Omit `n` for the whole buffer. */
  getRecentFrames(n?: number): LiveFrame[] {
    if (n == null || n >= this.frames.length) return [...this.frames];
    return this.frames.slice(this.frames.length - n);
  }

  stats(): LiveFrameBufferStats {
    return {
      frameCount: this.frames.length,
      totalBytes: this.totalBytes,
      droppedFrameCount: this.droppedFrameCount,
      oldestTimestampMs: this.frames[0]?.timestampMs,
      newestTimestampMs: this.frames[this.frames.length - 1]?.timestampMs,
    };
  }

  clear(): void {
    this.frames = [];
    this.totalBytes = 0;
  }
}
