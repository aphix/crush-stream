import { FACING, LAMP_SPACING, TREE_LAMP_CLEARANCE, TREE_SPACING } from "./openworld-constants.ts";
import type { BlockRef, Geometry, Side } from "./openworld-layout.ts";

type Point = { x: number; z: number };

/** One face of a block's property line: where its sidewalk and street lie. `outwardYaw` is the yaw of a prop whose front (local +x) faces the street. */
export type BlockSide = { side: Side; alongX: boolean; fixed: number; outward: number; start: number; length: number; outwardYaw: number };

/** A block's four faces: north, south, west, east. */
export function sidesOf(block: BlockRef, geometry: Geometry): BlockSide[] {
  const westEdge = block.centreX - geometry.blockLength / 2;
  const northEdge = block.centreZ - geometry.blockDepth / 2;
  return [
    { side: "north", alongX: true, fixed: northEdge, outward: -1, start: westEdge, length: geometry.blockLength, outwardYaw: FACING.north },
    { side: "south", alongX: true, fixed: block.centreZ + geometry.blockDepth / 2, outward: 1, start: westEdge, length: geometry.blockLength, outwardYaw: FACING.south },
    { side: "west", alongX: false, fixed: westEdge, outward: -1, start: northEdge, length: geometry.blockDepth, outwardYaw: FACING.west },
    { side: "east", alongX: false, fixed: block.centreX + geometry.blockLength / 2, outward: 1, start: northEdge, length: geometry.blockDepth, outwardYaw: FACING.east },
  ];
}

/** The point `along` the side and `distance` out from its property line. */
export function sidePoint(side: BlockSide, along: number, distance: number): Point {
  const across = side.fixed + side.outward * distance;
  return side.alongX ? { x: along, z: across } : { x: across, z: along };
}

/** Stations along a side: `count` of them, evenly spread, each in the middle of its share. */
function stations(side: BlockSide, count: number): number[] {
  return Array.from({ length: count }, (_, index) => side.start + ((index + 0.5) * side.length) / count);
}

/** Where the side's lamps stand along it. */
export function lampStations(side: BlockSide): number[] {
  return stations(side, Math.max(1, Math.round(side.length / LAMP_SPACING)));
}

/** Where the side's street trees stand along it: none within the lamp clearance of a lamp. */
export function treeStations(side: BlockSide): number[] {
  const lamps = lampStations(side);
  return stations(side, Math.floor(side.length / TREE_SPACING)).filter((along) => lamps.every((lamp) => Math.abs(along - lamp) >= TREE_LAMP_CLEARANCE));
}
