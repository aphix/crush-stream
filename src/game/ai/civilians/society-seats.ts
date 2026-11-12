import { detAtan2, detCos, detSin } from "../../kernel/physics-core.js";
import { AISLE_STRIDE, COUNTER_STRIDE, SEAT_STRIDE, STAND_COLUMNS, STAND_ROW_DEPTH, STAND_SPACING, STAND_SPOTS } from "../../world/openworld/walk-graph.ts";
import { NO_PLACE, NO_SEAT, RESIDENT_INT, RESIDENT_INT_STRIDE, STREAM } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { CityState } from "./civilian-state.ts";

/** Odd multiplier that scatters resident numbers over the counter's lanes. */
const LANE_HASH = 2654435761;

/** Gives the resident the first free stoop seat (or indoor seat) at `place` from a drawn start; false when none is free. One holder per seat. An indoor seat higher than the counter's top is in a flat over the shop, not its room: never a customer's. */
export function claimSeat(state: CityState, resident: number, place: number, stoop: boolean): boolean {
  const { seatBase, seatCount, stoopCount } = state.venues;
  const { seats, counter } = state.map.places[place]!;
  const highest = stoop || counter === undefined ? Infinity : counter[3]!;
  const first = stoop ? 0 : stoopCount[place]!;
  const count = stoop ? stoopCount[place]! : seatCount[place]! - stoopCount[place]!;
  if (count <= 0) return false;
  const row = resident * RESIDENT_INT_STRIDE;
  const start = Math.floor(residentDraws(state.seed, resident, STREAM.seat, state.ints[row + RESIDENT_INT.decisionCount]!)() * count);
  for (let step = 0; step < count; step++) {
    const seat = first + ((start + step) % count);
    const slot = seatBase[place]! + seat;
    if (state.seatOwner[slot] !== NO_PLACE || seats![seat * SEAT_STRIDE + 3]! > highest) continue;
    state.seatOwner[slot] = resident;
    state.ints[row + RESIDENT_INT.seat] = seat;
    return true;
  }
  return false;
}

/** The nth step of a row of bodies along a line, centred: 0, then 1 to the right, 1 to the left, 2 to the right...; returned in whole steps. */
function lateralStep(column: number): number {
  return column === 0 ? 0 : (column & 1) === 1 ? (column + 1) / 2 : -column / 2;
}

/** Where a standing spot is, into `out`: the owner table's index `index` of `place` (a customer's spot after the seats, then the clerks'), the counter's spots as its base. */
export class StandSpot {
  x = 0;
  z = 0;
  yaw = 0;
  surfaceY = 0;
}

/**
 * Fills `out` with a spot of `place` from its counter's two spots: the clerks' `stand` (when `clerk`), a customer's standing spot `stand` (0 for the first), which are behind the buying lane (row 1 on), or, with `lane`,
 * the buying lane `stand` (0 to `STAND_COLUMNS` - 1) at the counter spot itself. A customer's spot past `STAND_SPOTS` is the room's standing room (`Place.standRoom`).
 */
export function standSpotAt(state: CityState, place: number, stand: number, clerk: boolean, out: StandSpot, lane = false): void {
  const { counter, aisle, standRoom } = state.map.places[place]!;
  if (!clerk && !lane && stand >= STAND_SPOTS) return roomSpotAt(counter!, aisle!, standRoom![stand - STAND_SPOTS]! * AISLE_STRIDE, out);
  const at = clerk ? COUNTER_STRIDE : 0;
  const yaw = counter![at + 2]!;
  const forwardX = detSin(yaw);
  const forwardZ = detCos(yaw);
  const column = clerk || lane ? stand : stand % STAND_COLUMNS;
  const row = clerk || lane ? 0 : 1 + Math.floor(stand / STAND_COLUMNS);
  const side = lateralStep(column) * STAND_SPACING;
  const back = row * STAND_ROW_DEPTH;
  out.x = counter![at]! + forwardZ * side - forwardX * back;
  out.z = counter![at + 1]! - forwardX * side - forwardZ * back;
  out.yaw = yaw;
  out.surfaceY = counter![at + 3]!;
}

