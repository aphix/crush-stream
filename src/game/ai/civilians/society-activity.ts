import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  DOOR_SPREAD,
  FIGHT_PLAYER,
  FLAG,
  LATERAL_MAX,
  NEVER_TICK,
  NO_BEARING,
  NO_PLACE,
  NO_SEAT,
  PLAYER_STRIKE_REACH,
  PURPOSE,
  RECOIL_STEP_METRES,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SITTER_CHAT_REACH,
  SPECIES,
} from "./civilian-constants.ts";
import { WALKER_BEARING_STEPS } from "./civilian-crowd-constants.ts";
import { legPose } from "./civilian-leg.ts";
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
const FULL_TURN = 2 * Math.PI;
/** A swing lands half way through its clip. */
const SWING_LAND_SECONDS = FIGHT_SLOT_SECONDS / 2;

/** Where a civilian's landed swing pushes the player: along (dirX, dirZ), from the fighter to him. */
export class WalkerStrike {
  dirX = 0;
  dirZ = 1;
}

/** A fight's bearing (`WALKER_BEARING_STEPS` of a turn, 0 = +z toward +x) as a yaw in (-pi, pi]; none faces +z. */
function bearingYaw(bearing: number): number {
  if (bearing === NO_BEARING) return 0;
  return ((bearing > WALKER_BEARING_STEPS / 2 ? bearing - WALKER_BEARING_STEPS : bearing) / WALKER_BEARING_STEPS) * FULL_TURN;
}

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
  const civilianPair = partner >= 0;
  const starter = !civilianPair || resident < partner;
  const slot = Math.floor(since / FIGHT_SLOT_SECONDS) % FIGHT_SLOTS;
  const inSlot = since % FIGHT_SLOT_SECONDS;
  const side = starter ? -1 : 1;
  out.placed = true;
  out.x = intAt(state, resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE + (civilianPair ? side * FIGHT_HALF_GAP : 0);
  out.z = intAt(state, resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
  out.yaw = civilianPair ? -side * QUARTER_TURN : bearingYaw(intAt(state, resident, RESIDENT_INT.fightBearing));
  out.partner = civilianPair ? partner : -1;
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

/** Turns `out` to face the hazard the resident last saw. */
function faceHazard(state: CityState, resident: number, out: ActivityReading): void {
  const toX = intAt(state, resident, RESIDENT_INT.alarmX) / CENTIMETRES_PER_METRE - out.x;
  const toZ = intAt(state, resident, RESIDENT_INT.alarmZ) / CENTIMETRES_PER_METRE - out.z;
  if (toX !== 0 || toZ !== 0) out.yaw = detAtan2(toX, toZ);
}

/** A flinch: a step back from the hazard, out and back over the recoil clip, `RECOIL_STEP_METRES` at most. */
function stepBack(state: CityState, resident: number, since: number, out: ActivityReading): void {
  const toX = intAt(state, resident, RESIDENT_INT.alarmX) / CENTIMETRES_PER_METRE - out.x;
  const toZ = intAt(state, resident, RESIDENT_INT.alarmZ) / CENTIMETRES_PER_METRE - out.z;
  const distance = hypot2(toX, toZ);
  if (distance === 0) return;
  const step = detSin((Math.PI * since) / ACTIVITY_SECONDS.recoil) * RECOIL_STEP_METRES;
  out.x -= (toX / distance) * step;
  out.z -= (toZ / distance) * step;
}

/** Someone walking who saw a hazard flinches for the recoil clip's length, stepping back from it and facing it, then walks on. */
function readFlinch(state: CityState, resident: number, seconds: number, out: ActivityReading): void {
  const since = seconds - intAt(state, resident, RESIDENT_INT.alarmTick) / DECISION_HZ;
  if (since < 0 || since >= ACTIVITY_SECONDS.recoil || !legPose(state, resident, seconds, state.pose)) return;
  out.placed = true;
  out.x = state.pose.x;
  out.z = state.pose.z;
  out.partner = intAt(state, resident, RESIDENT_INT.alarmVictim);
  faceHazard(state, resident, out);
  stepBack(state, resident, since, out);
  setClip(out, ACTIVITY.recoil, since, ACTIVITY_SECONDS.recoil - since);
}

/** Out at a door watching trouble: a flinch and a step back at first, then standing looking at it; the one who phones for the ambulance stands on the phone, glancing at who is down. */
function readWatcher(state: CityState, resident: number, purpose: number, since: number, left: number, out: ActivityReading): void {
  out.partner = intAt(state, resident, RESIDENT_INT.alarmVictim);
  faceHazard(state, resident, out);
  if (purpose === PURPOSE.callAmbulance) setClip(out, ACTIVITY.phoneCall, since, left);
  else if (since < ACTIVITY_SECONDS.recoil) {
    stepBack(state, resident, since, out);
    setClip(out, ACTIVITY.recoil, since, ACTIVITY_SECONDS.recoil - since);
  } else setClip(out, ACTIVITY.idle, since, left);
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
  if (purpose === PURPOSE.lookOn || purpose === PURPOSE.callAmbulance) {
    readWatcher(state, resident, purpose, since, left, out);
    return;
  }
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

/** Door clips: the first and last `ACTIVITY_SECONDS.door` of a walk that leaves or enters a building. A leg by car is a walk to it, getting in (a clip, standing at it), the drive (nobody is seen), getting out (a clip) and a walk from it. */
function readWalk(state: CityState, resident: number, seconds: number, out: ActivityReading): void {
  let from = intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ;
  let to = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
  const leaveTick = intAt(state, resident, RESIDENT_INT.driveLeaveTick);
  if (leaveTick !== NEVER_TICK) {
    const leaveSeconds = leaveTick / DECISION_HZ;
    const parkSeconds = intAt(state, resident, RESIDENT_INT.driveParkTick) / DECISION_HZ;
    const gotInSeconds = leaveSeconds - ACTIVITY_SECONDS.carIn;
    const gotOutSeconds = parkSeconds + ACTIVITY_SECONDS.carOut;
    if (seconds >= gotInSeconds && seconds < leaveSeconds) return setClip(out, ACTIVITY.carIn, seconds - gotInSeconds, leaveSeconds - seconds);
    if (seconds >= leaveSeconds && seconds < parkSeconds) return;
    if (seconds >= parkSeconds && seconds < gotOutSeconds) return setClip(out, ACTIVITY.carOut, seconds - parkSeconds, gotOutSeconds - seconds);
    if (seconds < leaveSeconds) to = gotInSeconds;
    else from = gotOutSeconds;
  }
  const doorSeconds = ACTIVITY_SECONDS.door;
  const since = seconds - from;
  const toEnd = to - seconds;
  if (to - from <= 2 * doorSeconds) return;
  if (since < doorSeconds && from === intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ && hasDoor(state, intAt(state, resident, RESIDENT_INT.fromPlace))) setClip(out, ACTIVITY.door, since, doorSeconds - since);
  else if (toEnd < doorSeconds && to === intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ && hasDoor(state, intAt(state, resident, RESIDENT_INT.place))) setClip(out, ACTIVITY.door, doorSeconds - toEnd, toEnd);
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
    if (out.code === ACTIVITY.none) readFlinch(state, resident, seconds, out);
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

/** The latest moment a fighter who arrived at `arriveSeconds` lands a swing in (fromSeconds, toSeconds], or -1: the one who started (or turned on the player) swings every other slot. */
function swingLandingIn(arriveSeconds: number, fromSeconds: number, toSeconds: number): number {
  let slot = Math.floor((toSeconds - arriveSeconds - SWING_LAND_SECONDS) / FIGHT_SLOT_SECONDS);
  if (slot >= 0 && STARTER_SLOTS[slot % FIGHT_SLOTS] !== ACTIVITY.swing) slot--;
  if (slot < 0) return -1;
  const landing = arriveSeconds + slot * FIGHT_SLOT_SECONDS + SWING_LAND_SECONDS;
  return landing > fromSeconds ? landing : -1;
}

/**
 * A civilian who turned on the player lands a swing in crowd time (fromSeconds, toSeconds] with him at (walkerX, walkerZ) within `PLAYER_STRIKE_REACH` of their spot: true, the push's direction in `out`. Pure in the rows
 * and the times; it is the host's own walker who shoved them, so the host asks it of its own.
 */
export function findWalkerStrike(state: CityState, fromSeconds: number, toSeconds: number, walkerX: number, walkerZ: number, out: WalkerStrike): boolean {
  const { ints } = state;
  for (let resident = 0; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    if (ints[base + RESIDENT_INT.alive] === 0 || ints[base + RESIDENT_INT.fightPartner] !== FIGHT_PLAYER || ints[base + RESIDENT_INT.fightTick] === NEVER_TICK || ints[base + RESIDENT_INT.legPurpose] !== PURPOSE.fight) continue;
    const landing = swingLandingIn(ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ, fromSeconds, toSeconds);
    if (landing < 0 || landing >= ints[base + RESIDENT_INT.nextDecisionTick]! / DECISION_HZ) continue;
    const towardX = walkerX - ints[base + RESIDENT_INT.fightX]! / CENTIMETRES_PER_METRE;
    const towardZ = walkerZ - ints[base + RESIDENT_INT.fightZ]! / CENTIMETRES_PER_METRE;
    const reach = hypot2(towardX, towardZ);
    if (reach > PLAYER_STRIKE_REACH) continue;
    const yaw = bearingYaw(ints[base + RESIDENT_INT.fightBearing]!);
    out.dirX = reach > 0 ? towardX / reach : detSin(yaw);
    out.dirZ = reach > 0 ? towardZ / reach : detCos(yaw);
    return true;
  }
  return false;
}
