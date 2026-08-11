import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDependencyGraph, findDependencies, findDependents } from "./dependency-graph.js";

async function makeFixtureProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gf-depgraph-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "some-package"), { recursive: true });

  // main.ts imports both a real sibling file and an external package.
  await writeFile(
    join(root, "src", "main.ts"),
    `import { helper } from "./helper.js";\nimport express from "express";\nhelper();\n`,
  );
  await writeFile(join(root, "src", "helper.ts"), `export function helper() {}\n`);
  // A file reached only via a require() call, and via a directory index import.
  await writeFile(join(root, "src", "legacy.js"), `const { helper } = require("./helper.js");\nmodule.exports = {};\n`);
  await mkdir(join(root, "src", "utils"), { recursive: true });
  await writeFile(join(root, "src", "utils", "index.ts"), `export const util = 1;\n`);
  await writeFile(join(root, "src", "uses-utils.ts"), `import { util } from "./utils";\nconsole.log(util);\n`);
  // A dangling relative import that doesn't resolve to any real file.
  await writeFile(join(root, "src", "broken.ts"), `import { nothing } from "./does-not-exist.js";\n`);
  // node_modules should never be walked.
  await writeFile(join(root, "node_modules", "some-package", "index.js"), `module.exports = {};\n`);

  return root;
}

describe("buildDependencyGraph", () => {
  it("resolves a relative import to the real file on disk", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(findDependencies(graph, "src/main.ts")).toEqual(["src/helper.ts"]);
  });

  it("excludes external package imports from the graph — they aren't part of the project's own files", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    const mainEntry = graph.entries.find((e) => e.file === "src/main.ts");
    expect(mainEntry?.imports).not.toContain("express");
    expect(mainEntry?.imports).toHaveLength(1);
  });

  it("resolves a require() call the same as an import", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(findDependencies(graph, "src/legacy.js")).toEqual(["src/helper.ts"]);
  });

  it("resolves a directory import to its index file", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(findDependencies(graph, "src/uses-utils.ts")).toEqual(["src/utils/index.ts"]);
  });

  it("silently drops an import that doesn't resolve to any real file, rather than fabricating an entry", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(findDependencies(graph, "src/broken.ts")).toEqual([]);
  });

  it("finds dependents (reverse direction) — who imports this file", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(findDependents(graph, "src/helper.ts")).toEqual(["src/legacy.js", "src/main.ts"]);
  });

  it("never walks into node_modules", async () => {
    const root = await makeFixtureProject();
    const graph = await buildDependencyGraph(root);
    expect(graph.entries.some((e) => e.file.includes("node_modules"))).toBe(false);
  });

  it("returns an empty graph for a project with no TS/JS files (e.g. a C# project) rather than fabricating one from using statements", async () => {
    const root = await mkdtemp(join(tmpdir(), "gf-depgraph-cs-"));
    await mkdir(join(root, "Assets"), { recursive: true });
    await writeFile(join(root, "Assets", "Player.cs"), `using UnityEngine;\nclass Player : MonoBehaviour {}\n`);

    const graph = await buildDependencyGraph(root);
    expect(graph.entries).toEqual([]);
  });
});
