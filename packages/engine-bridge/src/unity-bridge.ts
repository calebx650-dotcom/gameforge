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
  /** Forwarded to McpHttpClient — see its doc comment for what aborting mid-call does. */
  signal?: AbortSignal;
}

/**
 * Adapter for CoplayDev/unity-mcp (see UNITY_BRIDGE.md for why this
 * project over a from-scratch bridge). Maps GameForge's generic
 * `EngineBridge` verbs onto unity-mcp's tool set: `manage_scene`,
 * `manage_gameobject`, `manage_editor`, `read_console`. `connect()` and
 * `readConsole()` were verified live against a real Unity Editor + running
 * `unity-mcp` 10.1.2 server on 2026-08-09 (see UNITY_BRIDGE.md's "Real
 * verification results" — this is where `readConsole()`'s `format: "json"`
 * requirement and log-type mapping came from). The remaining tool calls
 * still follow unity-mcp's documented shapes without having been exercised
 * against a live server; if the real tool surface differs for one of them,
 * the fix is confined to this one file.
 */
export class UnityBridge implements EngineBridge {
  readonly id = "unity-mcp";
  readonly displayName = "Unity (via unity-mcp)";

  private readonly client: McpHttpClient;
  private connected = false;

  constructor(config: UnityBridgeConfig = {}) {
    // 8080 is unity-mcp's real HTTP-transport default (confirmed live 2026-08-09 — see
    // UNITY_BRIDGE.md). 6400 is the legacy stdio-mode bridge's TCP port, not an HTTP
    // JSON-RPC listener; McpHttpClient can't talk to it.
    this.client = new McpHttpClient({ baseUrl: config.baseUrl ?? "http://127.0.0.1:8080", signal: config.signal });
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

  /**
   * "Build" here means the fast, iterate-friendly signal a script-editing
   * repair loop actually needs — force Unity to recompile and report
   * whether the result has compiler errors — not a full distributable
   * player build. Those are genuinely different unity-mcp tools:
   * `manage_build` (real player build via `BuildPipeline.BuildPlayer`) is
   * async/pollable and can take up to 30 minutes, the wrong shape for
   * "did my last edit compile"; `refresh_unity` forces recompilation and,
   * with `wait_for_ready: true`, blocks the call until Unity is done
   * (confirmed live against mcp-for-unity 10.1.2 — see UNITY_BRIDGE.md).
   * A real player build is deliberately out of scope for this method; a
   * caller that specifically needs one should be a distinct capability,
   * not this one, since it needs the async poll protocol `manage_build`
   * actually requires.
   */
  async buildProject(_options: { target?: string } = {}): Promise<BuildResult> {
    await this.client.callTool("refresh_unity", {
      mode: "force",
      scope: "scripts",
      compile: "request",
      wait_for_ready: true,
    });
    const messages = await this.readConsole({ maxMessages: 100 });
    const errors = messages.filter((m) => m.level === "error").map((m) => m.message);
    return { success: errors.length === 0, errors: errors.length ? errors : undefined };
  }

  async captureScreenshot(): Promise<ScreenshotResult> {
    const result = await this.client.callTool("capture_screenshot", {});
    const base64 = result.content.find((c) => c.type === "image")?.text;
    if (!base64) throw new ProviderError("unity-mcp capture_screenshot returned no image content");
    return { base64Png: base64 };
  }

  async readConsole(options: { maxMessages?: number } = {}): Promise<ConsoleMessage[]> {
    // format:"json" is required to get structured entries — the tool's default/"plain"
    // format returns raw formatted strings, not {type, message, ...} objects (confirmed
    // live 2026-08-09 against mcp-for-unity 10.1.2 — see UNITY_BRIDGE.md).
    const result = await this.client.callTool("read_console", {
      action: "get",
      count: options.maxMessages ?? 50,
      format: "json",
    });
    const parsed = JSON.parse(extractText(result)) as {
      data: Array<{ type: string; message: string; stackTrace?: string | null }>;
    };
    return parsed.data.map((entry) => ({
      level: mapUnityLogType(entry.type),
      message: entry.message,
      stackTrace: entry.stackTrace ?? undefined,
    }));
  }
}

/** Maps unity-mcp's Unity `LogType` names (`Log`/`Warning`/`Error`/`Exception`/`Assert`) onto `ConsoleMessage["level"]`. */
function mapUnityLogType(type: string): ConsoleMessage["level"] {
  const normalized = type.toLowerCase();
  if (normalized === "warning") return "warning";
  if (normalized === "error" || normalized === "exception" || normalized === "assert") return "error";
  return "log";
}
