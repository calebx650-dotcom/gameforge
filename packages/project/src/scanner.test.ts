import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanProject, summarizeProjectContext } from "./scanner.js";

const execFileAsync = promisify(execFile);

describe("scanProject", () => {
  it("detects a plain Node/TypeScript project with git", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-proj-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n");
    await writeFile(join(root, "README.md"), "# Test\n");
    await execFileAsync("git", ["init"], { cwd: root });

    const ctx = await scanProject(root);
    expect(ctx.engine).toBe("none");
    expect(ctx.languages).toContain("TypeScript");
    expect(ctx.packageFiles).toContain("package.json");
    expect(ctx.docFiles).toContain("README.md");
    expect(ctx.git.isRepo).toBe(true);

    const summary = summarizeProjectContext(ctx);
    expect(summary).toContain("Engine: none");
    expect(summary).toContain("TypeScript");
  });

  it("detects a Unity project by Assets/ProjectSettings folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-unity-"));
    await mkdir(join(root, "Assets", "Scenes"), { recursive: true });
    await mkdir(join(root, "ProjectSettings"), { recursive: true });
    await writeFile(join(root, "Assets", "Scenes", "Main.unity"), "");
    await writeFile(join(root, "Assets", "Player.cs"), "class Player {}\n");

    const ctx = await scanProject(root);
    expect(ctx.engine).toBe("unity");
    expect(ctx.languages).toContain("C#");
    expect(ctx.sceneFiles).toContain("Assets/Scenes/Main.unity");
  });
});
