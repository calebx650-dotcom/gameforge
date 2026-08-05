import { describe, expect, it, vi } from "vitest";
import { dispatchEngineTool, isEngineTool } from "./engine-tools.js";
import type { EngineBridge } from "@gameforge/engine-bridge";

function fakeBridge(overrides: Partial<EngineBridge> = {}): EngineBridge {
  let connected = false;
  return {
    id: "fake",
    displayName: "Fake",
    connect: vi.fn(async () => {
      connected = true;
    }),
    disconnect: vi.fn(async () => {
      connected = false;
    }),
    isConnected: vi.fn(() => connected),
    inspectScene: vi.fn(async () => ({ name: "Scene", objects: [] })),
    inspectObject: vi.fn(async () => ({ path: "/A", name: "A", active: true, transform: { position: { x: 0, y: 0, z: 0 }, rotationEuler: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, components: [] })),
    createObject: vi.fn(async () => ({ path: "/New", name: "New", active: true })),
    modifyObject: vi.fn(async () => {}),
    modifyTransform: vi.fn(async () => {}),
    modifyComponent: vi.fn(async () => {}),
    saveScene: vi.fn(async () => {}),
    enterPlayMode: vi.fn(async () => {}),
    exitPlayMode: vi.fn(async () => {}),
    buildProject: vi.fn(async () => ({ success: true })),
    captureScreenshot: vi.fn(async () => ({ base64Png: "abc" })),
    readConsole: vi.fn(async () => []),
    ...overrides,
  };
}

describe("isEngineTool", () => {
  it("recognizes engine tool names and rejects everything else", () => {
    expect(isEngineTool("inspect_scene")).toBe(true);
    expect(isEngineTool("capture_screenshot")).toBe(true);
    expect(isEngineTool("read_file")).toBe(false);
  });
});

describe("dispatchEngineTool", () => {
  it("throws a clear error when no bridge is configured", async () => {
    await expect(dispatchEngineTool("inspect_scene", {}, undefined)).rejects.toThrow(/No engine bridge configured/);
  });

  it("connects lazily before dispatching if not already connected", async () => {
    const bridge = fakeBridge();
    await dispatchEngineTool("inspect_scene", {}, bridge);
    expect(bridge.connect).toHaveBeenCalled();
  });

  it("does not reconnect if already connected", async () => {
    const bridge = fakeBridge();
    await bridge.connect();
    await dispatchEngineTool("inspect_scene", {}, bridge);
    expect(bridge.connect).toHaveBeenCalledTimes(1);
  });

  it("dispatches inspect_scene and inspect_object", async () => {
    const bridge = fakeBridge();
    const sceneResult = JSON.parse(await dispatchEngineTool("inspect_scene", {}, bridge));
    expect(sceneResult.name).toBe("Scene");
    const objectResult = JSON.parse(await dispatchEngineTool("inspect_object", { path: "/A" }, bridge));
    expect(bridge.inspectObject).toHaveBeenCalledWith("/A");
    expect(objectResult.path).toBe("/A");
  });

  it("dispatches create_object with the right arguments", async () => {
    const bridge = fakeBridge();
    await dispatchEngineTool("create_object", { name: "Cube", primitive: "cube" }, bridge);
    expect(bridge.createObject).toHaveBeenCalledWith({ name: "Cube", parentPath: undefined, primitive: "cube" });
  });

  it("dispatches modify_transform with position/rotation/scale", async () => {
    const bridge = fakeBridge();
    await dispatchEngineTool("modify_transform", { path: "/A", position: { x: 1, y: 2, z: 3 } }, bridge);
    expect(bridge.modifyTransform).toHaveBeenCalledWith("/A", { position: { x: 1, y: 2, z: 3 }, rotationEuler: undefined, scale: undefined });
  });

  it("dispatches enter_play_mode and exit_play_mode", async () => {
    const bridge = fakeBridge();
    await dispatchEngineTool("enter_play_mode", {}, bridge);
    await dispatchEngineTool("exit_play_mode", {}, bridge);
    expect(bridge.enterPlayMode).toHaveBeenCalled();
    expect(bridge.exitPlayMode).toHaveBeenCalled();
  });

  it("dispatches capture_screenshot and returns the image payload", async () => {
    const bridge = fakeBridge();
    const result = JSON.parse(await dispatchEngineTool("capture_screenshot", {}, bridge));
    expect(result.base64Png).toBe("abc");
  });

  it("dispatches read_console with maxMessages", async () => {
    const bridge = fakeBridge();
    await dispatchEngineTool("read_console", { maxMessages: 10 }, bridge);
    expect(bridge.readConsole).toHaveBeenCalledWith({ maxMessages: 10 });
  });
});
