import { PLACE_KIND, type OpenWorldMap, type Place } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { dayOf } from "./civilian-clock.ts";
import {
  FLAG,
  HOURS_PER_GAME_DAY,
  NEED_COUNT,
  NEVER_TICK,
  NO_BEARING,
  NO_INDEX,
  NO_PLACE,
  NO_SEAT,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
} from "./civilian-constants.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { decideResident } from "./civilian-plan.ts";
import type { CityState } from "./civilian-state.ts";
import { walkMetres } from "./society-cars.ts";
import { releaseSeat } from "./society-seats.ts";

export const COFFEE_SHOP = "Perk Up Coffee";
export const SUPERMARKET = "Moore Market";
export const PIZZA = "Moore Street Pizza";
const COUNTER_TOP = 1;
const SEAT_TOP = 0.45;
const STOOP_TOP = 0.54;

/** A row of `count` seats beside a door: x, z, yaw, height each. */
function seatsBeside(place: Place, count: number, height: number): number[] {
  return Array.from({ length: count }, (_, seat) => [place.doorX + 1 + seat, place.doorZ + 1, 0, height]).flat();
}

/** Where a customer stands, then where a clerk stands, one metre in from the door. */
function counterBeside(place: Place): Float32Array {
  return Float32Array.from([place.doorX + 1, place.doorZ - 1, 0, COUNTER_TOP, place.doorX + 1, place.doorZ - 3, Math.PI, COUNTER_TOP]);
}

/**
 * The fixture neighbourhood with the venues the table sends people to: a coffee shop (three seats, a counter) beside the pizza place, a supermarket and the bodega (counters), the bar with two seats and a counter, and two stoop seats at the head of every home's seats.
 */
export function buildSocietyMap(): OpenWorldMap {
  const base = buildFixtureMap(2, [
    { name: COFFEE_SHOP, kind: PLACE_KIND.food, block: "B1", sector: "Food" },
    { name: SUPERMARKET, kind: PLACE_KIND.shop, block: "B3", sector: "Commercial" },
  ]);
  const places = base.places.map((place): Place => {
    if (place.name === COFFEE_SHOP) return { ...place, interior: "coffee", seats: Float32Array.from(seatsBeside(place, 3, SEAT_TOP)), counter: counterBeside(place) };
    if (place.name === PLACE_NAMES.bar) return { ...place, interior: "bar", seats: Float32Array.from(seatsBeside(place, 2, SEAT_TOP)), counter: counterBeside(place) };
    if (place.name === SUPERMARKET) return { ...place, style: "supermarket", counter: counterBeside(place) };
    if (place.name === PLACE_NAMES.bodega) return { ...place, interior: "store", counter: counterBeside(place) };
    if (place.kind === PLACE_KIND.home && place.doorNode >= 0) return { ...place, seats: Float32Array.from(seatsBeside(place, 2, STOOP_TOP)), stoopSeats: 2 };
    return place;
  });
  return { ...base, places };
}

export function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

export function placeIn(map: OpenWorldMap, name: string): number {
  const place = map.places.findIndex((candidate) => candidate.name === name);
  if (place === -1) throw new Error(`no place called ${name}`);
  return place;
}

/** Needs that press nothing: a decision with only these stays put. */
export const CALM = 0.1;

export function needsWith(levels: Readonly<Record<number, number>>): number[] {
  return Array.from({ length: NEED_COUNT }, (_, need) => levels[need] ?? CALM);
}

/** How a resident is set down for a scene: dwelling at `place` for `dwell` ticks as a decision comes due at `tick`. */
export type Stage = {
  place: number;
  tick: number;
  dwell?: number;
  nextDecision?: number;
  age?: number;
  home?: number;
  work?: number;
  shiftStart?: number;
  flags?: number;
  needs?: readonly number[];
  risePerHour?: readonly number[];
  moodEvent?: number;
  purpose?: number;
  carPlace?: number;
  joblessDays?: number;
};

