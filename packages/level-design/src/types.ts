export type LevelTheme = "gothic_cathedral" | "urban_arena" | "asylum_hallway";

export interface Point2D {
  x: number;
  y: number;
}

export interface Room {
  id: string;
  kind: string;
  /** Bottom-left corner, in room-grid units (1 unit ~ a few meters; scale in the engine importer). */
  position: Point2D;
  width: number;
  height: number;
  connections: string[];
}

export interface Corridor {
  from: string;
  to: string;
  path: Point2D[];
}

export interface LevelLayout {
  theme: LevelTheme;
  seed: number;
  rooms: Room[];
  corridors: Corridor[];
}

export interface PropPlacement {
  roomId: string;
  prefabId: string;
  position: { x: number; y: number; z: number };
  rotationY?: number;
}

export interface LevelGenerationRequest {
  theme: LevelTheme;
  seed?: number;
  roomCount?: number;
}

export interface LevelGenerationResult {
  layout: LevelLayout;
  propPlacements: PropPlacement[];
}
