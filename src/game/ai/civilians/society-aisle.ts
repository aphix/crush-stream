import { AISLE_STRIDE, SEAT_STRIDE, STAND_COLUMNS, STAND_SPOTS } from "../../world/openworld/walk-graph.ts";
import { ACTIVITY_SECONDS } from "./civilian-activity.ts";
import { DECISION_HZ, NO_SEAT, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { laneOf, SPOT_FLOATS, spotTable, StandSpot } from "./society-seats.ts";

/** Slots of `AISLE_WALK`: the walk's ends and the share of it walked (in), its point, heading, metres walked and length (out), what the steps below hand each other, and a stay's seconds for `planRoom` (in). */
export const WALK = { fromX: 0, fromZ: 1, toX: 2, toZ: 3, share: 4, x: 5, z: 6, yaw: 7, walked: 8, length: 9, x0: 10, z0: 11, x1: 12, z1: 13, t: 14, metres: 15, stay: 16 } as const;
/** The walk being read: a double passed to or returned from a call V8 does not inline is boxed, so they cross here. */
export const AISLE_WALK = new Float64Array(17);

/** The aisle node nearest the point in `AISLE_WALK` slots `slot`, `slot + 1`. */
function nearestNode(aisle: Float32Array, slot: number): number {
  const x = AISLE_WALK[slot]!;
  const z = AISLE_WALK[slot + 1]!;
  let best = 0;
  let bestGap = Infinity;
  for (let node = 0; node * AISLE_STRIDE < aisle.length; node++) {
    const dx = aisle[node * AISLE_STRIDE]! - x;
    const dz = aisle[node * AISLE_STRIDE + 1]! - z;
    const gap = dx * dx + dz * dz;
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = node;
  }
  return best;
}

function depthOf(aisle: Float32Array, node: number): number {
  let depth = 0;
  for (let at = node; aisle[at * AISLE_STRIDE + 2]! >= 0; at = aisle[at * AISLE_STRIDE + 2]!) depth++;
  return depth;
}

/** The node where the paths from the door to `a` and to `b` part. */
function meeting(aisle: Float32Array, a: number, b: number): number {
  let first = a;
  let second = b;
  for (let gap = depthOf(aisle, first) - depthOf(aisle, second); gap > 0; gap--) first = aisle[first * AISLE_STRIDE + 2]!;
  for (let gap = depthOf(aisle, second) - depthOf(aisle, first); gap > 0; gap--) second = aisle[second * AISLE_STRIDE + 2]!;
  while (first !== second) {
    first = aisle[first * AISLE_STRIDE + 2]!;
    second = aisle[second * AISLE_STRIDE + 2]!;
  }
  return first;
}

/** Metres from `node` up the tree to `top`, into `WALK.metres`. */
function climb(aisle: Float32Array, node: number, top: number): void {
  let metres = 0;
  for (let at = node; at !== top; at = aisle[at * AISLE_STRIDE + 2]!) {
    const up = aisle[at * AISLE_STRIDE + 2]!;
    const dx = aisle[up * AISLE_STRIDE]! - aisle[at * AISLE_STRIDE]!;
    const dz = aisle[up * AISLE_STRIDE + 1]! - aisle[at * AISLE_STRIDE + 1]!;
    metres += Math.sqrt(dx * dx + dz * dz);
  }
  AISLE_WALK[WALK.metres] = metres;
}

/** The walk's point `WALK.t` of the way from (`x0`, `z0`) to (`x1`, `z1`). */
function onSegment(): void {
  const x0 = AISLE_WALK[WALK.x0]!;
  const z0 = AISLE_WALK[WALK.z0]!;
  AISLE_WALK[WALK.x] = x0 + (AISLE_WALK[WALK.x1]! - x0) * AISLE_WALK[WALK.t]!;
  AISLE_WALK[WALK.z] = z0 + (AISLE_WALK[WALK.z1]! - z0) * AISLE_WALK[WALK.t]!;
}

/** The node under `top` on the way down to `node` (`node` itself when it is a child of `top`). */
function childBelow(aisle: Float32Array, node: number, top: number): number {
  let at = node;
  while (aisle[at * AISLE_STRIDE + 2]! !== top) at = aisle[at * AISLE_STRIDE + 2]!;
  return at;
}

/** The walk heads along edge `node` -> its parent (`up`) or the other way: the heading stored with the aisle, so no trig a frame. */
function edgeYaw(aisle: Float32Array, node: number, up: boolean): void {
  const yaw = aisle[node * AISLE_STRIDE + 3]!;
  AISLE_WALK[WALK.yaw] = up ? yaw : yaw > 0 ? yaw - Math.PI : yaw + Math.PI;
}

/** Where a walk along `aisle` is, `WALK.share` of the way: from its start to the nearest node, through the tree, from the nearest node to its end. Writes its point, heading (an edge's; on a free end the edge next to it, else the `WALK.yaw` given), metres walked and length. */
export function walkAisle(aisle: Float32Array): void {
  const toX = AISLE_WALK[WALK.toX]!;
  const toZ = AISLE_WALK[WALK.toZ]!;
  const a = nearestNode(aisle, WALK.fromX);
  const b = nearestNode(aisle, WALK.toX);
  const top = meeting(aisle, a, b);
  const firstX = aisle[a * AISLE_STRIDE]! - AISLE_WALK[WALK.fromX]!;
  const firstZ = aisle[a * AISLE_STRIDE + 1]! - AISLE_WALK[WALK.fromZ]!;
  const first = Math.sqrt(firstX * firstX + firstZ * firstZ);
  climb(aisle, a, top);
  const up = AISLE_WALK[WALK.metres]!;
  climb(aisle, b, top);
  const down = AISLE_WALK[WALK.metres]!;
  const lastX = toX - aisle[b * AISLE_STRIDE]!;
  const lastZ = toZ - aisle[b * AISLE_STRIDE + 1]!;
  const last = Math.sqrt(lastX * lastX + lastZ * lastZ);
  const length = first + up + down + last;
  const s = AISLE_WALK[WALK.share]! * length;
  AISLE_WALK[WALK.length] = length;
  AISLE_WALK[WALK.walked] = s;
  if (s <= first) {
    if (a !== top) edgeYaw(aisle, a, true);
    else if (b !== top) edgeYaw(aisle, childBelow(aisle, b, top), false);
    AISLE_WALK[WALK.x0] = AISLE_WALK[WALK.fromX]!;
    AISLE_WALK[WALK.z0] = AISLE_WALK[WALK.fromZ]!;
    AISLE_WALK[WALK.x1] = aisle[a * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z1] = aisle[a * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.t] = first > 0 ? s / first : 1;
  } else if (s <= first + up) {
    AISLE_WALK[WALK.metres] = s - first;
    climbTo(aisle, a, false);
  } else if (s <= first + up + down) {
    AISLE_WALK[WALK.metres] = first + up + down - s;
    climbTo(aisle, b, true);
  } else {
    if (b !== top) edgeYaw(aisle, b, false);
    else if (a !== top) edgeYaw(aisle, childBelow(aisle, a, top), true);
    AISLE_WALK[WALK.x0] = aisle[b * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z0] = aisle[b * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.x1] = toX;
    AISLE_WALK[WALK.z1] = toZ;
    AISLE_WALK[WALK.t] = last > 0 ? (s - first - up - down) / last : 1;
  }
  onSegment();
}

/** The segment holding the point `WALK.metres` up the tree from `node`; `descending`: she walks it the other way, toward `node`. */
function climbTo(aisle: Float32Array, node: number, descending: boolean): void {
  let left = AISLE_WALK[WALK.metres]!;
  let at = node;
  for (; aisle[at * AISLE_STRIDE + 2]! >= 0; at = aisle[at * AISLE_STRIDE + 2]!) {
    const up = aisle[at * AISLE_STRIDE + 2]!;
    const dx = aisle[up * AISLE_STRIDE]! - aisle[at * AISLE_STRIDE]!;
    const dz = aisle[up * AISLE_STRIDE + 1]! - aisle[at * AISLE_STRIDE + 1]!;
    const step = Math.sqrt(dx * dx + dz * dz);
    if (left > step) {
      left -= step;
      continue;
    }
    edgeYaw(aisle, at, !descending);
    const near = descending ? up : at;
    const far = descending ? at : up;
    AISLE_WALK[WALK.x0] = aisle[near * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z0] = aisle[near * AISLE_STRIDE + 1]!;
    AISLE_WALK[WALK.x1] = aisle[far * AISLE_STRIDE]!;
    AISLE_WALK[WALK.z1] = aisle[far * AISLE_STRIDE + 1]!;
    const t = step > 0 ? left / step : 0;
    AISLE_WALK[WALK.t] = descending ? 1 - t : t;
    return;
  }
  AISLE_WALK[WALK.x0] = aisle[at * AISLE_STRIDE]!;
  AISLE_WALK[WALK.z0] = aisle[at * AISLE_STRIDE + 1]!;
  AISLE_WALK[WALK.x1] = AISLE_WALK[WALK.x0]!;
  AISLE_WALK[WALK.z1] = AISLE_WALK[WALK.z0]!;
  AISLE_WALK[WALK.t] = 0;
}

/** An indoor walk takes this many seconds a metre in a straight line, over her pace: an aisle bends round the furniture. */
const AISLE_ROUTE = 1.3;
/** `RESIDENT_INT.leftSpot` of someone who was at her buying lane, not a seat or spot of her own; and of someone who was out at the door. */
export const LEFT_LANE = -2;
export const LEFT_DOOR = -3;

/** Where she was in `place` before setting out: `leftSpot` is a seat or owner-table spot of it, or `LEFT_LANE` (her buying lane), into `out`. True for a seat. */
export function leftSpotAt(state: CityState, resident: number, place: number, leftSpot: number, out: StandSpot): boolean {
  const table = spotTable(state, place);
  if (leftSpot === LEFT_LANE) {
    fromSpotTable(table, laneOf(resident), out);
    return false;
  }
  const own = leftSpot - state.venues.seatCount[place]!;
  if (own >= 0) {
    fromSpotTable(table, STAND_COLUMNS + own, out);
    return false;
  }
  const seats = state.map.places[place]!.seats!;
  out.x = seats[leftSpot * SEAT_STRIDE]!;
  out.z = seats[leftSpot * SEAT_STRIDE + 1]!;
  out.yaw = seats[leftSpot * SEAT_STRIDE + 2]!;
  out.surfaceY = seats[leftSpot * SEAT_STRIDE + 3]!;
  return true;
}

/** Spot `index` of a `spotTable` into `to`. */
function fromSpotTable(table: Float64Array, index: number, to: StandSpot): void {
  const at = index * SPOT_FLOATS;
  to.x = table[at]!;
  to.z = table[at + 1]!;
  to.yaw = table[at + 2]!;
  to.surfaceY = table[at + 3]!;
}

const leftAt = new StandSpot();

/** Decision ticks she takes to get from `leftSpot` of `place` out to its door (a seat's standing up first), at her walking speed; 0 where the place has no aisle or she held nothing there. The brain delays her leg by it and the reader draws it, so both work it out here. */
export function walkOutTicks(state: CityState, resident: number, place: number, leftSpot: number): number {
  const entry = state.map.places[place]!;
  if (entry.aisle === undefined || leftSpot === NO_SEAT || leftSpot === LEFT_DOOR) return 0;
  const seat = leftSpotAt(state, resident, place, leftSpot, leftAt);
  const dx = entry.doorX - leftAt.x;
  const dz = entry.doorZ - leftAt.z;
  const seconds = (Math.sqrt(dx * dx + dz * dz) * AISLE_ROUTE) / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]! + (seat ? ACTIVITY_SECONDS.standUp : 0);
  return Math.ceil(seconds * DECISION_HZ);
}

