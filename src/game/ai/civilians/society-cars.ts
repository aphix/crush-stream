import { hypot2 } from "../../kernel/physics-core.js";
import {
  CAR_WALK_METRES,
  DRIVE_MIN_METRES,
  FLAG,
  MAX_PATH_NODES,
  NEED,
  NEVER_TICK,
  NO_INDEX,
  NO_PLACE,
  PURPOSE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
} from "./civilian-constants.ts";
import { markDirty, type CityState } from "./civilian-state.ts";

/** Reasons that take a car: the commute, home, errands, meals, company, a coffee or a drink. The stories, the bus, crime, a fight and hiding go on foot. */
const DRIVABLE_PURPOSES: readonly number[] = [NEED.rest, NEED.food, NEED.work, NEED.social, NEED.errand, PURPOSE.coffee, PURPOSE.drink];

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

/** The place whose kerb an owner's car stands at at `tick`, or none: before its trip leaves it is where it was, once parked at the trip's end, and in between it is away. */
export function carStandsAt(state: CityState, owner: number, tick: number): number {
  if (intAt(state, owner, RESIDENT_INT.alive) === 0 || (intAt(state, owner, RESIDENT_INT.flags) & FLAG.hasCar) === 0) return NO_PLACE;
  const to = intAt(state, owner, RESIDENT_INT.carTo);
  if (to === NO_PLACE || tick < intAt(state, owner, RESIDENT_INT.carLeaveTick)) return intAt(state, owner, RESIDENT_INT.carPlace);
  return tick < intAt(state, owner, RESIDENT_INT.carParkTick) ? NO_PLACE : to;
}

/** Nobody has the car reserved or on the road: it is anyone of the household's to take. */
function carIsFree(state: CityState, owner: number, tick: number): boolean {
  return intAt(state, owner, RESIDENT_INT.carTo) === NO_PLACE || tick >= intAt(state, owner, RESIDENT_INT.carParkTick);
}

/** Metres of the shortest walk (fear ignored) from one place's door to another's, or -1 when there is none. */
export function walkMetres(state: CityState, from: number, to: number): number {
  const { doorNode } = state.index;
  const count = state.finder.find(doorNode[from]!, doorNode[to]!, state.noFear, 1, state.scratchPath, 0, MAX_PATH_NODES);
  if (count === 0) return -1;
  const { nodeX, nodeZ } = state.map.graph;
  let metres = 0;
  for (let step = 1; step < count; step++) {
    const before = state.scratchPath[step - 1]!;
    const here = state.scratchPath[step]!;
    metres += hypot2(nodeX[here]! - nodeX[before]!, nodeZ[here]! - nodeZ[before]!);
  }
  return metres;
}

/** Whether the car of `owner` is free and stands within `CAR_WALK_METRES` of the door of `current`. */
function carIsHandy(state: CityState, owner: number, current: number, tick: number): boolean {
  if (intAt(state, owner, RESIDENT_INT.alive) === 0 || !carIsFree(state, owner, tick)) return false;
  const stand = carStandsAt(state, owner, tick);
  if (stand === NO_PLACE || state.index.doorNode[stand]! < 0) return false;
  if (stand === current) return true;
  const walk = walkMetres(state, current, stand);
  return walk >= 0 && walk <= CAR_WALK_METRES;
}

/** The owner of the car `resident` takes from `current` to a place `metres` away for `purpose` at `tick`, or none: their own, else a housemate's (the lowest numbered that is free and handy). Only long trips for the purposes that drive. */
export function chooseCar(state: CityState, resident: number, current: number, purpose: number, metres: number, tick: number): number {
  if (metres < DRIVE_MIN_METRES || !DRIVABLE_PURPOSES.includes(purpose)) return NO_PLACE;
  if ((intAt(state, resident, RESIDENT_INT.flags) & FLAG.hasCar) !== 0 && carIsHandy(state, resident, current, tick)) return resident;
  const home = intAt(state, resident, RESIDENT_INT.home);
  for (let other = 0; other < state.capacity; other++) {
    if (other === resident || intAt(state, other, RESIDENT_INT.species) !== SPECIES.person || (intAt(state, other, RESIDENT_INT.flags) & FLAG.hasCar) === 0) continue;
    if (intAt(state, other, RESIDENT_INT.home) === home && carIsHandy(state, other, current, tick)) return other;
  }
  return NO_PLACE;
}

/**
 * The trip by car as one path in `state.pathNodes` for `resident` (nothing written, false, when no such path fits): the walk from `current`'s door to the car's node beside `stand`'s door, the way by the graph from there to the node
 * beside the destination's door (the car's drive, in sidewalk metres), and the walk in. The nodes where the driver gets in and out are left in the resident's row.
 */
