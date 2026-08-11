import { afterEach, describe, expect, it, vi } from "vitest";
import { UnityBridge } from "./unity-bridge.js";

const SESSION_ID = "test-session-id";

/**
 * Stands in for a real MCP "Streamable HTTP" server (see mcp-client.test.ts for the
 * protocol details this mirrors): handles the `initialize`/`notifications/initialized`
 * handshake McpHttpClient now performs before every real request, then dispatches to
 * `handler` for the actual tool call.
 */
function mockMcpResponse(handler: (body: any) => unknown) {
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
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
    mockMcpResponse(() => ({ content: [{ type: "image", text: "base64data" }] }));
    const bridge = new UnityBridge();
    const screenshot = await bridge.captureScreenshot();
    expect(screenshot.base64Png).toBe("base64data");
  });

  it("reads the console via read_console, unwrapping the real {data:[...]} envelope and mapping log types", async () => {
    let capturedArgs: any;
    mockMcpResponse((body) => {
      capturedArgs = body.params.arguments;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              data: [
                { type: "Error", message: "NullReferenceException", stackTrace: "at Foo.Bar()" },
                { type: "Warning", message: "deprecated API", stackTrace: null },
                { type: "Log", message: "hello" },
              ],
            }),
          },
        ],
      };
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

  it("buildProject() forces a real recompile via refresh_unity, not manage_editor, and reports success on a clean console", async () => {
    const calledTools: string[] = [];
    let refreshArgs: any;
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
      calledTools.push(body.params.name);
      let result: unknown;
      if (body.params.name === "refresh_unity") {
        refreshArgs = body.params.arguments;
        result = { content: [{ type: "text", text: JSON.stringify({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" }) }] };
      } else if (body.params.name === "read_console") {
        result = { content: [{ type: "text", text: JSON.stringify({ success: true, data: [] }) }] };
      } else {
        throw new Error(`unexpected tool call in test: ${body.params.name}`);
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(calledTools).toEqual(["refresh_unity", "read_console"]);
    expect(refreshArgs).toMatchObject({ mode: "force", scope: "scripts", compile: "request", wait_for_ready: true });
    expect(result).toEqual({ success: true, errors: undefined });
  });

  it("buildProject() reports failure with the real compiler error text when the console has errors after recompiling", async () => {
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
      if (body.params.name === "refresh_unity") {
        result = { content: [{ type: "text", text: JSON.stringify({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" }) }] };
      } else {
        result = {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                data: [{ type: "Error", message: "CS1002: ; expected", stackTrace: null }],
              }),
            },
          ],
        };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const bridge = new UnityBridge();
    const result = await bridge.buildProject();

    expect(result).toEqual({ success: false, errors: ["CS1002: ; expected"] });
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
