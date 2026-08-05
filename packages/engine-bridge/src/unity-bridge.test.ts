import { afterEach, describe, expect, it, vi } from "vitest";
import { UnityBridge } from "./unity-bridge.js";

function mockMcpResponse(handler: (body: any) => unknown) {
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) }), { status: 200 });
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
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "image", text: "base64data" }] } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const bridge = new UnityBridge();
    const screenshot = await bridge.captureScreenshot();
    expect(screenshot.base64Png).toBe("base64data");
  });

  it("reads the console via read_console", async () => {
    mockMcpResponse(() => ({ content: [{ type: "text", text: JSON.stringify([{ level: "error", message: "NullReferenceException" }]) }] }));
    const bridge = new UnityBridge();
    const messages = await bridge.readConsole();
    expect(messages[0].message).toBe("NullReferenceException");
  });
});
