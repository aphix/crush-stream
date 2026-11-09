import { PREFAB, SURFACE } from "../constants.ts";
import type { InteriorPlan } from "./interior-kinds.ts";
import { interiorDoor, interiorSpots, planInterior } from "./interior-plan.ts";
import { planBlocks } from "./openworld-blocks.ts";
import { LAYOUT } from "./openworld-constants.ts";
import { openWorldGeometry, type Area, type BlockPlan, type Building, type Dressing, type Geometry, type Link, type Lots, type LotPlan, type PathPlan } from "./openworld-layout.ts";
import {
  BACKDROP_MARKET,
  BEYOND,
  BLOCK_ROW_LETTERS,
  BRICK_SHARE_OF_TEN,
  BUS_STOP,
  HOME_STYLES,
  HOUSE_STOREYS,
  HUNDRED_STEP,
  HUNDRED_WEST,
  NAMED_HOMES,
  PARK_NAME,
  PLACE_NAMES,
  SIDE_PLACES,
  STREETS_Z,
  VENUE_SPOTS,
  type Face,
  type Spot,
  type Venue,
} from "./openworld-programme.ts";
import { homeDoorPoint } from "./openworld-facade-solids.ts";
import { PLACE_KIND, SECTOR, type Place } from "./walk-graph.ts";

/** Storey heights (m): ground 3.6 (parlour 3.0-3.7), shop ground 4.0, floor to floor 3.2 (2.7-3.4), cornice and parapet 0.9. */
const GROUND_STOREY = 3.6;
const SHOP_GROUND_STOREY = 4;
const STOREY = 3.2;
const PARAPET = 0.9;
/** A dumpster stands this far (m) in from the alley's south edge, at these shares of its length. */
const DUMPSTER_BACK = 0.7;
const DUMPSTER_SHARES = [0.25, 0.75] as const;
/** Mixing weights of a house's style: block column, block row, lot index and the south face's offset, so neighbours differ and no house moves another's style. */
const STYLE_MIX = { column: 7, row: 13, lot: 5, south: 3 } as const;

/** `plans`: the interiors planned so far, by kind and size, so the three hundred rowhomes share one. */
type Layout = { places: Place[]; links: Link[]; buildings: Building[]; paths: PathPlan[]; areas: Area[]; dressing: Dressing[]; plans: Map<string, InteriorPlan> };

const NO_STYLE = "";

const isBlock = (spot: Pick<Spot, "row" | "column">, plan: BlockPlan): boolean => spot.row === plan.row && spot.column === plan.column;

function blockId(plan: BlockPlan): string {
  return `${BLOCK_ROW_LETTERS[plan.row]!}${plan.column + 1}`;
}

function heightOf(storeys: number, shopGround: boolean): number {
  return (shopGround ? SHOP_GROUND_STOREY : GROUND_STOREY) + (storeys - 1) * STOREY + PARAPET;
}

function streetOf(plan: BlockPlan, face: Face): string {
  const index = plan.row + (face === "south" ? 1 : 0);
  return index < 0 ? BEYOND.north : index >= STREETS_Z.length ? BEYOND.south : STREETS_Z[index]!;
}

/** House numbers rise westward by block; even on the north face, odd on the south. */
function addressOf(plan: BlockPlan, lot: LotPlan): string {
  const hundred = HUNDRED_WEST - HUNDRED_STEP * plan.column;
  const number = hundred + 2 * (LAYOUT.lotsPerFace - lot.index) - (lot.face === "south" ? 1 : 0);
  return `${number} ${streetOf(plan, lot.face)}`;
}

function homeStyleOf(plan: BlockPlan, lot: LotPlan): string {
  const mix = (plan.column * STYLE_MIX.column + plan.row * STYLE_MIX.row + lot.index * STYLE_MIX.lot + (lot.face === "south" ? STYLE_MIX.south : 0)) % 10;
  return HOME_STYLES[mix < BRICK_SHARE_OF_TEN ? 0 : 1]!;
}

