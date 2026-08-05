import type { LevelLayout, Point2D } from "./types.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ProBuilderCommand =
  | { type: "BuildRoomShell"; id: string; center: Vec3; floorSize: { width: number; depth: number }; wallHeight: number; wallThickness: number }
  | { type: "BuildCorridorFloor"; id: string; polygon: Vec3[]; wallHeight: number };

export interface ProBuilderExportOptions {
  wallHeight?: number;
  wallThickness?: number;
  corridorWidth?: number;
}

/**
 * Translates a generated LevelLayout into a sequence of ProBuilder
 * build commands: one room-shell (floor + four walls) per room, one
 * floor strip per corridor segment. This is real, testable data
 * generation — it does NOT call Unity's ProBuilder API directly (there's
 * no Unity Editor in this environment to call it against). The intended
 * consumer is a small Unity-side C# script (invoked through the
 * GameForgeBridge / unity-mcp connection — see UNITY_BRIDGE.md) that
 * walks this command list and calls `ShapeGenerator.GenerateCube` /
 * builds a custom `ProBuilderMesh` per command via Unity's
 * `com.unity.probuilder` scripting API. Keeping the translation step
 * here means graybox geometry generation isn't blocked on that Unity
 * script existing yet — the level data is already in exactly the shape
 * that script needs to consume.
 */
export function generateProBuilderCommands(layout: LevelLayout, options: ProBuilderExportOptions = {}): ProBuilderCommand[] {
  const wallHeight = options.wallHeight ?? 3;
  const wallThickness = options.wallThickness ?? 0.2;
  const corridorWidth = options.corridorWidth ?? 1.5;

  const commands: ProBuilderCommand[] = [];

  for (const room of layout.rooms) {
    commands.push({
      type: "BuildRoomShell",
      id: room.id,
      center: { x: room.position.x + room.width / 2, y: 0, z: room.position.y + room.height / 2 },
      floorSize: { width: room.width, depth: room.height },
      wallHeight,
      wallThickness,
    });
  }

  for (const corridor of layout.corridors) {
    for (let i = 0; i < corridor.path.length - 1; i++) {
      commands.push({
        type: "BuildCorridorFloor",
        id: `${corridor.from}->${corridor.to}#${i}`,
        polygon: segmentToStrip3D(corridor.path[i], corridor.path[i + 1], corridorWidth),
        wallHeight,
      });
    }
  }

  return commands;
}

function segmentToStrip3D(a: Point2D, b: Point2D, width: number): Vec3[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  return [
    { x: a.x + nx, y: 0, z: a.y + ny },
    { x: b.x + nx, y: 0, z: b.y + ny },
    { x: b.x - nx, y: 0, z: b.y - ny },
    { x: a.x - nx, y: 0, z: a.y - ny },
  ];
}
