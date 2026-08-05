import { describe, expect, it } from "vitest";
import { generateLevel } from "./generator.js";
import { computeNavMeshBakeInput } from "./navmesh.js";

describe("computeNavMeshBakeInput", () => {
  it("produces one polygon per room plus one strip per corridor segment", () => {
    const { layout } = generateLevel({ theme: "urban_arena", seed: 11, roomCount: 5 });
    const input = computeNavMeshBakeInput(layout);

    const roomSurfaces = input.walkableSurfaces.filter((s) => layout.rooms.some((r) => r.id === s.sourceId));
    expect(roomSurfaces).toHaveLength(layout.rooms.length);
    for (const surface of roomSurfaces) {
      expect(surface.polygon).toHaveLength(4);
    }

    const corridorSegments = layout.corridors.reduce((sum, c) => sum + c.path.length - 1, 0);
    expect(input.walkableSurfaces.length).toBe(layout.rooms.length + corridorSegments);
  });

  it("uses sensible default agent parameters and respects overrides", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 2, roomCount: 3 });
    const defaults = computeNavMeshBakeInput(layout);
    expect(defaults.agentRadius).toBe(0.5);
    expect(defaults.maxSlopeDegrees).toBe(45);

    const custom = computeNavMeshBakeInput(layout, { agentRadius: 0.75, agentHeight: 2.2, maxSlopeDegrees: 30 });
    expect(custom.agentRadius).toBe(0.75);
    expect(custom.agentHeight).toBe(2.2);
    expect(custom.maxSlopeDegrees).toBe(30);
  });
});
