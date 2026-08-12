import { ProviderError } from "@gameforge/shared";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  /** Base64 payload for `type: "image"` blocks (confirmed live 2026-08-10 against mcp-for-unity's `manage_camera` screenshot tool — image blocks carry the payload in `data`, not `text`). */
  data?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpClientConfig {
  baseUrl: string;
  /**
   * When set, every request this client makes (including the `initialize`
   * handshake) is abortable through it — a cancelled agent run should stop
   * an in-flight Unity call immediately rather than waiting for it to
   * finish. An abort is a deliberate cancellation, not a transient network
   * failure, so it's never treated as a stale-session/dropped-connection
   * case eligible for the single automatic retry `request()` otherwise does.
   */
  signal?: AbortSignal;
}

let requestCounter = 0;

const PROTOCOL_VERSION = "2025-06-18";
const ACCEPT_HEADER = "application/json, text/event-stream";

type JsonRpcEnvelope<T> = { result?: T; error?: { message: string; code?: number } };

/**
 * A client for the Model Context Protocol's real "Streamable HTTP" transport
 * (verified 2026-08-09 against a live `mcp-for-unity` 10.1.2 server: real
 * routes and framing are NOT a bespoke bare-JSON-over-HTTP scheme — see
 * UNITY_BRIDGE.md's "Real HTTP transport" section for how this was found).
 * Every server is reached at `${baseUrl}/mcp`, not the bare base URL. A
 * session must be opened with an `initialize` handshake before any other
 * call; the server hands back an `Mcp-Session-Id` response header that must
 * be echoed on every subsequent request. Responses — including ordinary
 * `tools/list`/`tools/call` results, not just long-lived streams — commonly
 * come back as a single `text/event-stream` chunk (`event: message\ndata:
 * {...}`) rather than a bare JSON body, so the client accepts both.
 * Engine-specific bridges (`UnityBridge`) build on top of this generic
 * client rather than each reimplementing MCP framing.
 */
export class McpHttpClient {
  private readonly mcpUrl: string;
  private readonly signal: AbortSignal | undefined;
  private sessionId: string | undefined;
  private sessionPromise: Promise<void> | undefined;

  constructor(config: McpClientConfig) {
    this.mcpUrl = `${config.baseUrl.replace(/\/$/, "")}/mcp`;
    this.signal = config.signal;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request<{ tools: McpToolInfo[] }>("tools/list", {});
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    return this.request<McpToolCallResult>("tools/call", { name, arguments: args });
  }

  /**
   * Reads an MCP resource (e.g. `mcpforunity://scene/gameobject/{id}`) — a separate
   * MCP capability from tools, confirmed live 2026-08-10: unity-mcp exposes GameObject
   * detail/component data this way rather than through a `manage_gameobject` "get"
   * action (that action doesn't exist in the real tool's action enum).
   */
  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = await this.request<{ contents: McpResourceContent[] }>("resources/read", { uri });
    return result.contents;
  }

  /** Opens the MCP session (idempotent — safe to call from multiple concurrent requests). */
  private async ensureSession(): Promise<void> {
    if (this.sessionId !== undefined) return;
    if (!this.sessionPromise) this.sessionPromise = this.initializeSession();
    await this.sessionPromise;
  }

  private async initializeSession(): Promise<void> {
    const res = await this.post({
      jsonrpc: "2.0",
      id: ++requestCounter,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "gameforge-engine-bridge", version: "0.1.0" },
      },
    });
    const sessionId = res.headers.get("mcp-session-id");
    if (!sessionId) {
      throw new ProviderError(`MCP server at ${this.mcpUrl} did not return a Mcp-Session-Id header from initialize`);
    }
    const body = await this.readEnvelope<unknown>(res);
    if (body.error) {
      throw new ProviderError(`MCP initialize failed: ${body.error.message}`);
    }
    this.sessionId = sessionId;

    // Best-effort: the spec expects this notification after initialize, but a server
    // that doesn't strictly require it shouldn't block the client from proceeding.
    try {
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    } catch {
      // Notification failures are non-fatal; subsequent requests will surface real errors.
    }
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: ACCEPT_HEADER,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    try {
      return await fetch(this.mcpUrl, { method: "POST", headers, body: JSON.stringify(body), signal: this.signal });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      throw new ProviderError(`Failed to reach MCP server at ${this.mcpUrl}: ${(err as Error).message}`, true, err);
    }
  }

  /**
   * `retryAllowed` bounds recovery to a single attempt per call: a real MCP
   * server responds 404 when the `Mcp-Session-Id` it was given is
   * unrecognized (session expired, or the server restarted and forgot every
   * session it had); a `fetch` rejection means the connection itself dropped
   * (reset, server briefly down). Either way, the fix is the same — forget
   * the stale session, re-run the `initialize` handshake, and replay this
   * exact call once. If that retry *also* fails, the problem is real (server
   * genuinely unreachable, or broken) and should surface as an error rather
   * than loop.
   */
  private async request<T>(method: string, params: Record<string, unknown>, retryAllowed = true): Promise<T> {
    await this.ensureSession();

    const id = ++requestCounter;
    let res: Response;
    try {
      res = await this.post({ jsonrpc: "2.0", id, method, params });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") throw err;
      if (retryAllowed) {
        this.forgetSession();
        return this.request<T>(method, params, false);
      }
      throw err;
    }

    if (res.status === 404 && retryAllowed) {
      this.forgetSession();
      return this.request<T>(method, params, false);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`MCP server returned ${res.status}: ${text}`, res.status >= 500);
    }
    const body = await this.readEnvelope<T>(res);
    if (body.error) {
      throw new ProviderError(`MCP call "${method}" failed: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new ProviderError(`MCP call "${method}" returned no result`);
    }
    return body.result;
  }

  private forgetSession(): void {
    this.sessionId = undefined;
    this.sessionPromise = undefined;
  }

  /**
   * Reads a JSON-RPC envelope from either framing the Streamable HTTP transport uses:
   * a bare `application/json` body, or one or more `text/event-stream` SSE frames
   * (`event: message\ndata: {...}`). Picks the last parseable `data:` payload, which
   * is the final JSON-RPC response for the single-request/single-response calls this
   * client makes (as opposed to a long-lived server-initiated stream).
   */
  private async readEnvelope<T>(res: Response): Promise<JsonRpcEnvelope<T>> {
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!contentType.includes("text/event-stream")) {
      return text ? (JSON.parse(text) as JsonRpcEnvelope<T>) : {};
    }

    let lastPayload: JsonRpcEnvelope<T> | undefined;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (!data) continue;
      try {
        lastPayload = JSON.parse(data) as JsonRpcEnvelope<T>;
      } catch {
        // Non-JSON data lines (shouldn't happen for this server) are ignored.
      }
    }
    if (!lastPayload) {
      throw new ProviderError(`MCP server at ${this.mcpUrl} returned an event stream with no parseable data`);
    }
    return lastPayload;
  }
}

/** Extracts the first text block from an MCP tool result, throwing if the call errored or returned no text. */
export function extractText(result: McpToolCallResult): string {
  if (result.isError) {
    const message = result.content.find((c) => c.type === "text")?.text ?? "Unknown MCP tool error";
    throw new ProviderError(message);
  }
  const text = result.content.find((c) => c.type === "text")?.text;
  if (text === undefined) {
    throw new ProviderError("MCP tool call returned no text content");
  }
  return text;
}
