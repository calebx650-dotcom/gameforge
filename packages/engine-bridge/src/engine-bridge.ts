export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TransformData {
  position: Vector3;
  rotationEuler: Vector3;
  scale: Vector3;
}

export interface ComponentData {
  type: string;
  properties: Record<string, unknown>;
}

export interface SceneObjectSummary {
  path: string;
  name: string;
  active: boolean;
}

export interface SceneObjectDetail extends SceneObjectSummary {
  transform: TransformData;
  components: ComponentData[];
}

export interface SceneInfo {
  name: string;
  objects: SceneObjectSummary[];
}

export interface CreateObjectRequest {
  name: string;
  parentPath?: string;
  /** Engine-provided primitive to start from, e.g. "cube", "sphere", "empty". */
  primitive?: string;
}

export interface ConsoleMessage {
  level: "log" | "warning" | "error";
  message: string;
  stackTrace?: string;
}

export interface ScreenshotResult {
  base64Png: string;
  width?: number;
  height?: number;
}

export interface BuildResult {
  success: boolean;
  outputPath?: string;
  errors?: string[];
}

/**
 * Behind this interface: any game engine's editor-automation surface
 * (Unity via unity-mcp, Godot via a custom EditorPlugin protocol, a future
 * Unreal adapter via its Remote Control API). The verbs are deliberately
 * generic — "create an object," "modify a transform," not "instantiate a
 * GameObject" — so the agent/tool layer above never needs to know which
 * engine it's talking to, the same way it never needs to know which LLM
 * vendor or which generation vendor it's talking to.
 */
export interface EngineBridge {
  readonly id: string;
  readonly displayName: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  inspectScene(): Promise<SceneInfo>;
  inspectObject(path: string): Promise<SceneObjectDetail>;
  createObject(request: CreateObjectRequest): Promise<SceneObjectSummary>;
  modifyObject(path: string, changes: { name?: string; active?: boolean }): Promise<void>;
  modifyTransform(path: string, transform: Partial<TransformData>): Promise<void>;
  modifyComponent(path: string, componentType: string, properties: Record<string, unknown>): Promise<void>;
  saveScene(): Promise<void>;
  enterPlayMode(): Promise<void>;
  exitPlayMode(): Promise<void>;
  /**
   * The fast "did my last edit compile" signal a build/fix repair loop
   * needs — force a recompile and report whether the result has errors —
   * not necessarily a full distributable player/export build. See
   * `UnityBridge.buildProject()`'s doc comment for why those are
   * deliberately different operations.
   */
  buildProject(options?: { target?: string }): Promise<BuildResult>;
  captureScreenshot(): Promise<ScreenshotResult>;
  readConsole(options?: { maxMessages?: number }): Promise<ConsoleMessage[]>;
}
