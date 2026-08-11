import { describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "./index.js";

const execFileAsync = promisify(execFile);

async function makeGitProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gf-route-git-"));
  await writeFile(join(root, "a.txt"), "v1\n");
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

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

  it("reports git status, diff, and log for a git-backed project", async () => {
    const root = await makeGitProject();
    await writeFile(join(root, "a.txt"), "v2\n");
    const { app } = createApp();
    const openRes = await request(app).post("/api/projects").send({ path: root });
    const id = openRes.body.id;

    const statusRes = await request(app).get(`/api/projects/${id}/git/status`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.isRepo).toBe(true);
    expect(statusRes.body.unstaged).toContain("a.txt");

    const diffRes = await request(app).get(`/api/projects/${id}/git/diff`);
    expect(diffRes.body.diff).toContain("+v2");

    const logRes = await request(app).get(`/api/projects/${id}/git/log`);
    expect(logRes.body).toHaveLength(1);
    expect(logRes.body[0].message).toBe("initial");
  });

  it("restores a checkpoint via the explicit restore endpoint", async () => {
    const root = await makeGitProject();
    const { app } = createApp();
    const openRes = await request(app).post("/api/projects").send({ path: root });
    const id = openRes.body.id;
    const checkpointHash = (await request(app).get(`/api/projects/${id}/git/log`)).body[0].hash;

    await writeFile(join(root, "a.txt"), "v2\n");
    await execFileAsync("git", ["commit", "-am", "v2"], { cwd: root });

    const restoreRes = await request(app).post(`/api/projects/${id}/git/restore`).send({ hash: checkpointHash });
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.restoredTo).toBe(checkpointHash);

    const diffRes = await request(app).get(`/api/projects/${id}/git/diff`);
    expect(diffRes.body.diff).toBe("");
  });

  it("rejects restoring an invalid commit reference with a 400, not a 500", async () => {
    const root = await makeGitProject();
    const { app } = createApp();
    const openRes = await request(app).post("/api/projects").send({ path: root });
    const id = openRes.body.id;

    const res = await request(app).post(`/api/projects/${id}/git/restore`).send({ hash: "not-a-hash!" });
    expect(res.status).toBe(400);
  });

  it("lists and reads back real persisted run logs (P4 log persistence)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-route-runlogs-"));
    const { app, projects } = createApp();
    const openRes = await request(app).post("/api/projects").send({ path: root });
    const id = openRes.body.id;

    const session = projects.get(id)!;
    await session.runLogs.append("run-1", { timestamp: 1, kind: "message", summary: "hello from run 1" });
    await session.runLogs.append("run-2", { timestamp: 2, kind: "tool_call", summary: "read_file(...)" });

    const listRes = await request(app).get(`/api/projects/${id}/runs`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.sort()).toEqual(["run-1", "run-2"]);

    const readRes = await request(app).get(`/api/projects/${id}/runs/run-1`);
    expect(readRes.status).toBe(200);
    expect(readRes.body).toEqual([{ timestamp: 1, kind: "message", summary: "hello from run 1" }]);
  });

  it("returns 404 for run-log endpoints on an unknown project", async () => {
    const { app } = createApp();
    expect((await request(app).get("/api/projects/nonexistent/runs")).status).toBe(404);
    expect((await request(app).get("/api/projects/nonexistent/runs/run-1")).status).toBe(404);
  });
});
