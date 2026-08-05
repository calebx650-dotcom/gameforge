import WebSocket from "ws";
import { ProviderError } from "@gameforge/shared";

export interface GodotWsClientConfig {
  /** WebSocket URL of a locally-running Godot EditorPlugin (see godot-bridge.ts doc for the expected protocol). */
  url: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let requestCounter = 0;

/**
 * A minimal request/response client over a raw WebSocket: every call sends
 * `{id, command, args}` and awaits a matching `{id, result}` or
 * `{id, error}` reply. This is GameForge's own small protocol, not an
 * existing standard — unlike Unity, there's no dominant existing
 * editor-automation bridge for Godot yet, so `GodotBridge` defines the
 * simplest thing a GDScript `EditorPlugin` could implement (Godot's
 * `WebSocketPeer` makes a matching server-side trivial to write, just not
 * something this repository can build or run without a Godot install).
 */
export class GodotWsClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: GodotWsClientConfig) {
    this.connectTimeoutMs = config.connectTimeoutMs ?? 5000;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10000;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.config.url);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new ProviderError(`Timed out connecting to Godot bridge at ${this.config.url}`, true));
      }, this.connectTimeoutMs);

      socket.once("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("message", (data) => this.handleMessage(data.toString()));
        socket.on("close", () => this.rejectAllPending("Godot bridge connection closed"));
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new ProviderError(`Failed to reach Godot bridge at ${this.config.url}: ${err.message}`, true, err));
      });
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async send(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new ProviderError("Godot bridge is not connected — call connect() first.");
    }
    const id = ++requestCounter;
    const socket = this.socket;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProviderError(`Godot bridge command "${command}" timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      socket.send(JSON.stringify({ id, command, args }));
    });
  }

  private handleMessage(raw: string): void {
    let message: { id: number; result?: unknown; error?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new ProviderError(message.error));
    else pending.resolve(message.result);
  }

  private rejectAllPending(reason: string): void {
    for (const pending of this.pending.values()) {
      pending.reject(new ProviderError(reason));
    }
    this.pending.clear();
  }
}
