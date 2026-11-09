import { PREFAB } from "../constants.ts";
import { FACING } from "./openworld-constants.ts";
import { blockCentre, openWorldGeometry, type Area, type BlockRef, type Building, type Dimensions, type Dressing, type Geometry, type Link, type Lots, type PathPlan } from "./openworld-layout.ts";
import { PLACE_KIND, type Place, type PlaceKind } from "./walk-graph.ts";

/**
 * A small made-up layout the builders' rows run on: any layout the builders accept must satisfy the same rows, so they are held to a plain one.
 * Blocks of 60 x 40 m, a street of 10 m with 3 m sidewalks, a row of lots on each long face, an alley through each block but the middle one,
 * which is a park with cross paths, and one bus stop.
 */
export const FIXTURE_DIMENSIONS: Omit<Dimensions, "wallReach"> = {
  columns: 3,
  rows: 3,
  blockLength: 60,
  blockDepth: 40,
  carriageway: 10,
  travelLane: 3,
  parkingLane: 2,
  sidewalk: 3,
  sidewalkFrontage: 0.5,
  sidewalkClear: 1.6,
  sidewalkFurniture: 0.9,
};

const LOTS_PER_ROW = 10;
const HOUSE_DEPTH = 12;
const HOUSE_HEIGHT = 9;
const SETBACK = 0.5;
const ALLEY_WIDTH = 4;
const ROW_STYLE = "fixture-row";
const BEYOND_WALLS_PLACES = 6;

type PlaceFields = { kind: PlaceKind; name: string; doorX: number; doorZ: number; yaw: number; x: number; z: number; width: number; depth: number; style: string };

function place(fields: PlaceFields): Place {
  return { ...fields, doorNode: -1, storeys: fields.style === "" ? 0 : 3, sector: "fixture" };
}

/** A row of lots along one long face of `block`, each a building and a home with its door on the front face. */
function layRow(block: BlockRef, blockIndex: number, north: boolean, lots: Mutable): void {
  const width = FIXTURE_DIMENSIONS.blockLength / LOTS_PER_ROW;
  const outward = north ? -1 : 1;
  const lineZ = block.centreZ + (outward * FIXTURE_DIMENSIONS.blockDepth) / 2;
  const frontZ = lineZ - outward * SETBACK;
  for (let lot = 0; lot < LOTS_PER_ROW; lot++) {
    const x = block.centreX - FIXTURE_DIMENSIONS.blockLength / 2 + (lot + 0.5) * width;
    const yaw = north ? FACING.north : FACING.south;
    const z = frontZ - (outward * HOUSE_DEPTH) / 2;
    lots.buildings.push({ x, z, yaw, depth: HOUSE_DEPTH, width, height: HOUSE_HEIGHT, style: ROW_STYLE });
    lots.links.push({ place: lots.places.length, block: blockIndex, side: north ? "north" : "south" });
    lots.places.push(place({ kind: PLACE_KIND.home, name: `${blockIndex}${north ? "n" : "s"}${lot} Fixture St`, doorX: x, doorZ: frontZ, yaw, x, z, width, depth: HOUSE_DEPTH, style: ROW_STYLE }));
  }
}

type Mutable = { buildings: Building[]; places: Place[]; links: Link[]; paths: PathPlan[]; areas: Area[]; dressing: Dressing[] };

/** A path down a block's middle from its west side to its east side, with a hiding place at its middle. */
function layAlley(block: BlockRef, blockIndex: number, lots: Mutable): void {
  const halfLength = FIXTURE_DIMENSIONS.blockLength / 2;
  lots.paths.push({
    block: blockIndex,
    points: [
      [block.centreX - halfLength, block.centreZ],
      [block.centreX, block.centreZ],
      [block.centreX + halfLength, block.centreZ],
    ],
    joins: [
      { point: 0, side: "west" },
      { point: 2, side: "east" },
    ],
  });
  lots.links.push({ place: lots.places.length, block: blockIndex, side: null });
  lots.places.push(place({ kind: PLACE_KIND.hide, name: `Alley ${blockIndex}`, doorX: block.centreX, doorZ: block.centreZ, yaw: 0, x: block.centreX, z: block.centreZ, width: FIXTURE_DIMENSIONS.blockLength, depth: ALLEY_WIDTH, style: "" }));
  lots.areas.push({ surface: "asphalt", x0: block.centreX - halfLength, z0: block.centreZ - ALLEY_WIDTH / 2, x1: block.centreX + halfLength, z1: block.centreZ + ALLEY_WIDTH / 2 });
  lots.dressing.push({ prefab: PREFAB.dumpster, x: block.centreX + halfLength / 2, z: block.centreZ + ALLEY_WIDTH / 2 - 0.6 });
}