/** Decision ticks she takes to walk in from the door of `place` to her buying lane; 0 where it has no aisle. */
export function walkInTicks(state: CityState, resident: number, place: number): number {
  const entry = state.map.places[place]!;
  if (entry.aisle === undefined) return 0;
  fromSpotTable(spotTable(state, place), laneOf(resident), leftAt);
  const dx = entry.doorX - leftAt.x;
  const dz = entry.doorZ - leftAt.z;
  return Math.ceil(((Math.sqrt(dx * dx + dz * dz) * AISLE_ROUTE) / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!) * DECISION_HZ);
}

/** What she ends at in a room: a seat, a standing or clerk's spot by the counter (fixed), or a loose spot (her standing room, or the lane for a short stop) the crowd keeps her apart on. */
export const ROOM_END = { seat: 0, spot: 1, loose: 2 } as const;

/** A stay in a room with an aisle, as `planRoom` lays it out: where her walk in starts (the door, or where she was when the stay goes on from the last one there), where she buys, where she ends and as what; the seconds of the walk in, the buying and the walk on. */
class RoomPlan {
  readonly from = new StandSpot();
  readonly lane = new StandSpot();
  readonly end = new StandSpot();
  kind: number = ROOM_END.loose;
  walkIn = 0;
  buy = 0;
  walkOn = 0;
}

