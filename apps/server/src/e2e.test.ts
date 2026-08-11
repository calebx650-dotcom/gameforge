import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import request from "supertest";
import WebSocket from "ws";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import express from "express";
import cors from "cors";
import { ProjectManager } from "./project-manager.js";
import { createRouter } from "./routes.js";
import { handleChatConnection } from "./chat-socket.js";

/**
 * End-to-end smoke test for the Phase 1 vertical slice described in the
 * spec: pick a model -> prompt -> agent reads a file -> edits a file ->
 * runs a safe command -> reports what happened. Runs against a tiny fake
 * Ollama server instead of a real model so it's deterministic and doesn't
 * require Ollama to be installed.
 */
describe("GameForge end-to-end smoke test", () => {
  let fakeOllama: ReturnType<typeof createHttpServer>;
  let fakeOllamaPort: number;
  let gfServer: ReturnType<typeof createServer>;
  let gfPort: number;
  let projectRoot: string;

  beforeAll(async () => {
    let step = 0;
    const script = [
      { message: { content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "hello.txt" } } }] } },
      {
        message: {
          content: "",
          tool_calls: [
            { function: { name: "edit_file", arguments: { path: "hello.txt", oldText: "hello", newText: "hello from GameForge" } } },
          ],
        },
      },
      { message: { content: "", tool_calls: [{ function: { name: "run_command", arguments: { command: "echo verified" } } }] } },
      { message: { content: "Done: greeted the project and verified the shell." } },
    ];

    fakeOllama = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          const next = script[Math.min(step, script.length - 1)];
          step++;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ...next, prompt_eval_count: 5, eval_count: 5 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeOllama.listen(0, resolve));
    fakeOllamaPort = (fakeOllama.address() as AddressInfo).port;

    const projects = new ProjectManager();
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use("/api", createRouter(projects));
    gfServer = createServer(app);
    const wss = new WebSocketServer({ server: gfServer, path: "/ws/chat" });
    wss.on("connection", (socket) => handleChatConnection(socket, projects));
    await new Promise<void>((resolve) => gfServer.listen(0, resolve));
    gfPort = (gfServer.address() as AddressInfo).port;

    projectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-"));
    await writeFile(join(projectRoot, "hello.txt"), "hello world\n");
  });

  afterAll(async () => {
    await new Promise((resolve) => fakeOllama.close(resolve));
    await new Promise((resolve) => gfServer.close(resolve));
  });

  it("opens a project, lists Ollama models, and drives the full agent loop", async () => {
    const httpBase = `http://localhost:${gfPort}`;

    const openRes = await request(httpBase).post("/api/projects").send({ path: projectRoot });
    expect(openRes.status).toBe(200);
    const projectId = openRes.body.id;

    const modelsRes = await request(httpBase)
      .post("/api/providers/models")
      .send({ provider: "ollama", baseUrl: `http://127.0.0.1:${fakeOllamaPort}` });
    expect(modelsRes.status).toBe(200);
    expect(modelsRes.body[0].id).toBe("llama3.1:8b");

    const result = await new Promise<{ stoppedReason: string; iterations: number; finalText: string; logKinds: string[] }>(
      (resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const logKinds: string[] = [];
        const timeout = setTimeout(() => reject(new Error("e2e chat timed out")), 10_000);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "build",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeOllamaPort}` },
              message: "Please greet the project, then verify the shell works.",
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "log") logKinds.push(msg.entry.kind);
          else if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            ws.close();
            resolve({ stoppedReason: msg.stoppedReason, iterations: msg.iterations, finalText: finalMessage.content, logKinds });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      },
    );

    expect(result.stoppedReason).toBe("completed");
    expect(result.finalText).toContain("Done");
    expect(result.logKinds.filter((k) => k === "tool_call")).toHaveLength(3);
    expect(result.logKinds.filter((k) => k === "tool_result")).toHaveLength(3);

    const finalContent = await readFile(join(projectRoot, "hello.txt"), "utf-8");
    expect(finalContent).toBe("hello from GameForge world\n");
  });

  it("auto-commits a checkpoint before a build-mode run when the project is a dirty git repo", async () => {
    const execFileAsync = promisify(execFile);
    const httpBase = `http://localhost:${gfPort}`;

    const gitProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-git-"));
    await writeFile(join(gitProjectRoot, "hello.txt"), "hello world\n");
    await execFileAsync("git", ["init"], { cwd: gitProjectRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: gitProjectRoot });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: gitProjectRoot });
    await execFileAsync("git", ["add", "-A"], { cwd: gitProjectRoot });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: gitProjectRoot });
    await writeFile(join(gitProjectRoot, "dirty.txt"), "uncommitted work\n"); // dirties the tree

    const openRes = await request(httpBase).post("/api/projects").send({ path: gitProjectRoot });
    const projectId = openRes.body.id;

    const logSummaries = await new Promise<string[]>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
      const summaries: string[] = [];
      const timeout = setTimeout(() => reject(new Error("checkpoint e2e timed out")), 10_000);

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "chat",
            projectId,
            mode: "build",
            providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeOllamaPort}` },
            message: "Please greet the project, then verify the shell works.",
          }),
        );
      });

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "log") summaries.push(msg.entry.summary);
        else if (msg.type === "result") {
          clearTimeout(timeout);
          ws.close();
          resolve(summaries);
        } else if (msg.type === "error") {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      });
    });

    expect(logSummaries.some((s) => s.includes("Checkpoint committed"))).toBe(true);

    const { stdout } = await execFileAsync("git", ["log", "--oneline"], { cwd: gitProjectRoot });
    expect(stdout).toMatch(/GameForge checkpoint/);
  });

  it("drives capture_screenshot through a real engine bridge and splices the image for vision analysis (Phase 7-10 end to end)", async () => {
    const httpBase = `http://localhost:${gfPort}`;

    // A dedicated, self-contained fake model server for this test (rather
    // than reusing the shared fakeOllama, whose scripted step counter has
    // already been consumed by the earlier tests in this file) so the
    // exact tool-call sequence — including capture_screenshot — is
    // fully controlled.
    let modelStep = 0;
    const modelScript = [
      { message: { content: "", tool_calls: [{ function: { name: "capture_screenshot", arguments: {} } }] } },
      { message: { content: "I can see the screenshot: the scene looks correct." } },
    ];
    const fakeModel = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          const next = modelScript[Math.min(modelStep, modelScript.length - 1)];
          modelStep++;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ...next, prompt_eval_count: 5, eval_count: 5 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeModel.listen(0, resolve));
    const fakeModelPort = (fakeModel.address() as AddressInfo).port;

    // A fake unity-mcp server speaking the real MCP "Streamable HTTP" shape (verified
    // live against mcp-for-unity 10.1.2 — see UNITY_BRIDGE.md): the initialize
    // handshake returns an Mcp-Session-Id header before any tool call is accepted.
    const fakeUnityMcp = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const rpc = JSON.parse(body);
        res.setHeader("Content-Type", "application/json");
        if (rpc.method === "initialize") {
          res.setHeader("Mcp-Session-Id", "fake-session-id");
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18" } }));
          return;
        }
        if (rpc.method === "notifications/initialized") {
          res.statusCode = 202;
          res.end();
          return;
        }
        if (rpc.method === "tools/list") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "capture_screenshot" }] } }));
          return;
        }
        if (rpc.method === "tools/call" && rpc.params.name === "capture_screenshot") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "image", text: "fakeScreenshotBase64" }] } }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { message: "unhandled tool call in test" } }));
      });
    });
    await new Promise<void>((resolve) => fakeUnityMcp.listen(0, resolve));
    const fakeUnityMcpPort = (fakeUnityMcp.address() as AddressInfo).port;

    try {
      const screenshotProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-vision-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: screenshotProjectRoot });
      const projectId = openRes.body.id;

      const result = await new Promise<{ finalText: string; sawImageInSecondCall: boolean }>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("vision e2e timed out")), 10_000);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "build",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeModelPort}` },
              engineSettings: { engine: "unity", url: `http://127.0.0.1:${fakeUnityMcpPort}` },
              message: "Take a screenshot and tell me if the scene looks right.",
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            // The message right before the final assistant response should be
            // the spliced-in vision message carrying the actual image.
            const visionMessage = msg.messages[msg.messages.length - 2];
            const sawImageInSecondCall =
              Array.isArray(visionMessage?.content) &&
              visionMessage.content.some((part: { type: string; data?: string }) => part.type === "image" && part.data === "fakeScreenshotBase64");
            ws.close();
            resolve({ finalText: finalMessage.content, sawImageInSecondCall });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });

      expect(result.sawImageInSecondCall).toBe(true);
      expect(result.finalText).toContain("scene looks correct");
    } finally {
      await new Promise((resolve) => fakeModel.close(resolve));
      await new Promise((resolve) => fakeUnityMcp.close(resolve));
    }
  });

  it("streams incremental assistant text over the WebSocket when the request opts in with stream: true (Phase 5)", async () => {
    const httpBase = `http://localhost:${gfPort}`;

    // A dedicated fake Ollama server speaking Ollama's real streaming wire
    // format: newline-delimited JSON chunks, not one bare JSON response —
    // this is what OllamaProvider.stream() actually parses.
    const fakeStreamingOllama = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          res.setHeader("Content-Type", "application/x-ndjson");
          for (const word of ["Streaming ", "works ", "correctly."]) {
            res.write(JSON.stringify({ message: { content: word }, done: false }) + "\n");
          }
          res.write(JSON.stringify({ message: { content: "" }, done: true, prompt_eval_count: 5, eval_count: 5 }) + "\n");
          res.end();
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeStreamingOllama.listen(0, resolve));
    const fakeStreamingOllamaPort = (fakeStreamingOllama.address() as AddressInfo).port;

    try {
      const streamProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-stream-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: streamProjectRoot });
      const projectId = openRes.body.id;

      const result = await new Promise<{ deltas: string[]; finalText: string }>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("streaming e2e timed out")), 10_000);
        const deltas: string[] = [];

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "build",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeStreamingOllamaPort}` },
              message: "Say something.",
              stream: true,
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "stream_delta") {
            deltas.push(msg.text);
          } else if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            ws.close();
            resolve({ deltas, finalText: finalMessage.content });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });

      expect(result.deltas.length).toBeGreaterThan(1);
      expect(result.deltas.join("")).toBe("Streaming works correctly.");
      expect(result.finalText).toBe("Streaming works correctly.");
    } finally {
      await new Promise((resolve) => fakeStreamingOllama.close(resolve));
    }
  });

  it("drives a real edit -> build_project -> error -> fix -> build_project -> success repair loop end to end", async () => {
    const httpBase = `http://localhost:${gfPort}`;

    // Dedicated fake model server scripting exactly the repair-loop sequence:
    // write a script, try to build, get a compiler error, fix it, build again, report done.
    let modelStep = 0;
    const modelScript = [
      { message: { content: "", tool_calls: [{ function: { name: "create_file", arguments: { path: "Player.cs", content: "buggy C#" } } }] } },
      { message: { content: "", tool_calls: [{ function: { name: "build_project", arguments: {} } }] } },
      { message: { content: "", tool_calls: [{ function: { name: "edit_file", arguments: { path: "Player.cs", oldText: "buggy C#", newText: "fixed C#" } } }] } },
      { message: { content: "", tool_calls: [{ function: { name: "build_project", arguments: {} } }] } },
      { message: { content: "Fixed the compiler error and the project now builds clean." } },
    ];
    const fakeModel = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          const next = modelScript[Math.min(modelStep, modelScript.length - 1)];
          modelStep++;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ...next, prompt_eval_count: 5, eval_count: 5 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeModel.listen(0, resolve));
    const fakeModelPort = (fakeModel.address() as AddressInfo).port;

    // Fake unity-mcp speaking the real protocol: refresh_unity + read_console
    // (what build_project actually calls, per UNITY_BRIDGE.md) — first
    // build_project call reports a compiler error, second reports clean.
    let buildCallCount = 0;
    const fakeUnityMcp = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const rpc = JSON.parse(body);
        res.setHeader("Content-Type", "application/json");
        if (rpc.method === "initialize") {
          res.setHeader("Mcp-Session-Id", "fake-session-id");
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18" } }));
          return;
        }
        if (rpc.method === "notifications/initialized") {
          res.statusCode = 202;
          res.end();
          return;
        }
        if (rpc.method === "tools/list") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [{ name: "refresh_unity" }, { name: "read_console" }] } }));
          return;
        }
        if (rpc.method === "tools/call" && rpc.params.name === "refresh_unity") {
          buildCallCount++;
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: { content: [{ type: "text", text: JSON.stringify({ refresh_triggered: true, compile_requested: true, resulting_state: "idle" }) }] },
            }),
          );
          return;
        }
        if (rpc.method === "tools/call" && rpc.params.name === "read_console") {
          const errorsForThisBuild =
            buildCallCount === 1 ? [{ type: "Error", message: "CS1002: ; expected in Player.cs", stackTrace: null }] : [];
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: errorsForThisBuild }) }] },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { message: "unhandled tool call in test" } }));
      });
    });
    await new Promise<void>((resolve) => fakeUnityMcp.listen(0, resolve));
    const fakeUnityMcpPort = (fakeUnityMcp.address() as AddressInfo).port;

    try {
      const repairProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-repair-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: repairProjectRoot });
      const projectId = openRes.body.id;

      const result = await new Promise<{ finalText: string; toolSequence: string[] }>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("repair-loop e2e timed out")), 10_000);
        const toolSequence: string[] = [];

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "build",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeModelPort}` },
              engineSettings: { engine: "unity", url: `http://127.0.0.1:${fakeUnityMcpPort}` },
              message: "Add a player script and make sure it builds.",
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "log" && msg.entry.kind === "tool_call") {
            toolSequence.push(msg.entry.summary.split("(")[0]);
          } else if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            ws.close();
            resolve({ finalText: finalMessage.content, toolSequence });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });

      expect(result.toolSequence).toEqual(["create_file", "build_project", "edit_file", "build_project"]);
      expect(result.finalText).toContain("builds clean");

      const finalFileContent = await readFile(join(repairProjectRoot, "Player.cs"), "utf-8");
      expect(finalFileContent).toBe("fixed C#");
    } finally {
      await new Promise((resolve) => fakeModel.close(resolve));
      await new Promise((resolve) => fakeUnityMcp.close(resolve));
    }
  });

  it("falls back to a working backup provider when the primary is unreachable (P1.5 model routing)", async () => {
    const httpBase = `http://localhost:${gfPort}`;

    // A port nothing is listening on, guaranteed by binding then immediately closing.
    const deadServer = createHttpServer();
    await new Promise<void>((resolve) => deadServer.listen(0, resolve));
    const deadPort = (deadServer.address() as AddressInfo).port;
    await new Promise((resolve) => deadServer.close(resolve));

    const fakeBackupOllama = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "backup-model" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ message: { content: "Answered by the backup provider." }, prompt_eval_count: 1, eval_count: 1 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeBackupOllama.listen(0, resolve));
    const backupPort = (fakeBackupOllama.address() as AddressInfo).port;

    try {
      const routerProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-router-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: routerProjectRoot });
      const projectId = openRes.body.id;

      const result = await new Promise<{ finalText: string; sawFallbackLog: boolean }>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("router fallback e2e timed out")), 10_000);
        let sawFallbackLog = false;

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "ask",
              providerSettings: { provider: "ollama", model: "primary-model", baseUrl: `http://127.0.0.1:${deadPort}` },
              fallbackProviderSettings: [{ provider: "ollama", model: "backup-model", baseUrl: `http://127.0.0.1:${backupPort}` }],
              message: "hello",
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "log" && /Falling back/.test(msg.entry.summary)) {
            sawFallbackLog = true;
          } else if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            ws.close();
            resolve({ finalText: finalMessage.content, sawFallbackLog });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });

      expect(result.sawFallbackLog).toBe(true);
      expect(result.finalText).toBe("Answered by the backup provider.");
    } finally {
      await new Promise((resolve) => fakeBackupOllama.close(resolve));
    }
  });

  it("forwards a reference image attached to the chat request through to the real provider call (P3 reference-image input)", async () => {
    const httpBase = `http://localhost:${gfPort}`;
    let capturedOllamaBody: any;

    const fakeVisionOllama = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          capturedOllamaBody = JSON.parse(body);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ message: { content: "I see a red square." }, prompt_eval_count: 1, eval_count: 1 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeVisionOllama.listen(0, resolve));
    const fakeVisionOllamaPort = (fakeVisionOllama.address() as AddressInfo).port;

    try {
      const imageProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-refimage-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: imageProjectRoot });
      const projectId = openRes.body.id;

      const result = await new Promise<{ finalText: string; sawImageInLocalMessages: boolean }>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("reference-image e2e timed out")), 10_000);

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "ask",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeVisionOllamaPort}` },
              message: "What shape is in this reference image?",
              images: [{ data: "redSquareBase64", mimeType: "image/png" }],
            }),
          );
        });

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "result") {
            clearTimeout(timeout);
            const finalMessage = msg.messages[msg.messages.length - 1];
            // messages[0] is the system prompt, messages[1] is the first real user turn.
            const firstUserMessage = msg.messages[1];
            const sawImageInLocalMessages =
              Array.isArray(firstUserMessage?.content) &&
              firstUserMessage.content.some((part: { type: string; data?: string }) => part.type === "image" && part.data === "redSquareBase64");
            ws.close();
            resolve({ finalText: finalMessage.content, sawImageInLocalMessages });
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });

      // Confirms the attached image reached GameForge's own message history...
      expect(result.sawImageInLocalMessages).toBe(true);
      expect(result.finalText).toBe("I see a red square.");
      // ...and that it was genuinely forwarded to the real Ollama wire request, not
      // just kept in local state — OllamaProvider maps ImagePart onto Ollama's
      // message-level `images` array (see PROVIDERS.md's Ollama vision section).
      expect(capturedOllamaBody.messages[1].images).toEqual(["redSquareBase64"]);
    } finally {
      await new Promise((resolve) => fakeVisionOllama.close(resolve));
    }
  });

  it("carries a real prior run's outcome into the next run's system prompt on the same project (P3.5 agent memory)", async () => {
    const httpBase = `http://localhost:${gfPort}`;
    const capturedSystemPrompts: string[] = [];

    const fakeMemoryOllama = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url === "/api/tags") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }));
          return;
        }
        if (req.url === "/api/chat") {
          const parsed = JSON.parse(body);
          capturedSystemPrompts.push(parsed.messages[0].content);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ message: { content: "ok" }, prompt_eval_count: 1, eval_count: 1 }));
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((resolve) => fakeMemoryOllama.listen(0, resolve));
    const fakeMemoryOllamaPort = (fakeMemoryOllama.address() as AddressInfo).port;

    function sendOneChatMessage(projectId: string, message: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${gfPort}/ws/chat`);
        const timeout = setTimeout(() => reject(new Error("memory e2e timed out")), 10_000);
        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "chat",
              projectId,
              mode: "ask",
              providerSettings: { provider: "ollama", model: "llama3.1:8b", baseUrl: `http://127.0.0.1:${fakeMemoryOllamaPort}` },
              message,
            }),
          );
        });
        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "result") {
            clearTimeout(timeout);
            ws.close();
            resolve();
          } else if (msg.type === "error") {
            clearTimeout(timeout);
            reject(new Error(msg.message));
          }
        });
      });
    }

    try {
      const memoryProjectRoot = await mkdtemp(join(tmpdir(), "gf-e2e-memory-"));
      const openRes = await request(httpBase).post("/api/projects").send({ path: memoryProjectRoot });
      const projectId = openRes.body.id;

      await sendOneChatMessage(projectId, "first request: add a jump button");
      await sendOneChatMessage(projectId, "second request: what did we just do?");

      expect(capturedSystemPrompts).toHaveLength(2);
      // The FIRST run's own system prompt shouldn't already know about itself.
      expect(capturedSystemPrompts[0]).toContain("(no prior runs recorded for this project)");
      // The SECOND run's system prompt should carry the first run's real recorded outcome.
      expect(capturedSystemPrompts[1]).toContain("first request: add a jump button");
      expect(capturedSystemPrompts[1]).toContain("completed");
    } finally {
      await new Promise((resolve) => fakeMemoryOllama.close(resolve));
    }
  });
});
