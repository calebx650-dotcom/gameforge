import { afterEach, describe, expect, it, vi } from "vitest";
import { McpHttpClient, extractText } from "./mcp-client.js";

describe("McpHttpClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a JSON-RPC 2.0 tools/list request and returns the tool list", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: capturedBody.id, result: { tools: [{ name: "manage_scene" }] } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    const tools = await client.listTools();

    expect(capturedBody).toMatchObject({ jsonrpc: "2.0", method: "tools/list", params: {} });
    expect(tools).toEqual([{ name: "manage_scene" }]);
  });

  it("sends a tools/call request with the tool name and arguments", async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedBody = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: capturedBody.id, result: { content: [{ type: "text", text: "ok" }] } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new McpHttpClient({ baseUrl: "http://127.0.0.1:6400" });
    const result = await client.callTool("manage_scene", { action: "save" });

    expect(capturedBody.method).toBe("tools/call");
    expect(capturedBody.params).toEqual({ name: "manage_scene", arguments: { action: "save" } });
    expect(result.content[0].text).toBe("ok");
  });

  it("throws a ProviderError when the JSON-RPC response contains an error", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { message: "no such tool" } }), { status: 200 });
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
