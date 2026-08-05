import { ProviderError } from "@gameforge/shared";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface McpClientConfig {
  baseUrl: string;
}

let requestCounter = 0;

/**
 * A minimal client for the Model Context Protocol's JSON-RPC-over-HTTP
 * transport: every call is a `{jsonrpc: "2.0", method, params, id}` POST,
 * every response is `{jsonrpc: "2.0", id, result}` or `{..., error}`.
 * This is the real MCP wire format (the same one `unity-mcp` and any other
 * MCP server speak) — not something specific to Unity. Engine-specific
 * bridges (`UnityBridge`) build on top of this generic client rather than
 * each reimplementing JSON-RPC framing.
 */
export class McpHttpClient {
  private readonly baseUrl: string;

  constructor(config: McpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request<{ tools: McpToolInfo[] }>("tools/list", {});
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    return this.request<McpToolCallResult>("tools/call", { name, arguments: args });
  }

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++requestCounter;
    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (err) {
      throw new ProviderError(`Failed to reach MCP server at ${this.baseUrl}: ${(err as Error).message}`, true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(`MCP server returned ${res.status}: ${text}`, res.status >= 500);
    }
    const body = (await res.json()) as { result?: T; error?: { message: string; code?: number } };
    if (body.error) {
      throw new ProviderError(`MCP call "${method}" failed: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new ProviderError(`MCP call "${method}" returned no result`);
    }
    return body.result;
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
