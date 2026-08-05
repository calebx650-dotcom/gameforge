import { ProviderError } from "@gameforge/shared";
import { McpHttpClient, extractText } from "./mcp-client.js";
import type {
  BuildResult,
  ComponentData,
  ConsoleMessage,
  CreateObjectRequest,
  EngineBridge,
  SceneInfo,
  SceneObjectDetail,
  SceneObjectSummary,
  ScreenshotResult,
  TransformData,
} from "./engine-bridge.js";

export interface UnityBridgeConfig {
  /** Base URL of a locally-running unity-mcp server (started by the Unity Editor package). */
  baseUrl?: string;
}

/**
 * Adapter for CoplayDev/unity-mcp (see UNITY_BRIDGE.md for why this
 * project over a from-scratch bridge). Maps GameForge's generic
 * `EngineBridge` verbs onto unity-mcp's tool set: `manage_scene`,
 * `manage_gameobject`, `manage_editor`, `read_console`. The exact tool
 * names and argument shapes here follow unity-mcp's public documentation
 * as closely as possible but — like the Meshy/Tripo3D/DeepMotion cloud
 * adapters — have not been exercised against a live unity-mcp server or
 * Unity Editor in this environment (neither is installed here). If the
 * real tool surface differs, the fix is confined to this one file.
 */
export class UnityBridge implements EngineBridge {
  readonly id = "unity-mcp";
  readonly displayName = "Unity (via unity-mcp)";

  private readonly client: McpHttpClient;
  private connected = false;

  constructor(config: UnityBridgeConfig = {}) {
    this.client = new McpHttpClient({ baseUrl: config.baseUrl ?? "http://127.0.0.1:6400" });
  }

  async connect(): Promise<void> {
    await this.client.listTools();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async inspectScene(): Promise<SceneInfo> {
    const result = await this.client.callTool("manage_scene", { action: "get_hierarchy" });
    const data = JSON.parse(extractText(result)) as { name: string; objects: Array<{ path: string; name: string; active: boolean }> };
    return { name: data.name, objects: data.objects };
  }

  async inspectObject(path: string): Promise<SceneObjectDetail> {
    const result = await this.client.callTool("manage_gameobject", { action: "get", target: path });
    const data = JSON.parse(extractText(result)) as {
      path: string;
      name: string;
      active: boolean;
      transform: TransformData;
      components: ComponentData[];
    };
    return data;
  }

  async createObject(request: CreateObjectRequest): Promise<SceneObjectSummary> {
    const result = await this.client.callTool("manage_gameobject", {
      action: "create",
      name: request.name,
      parent: request.parentPath,
      primitive_type: request.primitive,
    });
    const data = JSON.parse(extractText(result)) as SceneObjectSummary;
    return data;
  }

  async modifyObject(path: string, changes: { name?: string; active?: boolean }): Promise<void> {
    await this.client.callTool("manage_gameobject", { action: "modify", target: path, ...changes });
  }

  async modifyTransform(path: string, transform: Partial<TransformData>): Promise<void> {
    await this.client.callTool("manage_gameobject", {
      action: "modify",
      target: path,
      position: transform.position,
      rotation: transform.rotationEuler,
      scale: transform.scale,
    });
  }

  async modifyComponent(path: string, componentType: string, properties: Record<string, unknown>): Promise<void> {
    await this.client.callTool("manage_gameobject", {
      action: "set_component_property",
      target: path,
      component_type: componentType,
      properties,
    });
  }

  async saveScene(): Promise<void> {
    await this.client.callTool("manage_scene", { action: "save" });
  }

  async enterPlayMode(): Promise<void> {
    await this.client.callTool("manage_editor", { action: "play" });
  }

  async exitPlayMode(): Promise<void> {
    await this.client.callTool("manage_editor", { action: "stop" });
  }

  async buildProject(options: { target?: string } = {}): Promise<BuildResult> {
    const result = await this.client.callTool("manage_editor", { action: "build", target: options.target });
    const data = JSON.parse(extractText(result)) as BuildResult;
    return data;
  }

  async captureScreenshot(): Promise<ScreenshotResult> {
    const result = await this.client.callTool("capture_screenshot", {});
    const base64 = result.content.find((c) => c.type === "image")?.text;
    if (!base64) throw new ProviderError("unity-mcp capture_screenshot returned no image content");
    return { base64Png: base64 };
  }

  async readConsole(options: { maxMessages?: number } = {}): Promise<ConsoleMessage[]> {
    const result = await this.client.callTool("read_console", { action: "get", count: options.maxMessages ?? 50 });
    const data = JSON.parse(extractText(result)) as ConsoleMessage[];
    return data;
  }
}
