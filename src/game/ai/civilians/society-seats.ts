import { NO_PLACE, NO_SEAT, RESIDENT_INT, RESIDENT_INT_STRIDE, STREAM } from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { CityState } from "./civilian-state.ts";

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

/** Frees the seat a resident holds at the place they are at (their row's place), if any. */
export function releaseSeat(state: CityState, resident: number): void {
  const row = resident * RESIDENT_INT_STRIDE;
  const seat = state.ints[row + RESIDENT_INT.seat]!;
  if (seat === NO_SEAT) return;
  const slot = state.venues.seatBase[state.ints[row + RESIDENT_INT.place]!]! + seat;
  if (state.seatOwner[slot] === resident) state.seatOwner[slot] = NO_PLACE;
  state.ints[row + RESIDENT_INT.seat] = NO_SEAT;
}
