import { Router } from "express";
import type { MemoryCategory } from "@gameforge/memory";
import { createProvider } from "@gameforge/llm";
import { summarizeProjectContext } from "@gameforge/project";
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
