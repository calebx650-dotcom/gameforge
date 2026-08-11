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

export interface TestRunOptions {
  /** Defaults to "EditMode" (the engine's own default) if omitted. */
  mode?: "EditMode" | "PlayMode";
  testNames?: string[];
  groupNames?: string[];
  categoryNames?: string[];
  assemblyNames?: string[];
  includeDetails?: boolean;
  includeFailedTests?: boolean;
}

export interface TestFailure {
  fullName: string;
  message: string;
}

export interface TestRunResult {
  jobId: string;
  status: "succeeded" | "failed" | "timed_out";
  mode?: string;
  /** Progress at the moment polling stopped — present even on "timed_out" so a caller can see how far it got. */
  completed?: number;
  total?: number;
  failuresSoFar?: TestFailure[];
  /** Set when status is "failed"/"timed_out" — a run-level error (couldn't start, aborted), not a single failing test. */
  error?: string;
  /**
   * The engine's own per-test result payload once status is "succeeded" —
   * passed through as-is, not typed further. See `UnityBridge.runTests()`'s
   * doc comment for why: the exact field shape wasn't confirmed against
   * source the way the rest of this method's fields were.
   */
  result?: unknown;
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
  /**
   * Runs the engine's own test suite (or a filtered subset) and blocks
   * until it settles, the same submit-then-poll-internally convention
   * `packages/tools`' generation tools use — simpler for the model than
   * exposing raw submit/poll tools it would have to remember to call in
   * sequence, at the cost of holding one agent iteration open for the
   * run's duration.
   */
  runTests(options?: TestRunOptions): Promise<TestRunResult>;
}
