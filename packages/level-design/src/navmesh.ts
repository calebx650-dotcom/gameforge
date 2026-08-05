import type { LevelLayout, Point2D } from "./types.js";

export interface WalkableSurface {
  /** Room or corridor id this surface belongs to. */
  sourceId: string;
  /** Floor polygon, counter-clockwise, in the same grid units as the layout. */
  polygon: Point2D[];
}

export interface NavMeshBakeInput {
  agentRadius: number;
  agentHeight: number;
  maxSlopeDegrees: number;
  walkableSurfaces: WalkableSurface[];
}

const CORRIDOR_WIDTH = 1.5;

/**
 * Computes the walkable floor geometry for a generated level: one
 * rectangular polygon per room, plus a thin rectangle along each corridor
 * path segment. This is the actual navmesh-bake INPUT — the geometry a
 * Unity NavMeshSurface.BuildNavMesh() call (via the future GameForgeBridge,
 * see UNITY_BRIDGE.md) would bake against. GameForge doesn't claim to bake
 * a real Unity navmesh without Unity present; what it can and does do
 * today is deterministically compute the walkable surfaces from the level
 * layout so that step is ready the moment the bridge exists.
 */
export function computeNavMeshBakeInput(
  layout: LevelLayout,
  options: { agentRadius?: number; agentHeight?: number; maxSlopeDegrees?: number } = {},
): NavMeshBakeInput {
  const walkableSurfaces: WalkableSurface[] = layout.rooms.map((room) => ({
    sourceId: room.id,
    polygon: [
      { x: room.position.x, y: room.position.y },
      { x: room.position.x + room.width, y: room.position.y },
      { x: room.position.x + room.width, y: room.position.y + room.height },
      { x: room.position.x, y: room.position.y + room.height },
    ],
  }));

  for (const corridor of layout.corridors) {
    for (let i = 0; i < corridor.path.length - 1; i++) {
      walkableSurfaces.push({
        sourceId: `${corridor.from}->${corridor.to}#${i}`,
        polygon: segmentToStrip(corridor.path[i], corridor.path[i + 1], CORRIDOR_WIDTH),
      });
    }
  }

  return {
    agentRadius: options.agentRadius ?? 0.5,
    agentHeight: options.agentHeight ?? 2,
    maxSlopeDegrees: options.maxSlopeDegrees ?? 45,
    walkableSurfaces,
  };
}

function segmentToStrip(a: Point2D, b: Point2D, width: number): Point2D[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (width / 2);
  const ny = (dx / length) * (width / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}
