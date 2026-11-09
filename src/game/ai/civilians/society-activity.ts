import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  DOOR_SPREAD,
  FLAG,
  LATERAL_MAX,
  NEVER_TICK,
  NO_PLACE,
  NO_SEAT,
  PURPOSE,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SITTER_CHAT_REACH,
  SPECIES,
} from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";
import { COUNTER_STRIDE, SEAT_STRIDE } from "../../world/openworld/walk-graph.ts";
import { VENUE, isCounterVenue, isOutdoorPurpose } from "./society-venues.ts";

/** What one resident is doing at a crowd time, for the crowd to copy into the drawn poses: `placed` says the brain gives their position (seated, at a counter, standing at a door, fighting) and `x`, `z`, `yaw` hold it; else they are on a leg (or inside) and the leg's pose applies. */
export class ActivityReading {
  code: number = ACTIVITY.none;
  sinceSeconds = 0;
  leftSeconds = ACTIVITY_OPEN_ENDED;
  partner = -1;
  surfaceY = 0;
  placed = false;
  x = 0;
  z = 0;
  yaw = 0;
}

/** A fight is a cycle of four slots this long (s): the one who started swings and blocks, the other is hit and swings back. */
const FIGHT_SLOT_SECONDS = 0.6;
const FIGHT_SLOTS = 4;
const STARTER_SLOTS = [ACTIVITY.swing, ACTIVITY.block, ACTIVITY.swing, ACTIVITY.block] as const;
const OTHER_SLOTS = [ACTIVITY.hit, ACTIVITY.swing, ACTIVITY.hit, ACTIVITY.swing] as const;
/** Two fighters stand this far (m) either side of the spot, facing each other. */
const FIGHT_HALF_GAP = 0.5;
/** Quarter turn: fighters face along the x axis. */
const QUARTER_TURN = Math.PI / 2;

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function setClip(out: ActivityReading, code: number, since: number, left: number): void {
  out.code = code;
  out.sinceSeconds = since;
  out.leftSeconds = left;
}

/** Standing at a place's door on the street side, spread along the frontage by the resident's own lateral offset, facing the street. */
function standAtDoor(state: CityState, resident: number, place: number, out: ActivityReading): void {
  const entry = state.map.places[place]!;
  const lateral = (state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral]! / LATERAL_MAX) * DOOR_SPREAD;
  out.placed = true;
  out.x = entry.doorX + detSin(entry.yaw) * lateral;
  out.z = entry.doorZ + detCos(entry.yaw) * lateral;
  out.yaw = detAtan2(detCos(entry.yaw), -detSin(entry.yaw));
}

/** Whether the person they talk with is still out at a door in chatting distance. */
function companionIsHere(state: CityState, resident: number, tick: number): number {
  const companion = intAt(state, resident, RESIDENT_INT.companion);
  if (companion < 0 || intAt(state, companion, RESIDENT_INT.alive) === 0 || !isOutdoorPurpose(intAt(state, companion, RESIDENT_INT.legPurpose))) return -1;
  if (intAt(state, companion, RESIDENT_INT.arriveTick) > tick || tick >= intAt(state, companion, RESIDENT_INT.nextDecisionTick)) return -1;
  const { placeX, placeZ } = state.index;
  const here = intAt(state, resident, RESIDENT_INT.place);
  const there = intAt(state, companion, RESIDENT_INT.place);
  return hypot2(placeX[here]! - placeX[there]!, placeZ[here]! - placeZ[there]!) <= SITTER_CHAT_REACH ? companion : -1;
}