/** The room plan `planRoom` fills: the reader draws a stay by it and the brain finds where she is in it, so both read one timing. */
export const ROOM = new RoomPlan();

function copySpot(from: StandSpot, to: StandSpot): void {
  to.x = from.x;
  to.z = from.z;
  to.yaw = from.yaw;
  to.surfaceY = from.surfaceY;
}

/** Where a resident in a room buys and ends: staff at their clerk's spot, a customer at her standing spot by the counter (buying there), or at her seat, her spot of standing room or the lane for a short stop (buying on the lane first). False: she holds nothing to walk to. */
function roomEnds(state: CityState, resident: number, place: number, worker: boolean, spot: number): boolean {
  ROOM.buy = worker ? 0 : ACTIVITY_SECONDS.buy;
  const own = spot - state.venues.seatCount[place]!;
  const table = spotTable(state, place);
  if (spot !== NO_SEAT && own >= 0 && (worker || own < STAND_SPOTS || own >= state.venues.standCount[place]!)) {
    fromSpotTable(table, STAND_COLUMNS + own, ROOM.end);
    copySpot(ROOM.end, ROOM.lane);
    ROOM.kind = ROOM_END.spot;
    return true;
  }
  if (worker) return false;
  fromSpotTable(table, laneOf(resident), ROOM.lane);
  ROOM.kind = ROOM_END.loose;
  if (own >= 0) fromSpotTable(table, STAND_COLUMNS + own, ROOM.end);
  else if (spot !== NO_SEAT) {
    leftSpotAt(state, resident, place, spot, ROOM.end);
    ROOM.kind = ROOM_END.seat;
  } else copySpot(ROOM.lane, ROOM.end);
  return true;
}

