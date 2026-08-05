import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
