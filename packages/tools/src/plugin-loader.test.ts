import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlugins } from "./plugin-loader.js";

async function makePluginsDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gf-plugins-"));
  const pluginsDir = join(root, "plugins");
  await mkdir(pluginsDir, { recursive: true });
  return pluginsDir;
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

    const { plugins, errors } = await loadPlugins(pluginsDir);

    expect(errors).toEqual([]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].definition.name).toBe("greet");
    const result = await plugins[0].dispatch({ name: "World" });
    expect(result).toBe("Hello, World!");
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

    const { plugins } = await loadPlugins(pluginsDir);

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

    const { plugins, errors } = await loadPlugins(pluginsDir);

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

    const { plugins, errors } = await loadPlugins(pluginsDir);

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
