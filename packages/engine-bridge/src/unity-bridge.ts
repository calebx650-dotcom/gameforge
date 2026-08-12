import { ProviderError } from "@gameforge/shared";
import { McpHttpClient, extractText } from "./mcp-client.js";
import type { McpResourceContent, McpToolCallResult } from "./mcp-client.js";
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
  TestFailure,
  TestRunOptions,
  TestRunResult,
  TransformData,
} from "./engine-bridge.js";

export interface UnityBridgeConfig {
  /** Base URL of a locally-running unity-mcp server (started by the Unity Editor package). */
  baseUrl?: string;
  /** Forwarded to McpHttpClient — see its doc comment for what aborting mid-call does. */
  signal?: AbortSignal;
}

/** Every real unity-mcp tool response (confirmed live 2026-08-09/10) wraps its payload in this envelope. */
interface McpToolEnvelope<T> {
  success: boolean;
  message?: string | null;
  error?: string | null;
  data: T;
  hint?: string | null;
}

/**
 * Adapter for CoplayDev/unity-mcp (see UNITY_BRIDGE.md for why this
 * project over a from-scratch bridge). Maps GameForge's generic
 * `EngineBridge` verbs onto unity-mcp's real tool set: `manage_scene`,
 * `manage_gameobject`, `manage_components`, `manage_camera`, `manage_editor`,
 * `find_gameobjects`, `read_console`, plus MCP *resource* reads for
 * per-object detail. `connect()`/`readConsole()`/`buildProject()` were
 * verified live on 2026-08-09 (see UNITY_BRIDGE.md's "Real verification
 * results"). Every remaining method here (`inspectScene`, `inspectObject`,
 * `createObject`, `modifyObject`, `modifyTransform`, `modifyComponent`,
 * `saveScene`, `enterPlayMode`/`exitPlayMode`, `captureScreenshot`) was
 * exercised live for the first time on 2026-08-10 against a real Editor —
 * several had real bugs (wrong tool/action names, or code assuming a flat
 * response shape when the real server wraps every payload in
 * `{success, message, error, data, hint}`). See each method's comment for
 * what the live call actually returned and what was wrong before.
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

  /**
   * Wraps `McpHttpClient.callTool` with a bounded retry for a specific real,
   * reproducible failure mode of mcp-for-unity's own server: the Unity-side
   * WebSocket session between its Python HTTP server and the Editor
   * intermittently hiccups mid-call (confirmed live 2026-08-10 — hit on
   * `read_console`, `find_gameobjects`, and `manage_gameobject` `delete`,
   * ~2 times out of 3 back-to-back calls in one observed run), and the
   * server's own response marks these `"hint": "retry"` — a real signal
   * from the server, not string-matching a message. Any other failure
   * (`success: false` without that hint — e.g. "GameObject not found",
   * a real compile error, a bad argument) is returned as-is on the first
   * try and surfaces immediately; retrying those would just hide a real
   * bug behind a delay.
   */
  private async callToolResilient(name: string, args: Record<string, unknown>, attempts = 3): Promise<McpToolCallResult> {
    for (let attempt = 1; ; attempt++) {
      const result = await this.client.callTool(name, args);
      if (attempt < attempts && isRetryableFailure(result)) {
        await sleep(300 * attempt);
        continue;
      }
      return result;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * `manage_scene`'s `get_hierarchy` action returns `data.items` (each with
   * `path`/`name`/`activeSelf`), not the flat `{name, objects}` this method
   * used to assume — confirmed live 2026-08-10. It also doesn't carry the
   * scene's own name, so that comes from a second real call, `get_active`.
   */
  async inspectScene(): Promise<SceneInfo> {
    const [hierarchy, active] = await Promise.all([
      this.callToolResilient("manage_scene", { action: "get_hierarchy" }).then((r) =>
        unwrap<{ items: Array<{ path: string; name: string; activeSelf: boolean }> }>(r),
      ),
      this.callToolResilient("manage_scene", { action: "get_active" }).then((r) => unwrap<{ name: string }>(r)),
    ]);
    return {
      name: active.name,
      objects: hierarchy.items.map((item) => ({ path: item.path, name: item.name, active: item.activeSelf })),
    };
  }

  /**
   * `manage_gameobject` has no "get" action (real action enum is `create`/
   * `modify`/`delete`/`duplicate`/`move_relative`/`look_at` — confirmed live
   * 2026-08-10 from the tool's real input schema). Per-object detail is
   * exposed as an MCP *resource* instead: `find_gameobjects` resolves a
   * name to an instance ID (paginated, active-only unless
   * `include_inactive: true`), then `mcpforunity://scene/gameobject/{id}`
   * and `.../components` resources return the actual detail.
   */
  async inspectObject(path: string): Promise<SceneObjectDetail> {
    const found = await this.callToolResilient("find_gameobjects", {
      search_term: path,
      search_method: "by_name",
      include_inactive: true,
    }).then((r) => unwrap<{ instanceIDs: number[] }>(r));
    const instanceId = found.instanceIDs[0];
    if (instanceId === undefined) {
      throw new ProviderError(`No GameObject found matching "${path}"`);
    }

    const [obj, comps] = await Promise.all([
      this.client
        .readResource(`mcpforunity://scene/gameobject/${instanceId}`)
        .then((c) => unwrapResource<{ name: string; path: string; active: boolean; transform: { position: TransformData["position"]; rotation: TransformData["rotationEuler"]; scale: TransformData["scale"] } }>(c)),
      this.client
        .readResource(`mcpforunity://scene/gameobject/${instanceId}/components`)
        .then((c) => unwrapResource<{ components: Array<{ typeName: string; instanceID?: number; properties?: Record<string, unknown> } & Record<string, unknown>> }>(c)),
    ]);

    return {
      path: obj.path,
      name: obj.name,
      active: obj.active,
      transform: { position: obj.transform.position, rotationEuler: obj.transform.rotation, scale: obj.transform.scale },
      components: comps.components.map((c): ComponentData => {
        const { typeName, instanceID: _instanceID, properties, ...rest } = c;
        return { type: typeName, properties: properties ?? rest };
      }),
    };
  }

  /**
   * Two real bugs fixed here (confirmed live 2026-08-10): (1) the response
   * is wrapped in `{success, data}` like every other tool, not a flat
   * object; (2) `create_object`'s own tool description tells the calling
   * LLM to pass `primitive: "empty"` for an object with no mesh, but the
   * real `primitive_type` field rejects that literal string
   * (`"Invalid primitive type: 'empty'. Valid types: Sphere, Capsule,
   * Cylinder, Cube, Plane, Quad"` — verified against the live server) —
   * an empty GameObject is created by omitting `primitive_type` entirely.
   */
  async createObject(request: CreateObjectRequest): Promise<SceneObjectSummary> {
    const primitiveType =
      request.primitive && request.primitive.toLowerCase() !== "empty" ? request.primitive : undefined;
    const result = await this.callToolResilient("manage_gameobject", {
      action: "create",
      name: request.name,
      parent: request.parentPath,
      primitive_type: primitiveType,
    });
    const data = unwrap<{ name: string; activeSelf: boolean }>(result);
    return {
      path: request.parentPath ? `${request.parentPath}/${data.name}` : data.name,
      name: data.name,
      active: data.activeSelf,
    };
  }

  /**
   * `manage_gameobject`'s real `modify` action renames via `new_name` and
   * toggles activity via `set_active` — this used to spread `{name, active}`
   * straight through, fields the real tool silently ignores (confirmed live
   * 2026-08-10: renamed/deactivated with the old field names, no error, no
   * effect). Also now checks `success` so a genuine failure throws instead
   * of silently no-op'ing.
   */
  async modifyObject(path: string, changes: { name?: string; active?: boolean }): Promise<void> {
    const result = await this.callToolResilient("manage_gameobject", {
      action: "modify",
      target: path,
      new_name: changes.name,
      set_active: changes.active,
    });
    unwrap(result);
  }

  async modifyTransform(path: string, transform: Partial<TransformData>): Promise<void> {
    const result = await this.callToolResilient("manage_gameobject", {
      action: "modify",
      target: path,
      position: transform.position,
      rotation: transform.rotationEuler,
      scale: transform.scale,
    });
    unwrap(result);
  }

  /**
   * `manage_gameobject` has no `set_component_property` action — component
   * properties are a separate tool, `manage_components`
   * (`action: "set_property"`), confirmed live 2026-08-10.
   */
  async modifyComponent(path: string, componentType: string, properties: Record<string, unknown>): Promise<void> {
    const result = await this.callToolResilient("manage_components", {
      action: "set_property",
      target: path,
      component_type: componentType,
      properties,
    });
    unwrap(result);
  }

  async saveScene(): Promise<void> {
    unwrap(await this.callToolResilient("manage_scene", { action: "save" }));
  }

  async enterPlayMode(): Promise<void> {
    unwrap(await this.callToolResilient("manage_editor", { action: "play" }));
  }

  async exitPlayMode(): Promise<void> {
    unwrap(await this.callToolResilient("manage_editor", { action: "stop" }));
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
    unwrap(
      await this.callToolResilient("refresh_unity", {
        mode: "force",
        scope: "scripts",
        compile: "request",
        wait_for_ready: true,
      }),
    );
    const messages = await this.readConsole({ maxMessages: 100 });
    const errors = messages.filter((m) => m.level === "error").map((m) => m.message);
    return { success: errors.length === 0, errors: errors.length ? errors : undefined };
  }

  /**
   * There is no `capture_screenshot` tool in the real unity-mcp tool set
   * (confirmed live 2026-08-10 — the 48-tool `tools/list` result has no
   * such name). The real capability is `manage_camera`'s `screenshot`
   * action with `include_image: true`, which returns two content blocks: a
   * `text` block with `{success, data: {imageWidth, imageHeight, ...}}`
   * (the usual envelope) and a separate `image` block whose base64 payload
   * lives in `data`, not `text` (a real, generic MCP content-block detail
   * the old code got wrong too — see `McpContentBlock` in mcp-client.ts).
   */
  async captureScreenshot(): Promise<ScreenshotResult> {
    const result = await this.callToolResilient("manage_camera", { action: "screenshot", include_image: true });
    const data = unwrap<{ imageWidth?: number; imageHeight?: number }>(result);
    const base64 = result.content.find((c) => c.type === "image")?.data;
    if (!base64) throw new ProviderError("unity-mcp manage_camera screenshot returned no image content");
    return { base64Png: base64, width: data.imageWidth, height: data.imageHeight };
  }

  /**
   * format:"json" is required to get structured entries — the tool's default/"plain"
   * format returns raw formatted strings, not {type, message, ...} objects (confirmed
   * live 2026-08-09 against mcp-for-unity 10.1.2 — see UNITY_BRIDGE.md).
   *
   * Real bug fixed 2026-08-10: this used to reach straight for
   * `parsed.data.map(...)` without checking `parsed.success` first. The
   * live mcp-for-unity bridge genuinely produces transient failures under
   * this exact shape (`{"success":false,"data":null,"error":"Unity session
   * not ready for 'read_console' (ping not answered); please retry"}` —
   * reproduced live, notably right after an immediately-preceding
   * `tools/list` call) and crashed with `TypeError: Cannot read properties
   * of null (reading 'map')` instead of a clear, catchable error — which is
   * exactly the failure `buildProject()`'s callers (the agent's repair
   * loop) need a real signal for, not a raw JS crash.
   */
  async readConsole(options: { maxMessages?: number } = {}): Promise<ConsoleMessage[]> {
    const result = await this.callToolResilient("read_console", {
      action: "get",
      count: options.maxMessages ?? 50,
      format: "json",
    });
    const data = unwrap<Array<{ type: string; message: string; stackTrace?: string | null }> | null>(result);
    return (data ?? []).map((entry) => ({
      level: mapUnityLogType(entry.type),
      message: entry.message,
      stackTrace: entry.stackTrace ?? undefined,
    }));
  }

  /**
   * `run_tests`/`get_test_job` are a submit-then-poll async job pair (read
   * from real unity-mcp source — `Editor/Tools/RunTests.cs`,
   * `Editor/Services/TestJobManager.cs` — the same way `buildProject`'s fix
   * was found; see UNITY_BRIDGE.md). `run_tests` returns a `job_id`
   * immediately; `get_test_job` reports `TestJobManager.ToSerializable()`'s
   * real fields — `job_id`/`status`("running"/"succeeded"/"failed")/`mode`/
   * `progress`(`completed`,`total`,`failures_so_far`,...)/`error`/`result`.
   * The `result` field (the engine's own per-test payload once succeeded)
   * is passed through as `unknown` rather than typed further: its exact
   * shape (`TestRunResult.ToSerializable()` server-side, a different class
   * from this method's own `TestRunResult` return type despite the name
   * collision) wasn't confirmed against source the way everything else
   * here was. This method also assumes both tools wrap their payload in
   * `{success, data}`, matching the confirmed shape of `read_console`'s
   * response — not independently confirmed for these two tools specifically,
   * since a live server to check against wasn't available while writing
   * this. Not yet exercised against a live Editor.
   */
  async runTests(options: TestRunOptions = {}): Promise<TestRunResult> {
    const submitResult = await this.client.callTool("run_tests", {
      mode: options.mode ?? "EditMode",
      testNames: options.testNames,
      groupNames: options.groupNames,
      categoryNames: options.categoryNames,
      assemblyNames: options.assemblyNames,
      includeDetails: options.includeDetails,
      includeFailedTests: options.includeFailedTests,
    });
    const submitted = JSON.parse(extractText(submitResult)) as { job_id: string; status: string; mode?: string };
    const jobId = submitted.job_id;

    const pollIntervalMs = 2000;
    const timeoutMs = 5 * 60 * 1000; // Unity test runs can genuinely take minutes, unlike the sub-second refresh_unity poll in buildProject().
    const startedAt = Date.now();

    while (true) {
      const jobResult = await this.client.callTool("get_test_job", {
        job_id: jobId,
        includeDetails: options.includeDetails,
        includeFailedTests: options.includeFailedTests,
      });
      const parsed = JSON.parse(extractText(jobResult)) as { data?: UnityTestJobPayload } & UnityTestJobPayload;
      const job = parsed.data ?? parsed;

      if (job.status !== "running") {
        return unityTestJobToResult(job);
      }
      if (Date.now() - startedAt > timeoutMs) {
        return {
          jobId,
          status: "timed_out",
          mode: job.mode,
          completed: job.progress?.completed,
          total: job.progress?.total,
          failuresSoFar: job.progress?.failures_so_far?.map(toTestFailure),
          error: `Timed out after ${timeoutMs}ms waiting for test job ${jobId}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

interface UnityTestJobPayload {
  job_id: string;
  status: string;
  mode?: string;
  error?: string;
  result?: unknown;
  progress?: {
    completed?: number;
    total?: number;
    failures_so_far?: Array<{ full_name: string; message: string }>;
  };
}

function toTestFailure(f: { full_name: string; message: string }): TestFailure {
  return { fullName: f.full_name, message: f.message };
}

function unityTestJobToResult(job: UnityTestJobPayload): TestRunResult {
  const status = job.status === "succeeded" ? "succeeded" : "failed";
  return {
    jobId: job.job_id,
    status,
    mode: job.mode,
    completed: job.progress?.completed,
    total: job.progress?.total,
    failuresSoFar: job.progress?.failures_so_far?.map(toTestFailure),
    error: job.error,
    result: status === "succeeded" ? job.result : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Peeks at a tool result's envelope (without throwing on a well-formed
 * failure, unlike `unwrap`) to check for the server's own `hint: "retry"`
 * signal. A malformed/non-JSON response is treated as non-retryable — that's
 * a different, real problem `unwrap` should surface immediately, not mask
 * behind a retry loop.
 */
function isRetryableFailure(result: McpToolCallResult): boolean {
  try {
    const parsed = JSON.parse(extractText(result)) as McpToolEnvelope<unknown>;
    return parsed.success === false && parsed.hint === "retry";
  } catch {
    return false;
  }
}

/** Maps unity-mcp's Unity `LogType` names (`Log`/`Warning`/`Error`/`Exception`/`Assert`) onto `ConsoleMessage["level"]`. */
function mapUnityLogType(type: string): ConsoleMessage["level"] {
  const normalized = type.toLowerCase();
  if (normalized === "warning") return "warning";
  if (normalized === "error" || normalized === "exception" || normalized === "assert") return "error";
  return "log";
}

/**
 * Every real unity-mcp tool call's text content is this same
 * `{success, message, error, data, hint}` envelope (confirmed live
 * 2026-08-09/10 across `refresh_unity`, `read_console`, `manage_scene`,
 * `manage_gameobject`, `manage_components`, `manage_camera`,
 * `find_gameobjects`). Throwing here on `success: false` turns real,
 * observed transient failures (a "ping not answered" or "Unity plugin
 * session disconnected" mid-call — both reproduced live against a real
 * Editor) into a clear `ProviderError` instead of either a confusing
 * downstream crash or, for the mutating calls that used to discard their
 * result entirely, a silent no-op.
 */
function unwrap<T>(result: McpToolCallResult): T {
  const parsed = JSON.parse(extractText(result)) as McpToolEnvelope<T>;
  if (!parsed.success) {
    throw new ProviderError(parsed.error ?? parsed.message ?? "unity-mcp tool call reported failure");
  }
  return parsed.data;
}

/** Same envelope, reached via an MCP resource read (`resources/read`) instead of a tool call. */
function unwrapResource<T>(contents: McpResourceContent[]): T {
  const text = contents[0]?.text;
  if (text === undefined) {
    throw new ProviderError("unity-mcp resource read returned no text content");
  }
  const parsed = JSON.parse(text) as McpToolEnvelope<T>;
  if (!parsed.success) {
    throw new ProviderError(parsed.error ?? parsed.message ?? "unity-mcp resource read reported failure");
  }
  return parsed.data;
}
