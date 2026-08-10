import { afterEach, describe, expect, it, vi } from "vitest";
import { McpHttpClient, extractText } from "./mcp-client.js";

const SESSION_ID = "test-session-id";

/**
 * Stands in for a real MCP "Streamable HTTP" server: requires the `initialize`
 * handshake (returning an `Mcp-Session-Id` response header, as verified live
 * against `mcp-for-unity` — see UNITY_BRIDGE.md), tolerates the
 * `notifications/initialized` follow-up, and otherwise dispatches to `handler`.
 * `sse` controls whether non-handshake responses are framed as the server's
 * real `text/event-stream` bodies or plain JSON, since the transport allows both.
 */
function mockMcpServer(handler: (body: any) => unknown, opts: { sse?: boolean } = {}) {
  const sse = opts.sse ?? true;
  globalThis.fetch = vi.fn(async (url, init) => {
    expect(url).toBe("http://127.0.0.1:6400/mcp");
    const body = JSON.parse((init as RequestInit).body as string);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json, text/event-stream");

    if (body.method === "initialize") {
      const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
      return new Response(sse ? `event: message\ndata: ${payload}\n\n` : payload, {
        status: 200,
        headers: {
          "Mcp-Session-Id": SESSION_ID,
          "Content-Type": sse ? "text/event-stream" : "application/json",
        },
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }

    expect(headers["Mcp-Session-Id"]).toBe(SESSION_ID);
    const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) });
    return new Response(sse ? `event: message\ndata: ${payload}\n\n` : payload, {
      status: 200,
      headers: { "Content-Type": sse ? "text/event-stream" : "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("McpHttpClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("opens a session against POST {baseUrl}/mcp before the first call", async () => {
    const calls: string[] = [];
    mockMcpServer((body) => {
      calls.push(body.method);
      return { tools: [] };
    });

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    await client.listTools();

    // fetch is called for initialize + notifications/initialized + the real request,
    // but only the real request reaches the test's handler.
    expect(calls).toEqual(["tools/list"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("reuses one session across multiple calls instead of re-initializing", async () => {
    mockMcpServer(() => ({ tools: [] }));
    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });

    await client.listTools();
    await client.listTools();

    const initializeCalls = (globalThis.fetch as any).mock.calls.filter(
      ([, init]: [unknown, RequestInit]) => JSON.parse(init.body as string).method === "initialize",
    );
    expect(initializeCalls).toHaveLength(1);
  });

  it("sends a JSON-RPC 2.0 tools/list request and returns the tool list", async () => {
    let capturedBody: any;
    mockMcpServer((body) => {
      capturedBody = body;
      return { tools: [{ name: "manage_scene" }] };
    });

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    const tools = await client.listTools();

    expect(capturedBody).toMatchObject({ jsonrpc: "2.0", method: "tools/list", params: {} });
    expect(tools).toEqual([{ name: "manage_scene" }]);
  });

  it("sends a tools/call request with the tool name and arguments", async () => {
    let capturedBody: any;
    mockMcpServer((body) => {
      capturedBody = body;
      return { content: [{ type: "text", text: "ok" }] };
    });

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    const result = await client.callTool("manage_scene", { action: "save" });

    expect(capturedBody.method).toBe("tools/call");
    expect(capturedBody.params).toEqual({ name: "manage_scene", arguments: { action: "save" } });
    expect(result.content[0].text).toBe("ok");
  });

  it("parses a plain application/json response the same as an event-stream one", async () => {
    mockMcpServer(() => ({ tools: [{ name: "manage_scene" }] }), { sse: false });

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    const tools = await client.listTools();

    expect(tools).toEqual([{ name: "manage_scene" }]);
  });

  it("throws a ProviderError when the JSON-RPC response contains an error", async () => {
    mockMcpServer(() => {
      throw new Error("unreachable"); // overridden below
    });
    // Override just the real-call branch to return an error envelope.
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
        });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "no such tool" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    await expect(client.callTool("nonexistent", {})).rejects.toThrow(/no such tool/);
  });

  it("wraps network failures in a retryable ProviderError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    await expect(client.listTools()).rejects.toThrow(/Failed to reach MCP server/);
  });

  it("throws when initialize succeeds but omits the Mcp-Session-Id header", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    await expect(client.listTools()).rejects.toThrow(/did not return a Mcp-Session-Id header/);
  });
});

describe("extractText", () => {
  it("returns the first text block", () => {
    expect(extractText({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });

  it("throws when the result is marked as an error", () => {
    expect(() => extractText({ content: [{ type: "text", text: "boom" }], isError: true })).toThrow("boom");
  });

  it("throws when there is no text content", () => {
    expect(() => extractText({ content: [{ type: "image" }] })).toThrow(/no text content/);
  });
});
