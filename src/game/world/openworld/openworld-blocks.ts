import { BACKDROP_RINGS, FACING, PARK, PARK_BLOCK } from "./openworld-constants.ts";
import { blockCentre, type BlockPlan, type BlockRef, type Geometry, type LotPlan, type PathPlan, type Rect } from "./openworld-layout.ts";

/** Every block of the grid: the playable ones (row by row, north to south, west to east) and the ring of drawn-only backdrop blocks beyond the walls. */
type BlockPlans = { playable: readonly BlockPlan[]; backdrop: readonly BlockPlan[] };

function rect(xA: number, zA: number, xB: number, zB: number): Rect {
  return { x0: Math.min(xA, xB), z0: Math.min(zA, zB), x1: Math.max(xA, xB), z1: Math.max(zA, zB) };
}

/** The lots along one long face of a block, west to east, tiling the face edge to edge. */
function faceLots(geometry: Geometry, block: BlockRef, north: boolean): LotPlan[] {
  const inward = north ? 1 : -1;
  const lineZ = block.centreZ - (inward * geometry.blockDepth) / 2;
  const frontZ = lineZ + inward * geometry.setback;
  const houseBackZ = frontZ + inward * geometry.houseDepth;
  const lotBackZ = lineZ + inward * geometry.lotDepth;
  const west = block.centreX - geometry.blockLength / 2;
  return Array.from({ length: geometry.lotsPerFace }, (_, index) => {
    const x0 = west + index * geometry.lotFrontage;
    const x1 = x0 + geometry.lotFrontage;
    return {
      face: north ? "north" : "south",
      index,
      x: (x0 + x1) / 2,
      width: geometry.lotFrontage,
      lineZ,
      frontZ,
      inward,
      yaw: north ? FACING.north : FACING.south,
      lot: rect(x0, lineZ, x1, lotBackZ),
      house: rect(x0, frontZ, x1, houseBackZ),
      yard: rect(x0, houseBackZ, x1, lotBackZ),
    };
  });
}

/**
 * The alley down a block's middle, opening on the two north-south streets: its ground and the path along it, joined to the sidewalk paths at both mouths.
 * The path has a node at the block's middle and at every lot's middle, where a yard's gate would open on it.
 */
function alleyOf(geometry: Geometry, block: BlockRef, index: number): { alley: Rect; paths: PathPlan[] } {
  const halfLength = geometry.blockLength / 2;
  const alley = rect(block.centreX - halfLength, block.centreZ - geometry.alley / 2, block.centreX + halfLength, block.centreZ + geometry.alley / 2);
  const gateXs = Array.from({ length: geometry.lotsPerFace }, (_, lot) => alley.x0 + (lot + 0.5) * geometry.lotFrontage);
  const points = [alley.x0, ...[...gateXs, block.centreX].sort((a, b) => a - b), alley.x1].map((x): readonly [number, number] => [x, block.centreZ]);
  return {
    alley,
    paths: [
      {
        block: index,
        points,
        joins: [
          { point: 0, side: "west" },
          { point: points.length - 1, side: "east" },
        ],
      },
    ],
  };
}

/** The park block: lawn to every property line (no fence, open to the four streets), the cross paths and the court's spur off the east-west path. */
function parkOf(geometry: Geometry, block: BlockRef, index: number): { lawn: Rect; court: Rect; courtDoor: readonly [number, number]; paths: PathPlan[] } {
  const halfLength = geometry.blockLength / 2;
  const halfDepth = geometry.blockDepth / 2;
  const courtX = block.centreX + PARK.courtOffsetX;
  const courtZ = block.centreZ + PARK.courtOffsetZ;
  const court = rect(courtX - PARK.courtLength / 2, courtZ - PARK.courtWidth / 2, courtX + PARK.courtLength / 2, courtZ + PARK.courtWidth / 2);
  const courtDoor = [courtX, court.z0] as const;
  const crossXs = PARK.crossPaths.map((offset) => block.centreX + offset);
  const eastWest = [block.centreX - halfLength, ...[...crossXs, courtX].sort((a, b) => a - b), block.centreX + halfLength].map((x): readonly [number, number] => [x, block.centreZ]);
  const northSouth = crossXs.map(
    (x): PathPlan => ({
      block: index,
      points: [
        [x, block.centreZ - halfDepth],
        [x, block.centreZ],
        [x, block.centreZ + halfDepth],
      ],
      joins: [
        { point: 0, side: "north" },
        { point: 2, side: "south" },
      ],
    }),
  );
  const spur: PathPlan = { block: index, points: [[courtX, block.centreZ], courtDoor], joins: [] };
  const alongStreets: PathPlan = {
    block: index,
    points: eastWest,
    joins: [
      { point: 0, side: "west" },
      { point: eastWest.length - 1, side: "east" },
    ],
  };
  return { lawn: rect(block.centreX - halfLength, block.centreZ - halfDepth, block.centreX + halfLength, block.centreZ + halfDepth), court, courtDoor, paths: [alongStreets, ...northSouth, spur] };
}

function planBlock(geometry: Geometry, block: BlockRef, index: number, playable: boolean): BlockPlan {
  const park = playable && block.column === PARK_BLOCK.column && block.row === PARK_BLOCK.row;
  if (park) {
    const { lawn, court, courtDoor, paths } = parkOf(geometry, block, index);
    return { ...block, playable, park, lots: [], alley: null, lawn, court, paths, courtDoor };
  }
  const { alley, paths } = alleyOf(geometry, block, index);
  return { ...block, playable, park, lots: [...faceLots(geometry, block, true), ...faceLots(geometry, block, false)], alley, lawn: null, court: null, paths: playable ? paths : [], courtDoor: null };
}

/** The grid's blocks and the backdrop ring round it, every lot, alley, lawn and path from the dimensions alone. */
export function planBlocks(geometry: Geometry): BlockPlans {
  const playable: BlockPlan[] = [];
  const backdrop: BlockPlan[] = [];
  for (let row = -BACKDROP_RINGS; row < geometry.rows + BACKDROP_RINGS; row++) {
    for (let column = -BACKDROP_RINGS; column < geometry.columns + BACKDROP_RINGS; column++) {
      const inside = column >= 0 && column < geometry.columns && row >= 0 && row < geometry.rows;
      const block = blockCentre(geometry, column, row);
      if (inside) playable.push(planBlock(geometry, block, playable.length, true));
      else backdrop.push(planBlock(geometry, block, -1, false));
    }
  }
  return { playable, backdrop };
}
