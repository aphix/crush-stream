import { DECISION_HZ, FLAG, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { carStandsAt } from "./society-cars.ts";

/**
 * Fills the traffic's two lists from the brain's rows at `tick`, in place (`count` rows each, as many as the arrays hold): every car on the road, from the tick its driver gets in to the tick it is parked, with the places it goes
 * between and the crowd second it is due (the resident listed is the car's owner: a housemate may be at the wheel), and every car that stands, with the place whose kerb it stands at.
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
    const stands = carStandsAt(state, resident, tick);
    if (stands !== NO_PLACE) {
      if (parked.count < parked.resident.length) {
        parked.resident[parked.count] = resident;
        parked.place[parked.count++] = stands;
      }
    } else if (legs.count < legs.resident.length) {
      legs.resident[legs.count] = resident;
      legs.fromPlace[legs.count] = ints[base + RESIDENT_INT.carPlace]!;
      legs.toPlace[legs.count] = ints[base + RESIDENT_INT.carTo]!;
      legs.arriveSeconds[legs.count++] = ints[base + RESIDENT_INT.carParkTick]! / DECISION_HZ;
    }
  }
}