/** A place with an interior stands at the door that interior's frontage gives it, and publishes the seats and counter its furniture makes. */
function furnished(layout: Layout, place: Place): Place {
  if (place.interior === undefined) return place;
  const door = interiorDoor(place.interior, place.width, place.depth, place.x, place.z, place.yaw);
  const standing = { ...place, doorX: door.x, doorZ: door.z };
  const key = `${place.interior}:${place.width}:${place.depth}`;
  let plan = layout.plans.get(key);
  if (plan === undefined) {
    plan = planInterior(place.interior, place.width, place.depth);
    layout.plans.set(key, plan);
  }
  const { seats, stoopSeats, counter } = interiorSpots(standing, plan);
  return { ...standing, ...(seats.length > 0 ? { seats } : {}), ...(stoopSeats > 0 ? { stoopSeats } : {}), ...(counter !== null ? { counter } : {}) };
}

function layHome(layout: Layout, plan: BlockPlan, blockIndex: number, lot: LotPlan, geometry: Geometry): void {
  const style = homeStyleOf(plan, lot);
  const centreZ = (lot.house.z0 + lot.house.z1) / 2;
  const named = NAMED_HOMES.find((home) => isBlock(home, plan) && home.face === lot.face && home.at === lot.index);
  layout.buildings.push({ x: lot.x, z: centreZ, yaw: lot.yaw, depth: geometry.houseDepth, width: lot.width, height: heightOf(HOUSE_STOREYS, false), style, enterable: true });
  layout.links.push({ place: layout.places.length, block: blockIndex, side: lot.face });
  layout.places.push(
    furnished(layout, { kind: PLACE_KIND.home, name: named?.name ?? addressOf(plan, lot), doorNode: -1, doorX: lot.x, doorZ: lot.frontZ, yaw: lot.yaw, x: lot.x, z: centreZ, width: lot.width, depth: geometry.houseDepth, storeys: HOUSE_STOREYS, style, sector: SECTOR.residential, interior: "rowhome" }),
  );
}

function layVenue(layout: Layout, blockIndex: number, lots: readonly LotPlan[], venue: Venue, geometry: Geometry): void {
  const first = lots[0]!;
  const x = (first.x + lots[lots.length - 1]!.x) / 2;
  const z = (first.house.z0 + first.house.z1) / 2;
  const width = lots.length * first.width;
  layout.buildings.push({ x, z, yaw: first.yaw, depth: geometry.houseDepth, width, height: heightOf(venue.storeys, venue.shopGround), style: venue.style, ...(venue.interior === undefined ? {} : { enterable: true }) });
  layout.links.push({ place: layout.places.length, block: blockIndex, side: first.face });
  layout.places.push(
    furnished(layout, {
      kind: venue.kind,
      name: venue.name,
      doorNode: -1,
      doorX: x,
      doorZ: first.frontZ,
      yaw: first.yaw,
      x,
      z,
      width,
      depth: geometry.houseDepth,
      storeys: venue.storeys,
      style: venue.style,
      sector: venue.sector,
      hours: venue.hours,
      ...(venue.interior === undefined ? {} : { interior: venue.interior }),
    }),
  );
}

/** A face, west to east: each venue its lots, a home on every lot between. */
function layFace(layout: Layout, plan: BlockPlan, blockIndex: number, face: Face, geometry: Geometry): void {
  const lots = plan.lots.filter((lot) => lot.face === face);
  const venues = VENUE_SPOTS.filter((spot) => isBlock(spot, plan) && spot.face === face);
  for (let index = 0; index < lots.length; ) {
    const venue = venues.find((spot) => spot.at === index)?.venue;
    if (venue) {
      layVenue(layout, blockIndex, lots.slice(index, index + venue.lots), venue, geometry);
      index += venue.lots;
      continue;
    }
    layHome(layout, plan, blockIndex, lots[index]!, geometry);
    index++;
  }
}

