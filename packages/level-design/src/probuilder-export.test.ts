import { describe, expect, it } from "vitest";
import { generateLevel } from "./generator.js";
import { generateProBuilderCommands } from "./probuilder-export.js";

describe("generateProBuilderCommands", () => {
  it("emits one BuildRoomShell command per room, centered on the room's footprint", () => {
    const { layout } = generateLevel({ theme: "gothic_cathedral", seed: 1, roomCount: 4 });
    const commands = generateProBuilderCommands(layout);
    const roomCommands = commands.filter((c) => c.type === "BuildRoomShell");
    expect(roomCommands).toHaveLength(layout.rooms.length);

    const first = roomCommands.find((c) => c.id === layout.rooms[0].id)!;
    expect(first.floorSize).toEqual({ width: layout.rooms[0].width, depth: layout.rooms[0].height });
    expect(first.center.x).toBeCloseTo(layout.rooms[0].position.x + layout.rooms[0].width / 2);
    expect(first.center.z).toBeCloseTo(layout.rooms[0].position.y + layout.rooms[0].height / 2);
  });

  it("emits one BuildCorridorFloor command per corridor path segment, as a 4-point strip", () => {
    const { layout } = generateLevel({ theme: "urban_arena", seed: 2, roomCount: 6 });
    const commands = generateProBuilderCommands(layout);
    const corridorCommands = commands.filter((c) => c.type === "BuildCorridorFloor");
    const expectedSegments = layout.corridors.reduce((sum, c) => sum + c.path.length - 1, 0);
    expect(corridorCommands).toHaveLength(expectedSegments);
    for (const cmd of corridorCommands) {
      expect(cmd.polygon).toHaveLength(4);
    }
  });

  it("respects custom wall height/thickness/corridor width options", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 3, roomCount: 3 });
    const commands = generateProBuilderCommands(layout, { wallHeight: 5, wallThickness: 0.5, corridorWidth: 3 });
    const room = commands.find((c) => c.type === "BuildRoomShell")!;
    expect(room.wallHeight).toBe(5);
    expect(room.wallThickness).toBe(0.5);
  });
});