/** A standing-room spot: the aisle node at float `at`, facing the counter's customer spot. */
function roomSpotAt(counter: Float32Array, aisle: Float32Array, at: number, out: StandSpot): void {
  out.x = aisle[at]!;
  out.z = aisle[at + 1]!;
  out.yaw = detAtan2(counter[0]! - out.x, counter[1]! - out.z);
  out.surfaceY = counter[3]!;
}

/** The buying lane (0 to `STAND_COLUMNS` - 1) a resident's number gives her. */
export function laneOf(resident: number): number {
  return (Math.imul(resident, LANE_HASH) >>> 0) % STAND_COLUMNS;
}

/** The spot of a customer who buys without a standing spot of their own: a lane along the counter by their number, in front of every standing spot (they may share it; they are not fixed, the crowd keeps them apart). */
export function buyLaneSpot(state: CityState, place: number, resident: number, out: StandSpot): void {
  standSpotAt(state, place, laneOf(resident), false, out, true);
}

/** Floats a spot takes in a `spotTable`: x, z, yaw, surface height. */
export const SPOT_FLOATS = 4;
const SPOT_TABLES = new WeakMap<object, Float64Array>();

/** Every buying lane of `place`, then its customers' and clerks' spots in owner-table order, as `standSpotAt` places them (`SPOT_FLOATS` each): worked out once a map, so a room's walks read them each frame with no trig. */
export function spotTable(state: CityState, place: number): Float64Array {
  return SPOT_TABLES.get(state.map.places[place]!) ?? buildSpotTable(state, place);
}

function buildSpotTable(state: CityState, place: number): Float64Array {
  const stands = state.venues.standCount[place]!;
  const clerks = state.venues.clerkCount[place]!;
  const table = new Float64Array((STAND_COLUMNS + stands + clerks) * SPOT_FLOATS);
  const spot = new StandSpot();
  for (let at = 0; at < STAND_COLUMNS + stands + clerks; at++) {
    if (at < STAND_COLUMNS) standSpotAt(state, place, at, false, spot, true);
    else if (at < STAND_COLUMNS + stands) standSpotAt(state, place, at - STAND_COLUMNS, false, spot);
    else standSpotAt(state, place, at - STAND_COLUMNS - stands, true, spot);
    table.set([spot.x, spot.z, spot.yaw, spot.surfaceY], at * SPOT_FLOATS);
  }
  SPOT_TABLES.set(state.map.places[place]!, table);
  return table;
}

/** Gives the resident the lowest free standing spot at `place` (the clerks' when `clerk`); false when none is free. One holder to each. */
export function claimStand(state: CityState, resident: number, place: number, clerk: boolean): boolean {
  const { seatBase, seatCount, standCount, clerkCount } = state.venues;
  const first = seatCount[place]! + (clerk ? standCount[place]! : 0);
  const count = clerk ? clerkCount[place]! : standCount[place]!;
  const row = resident * RESIDENT_INT_STRIDE;
  for (let spot = 0; spot < count; spot++) {
    const slot = seatBase[place]! + first + spot;
    if (state.seatOwner[slot] !== NO_PLACE) continue;
    state.seatOwner[slot] = resident;
    state.ints[row + RESIDENT_INT.seat] = first + spot;
    return true;
  }
  return false;
}

/** Frees the seat or standing spot a resident holds at the place they are at (their row's place), if any. */
export function releaseSeat(state: CityState, resident: number): void {
  const row = resident * RESIDENT_INT_STRIDE;
  const seat = state.ints[row + RESIDENT_INT.seat]!;
  if (seat === NO_SEAT) return;
  const slot = state.venues.seatBase[state.ints[row + RESIDENT_INT.place]!]! + seat;
  if (state.seatOwner[slot] === resident) state.seatOwner[slot] = NO_PLACE;
  state.ints[row + RESIDENT_INT.seat] = NO_SEAT;
}