function readFight(state: CityState, resident: number, since: number, out: ActivityReading): void {
  const partner = intAt(state, resident, RESIDENT_INT.fightPartner);
  const fighting = intAt(state, resident, RESIDENT_INT.fightTick) !== NEVER_TICK;
  const starter = partner < 0 || resident < partner;
  const slot = Math.floor(since / FIGHT_SLOT_SECONDS) % FIGHT_SLOTS;
  const inSlot = since % FIGHT_SLOT_SECONDS;
  const side = starter ? -1 : 1;
  out.placed = true;
  out.x = intAt(state, resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE + (partner >= 0 ? side * FIGHT_HALF_GAP : 0);
  out.z = intAt(state, resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
  out.yaw = partner >= 0 ? -side * QUARTER_TURN : 0;
  out.partner = partner;
  if (!fighting) setClip(out, ACTIVITY.idle, since, ACTIVITY_OPEN_ENDED);
  else setClip(out, (starter ? STARTER_SLOTS : OTHER_SLOTS)[slot]!, inSlot, FIGHT_SLOT_SECONDS - inSlot);
}

/** Sitting down, sitting, standing up at the seat `seat` of `place`: the clip by how far into the stay (`since`) and how much of it is left. */
function readSitting(state: CityState, place: number, seat: number, since: number, left: number, out: ActivityReading, sitting: number): void {
  const seats = state.map.places[place]!.seats!;
  const at = seat * SEAT_STRIDE;
  out.placed = true;
  out.x = seats[at]!;
  out.z = seats[at + 1]!;
  out.yaw = seats[at + 2]!;
  out.surfaceY = seats[at + 3]!;
  if (since < ACTIVITY_SECONDS.sitDown) setClip(out, ACTIVITY.sitDown, since, ACTIVITY_SECONDS.sitDown - since);
  else if (left < ACTIVITY_SECONDS.standUp) setClip(out, ACTIVITY.standUp, ACTIVITY_SECONDS.standUp - left, left);
  else setClip(out, sitting, since - ACTIVITY_SECONDS.sitDown, left);
}

function readOutdoor(state: CityState, resident: number, purpose: number, place: number, tick: number, since: number, left: number, out: ActivityReading): void {
  const companion = companionIsHere(state, resident, tick);
  const seat = intAt(state, resident, RESIDENT_INT.seat);
  out.partner = companion;
  if (purpose === PURPOSE.stoopSit && seat !== NO_SEAT) {
    readSitting(state, place, seat, since, left, out, ACTIVITY.sitSteps);
    return;
  }
  standAtDoor(state, resident, place, out);
  const talking = companion >= 0 && (purpose === PURPOSE.stoopTalk || purpose === PURPOSE.argue || purpose === PURPOSE.stoopSit);
  setClip(out, talking ? ACTIVITY.talk : ACTIVITY.idle, since, left);
}

function readIndoors(state: CityState, resident: number, place: number, since: number, left: number, out: ActivityReading): void {
  const entry = state.map.places[place]!;
  const venue = state.venues.venueOf[place]!;
  const counter = entry.counter;
  const worker = intAt(state, resident, RESIDENT_INT.work) === place;
  if (worker && counter !== undefined && counter.length >= 2 * COUNTER_STRIDE) {
    out.placed = true;
    out.x = counter[COUNTER_STRIDE]!;
    out.z = counter[COUNTER_STRIDE + 1]!;
    out.yaw = counter[COUNTER_STRIDE + 2]!;
    out.surfaceY = counter[COUNTER_STRIDE + 3]!;
    setClip(out, ACTIVITY.idle, since, left);
    return;
  }
  if (worker || !isCounterVenue(venue)) return;
  if (counter !== undefined && counter.length >= COUNTER_STRIDE && since < ACTIVITY_SECONDS.buy) {
    out.placed = true;
    out.x = counter[0]!;
    out.z = counter[1]!;
    out.yaw = counter[2]!;
    out.surfaceY = counter[3]!;
    setClip(out, ACTIVITY.buy, since, ACTIVITY_SECONDS.buy - since);
    return;
  }
  const seat = intAt(state, resident, RESIDENT_INT.seat);
  if (seat !== NO_SEAT && entry.seats !== undefined) readSitting(state, place, seat, since - (counter === undefined ? 0 : ACTIVITY_SECONDS.buy), left, out, ACTIVITY.sit);
}

function hasDoor(state: CityState, place: number): boolean {
  const venue = state.venues.venueOf[place]!;
  return venue !== VENUE.park && venue !== VENUE.transit && venue !== VENUE.other;
}

/** Door clips: the first and last `ACTIVITY_SECONDS.door` of a walk that leaves or enters a building. */
function readWalk(state: CityState, resident: number, seconds: number, out: ActivityReading): void {
  if (intAt(state, resident, RESIDENT_INT.legPurpose) === PURPOSE.drive) return;
  const departSeconds = intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ;
  const arriveSeconds = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
  const doorSeconds = ACTIVITY_SECONDS.door;
  const since = seconds - departSeconds;
  const toEnd = arriveSeconds - seconds;
  if (arriveSeconds - departSeconds <= 2 * doorSeconds) return;
  if (since < doorSeconds && hasDoor(state, intAt(state, resident, RESIDENT_INT.fromPlace))) setClip(out, ACTIVITY.door, since, doorSeconds - since);
  else if (toEnd < doorSeconds && hasDoor(state, intAt(state, resident, RESIDENT_INT.place))) setClip(out, ACTIVITY.door, doorSeconds - toEnd, toEnd);
}

/** Fills `out` with what resident `resident` is doing at crowd time `seconds`, from their row alone: a pure function of the row and the time (any frame rate, no allocation). */
export function readActivity(state: CityState, resident: number, seconds: number, out: ActivityReading): void {
  setClip(out, ACTIVITY.none, 0, ACTIVITY_OPEN_ENDED);
  out.partner = -1;
  out.surfaceY = 0;
  out.placed = false;
  const base = resident * RESIDENT_INT_STRIDE;
  const tick = seconds * DECISION_HZ;
  if (state.ints[base + RESIDENT_INT.alive] === 0 || state.ints[base + RESIDENT_INT.species] !== SPECIES.person) return;
  if ((state.ints[base + RESIDENT_INT.flags]! & (FLAG.hurt | FLAG.custody)) !== 0 || (tick >= state.hiddenFromTick[resident]! && tick < state.hiddenUntilTick[resident]!)) return;
  const arriveSeconds = state.ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ;
  const nextSeconds = state.ints[base + RESIDENT_INT.nextDecisionTick]! / DECISION_HZ;
  if (state.ints[base + RESIDENT_INT.pathCount]! > 0 && seconds >= state.ints[base + RESIDENT_INT.departTick]! / DECISION_HZ && seconds < arriveSeconds) {
    readWalk(state, resident, seconds, out);
    return;
  }
  if (seconds < arriveSeconds || seconds >= nextSeconds) return;
  const purpose = state.ints[base + RESIDENT_INT.legPurpose]!;
  const place = state.ints[base + RESIDENT_INT.place]!;
  const since = seconds - arriveSeconds;
  const left = nextSeconds - seconds;
  if (place === NO_PLACE) return;
  if (purpose === PURPOSE.fight) readFight(state, resident, since, out);
  else if (isOutdoorPurpose(purpose)) readOutdoor(state, resident, purpose, place, tick, since, left, out);
  else readIndoors(state, resident, place, since, left, out);
}