/** A park open to all four streets: two crossing paths and a lawn. */
function layPark(block: BlockRef, blockIndex: number, lots: Mutable): void {
  const halfLength = FIXTURE_DIMENSIONS.blockLength / 2;
  const halfDepth = FIXTURE_DIMENSIONS.blockDepth / 2;
  lots.paths.push(
    {
      block: blockIndex,
      points: [
        [block.centreX, block.centreZ - halfDepth],
        [block.centreX, block.centreZ],
        [block.centreX, block.centreZ + halfDepth],
      ],
      joins: [
        { point: 0, side: "north" },
        { point: 2, side: "south" },
      ],
    },
    {
      block: blockIndex,
      points: [
        [block.centreX - halfLength, block.centreZ],
        [block.centreX, block.centreZ],
        [block.centreX + halfLength, block.centreZ],
      ],
      joins: [
        { point: 0, side: "west" },
        { point: 2, side: "east" },
      ],
    },
  );
  lots.links.push({ place: lots.places.length, block: blockIndex, side: null });
  lots.places.push(place({ kind: PLACE_KIND.hangout, name: "Fixture Park", doorX: block.centreX, doorZ: block.centreZ, yaw: 0, x: block.centreX, z: block.centreZ, width: FIXTURE_DIMENSIONS.blockLength, depth: FIXTURE_DIMENSIONS.blockDepth, style: "" }));
  lots.areas.push({ surface: "grass", x0: block.centreX - halfLength, z0: block.centreZ - halfDepth, x1: block.centreX + halfLength, z1: block.centreZ + halfDepth });
}

/** A bus stop on the clear path's curb edge of a block's north face. */
function layBusStop(block: BlockRef, blockIndex: number, geometry: Geometry, lots: Mutable): void {
  const doorZ = block.centreZ - FIXTURE_DIMENSIONS.blockDepth / 2 - geometry.sidewalkFrontage - geometry.sidewalkClear;
  lots.links.push({ place: lots.places.length, block: blockIndex, side: "north" });
  lots.places.push(place({ kind: PLACE_KIND.transit, name: "Fixture Bus Stop", doorX: block.centreX, doorZ, yaw: FACING.north, x: block.centreX, z: doorZ, width: 5, depth: 1, style: "" }));
}

/** The fixture layout with the walls `wallReach` m from the outermost streets' centre lines. */
export function fixtureLots(wallReach: number): Lots {
  const geometry = openWorldGeometry({ ...FIXTURE_DIMENSIONS, wallReach });
  const lots: Mutable = { buildings: [], places: [], links: [], paths: [], areas: [], dressing: [] };
  const blocks: BlockRef[] = [];
  for (let row = 0; row < geometry.rows; row++) for (let column = 0; column < geometry.columns; column++) blocks.push(blockCentre(geometry, column, row));
  for (const [index, block] of blocks.entries()) {
    const park = block.column === 1 && block.row === 1;
    if (park) layPark(block, index, lots);
    else {
      layRow(block, index, true, lots);
      layRow(block, index, false, lots);
      layAlley(block, index, lots);
    }
    if (block.column === 1 && block.row === geometry.rows - 1) layBusStop(block, index, geometry, lots);
  }
  const backdropStart = lots.places.length;
  for (let step = 0; step < BEYOND_WALLS_PLACES; step++) {
    const x = geometry.halfX + 20 + step * 7;
    lots.places.push(place({ kind: PLACE_KIND.home, name: `Beyond ${step}`, doorX: x, doorZ: 0, yaw: 0, x, z: 0, width: 6, depth: HOUSE_DEPTH, style: ROW_STYLE }));
  }
  return { geometry, blocks, backdropStart, ...lots };
}