/** Writes a living, free resident's whole row for a scene (no leg, no seat, no crime, no fight, needs that stay put unless told otherwise). */
export function stageResident(state: CityState, resident: number, stage: Stage): void {
  releaseSeat(state, resident);
  const base = resident * RESIDENT_INT_STRIDE;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  const { ints, floats } = state;
  const arrived = stage.tick - (stage.dwell ?? 0);
  const fields: Record<number, number> = {
    [RESIDENT_INT.alive]: 1,
    [RESIDENT_INT.species]: SPECIES.person,
    [RESIDENT_INT.birthDay]: dayOf(stage.tick, state.startHour) - (stage.age ?? 30),
    [RESIDENT_INT.home]: stage.home ?? stage.place,
    [RESIDENT_INT.work]: stage.work ?? NO_PLACE,
    [RESIDENT_INT.shiftStart]: stage.shiftStart ?? 9,
    [RESIDENT_INT.flags]: stage.flags ?? 0,
    [RESIDENT_INT.place]: stage.place,
    [RESIDENT_INT.fromPlace]: stage.place,
    [RESIDENT_INT.departTick]: arrived,
    [RESIDENT_INT.arriveTick]: arrived,
    [RESIDENT_INT.nextDecisionTick]: stage.nextDecision ?? stage.tick,
    [RESIDENT_INT.pathCount]: 0,
    [RESIDENT_INT.legPurpose]: stage.purpose ?? 0,
    [RESIDENT_INT.companion]: NO_PLACE,
    [RESIDENT_INT.seat]: NO_SEAT,
    [RESIDENT_INT.carPlace]: stage.carPlace ?? NO_PLACE,
    [RESIDENT_INT.carTo]: NO_PLACE,
    [RESIDENT_INT.carLeaveTick]: NEVER_TICK,
    [RESIDENT_INT.carParkTick]: NEVER_TICK,
    [RESIDENT_INT.carOwner]: NO_PLACE,
    [RESIDENT_INT.driveFirst]: NO_INDEX,
    [RESIDENT_INT.driveLast]: NO_INDEX,
    [RESIDENT_INT.driveLeaveTick]: NEVER_TICK,
    [RESIDENT_INT.driveParkTick]: NEVER_TICK,
    [RESIDENT_INT.joblessDays]: stage.joblessDays ?? 0,
    [RESIDENT_INT.wantedUntilTick]: 0,
    [RESIDENT_INT.crimeTick]: NEVER_TICK,
    [RESIDENT_INT.crimeKind]: 0,
    [RESIDENT_INT.crimePlace]: NO_PLACE,
    [RESIDENT_INT.crimeVictim]: NO_PLACE,
    [RESIDENT_INT.crimeNotBefore]: 0,
    [RESIDENT_INT.fightTick]: NEVER_TICK,
    [RESIDENT_INT.fightPartner]: NO_PLACE,
    [RESIDENT_INT.fightBearing]: NO_BEARING,
    [RESIDENT_INT.moodEvent]: stage.moodEvent ?? 0,
    [RESIDENT_INT.moodTick]: stage.tick - 1,
    [RESIDENT_INT.decisionCount]: 0,
  };
  for (const [field, value] of Object.entries(fields)) ints[base + Number(field)] = value;
  const needs = stage.needs ?? needsWith({});
  for (let need = 0; need < NEED_COUNT; need++) {
    floats[floatBase + RESIDENT_FLOAT.needs + need] = needs[need]!;
    floats[floatBase + RESIDENT_FLOAT.rates + need] = stage.risePerHour?.[need] ?? 0;
  }
  state.hiddenFromTick[resident] = NEVER_TICK;
  state.hiddenUntilTick[resident] = NEVER_TICK;
}

/** Resident's decision at `tick` as the `count`th they have made (it draws from the stream of that count). */
export function decideAs(state: CityState, resident: number, tick: number, count: number): void {
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.decisionCount] = count;
  decideResident(state, resident, tick);
}

/** The workplaces (a place that employs) open at `hour`. */
function openWorkplaces(state: CityState, hour: number): number[] {
  return Array.from(state.index.workplaces).filter((place) => state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]! >= 1);
}

/** The workplace open at `hour` whose door is the longest walk from `from`'s door in `state`'s city, and that walk's metres. */
export function farthestWorkplace(state: CityState, from: number, hour: number): { place: number; metres: number } {
  let best = { place: NO_PLACE, metres: -1 };
  for (const place of openWorkplaces(state, hour)) {
    const metres = walkMetres(state, from, place);
    if (metres > best.metres) best = { place, metres };
  }
  return best;
}

/** The workplace open at `hour` (not `from`) whose door is the shortest walk from `from`'s, and that walk's metres. */
export function nearestWorkplace(state: CityState, from: number, hour: number): { place: number; metres: number } {
  let best = { place: NO_PLACE, metres: Infinity };
  for (const place of openWorkplaces(state, hour)) {
    const metres = place === from ? -1 : walkMetres(state, from, place);
    if (metres > 0 && metres < best.metres) best = { place, metres };
  }
  return best;
}

/** The place (not `from`, with a door) whose door is the shortest walk from `from`'s, and that walk's metres. */
export function nearestPlace(state: CityState, from: number): { place: number; metres: number } {
  let best = { place: NO_PLACE, metres: Infinity };
  for (let place = 0; place < state.index.placeCount; place++) {
    const metres = place === from || state.index.doorNode[place]! < 0 ? -1 : walkMetres(state, from, place);
    if (metres > 0 && metres < best.metres) best = { place, metres };
  }
  return best;
}

/** Takes the car away from every resident of `home` but `keep`: a scene then has the cars it stages and no household's else. */
export function withoutOtherCars(state: CityState, home: number, keep: readonly number[]): void {
  for (let resident = 0; resident < state.capacity; resident++) {
    if (keep.includes(resident) || state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.home] !== home) continue;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags]! &= ~FLAG.hasCar;
  }
}
