import { describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./index.js";

describe("REST API", () => {
  it("responds to /api/health", async () => {
    const { app } = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("opens a project and reports its context", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-route-"));
    const { app } = createApp();
    const res = await request(app).post("/api/projects").send({ path: root });
    expect(res.status).toBe(200);
    expect(res.body.root).toBe(root);
    expect(res.body.context.engine).toBe("none");

    const listRes = await request(app).get("/api/projects");
    expect(listRes.body).toHaveLength(1);
  });

  it("rejects opening a project without a path", async () => {
    const { app } = createApp();
    const res = await request(app).post("/api/projects").send({});
    expect(res.status).toBe(400);
  });

  it("adds and lists memory entries for a project", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-route-mem-"));
    const { app } = createApp();
    const openRes = await request(app).post("/api/projects").send({ path: root });
    const id = openRes.body.id;

    const addRes = await request(app)
      .post(`/api/projects/${id}/memory`)
      .send({ category: "known_bug", content: "Jump height too low" });
    expect(addRes.status).toBe(200);

    const listRes = await request(app).get(`/api/projects/${id}/memory`);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].content).toBe("Jump height too low");
  });

  it("404s for an unknown project id", async () => {
    const { app } = createApp();
    const res = await request(app).get("/api/projects/does-not-exist");
    expect(res.status).toBe(404);
  });
});
