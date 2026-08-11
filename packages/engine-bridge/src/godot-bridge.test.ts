import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { GodotBridge } from "./godot-bridge.js";
import { GodotWsClient } from "./godot-ws-client.js";

/**
 * Stands in for a real Godot EditorPlugin implementing the bridge
 * protocol, the same way the fake-Ollama server stands in for a real
 * Ollama install elsewhere in this repo — lets the client-side protocol
 * handling be genuinely exercised without a Godot Editor present.
 */
function startFakeGodotServer(handlers: Record<string, (args: any) => unknown>): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const port = (wss.address() as AddressInfo).port;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => res());
          }),
      });
    });
    wss.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const { id, command, args } = JSON.parse(raw.toString());
        const handler = handlers[command];
        if (!handler) {
          socket.send(JSON.stringify({ id, error: `no handler for ${command}` }));
          return;
        }
        try {
          socket.send(JSON.stringify({ id, result: handler(args) }));
        } catch (err) {
          socket.send(JSON.stringify({ id, error: (err as Error).message }));
        }
      });
    });
  });
}

describe("GodotWsClient", () => {
  let server: { url: string; close: () => Promise<void> };

  afterEach(async () => {
    await server?.close();
  });

  it("round-trips a command over the real WebSocket protocol", async () => {
    server = await startFakeGodotServer({ ping: () => ({ pong: true }) });
    const client = new GodotWsClient({ url: server.url });
    await client.connect();
    const result = await client.send("ping");
    expect(result).toEqual({ pong: true });
    client.disconnect();
  });

  it("rejects the call when the server reports an error", async () => {
    server = await startFakeGodotServer({});
    const client = new GodotWsClient({ url: server.url });
    await client.connect();
    await expect(client.send("nonexistent")).rejects.toThrow(/no handler for nonexistent/);
    client.disconnect();
  });

  it("throws when connecting to a server that isn't listening", async () => {
    const client = new GodotWsClient({ url: "ws://127.0.0.1:1", connectTimeoutMs: 500 });
    await expect(client.connect()).rejects.toThrow();
  });

  it("rejects an in-flight command immediately when the configured signal aborts, rather than waiting out its own timeout", async () => {
    // A raw server that deliberately never replies to any message, so the
    // only way this call resolves is via the abort signal or the (much
    // longer) request timeout — proves the abort path actually
    // short-circuits the wait instead of coincidentally finishing first.
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    const port = (wss.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}`;

    try {
      const controller = new AbortController();
      const client = new GodotWsClient({ url, requestTimeoutMs: 30_000, signal: controller.signal });
      await client.connect();

      const pending = client.send("never_replies");
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      client.disconnect();
    } finally {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });

  it("rejects immediately if the signal is already aborted before the call is made", async () => {
    server = await startFakeGodotServer({ ping: () => ({ pong: true }) });
    const controller = new AbortController();
    controller.abort();
    const client = new GodotWsClient({ url: server.url, signal: controller.signal });
    await client.connect();

    await expect(client.send("ping")).rejects.toMatchObject({ name: "AbortError" });
    client.disconnect();
  });
});

describe("GodotBridge", () => {
  let server: { url: string; close: () => Promise<void> };

  afterEach(async () => {
    await server?.close();
  });

  it("inspects the scene via scene.get_hierarchy", async () => {
    server = await startFakeGodotServer({
      "scene.get_hierarchy": () => ({ name: "Main", objects: [{ path: "/Root/Player", name: "Player", active: true }] }),
    });
    const bridge = new GodotBridge({ url: server.url });
    await bridge.connect();
    const scene = await bridge.inspectScene();
    expect(scene.name).toBe("Main");
    expect(scene.objects[0].path).toBe("/Root/Player");
  });

  it("creates an object via scene.create_object", async () => {
    let capturedArgs: any;
    server = await startFakeGodotServer({
      "scene.create_object": (args) => {
        capturedArgs = args;
        return { path: "/Root/NewNode", name: args.name, active: true };
      },
    });
    const bridge = new GodotBridge({ url: server.url });
    await bridge.connect();
    const result = await bridge.createObject({ name: "NewNode", primitive: "MeshInstance3D" });
    expect(capturedArgs).toMatchObject({ name: "NewNode", primitive: "MeshInstance3D" });
    expect(result.path).toBe("/Root/NewNode");
  });

  it("enters and exits play mode", async () => {
    const calls: string[] = [];
    server = await startFakeGodotServer({
      "editor.play": () => {
        calls.push("play");
        return {};
      },
      "editor.stop": () => {
        calls.push("stop");
        return {};
      },
    });
    const bridge = new GodotBridge({ url: server.url });
    await bridge.connect();
    await bridge.enterPlayMode();
    await bridge.exitPlayMode();
    expect(calls).toEqual(["play", "stop"]);
  });

  it("reads the console", async () => {
    server = await startFakeGodotServer({
      "editor.read_console": () => [{ level: "error", message: "Nonexistent function 'foo'" }],
    });
    const bridge = new GodotBridge({ url: server.url });
    await bridge.connect();
    const messages = await bridge.readConsole();
    expect(messages[0].message).toContain("Nonexistent function");
  });

  it("runs tests via editor.run_tests, forwarding the real options and returning the real result", async () => {
    let capturedArgs: any;
    server = await startFakeGodotServer({
      "editor.run_tests": (args) => {
        capturedArgs = args;
        return { jobId: "job-1", status: "succeeded", completed: 4, total: 4, result: { passed: 4 } };
      },
    });
    const bridge = new GodotBridge({ url: server.url });
    await bridge.connect();
    const result = await bridge.runTests({ mode: "EditMode", testNames: ["MyTest"] });

    expect(capturedArgs).toMatchObject({ mode: "EditMode", testNames: ["MyTest"] });
    expect(result).toEqual({ jobId: "job-1", status: "succeeded", completed: 4, total: 4, result: { passed: 4 } });
  });
});
