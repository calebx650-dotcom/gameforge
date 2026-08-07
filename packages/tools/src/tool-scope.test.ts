import { describe, expect, it } from "vitest";
import { getAvailableTools } from "./tool-scope.js";
import { ENGINE_TOOL_NAMES } from "./engine-tools.js";
import { GENERATION_TOOL_PROVIDER_KEY } from "./generation-tools.js";
import { TOOL_DEFINITIONS } from "./definitions.js";

const fakeBridge = { isConnected: () => true } as any;

describe("getAvailableTools", () => {
  it("always includes read/write/execution/git tools regardless of configuration", () => {
    const names = getAvailableTools({}, undefined).map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("run_command");
    expect(names).toContain("git_status");
    expect(names).toContain("git_commit");
  });

  it("excludes every engine tool when no engine bridge is configured", () => {
    const names = getAvailableTools({}, undefined).map((t) => t.name);
    for (const engineTool of ENGINE_TOOL_NAMES) {
      expect(names).not.toContain(engineTool);
    }
  });

  it("includes every engine tool when an engine bridge is configured", () => {
    const names = getAvailableTools({}, fakeBridge).map((t) => t.name);
    for (const engineTool of ENGINE_TOOL_NAMES) {
      expect(names).toContain(engineTool);
    }
  });

  it("excludes vendor-backed generation tools whose provider isn't configured", () => {
    const names = getAvailableTools({}, undefined).map((t) => t.name);
    for (const vendorTool of Object.keys(GENERATION_TOOL_PROVIDER_KEY)) {
      expect(names).not.toContain(vendorTool);
    }
  });

  it("includes a vendor-backed generation tool once its specific provider is configured", () => {
    const names = getAvailableTools({ text3d: {} as any }, undefined).map((t) => t.name);
    expect(names).toContain("generate_3d_model");
    // A sibling vendor tool whose provider is still unconfigured stays excluded.
    expect(names).not.toContain("generate_pbr_material");
  });

  it("always includes the pure, vendor-free generation tools", () => {
    const names = getAvailableTools({}, undefined).map((t) => t.name);
    expect(names).toContain("generate_level_layout");
    expect(names).toContain("generate_shader");
    expect(names).toContain("generate_humanoid_avatar_mapping");
  });

  it("with everything configured, returns exactly the full TOOL_DEFINITIONS set", () => {
    const allProviders = {
      text3d: {} as any,
      pbr: {} as any,
      autoRig: {} as any,
      motion: {} as any,
      voice: {} as any,
      music: {} as any,
    };
    const names = getAvailableTools(allProviders, fakeBridge).map((t) => t.name).sort();
    const allNames = TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual(allNames);
  });
});
