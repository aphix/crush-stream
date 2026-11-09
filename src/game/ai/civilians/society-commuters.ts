import { DECISION_HZ, FLAG, NO_PLACE, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";

/**
 * Fills the traffic's two lists from the brain's rows at `tick`, in place (`count` rows each, as many as the arrays hold): every resident on a drive leg with the places they drive between and the crowd second they are due,
 * and every other car owner with the place whose kerb their car stands at.
 */
export function fillCommuterFeed(
  state: CityState,
  tick: number,
  legs: { count: number; resident: Int32Array; fromPlace: Int32Array; toPlace: Int32Array; arriveSeconds: Float64Array },
  parked: { count: number; resident: Int32Array; place: Int32Array },
): void {
  legs.count = 0;
  parked.count = 0;
  const { ints } = state;
  for (let resident = 0; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    if (ints[base + RESIDENT_INT.alive] === 0 || (ints[base + RESIDENT_INT.flags]! & FLAG.hasCar) === 0) continue;
    const driving = ints[base + RESIDENT_INT.legPurpose] === PURPOSE.drive && tick >= ints[base + RESIDENT_INT.departTick]! && tick < ints[base + RESIDENT_INT.arriveTick]!;
    if (driving && legs.count < legs.resident.length) {
      legs.resident[legs.count] = resident;
      legs.fromPlace[legs.count] = ints[base + RESIDENT_INT.fromPlace]!;
      legs.toPlace[legs.count] = ints[base + RESIDENT_INT.place]!;
      legs.arriveSeconds[legs.count++] = ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ;
    } else if (!driving && ints[base + RESIDENT_INT.carPlace] !== NO_PLACE && parked.count < parked.resident.length) {
      parked.resident[parked.count] = resident;
      parked.place[parked.count++] = ints[base + RESIDENT_INT.carPlace]!;
    }
  }
}
