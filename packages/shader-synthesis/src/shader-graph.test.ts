import { describe, expect, it } from "vitest";
import { generateDistanceGrimeBlendGraph, validateShaderGraph } from "./shader-graph.js";

describe("generateDistanceGrimeBlendGraph", () => {
  it("produces a graph that passes its own validation", () => {
    const spec = generateDistanceGrimeBlendGraph();
    expect(validateShaderGraph(spec)).toEqual([]);
  });

  it("wires distance through remap/saturate into the lerp's T input", () => {
    const spec = generateDistanceGrimeBlendGraph({ nearDistance: 1, farDistance: 10 });
    const remapNode = spec.nodes.find((n) => n.type === "Remap")!;
    expect(remapNode.constants).toEqual({ InMin: 1, InMax: 10, OutMin: 0, OutMax: 1 });

    const lerpTEdge = spec.edges.find((e) => e.toNodeId === "lerp" && e.toSlot === "T");
    expect(lerpTEdge?.fromNodeId).toBe("saturateBlend");
  });

  it("outputs from the lerp node", () => {
    const spec = generateDistanceGrimeBlendGraph();
    expect(spec.outputNodeId).toBe("lerp");
  });
});

describe("validateShaderGraph", () => {
  it("flags an edge referencing a node that doesn't exist", () => {
    const spec = generateDistanceGrimeBlendGraph();
    spec.edges.push({ fromNodeId: "ghost", fromSlot: "Out", toNodeId: "lerp", toSlot: "A" });
    const errors = validateShaderGraph(spec);
    expect(errors.some((e) => e.includes('"ghost"'))).toBe(true);
  });

  it("flags an output node that doesn't exist in the graph", () => {
    const spec = generateDistanceGrimeBlendGraph();
    spec.outputNodeId = "missing";
    expect(validateShaderGraph(spec).some((e) => e.includes("missing"))).toBe(true);
  });
});
