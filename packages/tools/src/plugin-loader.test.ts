import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPlugins } from "./plugin-loader.js";
import type { ToolDefinition } from "@gameforge/shared";

async function makePluginsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gf-plugins-"));
  const pluginsDir = join(root, "plugins");
  await mkdir(pluginsDir, { recursive: true });
  return pluginsDir;
}

interface HarnessResult {
  plugins: Array<{ definition: ToolDefinition; filePath: string }>;
  errors: Array<{ filePath: string; message: string }>;
  dispatchResults: Array<{ name: string; result: string }>;
}

/**
 * Runs `loadPlugins(pluginsDir)` (and optionally dispatches some of the loaded plugins) in a
 * genuinely separate `node` process, via `plugin-loader.test-harness.ts` run through `tsx` —
 * not by calling `loadPlugins` directly in this test file. Confirmed live 2026-08-12: any
 * test in this file that calls `loadPlugins` directly and actually reaches its `import()`
 * call fails, because Vitest's SSR execution context (`vite-node`) has no working dynamic
 * `import()` for a file outside its own module graph — proven by testing every
 * specifier-level workaround (an indirected `new Function`-wrapped import, a `data:` URL
 * import needing no file resolution at all, the `/* @vite-ignore *\/` pragma) and getting
 * the identical failure every time, which rules out a resolver quirk and points at the
 * execution realm itself lacking `importModuleDynamically` outside Vite's own rewritten
 * import helper. A real, unmodified `node` process — which is what `loadPlugins()` actually
 * runs as in GameForge's production server — has no such limitation, so this is what
 * actually proves the real import behavior works, rather than testing an artifact of the
 * test harness. (The two tests below that never reach an actual `import()` call — a plugins
 * directory with no `.mjs` files in it, and one that doesn't exist at all — call
 * `loadPlugins` directly; there's nothing for this harness to prove for them, and skipping
 * the process-spawn keeps them fast.)
 */
async function runLoadPluginsInRealProcess(
  pluginsDir: string,
  dispatchCalls: Array<{ name: string; args: Record<string, unknown> }> = [],
): Promise<HarnessResult> {
  const harnessPath = join(dirname(fileURLToPath(import.meta.url)), "plugin-loader.test-harness.ts");
  const tsxCliPath = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [tsxCliPath, harnessPath, pluginsDir, JSON.stringify(dispatchCalls)]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`plugin-loader.test-harness.ts exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Failed to parse harness output as JSON.\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
}

describe("loadPlugins", () => {
  it("loads a real, valid plugin file from disk", async () => {
    const pluginsDir = await makePluginsDir();
    await writeFile(
      join(pluginsDir, "greet.mjs"),
      `export const definition = {
        name: "greet",
        description: "Says hello to whoever is named.",
        category: "read",
        mutating: false,
        parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      };
      export async function dispatch(args) {
        return \`Hello, \${args.name}!\`;
      }`,
    );

    const { plugins, errors, dispatchResults } = await runLoadPluginsInRealProcess(pluginsDir, [
      { name: "greet", args: { name: "World" } },
    ]);

    expect(errors).toEqual([]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].definition.name).toBe("greet");
    expect(dispatchResults).toEqual([{ name: "greet", result: "Hello, World!" }]);
  });

  it("loads multiple plugins from the same directory", async () => {
    const pluginsDir = await makePluginsDir();
    await writeFile(
      join(pluginsDir, "a.mjs"),
      `export const definition = { name: "tool_a", description: "d", category: "read", parameters: {} };
       export function dispatch() { return "a"; }`,
    );
    await writeFile(
      join(pluginsDir, "b.mjs"),
      `export const definition = { name: "tool_b", description: "d", category: "read", parameters: {} };
       export function dispatch() { return "b"; }`,
    );

    const { plugins } = await runLoadPluginsInRealProcess(pluginsDir);

    expect(plugins.map((p) => p.definition.name).sort()).toEqual(["tool_a", "tool_b"]);
  });

  it("collects an error for a plugin missing the required shape, rather than crashing the whole load", async () => {
    const pluginsDir = await makePluginsDir();
    await writeFile(join(pluginsDir, "broken.mjs"), `export const definition = { name: "broken" };`); // no dispatch, incomplete definition
    await writeFile(
      join(pluginsDir, "good.mjs"),
      `export const definition = { name: "good_tool", description: "d", category: "read", parameters: {} };
       export function dispatch() { return "ok"; }`,
    );

    const { plugins, errors } = await runLoadPluginsInRealProcess(pluginsDir);

    expect(plugins.map((p) => p.definition.name)).toEqual(["good_tool"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].filePath).toContain("broken.mjs");
    expect(errors[0].message).toMatch(/definition.*dispatch/);
  });

  it("collects an error for a plugin file that throws on import, rather than crashing the whole load", async () => {
    const pluginsDir = await makePluginsDir();
    await writeFile(join(pluginsDir, "throws.mjs"), `throw new Error("boom during import");`);
    await writeFile(
      join(pluginsDir, "good.mjs"),
      `export const definition = { name: "good_tool", description: "d", category: "read", parameters: {} };
       export function dispatch() { return "ok"; }`,
    );

    const { plugins, errors } = await runLoadPluginsInRealProcess(pluginsDir);

    expect(plugins.map((p) => p.definition.name)).toEqual(["good_tool"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/boom during import/);
  });

  it("ignores non-.mjs files in the plugins directory", async () => {
    const pluginsDir = await makePluginsDir();
    await writeFile(join(pluginsDir, "README.md"), "not a plugin");
    await writeFile(join(pluginsDir, "notes.txt"), "not a plugin");

    const { plugins, errors } = await loadPlugins(pluginsDir);

    expect(plugins).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("returns an empty result for a plugins directory that doesn't exist, rather than throwing", async () => {
    const { plugins, errors } = await loadPlugins("/nonexistent/plugins/dir");
    expect(plugins).toEqual([]);
    expect(errors).toEqual([]);
  });
});
