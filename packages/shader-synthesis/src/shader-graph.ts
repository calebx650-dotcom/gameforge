export interface ShaderGraphNode {
  id: string;
  /** Node type name, matching Unity Shader Graph's node vocabulary where possible (e.g. "Multiply", "Lerp", "SampleTexture2D", "Distance", "Saturate"). */
  type: string;
  /** Literal constant inputs, e.g. { A: 1.0 } for a Multiply node's second operand. */
  constants?: Record<string, number | string>;
}

export interface ShaderGraphEdge {
  fromNodeId: string;
  fromSlot: string;
  toNodeId: string;
  toSlot: string;
}

export interface ShaderGraphSpec {
  name: string;
  nodes: ShaderGraphNode[];
  edges: ShaderGraphEdge[];
  /** Which node/slot feeds the master stack's Base Color (or other target) output. */
  outputNodeId: string;
  outputSlot: string;
}

/**
 * A deliberately GameForge-owned intermediate representation, not a
 * byte-exact serialization of Unity's `.shadergraph` JSON format — that
 * format is internal, version-specific, and changes across Unity/URP
 * releases. This spec is what the future Unity bridge (see
 * UNITY_BRIDGE.md) would materialize into an actual Shader Graph asset,
 * either via the (undocumented) ShaderGraph scripting API or by
 * generating an equivalent hand-written HLSL shader — whichever proves
 * more stable when that bridge gets built. Keeping our own typed graph
 * means that decision doesn't block building the generators themselves.
 */
export interface DistanceGrimeBlendParams {
  nearDistance?: number;
  farDistance?: number;
}

/**
 * Builds the node graph for "blend in more grime/dirt the closer the
 * camera gets" — a Distance node feeding a Saturate/remap into a Lerp
 * between a clean albedo sample and a grime albedo sample. This is
 * exactly the kind of small, well-defined effect graph that's tedious to
 * wire up by hand in the Shader Graph editor for every material variant.
 */
export function generateDistanceGrimeBlendGraph(params: DistanceGrimeBlendParams = {}): ShaderGraphSpec {
  const nearDistance = params.nearDistance ?? 2;
  const farDistance = params.farDistance ?? 15;

  const nodes: ShaderGraphNode[] = [
    { id: "cameraPosition", type: "CameraPosition" },
    { id: "positionWS", type: "Position", constants: { Space: "World" } },
    { id: "distance", type: "Distance" },
    { id: "remap", type: "Remap", constants: { InMin: nearDistance, InMax: farDistance, OutMin: 0, OutMax: 1 } },
    { id: "saturateBlend", type: "Saturate" },
    { id: "sampleClean", type: "SampleTexture2D", constants: { Texture: "_CleanAlbedo" } },
    { id: "sampleGrime", type: "SampleTexture2D", constants: { Texture: "_GrimeAlbedo" } },
    { id: "lerp", type: "Lerp" },
  ];

  const edges: ShaderGraphEdge[] = [
    { fromNodeId: "cameraPosition", fromSlot: "Out", toNodeId: "distance", toSlot: "A" },
    { fromNodeId: "positionWS", fromSlot: "Out", toNodeId: "distance", toSlot: "B" },
    { fromNodeId: "distance", fromSlot: "Distance", toNodeId: "remap", toSlot: "In" },
    { fromNodeId: "remap", fromSlot: "Out", toNodeId: "saturateBlend", toSlot: "In" },
    { fromNodeId: "sampleClean", fromSlot: "RGBA", toNodeId: "lerp", toSlot: "A" },
    { fromNodeId: "sampleGrime", fromSlot: "RGBA", toNodeId: "lerp", toSlot: "B" },
    { fromNodeId: "saturateBlend", fromSlot: "Out", toNodeId: "lerp", toSlot: "T" },
  ];

  return { name: "GameForge_DistanceGrimeBlend", nodes, edges, outputNodeId: "lerp", outputSlot: "Out" };
}

/** Validates that every edge references a node that actually exists in the graph, and that the output node does too. */
export function validateShaderGraph(spec: ShaderGraphSpec): string[] {
  const nodeIds = new Set(spec.nodes.map((n) => n.id));
  const errors: string[] = [];
  for (const edge of spec.edges) {
    if (!nodeIds.has(edge.fromNodeId)) errors.push(`Edge references unknown source node "${edge.fromNodeId}"`);
    if (!nodeIds.has(edge.toNodeId)) errors.push(`Edge references unknown destination node "${edge.toNodeId}"`);
  }
  if (!nodeIds.has(spec.outputNodeId)) errors.push(`Output node "${spec.outputNodeId}" is not in the graph`);
  return errors;
}