/** Roof places are reached through their house's front door, yard places through a gate on the alley (a spur off the alley path, at the lot's middle). */
function laySidePlaces(layout: Layout, plan: BlockPlan, blockIndex: number): void {
  for (const spot of SIDE_PLACES.filter((side) => isBlock(side, plan))) {
    const lots = plan.lots.filter((lot) => lot.face === spot.face).slice(spot.at, spot.at + spot.lots);
    const first = lots[0]!;
    const middle = lots[Math.floor(lots.length / 2)]!;
    const common = { kind: spot.kind, name: spot.name, yaw: first.yaw, width: lots.length * first.width, sector: spot.sector, style: NO_STYLE, storeys: 0 };
    if (spot.where === "roof") {
      layout.links.push({ place: layout.places.length, block: blockIndex, side: first.face });
      const door = homeDoorPoint(first.x, first.frontZ, first.yaw);
      layout.places.push({ ...common, doorNode: -1, doorX: door.x, doorZ: door.z, x: first.x, z: (first.house.z0 + first.house.z1) / 2, depth: first.house.z1 - first.house.z0 });
      continue;
    }
    const gateZ = first.inward === 1 ? first.yard.z1 : first.yard.z0;
    const yardCentreZ = (first.yard.z0 + first.yard.z1) / 2;
    layout.paths.push({ block: blockIndex, points: [[middle.x, plan.centreZ], [middle.x, gateZ]], joins: [] });
    layout.links.push({ place: layout.places.length, block: blockIndex, side: null });
    layout.places.push({ ...common, doorNode: -1, doorX: middle.x, doorZ: gateZ, x: (first.x + lots[lots.length - 1]!.x) / 2, z: yardCentreZ, depth: first.yard.z1 - first.yard.z0 });
  }
}

function layAlley(layout: Layout, plan: BlockPlan, blockIndex: number): void {
  const alley = plan.alley!;
  layout.paths.push(...plan.paths);
  layout.links.push({ place: layout.places.length, block: blockIndex, side: null });
  layout.places.push({ kind: PLACE_KIND.hide, name: `${blockId(plan)} alley`, doorNode: -1, doorX: plan.centreX, doorZ: plan.centreZ, yaw: 0, x: plan.centreX, z: plan.centreZ, width: alley.x1 - alley.x0, depth: alley.z1 - alley.z0, storeys: 0, style: NO_STYLE, sector: SECTOR.hideout });
  layout.areas.push({ surface: SURFACE.asphalt, ...alley });
  for (const share of DUMPSTER_SHARES) layout.dressing.push({ prefab: PREFAB.dumpster, x: alley.x0 + share * (alley.x1 - alley.x0), z: alley.z1 - DUMPSTER_BACK });
  for (const face of ["north", "south"] as const) {
    const lots = plan.lots.filter((lot) => lot.face === face);
    layout.areas.push({ surface: SURFACE.grass, x0: lots[0]!.yard.x0, z0: lots[0]!.yard.z0, x1: lots[lots.length - 1]!.yard.x1, z1: lots[0]!.yard.z1 });
  }
}

function layPark(layout: Layout, plan: BlockPlan, blockIndex: number): void {
  const { lawn, court, courtDoor } = plan;
  layout.paths.push(...plan.paths);
  layout.areas.push({ surface: SURFACE.grass, ...lawn! }, { surface: SURFACE.asphalt, ...court! });
  layout.links.push({ place: layout.places.length, block: blockIndex, side: null });
  layout.places.push({ kind: PLACE_KIND.hangout, name: PARK_NAME, doorNode: -1, doorX: plan.centreX, doorZ: plan.centreZ, yaw: 0, x: plan.centreX, z: plan.centreZ, width: lawn!.x1 - lawn!.x0, depth: lawn!.z1 - lawn!.z0, storeys: 0, style: NO_STYLE, sector: SECTOR.recreation });
  layout.links.push({ place: layout.places.length, block: blockIndex, side: null });
  layout.places.push({ kind: PLACE_KIND.hangout, name: PLACE_NAMES.parkCourt, doorNode: -1, doorX: courtDoor![0], doorZ: courtDoor![1], yaw: 0, x: (court!.x0 + court!.x1) / 2, z: (court!.z0 + court!.z1) / 2, width: court!.x1 - court!.x0, depth: court!.z1 - court!.z0, storeys: 0, style: NO_STYLE, sector: SECTOR.recreation });
}