export function planCarPath(state: CityState, resident: number, current: number, stand: number, destination: number, fearWeight: number): boolean {
  const { carNode, doorNode } = state.index;
  if (carNode[stand] === carNode[destination]) return false;
  const { finder, carPath, scratchPath } = state;
  let count = finder.find(doorNode[current]!, carNode[stand]!, state.fear, fearWeight, carPath, 0, MAX_PATH_NODES);
  if (count === 0) return false;
  const getIn = count - 1;
  const drive = finder.find(carNode[stand]!, carNode[destination]!, state.noFear, 1, scratchPath, 0, MAX_PATH_NODES);
  if (drive === 0 || count + drive - 1 > MAX_PATH_NODES) return false;
  for (let step = 1; step < drive; step++) carPath[count++] = scratchPath[step]!;
  const getOut = count - 1;
  const walkIn = finder.find(carNode[destination]!, doorNode[destination]!, state.fear, fearWeight, scratchPath, 0, MAX_PATH_NODES);
  if (walkIn === 0 || count + walkIn - 1 > MAX_PATH_NODES) return false;
  for (let step = 1; step < walkIn; step++) carPath[count++] = scratchPath[step]!;
  const base = resident * RESIDENT_INT_STRIDE;
  state.pathNodes.set(carPath.subarray(0, count), resident * MAX_PATH_NODES);
  state.ints[base + RESIDENT_INT.pathCount] = count;
  state.ints[base + RESIDENT_INT.driveFirst] = getIn;
  state.ints[base + RESIDENT_INT.driveLast] = getOut;
  return true;
}

/** The resident's leg goes by no car. */
export function clearDriveLeg(state: CityState, resident: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.carOwner] = NO_PLACE;
  state.ints[base + RESIDENT_INT.driveFirst] = NO_INDEX;
  state.ints[base + RESIDENT_INT.driveLast] = NO_INDEX;
  state.ints[base + RESIDENT_INT.driveLeaveTick] = NEVER_TICK;
  state.ints[base + RESIDENT_INT.driveParkTick] = NEVER_TICK;
}

/** `owner`'s car is taken from `stand` to `destination`: it leaves at `leaveTick` with its driver in it and is parked at `parkTick`; the driver's leg carries the same. */
export function reserveCar(state: CityState, driver: number, owner: number, stand: number, destination: number, leaveTick: number, parkTick: number): void {
  const ownerBase = owner * RESIDENT_INT_STRIDE;
  state.ints[ownerBase + RESIDENT_INT.carPlace] = stand;
  state.ints[ownerBase + RESIDENT_INT.carTo] = destination;
  state.ints[ownerBase + RESIDENT_INT.carLeaveTick] = leaveTick;
  state.ints[ownerBase + RESIDENT_INT.carParkTick] = parkTick;
  markDirty(state, owner);
  const base = driver * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.carOwner] = owner;
  state.ints[base + RESIDENT_INT.driveLeaveTick] = leaveTick;
  state.ints[base + RESIDENT_INT.driveParkTick] = parkTick;
}

/**
 * The resident's leg is cut short (run down, arrested, dead) at `tick`: a car trip only reserved, whose driver has not got in yet, is given up and the car stays where it stands; one under way or done stands, with or without
 * its driver. The leg's drive fields are cleared either way.
 */
export function dropCarLeg(state: CityState, resident: number, tick: number): void {
  const owner = intAt(state, resident, RESIDENT_INT.carOwner);
  if (owner !== NO_PLACE && tick < intAt(state, owner, RESIDENT_INT.carLeaveTick) && intAt(state, owner, RESIDENT_INT.carTo) !== NO_PLACE) {
    const ownerBase = owner * RESIDENT_INT_STRIDE;
    state.ints[ownerBase + RESIDENT_INT.carTo] = NO_PLACE;
    state.ints[ownerBase + RESIDENT_INT.carLeaveTick] = NEVER_TICK;
    state.ints[ownerBase + RESIDENT_INT.carParkTick] = NEVER_TICK;
    markDirty(state, owner);
  }
  clearDriveLeg(state, resident);
}

/** Someone who moves house takes a car that stands at their old home to the new one, unless it is out on a trip. */
export function moveCarHome(state: CityState, owner: number, oldHome: number, newHome: number, tick: number): void {
  if (carStandsAt(state, owner, tick) !== oldHome || !carIsFree(state, owner, tick)) return;
  const base = owner * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.carPlace] = newHome;
  state.ints[base + RESIDENT_INT.carTo] = NO_PLACE;
  state.ints[base + RESIDENT_INT.carLeaveTick] = NEVER_TICK;
  state.ints[base + RESIDENT_INT.carParkTick] = NEVER_TICK;
}
