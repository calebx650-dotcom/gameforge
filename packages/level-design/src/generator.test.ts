import { describe, expect, it } from "vitest";
import { generateLevel } from "./generator.js";
import { THEME_DATA } from "./theme-data.js";

function bfsReachable(rooms: ReturnType<typeof generateLevel>["layout"]["rooms"]): Set<string> {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const visited = new Set<string>(["room-0"]);
  let frontier = ["room-0"];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of byId.get(id)!.connections) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

describe("generateLevel", () => {
  it("is deterministic for a given seed", () => {
    const a = generateLevel({ theme: "gothic_cathedral", seed: 42, roomCount: 10 });
    const b = generateLevel({ theme: "gothic_cathedral", seed: 42, roomCount: 10 });
    expect(a).toEqual(b);
  });

  it("produces a different layout for a different seed", () => {
    const a = generateLevel({ theme: "gothic_cathedral", seed: 1, roomCount: 10 });
    const b = generateLevel({ theme: "gothic_cathedral", seed: 2, roomCount: 10 });
    expect(a.layout.rooms.map((r) => r.position)).not.toEqual(b.layout.rooms.map((r) => r.position));
  });

  it("generates the requested number of rooms with no overlaps, all reachable from the entrance", () => {
    const { layout } = generateLevel({ theme: "urban_arena", seed: 7, roomCount: 12 });
    expect(layout.rooms).toHaveLength(12);

    for (let i = 0; i < layout.rooms.length; i++) {
      for (let j = i + 1; j < layout.rooms.length; j++) {
        const a = layout.rooms[i];
        const b = layout.rooms[j];
        const overlapX = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x;
        const overlapY = a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
        expect(overlapX && overlapY).toBe(false);
      }
    }

    const reachable = bfsReachable(layout.rooms);
    expect(reachable.size).toBe(layout.rooms.length);
  });

  it("assigns the entrance and finale room kinds correctly and only uses theme-appropriate kinds", () => {
    const { layout } = generateLevel({ theme: "asylum_hallway", seed: 3, roomCount: 8 });
    const theme = THEME_DATA.asylum_hallway;
    expect(layout.rooms[0].kind).toBe(theme.entranceKind);
    expect(layout.rooms.some((r) => r.kind === theme.finaleKind)).toBe(true);

    const allowedKinds = new Set([theme.entranceKind, theme.finaleKind, ...theme.roomKinds]);
    for (const room of layout.rooms) {
      expect(allowedKinds.has(room.kind)).toBe(true);
    }
  });

  it("places 1-3 thematically appropriate props per room", () => {
    const { layout, propPlacements } = generateLevel({ theme: "gothic_cathedral", seed: 5, roomCount: 6 });
    const theme = THEME_DATA.gothic_cathedral;
    const countsByRoom = new Map<string, number>();
    for (const p of propPlacements) {
      expect(theme.decorPrefabs).toContain(p.prefabId);
      countsByRoom.set(p.roomId, (countsByRoom.get(p.roomId) ?? 0) + 1);
    }
    for (const room of layout.rooms) {
      const count = countsByRoom.get(room.id) ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    }
  });
});
