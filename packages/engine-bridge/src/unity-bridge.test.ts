import { afterEach, describe, expect, it, vi } from "vitest";
import { UnityBridge } from "./unity-bridge.js";

const SESSION_ID = "test-session-id";

/**
 * Stands in for a real MCP "Streamable HTTP" server (see mcp-client.test.ts for the
 * protocol details this mirrors): handles the `initialize`/`notifications/initialized`
 * handshake McpHttpClient now performs before every real request, then dispatches to
 * `handler` for the actual tool call.
 */
function mockMcpResponse(handler: (body: any) => unknown) {
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string);
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
        status: 200,
        headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
      });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("UnityBridge", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("connects by listing tools", async () => {
    mockMcpResponse(() => ({ tools: [{ name: "manage_scene" }] }));
    const bridge = new UnityBridge();
    expect(bridge.isConnected()).toBe(false);
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
  });

  it("inspects the scene via manage_scene get_hierarchy", async () => {
    let capturedArgs: any;
    mockMcpResponse((body) => {
      capturedArgs = body.params.arguments;
      return { content: [{ type: "text", text: JSON.stringify({ name: "MainScene", objects: [{ path: "/Player", name: "Player", active: true }] }) }] };
    });
    const bridge = new UnityBridge();
    const scene = await bridge.inspectScene();
    expect(capturedArgs).toEqual({ action: "get_hierarchy" });
    expect(scene.name).toBe("MainScene");
    expect(scene.objects[0].path).toBe("/Player");
  });

  it("creates an object via manage_gameobject create", async () => {
    let capturedArgs: any;
    mockMcpResponse((body) => {
      capturedArgs = body.params.arguments;
      return { content: [{ type: "text", text: JSON.stringify({ path: "/Cube", name: "Cube", active: true }) }] };
    });
    const bridge = new UnityBridge();
    const result = await bridge.createObject({ name: "Cube", primitive: "cube" });
    expect(capturedArgs).toMatchObject({ action: "create", name: "Cube", primitive_type: "cube" });
    expect(result.path).toBe("/Cube");
  });

  it("modifies a transform via manage_gameobject modify", async () => {
    let capturedArgs: any;
    mockMcpResponse((body) => {
      capturedArgs = body.params.arguments;
      return { content: [{ type: "text", text: "{}" }] };
    });
    const bridge = new UnityBridge();
    await bridge.modifyTransform("/Player", { position: { x: 1, y: 2, z: 3 } });
    expect(capturedArgs).toMatchObject({ action: "modify", target: "/Player", position: { x: 1, y: 2, z: 3 } });
  });

  it("enters and exits play mode via manage_editor", async () => {
    const calls: string[] = [];
    mockMcpResponse((body) => {
      calls.push(body.params.arguments.action);
      return { content: [{ type: "text", text: "{}" }] };
    });
    const bridge = new UnityBridge();
    await bridge.enterPlayMode();
    await bridge.exitPlayMode();
    expect(calls).toEqual(["play", "stop"]);
  });

  it("captures a screenshot from image content", async () => {
    mockMcpResponse(() => ({ content: [{ type: "image", text: "base64data" }] }));
    const bridge = new UnityBridge();
    const screenshot = await bridge.captureScreenshot();
    expect(screenshot.base64Png).toBe("base64data");
  });

  it("reads the console via read_console, unwrapping the real {data:[...]} envelope and mapping log types", async () => {
    let capturedArgs: any;
    mockMcpResponse((body) => {
      capturedArgs = body.params.arguments;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              data: [
                { type: "Error", message: "NullReferenceException", stackTrace: "at Foo.Bar()" },
                { type: "Warning", message: "deprecated API", stackTrace: null },
                { type: "Log", message: "hello" },
              ],
            }),
          },
        ],
      };
    });
    const bridge = new UnityBridge();
    const messages = await bridge.readConsole();

    expect(capturedArgs).toMatchObject({ action: "get", format: "json" });
    expect(messages).toEqual([
      { level: "error", message: "NullReferenceException", stackTrace: "at Foo.Bar()" },
      { level: "warning", message: "deprecated API", stackTrace: undefined },
      { level: "log", message: "hello", stackTrace: undefined },
    ]);
  });

  it("buildProject() forces a real recompile via refresh_unity, not manage_editor, and reports success on a clean console", async () => {
    const calledTools: string[] = [];
    let refreshArgs: any;
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      calledTools.push(body.params.name);
      let result: unknown;
      if (body.params.name === "refresh_unity") {
        refreshArgs = body.params.arguments;
        result = { content: [{ type: "text", text: JSON.stringify({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" }) }] };
      } else if (body.params.name === "read_console") {
        result = { content: [{ type: "text", text: JSON.stringify({ success: true, data: [] }) }] };
      } else {
        throw new Error(`unexpected tool call in test: ${body.params.name}`);
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(calledTools).toEqual(["refresh_unity", "read_console"]);
    expect(refreshArgs).toMatchObject({ mode: "force", scope: "scripts", compile: "request", wait_for_ready: true });
    expect(result).toEqual({ success: true, errors: undefined });
  });

  it("buildProject() reports failure with the real compiler error text when the console has errors after recompiling", async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      let result: unknown;
      if (body.params.name === "refresh_unity") {
        result = { content: [{ type: "text", text: JSON.stringify({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" }) }] };
      } else {
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: [{ type: "Error", message: "CS1002: ; expected", stackTrace: null }],
              }),
            },
          ],
        };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(result).toEqual({ success: false, errors: ["CS1002: ; expected"] });
  });
});
