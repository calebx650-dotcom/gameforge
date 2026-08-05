import { createRng, intBetween, pick } from "./rng.js";
import { THEME_DATA } from "./theme-data.js";
import type { LevelGenerationRequest, LevelGenerationResult, Point2D, Room } from "./types.js";

const CORRIDOR_GAP = 2;
const DIRECTIONS: Array<"N" | "E" | "S" | "W"> = ["N", "E", "S", "W"];
const MAX_PLACEMENT_ATTEMPTS = 200;

interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function bounds(room: Pick<Room, "position" | "width" | "height">): Bounds {
  return { x1: room.position.x, y1: room.position.y, x2: room.position.x + room.width, y2: room.position.y + room.height };
}

function overlaps(a: Bounds, b: Bounds, padding: number): boolean {
  return a.x1 - padding < b.x2 && a.x2 + padding > b.x1 && a.y1 - padding < b.y2 && a.y2 + padding > b.y1;
}

function center(room: Room): Point2D {
  return { x: room.position.x + room.width / 2, y: room.position.y + room.height / 2 };
}

/**
 * Generates a room graph for one of the supported horror/action level
 * themes: a seeded random-walk placement (attach a new room to a random
 * existing one in a random cardinal direction, retrying on overlap),
 * connected by L-shaped corridors, then thematically appropriate room
 * kinds and decor props are assigned. Fully deterministic given the same
 * seed, so it's snapshot-testable and reproducible for a designer to
 * regenerate the exact same layout later.
 */
export function generateLevel(request: LevelGenerationRequest): LevelGenerationResult {
  const theme = THEME_DATA[request.theme];
  const seed = request.seed ?? 1;
  const roomCount = Math.max(2, request.roomCount ?? 8);
  const rng = createRng(seed);

  const rooms: Room[] = [];
  const corridors: LevelGenerationResult["layout"]["corridors"] = [];

  const entranceSize = intBetween(rng, theme.roomSizeRange.min, theme.roomSizeRange.max);
  rooms.push({
    id: "room-0",
    kind: theme.entranceKind,
    position: { x: 0, y: 0 },
    width: entranceSize,
    height: entranceSize,
    connections: [],
  });

  let attempts = 0;
  while (rooms.length < roomCount && attempts < MAX_PLACEMENT_ATTEMPTS * roomCount) {
    attempts++;
    const parent = pick(rng, rooms);
    const direction = pick(rng, DIRECTIONS);
    const size = intBetween(rng, theme.roomSizeRange.min, theme.roomSizeRange.max);
    const candidate = placeAdjacent(parent, direction, size);
    const candidateBounds = bounds({ position: candidate.position, width: size, height: size });

    const collides = rooms.some((r) => overlaps(candidateBounds, bounds(r), 1));
    if (collides) continue;

    const id = `room-${rooms.length}`;
    const room: Room = { id, kind: "", position: candidate.position, width: size, height: size, connections: [parent.id] };
    parent.connections.push(id);
    rooms.push(room);
    corridors.push({ from: parent.id, to: id, path: corridorPath(center(parent), center(room)) });
  }

  assignRoomKinds(rooms, theme, rng);
  const propPlacements = placeProps(rooms, theme, rng);

  return {
    layout: { theme: request.theme, seed, rooms, corridors },
    propPlacements,
  };
}

function placeAdjacent(parent: Room, direction: "N" | "E" | "S" | "W", size: number): { position: Point2D } {
  const p = bounds(parent);
  switch (direction) {
    case "N":
      return { position: { x: parent.position.x, y: p.y2 + CORRIDOR_GAP } };
    case "S":
      return { position: { x: parent.position.x, y: p.y1 - CORRIDOR_GAP - size } };
    case "E":
      return { position: { x: p.x2 + CORRIDOR_GAP, y: parent.position.y } };
    case "W":
      return { position: { x: p.x1 - CORRIDOR_GAP - size, y: parent.position.y } };
  }
}

function corridorPath(from: Point2D, to: Point2D): Point2D[] {
  return [from, { x: to.x, y: from.y }, to];
}

function assignRoomKinds(rooms: Room[], theme: (typeof THEME_DATA)[keyof typeof THEME_DATA], rng: () => number): void {
  rooms[0].kind = theme.entranceKind;
  if (rooms.length === 1) return;

  const finale = rooms.reduce((farthest, r) => (bfsDistance(rooms, rooms[0].id, r.id) > bfsDistance(rooms, rooms[0].id, farthest.id) ? r : farthest));
  finale.kind = theme.finaleKind;

  for (const room of rooms) {
    if (room.kind) continue;
    room.kind = pick(rng, theme.roomKinds);
  }
}

function bfsDistance(rooms: Room[], fromId: string, toId: string): number {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const visited = new Set([fromId]);
  let frontier = [fromId];
  let distance = 0;
  while (frontier.length > 0) {
    if (frontier.includes(toId)) return distance;
    const next: string[] = [];
    for (const id of frontier) {
      const room = byId.get(id);
      if (!room) continue;
      for (const neighbor of room.connections) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    distance++;
  }
  return -1;
}

function placeProps(
  rooms: Room[],
  theme: (typeof THEME_DATA)[keyof typeof THEME_DATA],
  rng: () => number,
): LevelGenerationResult["propPlacements"] {
  const placements: LevelGenerationResult["propPlacements"] = [];
  for (const room of rooms) {
    const count = intBetween(rng, 1, 3);
    for (let i = 0; i < count; i++) {
      const prefabId = pick(rng, theme.decorPrefabs);
      const margin = Math.min(1, room.width / 4);
      placements.push({
        roomId: room.id,
        prefabId,
        position: {
          x: room.position.x + margin + rng() * (room.width - margin * 2),
          y: 0,
          z: room.position.y + margin + rng() * (room.height - margin * 2),
        },
        rotationY: Math.floor(rng() * 360),
      });
    }
  }
  return placements;
}
