import { GodotWsClient } from "./godot-ws-client.js";
import type {
  BuildResult,
  ConsoleMessage,
  CreateObjectRequest,
  EngineBridge,
  SceneInfo,
  SceneObjectDetail,
  SceneObjectSummary,
  ScreenshotResult,
  TransformData,
} from "./engine-bridge.js";

export interface GodotBridgeConfig {
  /** WebSocket URL of a locally-running Godot EditorPlugin bridge. */
  url?: string;
}

/**
 * Adapter for a Godot EditorPlugin speaking GameForge's own WebSocket
 * command protocol (see `GodotWsClient`) — proof that `EngineBridge` isn't
 * secretly Unity-shaped. There is no dominant existing Godot MCP bridge to
 * adopt the way `unity-mcp` was adopted for Unity, so this defines the
 * simplest command set a GDScript plugin would need to implement:
 * `scene.get_hierarchy`, `scene.get_object`, `scene.create_object`,
 * `scene.modify_object`, `scene.modify_transform`, `scene.set_property`,
 * `scene.save`, `editor.play`, `editor.stop`, `editor.build`,
 * `editor.screenshot`, `editor.read_console`. None of this has been run
 * against a real Godot Editor or plugin in this environment (no Godot
 * install here) — see PROVIDERS.md/ROADMAP.md for that caveat, matching
 * every other adapter in this codebase that talks to a tool this sandbox
 * doesn't have.
 */
export class GodotBridge implements EngineBridge {
  readonly id = "godot-bridge";
  readonly displayName = "Godot (via GameForge bridge plugin)";

  private readonly client: GodotWsClient;

  constructor(config: GodotBridgeConfig = {}) {
    this.client = new GodotWsClient({ url: config.url ?? "ws://127.0.0.1:6401" });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  async inspectScene(): Promise<SceneInfo> {
    return (await this.client.send("scene.get_hierarchy")) as SceneInfo;
  }

  async inspectObject(path: string): Promise<SceneObjectDetail> {
    return (await this.client.send("scene.get_object", { path })) as SceneObjectDetail;
  }

  async createObject(request: CreateObjectRequest): Promise<SceneObjectSummary> {
    return (await this.client.send("scene.create_object", {
      name: request.name,
      parent: request.parentPath,
      primitive: request.primitive,
    })) as SceneObjectSummary;
  }

  async modifyObject(path: string, changes: { name?: string; active?: boolean }): Promise<void> {
    await this.client.send("scene.modify_object", { path, ...changes });
  }

  async modifyTransform(path: string, transform: Partial<TransformData>): Promise<void> {
    await this.client.send("scene.modify_transform", { path, ...transform });
  }

  async modifyComponent(path: string, componentType: string, properties: Record<string, unknown>): Promise<void> {
    // Godot's closest equivalent to a Unity "component" is a Node of a given class/script;
    // "componentType" here maps to the node's script/class name.
    await this.client.send("scene.set_property", { path, node_class: componentType, properties });
  }

  async saveScene(): Promise<void> {
    await this.client.send("scene.save");
  }

  async enterPlayMode(): Promise<void> {
    await this.client.send("editor.play");
  }

  async exitPlayMode(): Promise<void> {
    await this.client.send("editor.stop");
  }

  async buildProject(options: { target?: string } = {}): Promise<BuildResult> {
    return (await this.client.send("editor.build", { target: options.target })) as BuildResult;
  }

  async captureScreenshot(): Promise<ScreenshotResult> {
    return (await this.client.send("editor.screenshot")) as ScreenshotResult;
  }

  async readConsole(options: { maxMessages?: number } = {}): Promise<ConsoleMessage[]> {
    return (await this.client.send("editor.read_console", { count: options.maxMessages ?? 50 })) as ConsoleMessage[];
  }
}
