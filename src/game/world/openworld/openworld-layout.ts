import type { PrefabId, SurfaceId } from "../catalog.ts";
import type { Place } from "./walk-graph.ts";

/**
 * What a layout table fixes (m): a grid of blocks with streets between them. A block's long side runs along x. Blocks are measured property line to
 * property line; a street is its carriageway (curb to curb) and a sidewalk each side, the sidewalk's frontage, clear walking path and furniture strip in that order from the building.
 */
export type Dimensions = {
  columns: number;
  rows: number;
  blockLength: number;
  blockDepth: number;
  carriageway: number;
  travelLane: number;
  parkingLane: number;
  sidewalk: number;
  sidewalkFrontage: number;
  sidewalkClear: number;
  sidewalkFurniture: number;
  /** How far the invisible walls' inner faces stand from the outermost streets' centre lines. */
  wallReach: number;
};

/** The dimensions and what the map's parts derive from them. */
export type Geometry = Dimensions & {
  /** Building face to building face across a street. */
  faceToFace: number;
  pitchX: number;
  pitchZ: number;
  /** Street centre lines: x of the north-south streets, z of the east-west streets, west to east and north to south. */
  streetX: readonly number[];
  streetZ: readonly number[];
  /** The playable area's half sides, out to the walls. */
  halfX: number;
  halfZ: number;
  /** How far outside a block's property line its sidewalk path runs. */
  ringOffset: number;
  /** How far a sidewalk path runs from its street's centre line: where a crossing lands. */
  pathFromStreet: number;
  /** The outer sidewalk path's half sides, outside the outermost streets; it exists when it lies inside the walls. */
  outerX: number;
  outerZ: number;
  outerPath: boolean;
};

export function openWorldGeometry(dimensions: Dimensions): Geometry {
  const faceToFace = dimensions.carriageway + 2 * dimensions.sidewalk;
  const pitchX = dimensions.blockLength + faceToFace;
  const pitchZ = dimensions.blockDepth + faceToFace;
  const ringOffset = dimensions.sidewalkFrontage + dimensions.sidewalkClear / 2;
  const pathFromStreet = dimensions.carriageway / 2 + dimensions.sidewalk - ringOffset;
  const streetX = Array.from({ length: dimensions.columns + 1 }, (_, index) => (index - dimensions.columns / 2) * pitchX);
  const streetZ = Array.from({ length: dimensions.rows + 1 }, (_, index) => (index - dimensions.rows / 2) * pitchZ);
  const outermostX = streetX[streetX.length - 1]!;
  const outermostZ = streetZ[streetZ.length - 1]!;
  return {
    ...dimensions,
    faceToFace,
    pitchX,
    pitchZ,
    streetX,
    streetZ,
    halfX: outermostX + dimensions.wallReach,
    halfZ: outermostZ + dimensions.wallReach,
    ringOffset,
    pathFromStreet,
    outerX: outermostX + pathFromStreet,
    outerZ: outermostZ + pathFromStreet,
    outerPath: pathFromStreet < dimensions.wallReach,
  };
}

export type BlockRef = { column: number; row: number; centreX: number; centreZ: number };

/** A building prop: centre, yaw (its front is local +x), footprint, height, facade style. */
export type Building = { x: number; z: number; yaw: number; depth: number; width: number; height: number; style: string };

export type Side = "north" | "south" | "west" | "east";

/** Where a place's door joins the walk graph: a spur to the block's sidewalk path on `side`, or (no side) the door stands on a point of an interior path. */
export type Link = { place: number; block: number; side: Side | null };

/** A path inside a block (an alley, a park path): its points in order, and which of them also join the sidewalk path on a side (at the point's coordinate along that side). */
export type PathPlan = { block: number; points: readonly (readonly [number, number])[]; joins: readonly { point: number; side: Side }[] };

/** Ground the course paints a surface on. */
export type Area = { surface: SurfaceId; x0: number; z0: number; x1: number; z1: number };

/** A prop the layout stands (a dumpster, a parked car, a tree in a park). */
export type Dressing = { prefab: PrefabId; x: number; z: number; yaw?: number; scale?: number };

/** What a layout produces: the playable blocks, their buildings and places, the paths inside blocks, painted ground and dressing, then the drawn-only places beyond the walls (from `backdropStart`). */
export type Lots = {
  geometry: Geometry;
  blocks: readonly BlockRef[];
  buildings: readonly Building[];
  places: readonly Place[];
  links: readonly Link[];
  paths: readonly PathPlan[];
  areas: readonly Area[];
  dressing: readonly Dressing[];
  backdropStart: number;
};

export function blockCentre(geometry: Geometry, column: number, row: number): BlockRef {
  return { column, row, centreX: (column - (geometry.columns - 1) / 2) * geometry.pitchX, centreZ: (row - (geometry.rows - 1) / 2) * geometry.pitchZ };
}
