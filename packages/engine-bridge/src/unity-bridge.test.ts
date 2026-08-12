import { afterEach, describe, expect, it, vi } from "vitest";
import { UnityBridge } from "./unity-bridge.js";

const SESSION_ID = "test-session-id";

/**
 * Stands in for a real MCP "Streamable HTTP" server (see mcp-client.test.ts for the
 * protocol details this mirrors): handles the `initialize`/`notifications/initialized`
 * handshake McpHttpClient now performs before every real request, then dispatches
 * `tools/call` to `handleTool` and `resources/read` to `handleResource`.
 *
 * `handleTool`/`handleResource` return the *payload* (the `{success, data, ...}`
 * envelope every real unity-mcp response carries — confirmed live 2026-08-09/10, see
 * unity-bridge.ts's module doc comment) already stringified isn't required — pass the
 * envelope object directly and it's JSON.stringify'd into the text content block.
 */
function mockMcpServer(opts: {
  handleTool?: (name: string, args: any) => { content: Array<{ type: string; text?: string; data?: string }> };
  handleResource?: (uri: string) => { text: string };
}) {
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
    if (body.method === "tools/call") {
      if (!opts.handleTool) throw new Error(`unexpected tool call in test: ${body.params.name}`);
      result = opts.handleTool(body.params.name, body.params.arguments);
    } else if (body.method === "resources/read") {
      if (!opts.handleResource) throw new Error(`unexpected resource read in test: ${body.params.uri}`);
      result = { contents: [{ uri: body.params.uri, ...opts.handleResource(body.params.uri) }] };
    } else {
      throw new Error(`unexpected method in test: ${body.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Wraps a payload in the real `{success, message, error, data, hint}` tool-response envelope as a text content block. */
function textEnvelope(data: unknown, success = true, error: string | null = null, hint: string | null = null) {
  return { content: [{ type: "text", text: JSON.stringify({ success, message: null, error, data, hint }) }] };
}

describe("UnityBridge", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("connects by listing tools", async () => {
    mockMcpServer({ handleTool: () => ({ content: [] }) });
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (body.method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
          status: 200,
          headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
        });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "manage_scene" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const bridge = new UnityBridge();
    expect(bridge.isConnected()).toBe(false);
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
  });

  it("inspects the scene via manage_scene get_hierarchy + get_active, unwrapping the real {data:{items:[...]}} envelope", async () => {
    const capturedActions: string[] = [];
    mockMcpServer({
      handleTool: (name, args) => {
        capturedActions.push(args.action);
        if (args.action === "get_hierarchy") {
          return textEnvelope({ items: [{ path: "Player", name: "Player", activeSelf: true }] });
        }
        return textEnvelope({ name: "MainScene" });
      },
    });
    const bridge = new UnityBridge();
    const scene = await bridge.inspectScene();
    expect(capturedActions.sort()).toEqual(["get_active", "get_hierarchy"]);
    expect(scene.name).toBe("MainScene");
    expect(scene.objects).toEqual([{ path: "Player", name: "Player", active: true }]);
  });

  it("inspects an object by resolving its instance ID via find_gameobjects, then reading the gameobject + components resources", async () => {
    let findArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        expect(name).toBe("find_gameobjects");
        findArgs = args;
        return textEnvelope({ instanceIDs: [42] });
      },
      handleResource: (uri) => {
        if (uri === "mcpforunity://scene/gameobject/42") {
          return {
            text: JSON.stringify({
              success: true,
              data: {
                name: "Player",
                path: "Player",
                active: true,
                transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
              },
            }),
          };
        }
        return {
          text: JSON.stringify({
            success: true,
            data: { components: [{ typeName: "Transform", instanceID: 1, position: { x: 0, y: 0, z: 0 } }] },
          }),
        };
      },
    });
    const bridge = new UnityBridge();
    const detail = await bridge.inspectObject("Player");
    expect(findArgs).toMatchObject({ search_term: "Player", search_method: "by_name", include_inactive: true });
    expect(detail.name).toBe("Player");
    expect(detail.components).toEqual([{ type: "Transform", properties: { position: { x: 0, y: 0, z: 0 } } }]);
  });

  it("throws a clear error when inspectObject finds no matching GameObject", async () => {
    mockMcpServer({ handleTool: () => textEnvelope({ instanceIDs: [] }) });
    const bridge = new UnityBridge();
    await expect(bridge.inspectObject("Nope")).rejects.toThrow(/No GameObject found matching "Nope"/);
  });

  it("creates an object via manage_gameobject create, unwrapping the real envelope", async () => {
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedArgs = args;
        return textEnvelope({ name: "Cube", activeSelf: true });
      },
    });
    const bridge = new UnityBridge();
    const result = await bridge.createObject({ name: "Cube", primitive: "cube" });
    expect(capturedArgs).toMatchObject({ action: "create", name: "Cube", primitive_type: "cube" });
    expect(result).toEqual({ path: "Cube", name: "Cube", active: true });
  });

  it('creates an empty object by omitting primitive_type, since the real tool rejects primitive_type: "empty"', async () => {
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedArgs = args;
        return textEnvelope({ name: "Empty", activeSelf: true });
      },
    });
    const bridge = new UnityBridge();
    await bridge.createObject({ name: "Empty", primitive: "empty" });
    expect(capturedArgs.primitive_type).toBeUndefined();
  });

  it("nests the returned path under parentPath when creating a child object", async () => {
    mockMcpServer({ handleTool: () => textEnvelope({ name: "Child", activeSelf: true }) });
    const bridge = new UnityBridge();
    const result = await bridge.createObject({ name: "Child", parentPath: "Parent" });
    expect(result.path).toBe("Parent/Child");
  });

  it("modifies an object using the real new_name/set_active fields, not name/active", async () => {
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedArgs = args;
        return textEnvelope({ name: "Renamed" });
      },
    });
    const bridge = new UnityBridge();
    await bridge.modifyObject("Player", { name: "Renamed", active: false });
    expect(capturedArgs).toMatchObject({ action: "modify", target: "Player", new_name: "Renamed", set_active: false });
  });

  it("modifies a transform via manage_gameobject modify", async () => {
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedArgs = args;
        return textEnvelope({});
      },
    });
    const bridge = new UnityBridge();
    await bridge.modifyTransform("Player", { position: { x: 1, y: 2, z: 3 } });
    expect(capturedArgs).toMatchObject({ action: "modify", target: "Player", position: { x: 1, y: 2, z: 3 } });
  });

  it("modifies a component via manage_components set_property, not manage_gameobject set_component_property", async () => {
    let capturedTool: string | undefined;
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedTool = name;
        capturedArgs = args;
        return textEnvelope({});
      },
    });
    const bridge = new UnityBridge();
    await bridge.modifyComponent("Player", "Rigidbody", { mass: 5 });
    expect(capturedTool).toBe("manage_components");
    expect(capturedArgs).toMatchObject({
      action: "set_property",
      target: "Player",
      component_type: "Rigidbody",
      properties: { mass: 5 },
    });
  });

  it("throws when a mutating call's envelope reports success: false, instead of silently no-op'ing", async () => {
    mockMcpServer({ handleTool: () => textEnvelope(null, false, "Target GameObject not found") });
    const bridge = new UnityBridge();
    await expect(bridge.modifyObject("Ghost", { active: true })).rejects.toThrow(/Target GameObject not found/);
  });

  it("enters and exits play mode via manage_editor", async () => {
    const calls: string[] = [];
    mockMcpServer({
      handleTool: (name, args) => {
        calls.push(args.action);
        return textEnvelope(null);
      },
    });
    const bridge = new UnityBridge();
    await bridge.enterPlayMode();
    await bridge.exitPlayMode();
    expect(calls).toEqual(["play", "stop"]);
  });

  it("captures a screenshot via manage_camera screenshot, reading base64 from the image block's data field", async () => {
    let capturedTool: string | undefined;
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedTool = name;
        capturedArgs = args;
        return {
          content: [
            { type: "text", text: JSON.stringify({ success: true, data: { imageWidth: 640, imageHeight: 360 } }) },
            { type: "image", data: "base64data" },
          ],
        };
      },
    });
    const bridge = new UnityBridge();
    const screenshot = await bridge.captureScreenshot();
    expect(capturedTool).toBe("manage_camera");
    expect(capturedArgs).toMatchObject({ action: "screenshot", include_image: true });
    expect(screenshot).toEqual({ base64Png: "base64data", width: 640, height: 360 });
  });

  it("reads the console via read_console, unwrapping the real {data:[...]} envelope and mapping log types", async () => {
    let capturedArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        capturedArgs = args;
        return textEnvelope([
          { type: "Error", message: "NullReferenceException", stackTrace: "at Foo.Bar()" },
          { type: "Warning", message: "deprecated API", stackTrace: null },
          { type: "Log", message: "hello" },
        ]);
      },
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

  it("retries on the server's own hint:\"retry\" signal, reproducing the real intermittent Unity-session hiccup, and succeeds once it clears", async () => {
    // Reproduced live 2026-08-10: read_console/find_gameobjects/manage_gameobject all
    // occasionally failed with success:false, hint:"retry" (~2 of 3 back-to-back live
    // calls in one observed run) due to the Unity-side WebSocket bridge hiccuping.
    let attempts = 0;
    mockMcpServer({
      handleTool: () => {
        attempts += 1;
        if (attempts < 3) return textEnvelope(null, false, "Unity plugin session disconnected while awaiting command_result", "retry");
        return textEnvelope([]);
      },
    });
    const bridge = new UnityBridge();
    const messages = await bridge.readConsole();
    expect(attempts).toBe(3);
    expect(messages).toEqual([]);
  });

  it("does not retry a non-retryable failure (no hint:\"retry\") even after multiple calls, and surfaces it immediately", async () => {
    let attempts = 0;
    mockMcpServer({
      handleTool: () => {
        attempts += 1;
        return textEnvelope(null, false, "GameObject not found");
      },
    });
    const bridge = new UnityBridge();
    await expect(bridge.readConsole()).rejects.toThrow(/GameObject not found/);
    expect(attempts).toBe(1);
  });

  it("gives up after exhausting retries and surfaces the last real error", async () => {
    let attempts = 0;
    mockMcpServer({
      handleTool: () => {
        attempts += 1;
        return textEnvelope(null, false, "Unity plugin session disconnected while awaiting command_result", "retry");
      },
    });
    const bridge = new UnityBridge();
    await expect(bridge.readConsole()).rejects.toThrow(/disconnected while awaiting command_result/);
    expect(attempts).toBe(3);
  });

  it("readConsole throws a clear ProviderError (not a TypeError) on the real transient 'session not ready' failure shape", async () => {
    // Reproduced live 2026-08-10 against a real Editor: read_console can genuinely come back
    // with success:false and data:null (not []) when the Unity-side bridge session hiccups
    // (e.g. "ping not answered"). The old code called `.map` straight on `data` and crashed.
    mockMcpServer({
      handleTool: () => textEnvelope(null, false, "Unity session not ready for 'read_console' (ping not answered); please retry"),
    });
    const bridge = new UnityBridge();
    await expect(bridge.readConsole()).rejects.toThrow(/ping not answered/);
  });

  it("buildProject() forces a real recompile via refresh_unity, not manage_editor, and reports success on a clean console", async () => {
    const calledTools: string[] = [];
    let refreshArgs: any;
    mockMcpServer({
      handleTool: (name, args) => {
        calledTools.push(name);
        if (name === "refresh_unity") {
          refreshArgs = args;
          return textEnvelope({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" });
        }
        if (name === "read_console") return textEnvelope([]);
        throw new Error(`unexpected tool call in test: ${name}`);
      },
    });

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(calledTools).toEqual(["refresh_unity", "read_console"]);
    expect(refreshArgs).toMatchObject({ mode: "force", scope: "scripts", compile: "request", wait_for_ready: true });
    expect(result).toEqual({ success: true, errors: undefined });
  });

  it("buildProject() reports failure with the real compiler error text when the console has errors after recompiling", async () => {
    mockMcpServer({
      handleTool: (name) => {
        if (name === "refresh_unity") return textEnvelope({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" });
        return textEnvelope([{ type: "Error", message: "CS1002: ; expected", stackTrace: null }]);
      },
    });

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(result).toEqual({ success: false, errors: ["CS1002: ; expected"] });
  });

  it("buildProject() surfaces a real refresh_unity failure instead of proceeding to read_console", async () => {
    mockMcpServer({
      handleTool: (name) => {
        if (name === "refresh_unity") return textEnvelope(null, false, "Compilation is disabled while entering play mode");
        throw new Error(`unexpected tool call in test: ${name}`);
      },
    });
    const bridge = new UnityBridge();
    await expect(bridge.buildProject()).rejects.toThrow(/Compilation is disabled/);
  });

  describe("runTests()", () => {
    function mockTestServer(handleGetTestJob: (pollCount: number) => unknown) {
      let pollCount = 0;
      let capturedRunTestsArgs: any;
      globalThis.fetch = vi.fn(async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        if (body.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }), {
            status: 200,
            headers: { "Mcp-Session-Id": SESSION_ID, "Content-Type": "application/json" },
          });
        }
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });

        let result: unknown;
        if (body.params.name === "run_tests") {
          capturedRunTestsArgs = body.params.arguments;
          result = { content: [{ type: "text", text: JSON.stringify({ job_id: "job-1", status: "running", mode: "EditMode" }) }] };
        } else if (body.params.name === "get_test_job") {
          pollCount++;
          result = { content: [{ type: "text", text: JSON.stringify(handleGetTestJob(pollCount)) }] };
        } else {
          throw new Error(`unexpected tool call in test: ${body.params.name}`);
        }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;
      return { getCapturedRunTestsArgs: () => capturedRunTestsArgs };
    }

    it("submits a test run with the real run_tests argument names", async () => {
      const { getCapturedRunTestsArgs } = mockTestServer(() => ({
        data: { job_id: "job-1", status: "succeeded", mode: "EditMode", progress: { completed: 3, total: 3 }, result: { passed: 3 } },
      }));

      const bridge = new UnityBridge();
      await bridge.runTests({ mode: "PlayMode", testNames: ["MyTest"], includeDetails: true });

      expect(getCapturedRunTestsArgs()).toMatchObject({ mode: "PlayMode", testNames: ["MyTest"], includeDetails: true });
    });

    it("polls until succeeded and returns the real per-test result payload", async () => {
      mockTestServer(() => ({
        data: { job_id: "job-1", status: "succeeded", mode: "EditMode", progress: { completed: 3, total: 3 }, result: { passed: 3, failed: 0 } },
      }));

      const bridge = new UnityBridge();
      const result = await bridge.runTests();

      expect(result).toEqual({
        jobId: "job-1",
        status: "succeeded",
        mode: "EditMode",
        completed: 3,
        total: 3,
        failuresSoFar: undefined,
        error: undefined,
        result: { passed: 3, failed: 0 },
      });
    });

    it("reports a failed run with the real failure entries, without the (irrelevant) succeeded-only result payload", async () => {
      mockTestServer(() => ({
        data: {
          job_id: "job-1",
          status: "failed",
          mode: "EditMode",
          progress: { completed: 2, total: 3, failures_so_far: [{ full_name: "MyTests.TestFoo", message: "Assertion failed" }] },
          error: "1 of 3 tests failed",
        },
      }));

      const bridge = new UnityBridge();
      const result = await bridge.runTests();

      expect(result).toEqual({
        jobId: "job-1",
        status: "failed",
        mode: "EditMode",
        completed: 2,
        total: 3,
        failuresSoFar: [{ fullName: "MyTests.TestFoo", message: "Assertion failed" }],
        error: "1 of 3 tests failed",
        result: undefined,
      });
    });

    it("polls again after a running status before the job finally settles", async () => {
      vi.useFakeTimers();
      try {
        mockTestServer((pollCount) =>
          pollCount < 3
            ? { data: { job_id: "job-1", status: "running", mode: "EditMode", progress: { completed: pollCount, total: 5 } } }
            : { data: { job_id: "job-1", status: "succeeded", mode: "EditMode", progress: { completed: 5, total: 5 }, result: { passed: 5 } } },
        );

        const bridge = new UnityBridge();
        const resultPromise = bridge.runTests();
        // Two "running" polls happen before the third (settled) one; advance past both waits.
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(2000);
        const result = await resultPromise;

        expect(result.status).toBe("succeeded");
        expect(result.result).toEqual({ passed: 5 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives up after the bounded timeout if the job never stops running, rather than waiting forever", async () => {
      vi.useFakeTimers();
      try {
        mockTestServer((pollCount) => ({
          data: { job_id: "job-1", status: "running", mode: "EditMode", progress: { completed: pollCount, total: 100 } },
        }));

        const bridge = new UnityBridge();
        const resultPromise = bridge.runTests();
        await vi.advanceTimersByTimeAsync(6 * 60 * 1000); // past the 5-minute bound
        const result = await resultPromise;

        expect(result.status).toBe("timed_out");
        expect(result.jobId).toBe("job-1");
        expect(result.error).toMatch(/Timed out/);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
