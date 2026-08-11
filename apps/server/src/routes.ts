import { Router } from "express";
import type { MemoryCategory } from "@gameforge/memory";
import { createProvider } from "@gameforge/llm";
import { summarizeProjectContext } from "@gameforge/project";
import { gitStatusTool, gitDiffTool, gitLogTool, restoreCheckpoint, InvalidCommitReferenceError } from "@gameforge/tools";
import type { ProjectManager } from "./project-manager.js";

function serialize(session: ReturnType<ProjectManager["get"]>) {
  if (!session) return undefined;
  return {
    id: session.id,
    root: session.root,
    context: session.context,
    contextSummary: summarizeProjectContext(session.context),
    memory: session.memory.list(),
  };
}

export function createRouter(projects: ProjectManager): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.post("/projects", async (req, res) => {
    const path = req.body?.path;
    if (typeof path !== "string" || !path) {
      res.status(400).json({ error: "Body must include a 'path' string." });
      return;
    }
    try {
      const session = await projects.open(path);
      res.json(serialize(session));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/projects", (_req, res) => {
    res.json(projects.list().map(serialize));
  });

  router.get("/projects/:id", (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(serialize(session));
  });

  router.post("/projects/:id/rescan", async (req, res) => {
    const session = await projects.rescan(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(serialize(session));
  });

  router.get("/projects/:id/memory", (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(session.memory.list());
  });

  router.post("/projects/:id/memory", (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const { category, content } = req.body ?? {};
    if (typeof category !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "Body must include 'category' and 'content' strings." });
      return;
    }
    res.json(session.memory.add(category as MemoryCategory, content));
  });

  router.delete("/projects/:id/memory/:entryId", (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    session.memory.remove(Number(req.params.entryId));
    res.status(204).end();
  });

  router.get("/projects/:id/git/status", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    try {
      res.json(await gitStatusTool(session.guard));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/projects/:id/git/diff", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    try {
      const path = typeof req.query.path === "string" ? req.query.path : undefined;
      res.json({ diff: await gitDiffTool(session.guard, path) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/projects/:id/git/log", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await gitLogTool(session.guard, limit));
  });

  // Restoring a checkpoint is a hard reset — deliberately reachable only
  // via this direct REST call (a user clicking "Restore" in the UI), never
  // through the agent's tool set. See git-tools.ts's restoreCheckpoint doc.
  router.post("/projects/:id/git/restore", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const hash = req.body?.hash;
    if (typeof hash !== "string" || !hash) {
      res.status(400).json({ error: "Body must include a 'hash' string." });
      return;
    }
    try {
      res.json(await restoreCheckpoint(session.guard, hash));
    } catch (err) {
      if (err instanceof InvalidCommitReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Persisted run logs (P4) — one JSONL file per chat run under
  // .gameforge/logs/, written as it happens by chat-socket.ts's
  // onLogEntry hook. Read-only REST access; nothing writes through here.
  router.get("/projects/:id/runs", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(await session.runLogs.listRuns());
  });

  router.get("/projects/:id/runs/:runId", async (req, res) => {
    const session = projects.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(await session.runLogs.readRun(req.params.runId));
  });

  router.post("/providers/models", async (req, res) => {
    const { provider, baseUrl, apiKey } = req.body ?? {};
    if (typeof provider !== "string") {
      res.status(400).json({ error: "Body must include a 'provider' string." });
      return;
    }
    try {
      const instance = createProvider({ provider, model: "", baseUrl, apiKey });
      const models = await instance.listModels();
      res.json(models);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