/** The bus stop stands on the clear path's curb edge of C1's north face, on Moore St at 10th. */
function layBusStop(layout: Layout, plans: readonly BlockPlan[], geometry: Geometry): void {
  const blockIndex = plans.findIndex((plan) => isBlock(BUS_STOP, plan));
  const lot = plans[blockIndex]!.lots.find((candidate) => candidate.face === "north" && candidate.index === BUS_STOP.at)!;
  const doorZ = lot.lineZ - geometry.sidewalkFrontage - geometry.sidewalkClear;
  layout.links.push({ place: layout.places.length, block: blockIndex, side: "north" });
  layout.places.push({ kind: PLACE_KIND.transit, name: BUS_STOP.name, doorNode: -1, doorX: lot.x, doorZ, yaw: lot.yaw, x: lot.x, z: doorZ, width: lot.width, depth: geometry.sidewalkFurniture, storeys: 0, style: NO_STYLE, sector: SECTOR.transit });
}

/** The drawn-only city beyond the walls: a home on every lot, a corner market on every other block's north face. */
function layBackdrop(layout: Layout, plan: BlockPlan, geometry: Geometry): void {
  const market = (plan.column + plan.row) % 2 === 0;
  for (const lot of plan.lots) {
    const isMarket = market && lot.face === "north" && lot.index < BACKDROP_MARKET.lots;
    if (isMarket && lot.index > 0) continue;
    const width = isMarket ? BACKDROP_MARKET.lots * lot.width : lot.width;
    const x = isMarket ? (lot.x + lot.x + lot.width) / 2 : lot.x;
    const style = isMarket ? BACKDROP_MARKET.style : homeStyleOf(plan, lot);
    layout.places.push({
      kind: isMarket ? PLACE_KIND.work : PLACE_KIND.home,
      name: isMarket ? `${BACKDROP_MARKET.name} ${plan.column},${plan.row}` : addressOf(plan, lot),
      doorNode: -1,
      doorX: x,
      doorZ: lot.frontZ,
      yaw: lot.yaw,
      x,
      z: (lot.house.z0 + lot.house.z1) / 2,
      width,
      depth: geometry.houseDepth,
      storeys: HOUSE_STOREYS,
      style,
      sector: isMarket ? BACKDROP_MARKET.sector : SECTOR.residential,
    });
  }
}

/** The playable blocks' lots and places (the programme draft), then the backdrop's. */
export function layOutLots(): Lots {
  const geometry = openWorldGeometry({ ...LAYOUT });
  const plans = planBlocks(geometry);
  const layout: Layout = { places: [], links: [], buildings: [], paths: [], areas: [], dressing: [], plans: new Map() };
  for (const [blockIndex, plan] of plans.playable.entries()) {
    if (plan.park) {
      layPark(layout, plan, blockIndex);
      continue;
    }
    layFace(layout, plan, blockIndex, "north", geometry);
    layFace(layout, plan, blockIndex, "south", geometry);
    laySidePlaces(layout, plan, blockIndex);
    layAlley(layout, plan, blockIndex);
  }
  layBusStop(layout, plans.playable, geometry);
  const backdropStart = layout.places.length;
  for (const plan of plans.backdrop) layBackdrop(layout, plan, geometry);
  const { plans: _plans, ...laid } = layout;
  return { geometry, blocks: plans.playable, backdropStart, ...laid };
}
