import { PREFAB } from "../constants.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { FACING, LAYOUT } from "./openworld-constants.ts";
import { openWorldGeometry, type Area, type BlockPlan, type Building, type Dressing, type Geometry, type Link, type Lots, type PathPlan } from "./openworld-layout.ts";
import { PLACE_KIND, type Place, type PlaceKind } from "./walk-graph.ts";

/**
 * A plain programme for the builders' rows to run on: any programme the builders accept must satisfy the same rows, so they are held to this one, on the real block plans.
 * Every lot is a home with a 9 m high building, every alley a hiding place, the park and its court places to hang out, one bus stop; six homes lie beyond the walls.
 */
const HOUSE_HEIGHT = 9;
const ROW_STYLE = "fixture-row";
const BEYOND_WALLS_PLACES = 6;
const BEYOND_WALLS_STEP = 7;
const BEYOND_WALLS_MARGIN = 20;
const BUS_STOP_WIDTH = 5;
const BUS_STOP_DEPTH = 1;
/** The block the bus stop stands on (the middle of the south row) and the dumpster's place in an alley. */
const BUS_STOP_BLOCK = { column: 1, row: LAYOUT.rows - 1 } as const;
const DUMPSTER_BACK = 0.7;

type Mutable = { buildings: Building[]; places: Place[]; links: Link[]; paths: PathPlan[]; areas: Area[]; dressing: Dressing[] };

type PlaceFields = { kind: PlaceKind; name: string; doorX: number; doorZ: number; yaw: number; x: number; z: number; width: number; depth: number; style: string };

function place(fields: PlaceFields): Place {
  return { ...fields, doorNode: -1, storeys: fields.style === "" ? 0 : 3, sector: "fixture" };
}

function layBlock(plan: BlockPlan, blockIndex: number, mutable: Mutable): void {
  mutable.paths.push(...plan.paths);
  for (const lot of plan.lots) {
    const house = lot.house;
    const depth = house.z1 - house.z0;
    mutable.buildings.push({ x: lot.x, z: (house.z0 + house.z1) / 2, yaw: lot.yaw, depth, width: lot.width, height: HOUSE_HEIGHT, style: ROW_STYLE });
    mutable.links.push({ place: mutable.places.length, block: blockIndex, side: lot.face });
    mutable.places.push(place({ kind: PLACE_KIND.home, name: `${blockIndex}${lot.face[0]}${lot.index} Fixture St`, doorX: lot.x, doorZ: lot.frontZ, yaw: lot.yaw, x: lot.x, z: (house.z0 + house.z1) / 2, width: lot.width, depth, style: ROW_STYLE }));
  }
  if (plan.alley) {
    const alley = plan.alley;
    const middle = (alley.x0 + alley.x1) / 2;
    mutable.links.push({ place: mutable.places.length, block: blockIndex, side: null });
    mutable.places.push(place({ kind: PLACE_KIND.hide, name: `Alley ${blockIndex}`, doorX: middle, doorZ: plan.centreZ, yaw: 0, x: middle, z: plan.centreZ, width: alley.x1 - alley.x0, depth: alley.z1 - alley.z0, style: "" }));
    mutable.areas.push({ surface: "asphalt", ...alley });
    mutable.dressing.push({ prefab: PREFAB.dumpster, x: alley.x0 + 0.75 * (alley.x1 - alley.x0), z: alley.z1 - DUMPSTER_BACK });
  }
  if (plan.lawn && plan.court && plan.courtDoor) {
    mutable.links.push({ place: mutable.places.length, block: blockIndex, side: null });
    mutable.places.push(place({ kind: PLACE_KIND.hangout, name: "Fixture Park", doorX: plan.centreX, doorZ: plan.centreZ, yaw: 0, x: plan.centreX, z: plan.centreZ, width: plan.lawn.x1 - plan.lawn.x0, depth: plan.lawn.z1 - plan.lawn.z0, style: "" }));
    mutable.links.push({ place: mutable.places.length, block: blockIndex, side: null });
    mutable.places.push(place({ kind: PLACE_KIND.hangout, name: "Fixture Court", doorX: plan.courtDoor[0], doorZ: plan.courtDoor[1], yaw: 0, x: (plan.court.x0 + plan.court.x1) / 2, z: (plan.court.z0 + plan.court.z1) / 2, width: plan.court.x1 - plan.court.x0, depth: plan.court.z1 - plan.court.z0, style: "" }));
    mutable.areas.push({ surface: "grass", ...plan.lawn }, { surface: "asphalt", ...plan.court });
  }
}

/** A bus stop on the clear path's curb edge of a block's north face. */
function layBusStop(plan: BlockPlan, blockIndex: number, geometry: Geometry, mutable: Mutable): void {
  const doorZ = plan.centreZ - geometry.blockDepth / 2 - geometry.sidewalkFrontage - geometry.sidewalkClear;
  mutable.links.push({ place: mutable.places.length, block: blockIndex, side: "north" });
  mutable.places.push(place({ kind: PLACE_KIND.transit, name: "Fixture Bus Stop", doorX: plan.centreX, doorZ, yaw: FACING.north, x: plan.centreX, z: doorZ, width: BUS_STOP_WIDTH, depth: BUS_STOP_DEPTH, style: "" }));
}

/** The plain programme on the real grid, with the walls `wallReach` m from the outermost streets' centre lines. */
export function fixtureLots(wallReach: number): Lots {
  const geometry = openWorldGeometry({ ...LAYOUT, wallReach });
  const plans = planBlocks(geometry);
  const mutable: Mutable = { buildings: [], places: [], links: [], paths: [], areas: [], dressing: [] };
  for (const [index, plan] of plans.playable.entries()) layBlock(plan, index, mutable);
  const busBlock = plans.playable.findIndex((plan) => plan.column === BUS_STOP_BLOCK.column && plan.row === BUS_STOP_BLOCK.row);
  layBusStop(plans.playable[busBlock]!, busBlock, geometry, mutable);
  const backdropStart = mutable.places.length;
  for (let step = 0; step < BEYOND_WALLS_PLACES; step++) {
    const x = geometry.halfX + BEYOND_WALLS_MARGIN + step * BEYOND_WALLS_STEP;
    mutable.places.push(place({ kind: PLACE_KIND.home, name: `Beyond ${step}`, doorX: x, doorZ: 0, yaw: 0, x, z: 0, width: geometry.lotFrontage, depth: geometry.houseDepth, style: ROW_STYLE }));
  }
  return { geometry, blocks: plans.playable, backdropStart, ...mutable };
}