/**
 * `ROOM` for resident `resident`'s stay in `place` holding `spot` (staff: `worker`), `WALK.stay` seconds long: its walks at her pace (a straight metre's `AISLE_ROUTE` seconds), squeezed to fit a stay too short for them.
 * A stay that goes on from the last one where she is (another round, `RESIDENT_INT.leftSpot`) starts where she was and buys nothing: no walk when she keeps her spot, all of it when she was out at the door. False: nothing to draw.
 */
export function planRoom(state: CityState, resident: number, place: number, worker: boolean, spot: number): boolean {
  if (!roomEnds(state, resident, place, worker, spot)) return false;
  const base = resident * RESIDENT_INT_STRIDE;
  const entry = state.map.places[place]!;
  const left = state.ints[base + RESIDENT_INT.leftSpot]!;
  const goesOn = state.ints[base + RESIDENT_INT.pathCount] === 0 && state.ints[base + RESIDENT_INT.fromPlace] === place && left !== LEFT_DOOR;
  if (goesOn) {
    ROOM.buy = 0;
    if (left === NO_SEAT) copySpot(ROOM.end, ROOM.lane);
    else leftSpotAt(state, resident, place, left, ROOM.lane);
    copySpot(ROOM.lane, ROOM.from);
  } else {
    ROOM.from.x = entry.doorX;
    ROOM.from.z = entry.doorZ;
    ROOM.from.yaw = ROOM.lane.yaw;
  }
  const perMetre = AISLE_ROUTE / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  // Math.sqrt inline, not a kernel call: a double returned from a call is boxed, two a civilian a frame.
  const inX = ROOM.lane.x - ROOM.from.x;
  const inZ = ROOM.lane.z - ROOM.from.z;
  const onX = ROOM.end.x - ROOM.lane.x;
  const onZ = ROOM.end.z - ROOM.lane.z;
  const walkIn = Math.sqrt(inX * inX + inZ * inZ) * perMetre;
  const walkOn = Math.sqrt(onX * onX + onZ * onZ) * perMetre;
  const stay = AISLE_WALK[WALK.stay]!;
  ROOM.buy = Math.min(ROOM.buy, stay);
  const spare = stay - ROOM.buy;
  const fit = walkIn + walkOn > spare ? Math.max(0, spare) / (walkIn + walkOn) : 1;
  ROOM.walkIn = walkIn * fit;
  ROOM.walkOn = walkOn * fit;
  return true;
}

/** The most decision ticks a walk out of `place` to its door can take her: from its farthest aisle point or seat, a seat's standing up first. For timing a leg out of a place before she holds anything in it. */
export function longestWalkOutTicks(state: CityState, resident: number, place: number): number {
  const entry = state.map.places[place]!;
  const aisle = entry.aisle;
  if (aisle === undefined) return 0;
  let far = 0;
  for (let at = 0; at < aisle.length; at += AISLE_STRIDE) far = Math.max(far, Math.sqrt((aisle[at]! - entry.doorX) ** 2 + (aisle[at + 1]! - entry.doorZ) ** 2));
  const seats = entry.seats;
  if (seats !== undefined) for (let at = 0; at < seats.length; at += SEAT_STRIDE) far = Math.max(far, Math.sqrt((seats[at]! - entry.doorX) ** 2 + (seats[at + 1]! - entry.doorZ) ** 2));
  return Math.ceil(((far * AISLE_ROUTE) / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]! + ACTIVITY_SECONDS.standUp) * DECISION_HZ);
}
