import { detCos, detSin } from "../../kernel/physics-core.js";
import { COUNTER_STRIDE } from "../../world/openworld/walk-graph.ts";
import { NO_PLACE, NO_SEAT, RESIDENT_INT, RESIDENT_INT_STRIDE, STAND_COLUMNS, STAND_ROW_DEPTH, STAND_SPACING, STREAM } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { CityState } from "./civilian-state.ts";

/** Odd multiplier that scatters resident numbers over the counter's lanes. */
const LANE_HASH = 2654435761;

/** Gives the resident the first free stoop seat (or indoor seat) at `place` from a drawn start; false when none is free. One holder per seat. */
export function claimSeat(state: CityState, resident: number, place: number, stoop: boolean): boolean {
  const { seatBase, seatCount, stoopCount } = state.venues;
  const first = stoop ? 0 : stoopCount[place]!;
  const count = stoop ? stoopCount[place]! : seatCount[place]! - stoopCount[place]!;
  if (count <= 0) return false;
  const row = resident * RESIDENT_INT_STRIDE;
  const start = Math.floor(residentDraws(state.seed, resident, STREAM.seat, state.ints[row + RESIDENT_INT.decisionCount]!)() * count);
  for (let step = 0; step < count; step++) {
    const seat = first + ((start + step) % count);
    const slot = seatBase[place]! + seat;
    if (state.seatOwner[slot] !== NO_PLACE) continue;
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
 * the buying lane `stand` (0 to `STAND_COLUMNS` - 1) at the counter spot itself.
 */
export function standSpotAt(state: CityState, place: number, stand: number, clerk: boolean, out: StandSpot, lane = false): void {
  const counter = state.map.places[place]!.counter!;
  const at = clerk ? COUNTER_STRIDE : 0;
  const yaw = counter[at + 2]!;
  const forwardX = detSin(yaw);
  const forwardZ = detCos(yaw);
  const column = clerk || lane ? stand : stand % STAND_COLUMNS;
  const row = clerk || lane ? 0 : 1 + Math.floor(stand / STAND_COLUMNS);
  const side = lateralStep(column) * STAND_SPACING;
  const back = row * STAND_ROW_DEPTH;
  out.x = counter[at]! + forwardZ * side - forwardX * back;
  out.z = counter[at + 1]! - forwardX * side - forwardZ * back;
  out.yaw = yaw;
  out.surfaceY = counter[at + 3]!;
}

/** The spot of a customer who buys without a standing spot of their own: a lane along the counter by their number, in front of every standing spot (they may share it; they are not fixed, the crowd keeps them apart). */
export function buyLaneSpot(state: CityState, place: number, resident: number, out: StandSpot): void {
  standSpotAt(state, place, (Math.imul(resident, LANE_HASH) >>> 0) % STAND_COLUMNS, false, out, true);
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
