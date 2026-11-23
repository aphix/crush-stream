import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { BODY_KIND } from "../net/body-codec.ts";
import { MAX_CARS } from "../scenes/fleet.ts";

/** The ambulance's crew (`MEDICS.count` in engine-openworld-medics.ts imports it). */
export const MEDICS_COUNT = 2;
/** The people past the crowd's residents: a player on foot for each car, the foot cops and the medics. */
export const PEOPLE_EXTRA = MAX_CARS + FOOT_COP_COUNT + MEDICS_COUNT;

const PLAYERS_AT = 0;
const COPS_AT = MAX_CARS;
const MEDICS_AT = MAX_CARS + FOOT_COP_COUNT;

/** The one index of every person: civilian `c` is `c`, the player of car `k` is `capacity + k`, foot cop `k` is `capacity + MAX_CARS + k` and medic `k` is `capacity + MAX_CARS + FOOT_COP_COUNT + k`. */
export function personOf(kind: number, id: number, capacity: number): number {
  if (kind === BODY_KIND.civilian) return id;
  if (kind === BODY_KIND.player) return capacity + PLAYERS_AT + id;
  if (kind === BODY_KIND.cop) return capacity + COPS_AT + id;
  return capacity + MEDICS_AT + id;
}

/** The `BODY_KIND` of person `person`. */
export function kindOf(person: number, capacity: number): number {
  if (person < capacity) return BODY_KIND.civilian;
  if (person < capacity + COPS_AT) return BODY_KIND.player;
  if (person < capacity + MEDICS_AT) return BODY_KIND.cop;
  return BODY_KIND.medic;
}

/** Person `person`'s id inside her kind. */
export function idOf(person: number, capacity: number): number {
  if (person < capacity) return person;
  if (person < capacity + COPS_AT) return person - capacity - PLAYERS_AT;
  if (person < capacity + MEDICS_AT) return person - capacity - COPS_AT;
  return person - capacity - MEDICS_AT;
}
