import type { EngineBridge } from "@gameforge/engine-bridge";

export const ENGINE_TOOL_NAMES = [
  "inspect_scene",
  "inspect_object",
  "create_object",
  "modify_object",
  "modify_transform",
  "modify_component",
  "save_scene",
  "enter_play_mode",
  "exit_play_mode",
  "build_project",
  "capture_screenshot",
  "read_console",
] as const;

export function isEngineTool(name: string): boolean {
  return (ENGINE_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Dispatches an engine tool call to whichever EngineBridge is configured
 * for this session (Unity via unity-mcp, Godot via GameForge's own bridge
 * plugin protocol — see packages/engine-bridge). Connects lazily on first
 * use so the caller doesn't need a separate "connect" tool call. A tool
 * call with no bridge configured fails with a clear message, same pattern
 * as the generation tools' `requireProvider`.
 */
export async function dispatchEngineTool(name: string, args: Record<string, unknown>, bridge: EngineBridge | undefined): Promise<string> {
  if (!bridge) {
    throw new Error("No engine bridge configured for this session — connect a Unity or Godot bridge in the engine settings first.");
  }
  if (!bridge.isConnected()) {
    await bridge.connect();
  }

  switch (name) {
    case "inspect_scene":
      return JSON.stringify(await bridge.inspectScene());
    case "inspect_object":
      return JSON.stringify(await bridge.inspectObject(String(args.path)));
    case "create_object":
      return JSON.stringify(
        await bridge.createObject({
          name: String(args.name),
          parentPath: args.parentPath as string | undefined,
          primitive: args.primitive as string | undefined,
        }),
      );
    case "modify_object":
      await bridge.modifyObject(String(args.path), {
        name: args.name as string | undefined,
        active: args.active as boolean | undefined,
      });
      return `Modified ${args.path}`;
    case "modify_transform":
      await bridge.modifyTransform(String(args.path), {
        position: args.position as { x: number; y: number; z: number } | undefined,
        rotationEuler: args.rotationEuler as { x: number; y: number; z: number } | undefined,
        scale: args.scale as { x: number; y: number; z: number } | undefined,
      });
      return `Transformed ${args.path}`;
    case "modify_component":
      await bridge.modifyComponent(String(args.path), String(args.componentType), (args.properties as Record<string, unknown>) ?? {});
      return `Modified component ${args.componentType} on ${args.path}`;
    case "save_scene":
      await bridge.saveScene();
      return "Scene saved.";
    case "enter_play_mode":
      await bridge.enterPlayMode();
      return "Entered play mode.";
    case "exit_play_mode":
      await bridge.exitPlayMode();
      return "Exited play mode.";
    case "build_project": {
      const result = await bridge.buildProject({ target: args.target as string | undefined });
      return JSON.stringify(result);
    }
    case "capture_screenshot": {
      const result = await bridge.captureScreenshot();
      return JSON.stringify(result);
    }
    case "read_console": {
      const messages = await bridge.readConsole({ maxMessages: args.maxMessages as number | undefined });
      return JSON.stringify(messages);
    }
    default:
      throw new Error(`No engine tool implementation for: ${name}`);
  }
}
