import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  ALARM_DELAY_STEPS_PER_SECOND,
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  DOOR_SPREAD,
  FIGHT_PLAYER,
  FLAG,
  KNOCKOUT_BLOW_SPAN,
  KNOCKOUT_MIN_BLOWS,
  KNOCKOUT_SHARE,
  LATERAL_MAX,
  NEVER_TICK,
  NO_BEARING,
  NO_PLACE,
  NO_SEAT,
  PLAYER_STRIKE_REACH,
  PURPOSE,
  RECOIL_CALM_SHARE,
  RECOIL_STEP_METRES,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SITTER_CHAT_REACH,
  SPECIES,
  STREAM,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { WALKER_BEARING_STEPS } from "./civilian-crowd-constants.ts";
import { legPose } from "./civilian-leg.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";
import type { CityState } from "./civilian-state.ts";
import { SEAT_STRIDE } from "../../world/openworld/walk-graph.ts";
import { buyLaneSpot, StandSpot, standSpotAt } from "./society-seats.ts";
import { VENUE, isCounterVenue, isOutdoorPurpose } from "./society-venues.ts";

/** What one resident is doing at a crowd time, for the crowd to copy into the drawn poses: `placed` says the brain gives their position (seated, at a counter, standing at a door, fighting) and `x`, `z`, `yaw` hold it; else they are on a leg (or inside) and the leg's pose applies. */
export class ActivityReading {
  code: number = ACTIVITY.none;
  sinceSeconds = 0;
  leftSeconds = ACTIVITY_OPEN_ENDED;
  partner = -1;
  surfaceY = 0;
  placed = false;
  /** A placed body that must not give way (seated, at a counter, fighting): not one standing at a door or flinching, which the crowd keeps a body's width from the next. */
  fixed = false;
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

/**
 * What the readers below share while one resident is read: the crowd second asked and its tick, seconds since the resident arrived and seconds of the stay left, and (for a flinch) seconds into it. Held here and not handed
 * down as arguments: a double passed to or returned from a call V8 does not inline is boxed, one object each, for every civilian every frame.
 */
class ReadScratch {
  clock = 0;
  tick = 0;
  age = 0;
  rest = 0;
  flinch = 0;
}

const scratch = new ReadScratch();
/** Where `standAt` and the buying lane put someone, before it is copied into the reading. */
const standing = new StandSpot();

/** Standing at a place's door on the street side, spread along the frontage by the resident's own lateral offset, facing the street. */
function standAtDoor(state: CityState, resident: number, place: number, out: ActivityReading): void {
  const entry = state.map.places[place]!;
  const lateral = (state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral]! / LATERAL_MAX) * DOOR_SPREAD;
  out.placed = true;
  out.x = entry.doorX + detSin(entry.yaw) * lateral;
  out.z = entry.doorZ + detCos(entry.yaw) * lateral;
  out.yaw = detAtan2(detCos(entry.yaw), -detSin(entry.yaw));
}

/** The person they talk with if they are still out at a door in chatting distance at `scratch.tick`, else -1. */
function companionIsHere(state: CityState, resident: number): number {
  const companion = intAt(state, resident, RESIDENT_INT.companion);
  if (companion < 0 || intAt(state, companion, RESIDENT_INT.alive) === 0 || !isOutdoorPurpose(intAt(state, companion, RESIDENT_INT.legPurpose))) return -1;
  if (intAt(state, companion, RESIDENT_INT.arriveTick) > scratch.tick || scratch.tick >= intAt(state, companion, RESIDENT_INT.nextDecisionTick)) return -1;
  const { placeX, placeZ } = state.index;
  const here = intAt(state, resident, RESIDENT_INT.place);
  const there = intAt(state, companion, RESIDENT_INT.place);
  return hypot2(placeX[here]! - placeX[there]!, placeZ[here]! - placeZ[there]!) <= SITTER_CHAT_REACH ? companion : -1;
}

/** A fight's clips, `scratch.age` seconds into it. */
function readFight(state: CityState, resident: number, out: ActivityReading): void {
  const partner = intAt(state, resident, RESIDENT_INT.fightPartner);
  const fighting = intAt(state, resident, RESIDENT_INT.fightTick) !== NEVER_TICK;
  const civilianPair = partner >= 0;
  const starter = !civilianPair || resident < partner;
  const slot = Math.floor(scratch.age / FIGHT_SLOT_SECONDS) % FIGHT_SLOTS;
  const inSlot = scratch.age % FIGHT_SLOT_SECONDS;
  const side = starter ? -1 : 1;
  out.placed = true;
  out.fixed = true;
  out.x = intAt(state, resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE + (civilianPair ? side * FIGHT_HALF_GAP : 0);
  out.z = intAt(state, resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
  out.yaw = civilianPair ? -side * QUARTER_TURN : bearingYaw(intAt(state, resident, RESIDENT_INT.fightBearing));
  out.partner = civilianPair ? partner : -1;
  if (!fighting) {
    out.code = ACTIVITY.idle;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = ACTIVITY_OPEN_ENDED;
  } else {
    out.code = (starter ? STARTER_SLOTS : OTHER_SLOTS)[slot]!;
    out.sinceSeconds = inSlot;
    out.leftSeconds = FIGHT_SLOT_SECONDS - inSlot;
  }
}

/** Sitting down, sitting, standing up at the seat `seat` of `place`: the clip by how far into the stay (`scratch.age`) and how much of it is left (`scratch.rest`). */
function readSitting(state: CityState, place: number, seat: number, out: ActivityReading, sitting: number): void {
  const seats = state.map.places[place]!.seats!;
  const at = seat * SEAT_STRIDE;
  out.placed = true;
  out.fixed = true;
  out.x = seats[at]!;
  out.z = seats[at + 1]!;
  out.yaw = seats[at + 2]!;
  out.surfaceY = seats[at + 3]!;
  if (scratch.age < ACTIVITY_SECONDS.sitDown) {
    out.code = ACTIVITY.sitDown;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = ACTIVITY_SECONDS.sitDown - scratch.age;
  } else if (scratch.rest < ACTIVITY_SECONDS.standUp) {
    out.code = ACTIVITY.standUp;
    out.sinceSeconds = ACTIVITY_SECONDS.standUp - scratch.rest;
    out.leftSeconds = scratch.rest;
  } else {
    out.code = sitting;
    out.sinceSeconds = scratch.age - ACTIVITY_SECONDS.sitDown;
    out.leftSeconds = scratch.rest;
  }
}

/** Turns `out` to face the hazard the resident last saw. */
function faceHazard(state: CityState, resident: number, out: ActivityReading): void {
  const toX = intAt(state, resident, RESIDENT_INT.alarmX) / CENTIMETRES_PER_METRE - out.x;
  const toZ = intAt(state, resident, RESIDENT_INT.alarmZ) / CENTIMETRES_PER_METRE - out.z;
  if (toX !== 0 || toZ !== 0) out.yaw = detAtan2(toX, toZ);
}

/** A flinch, `scratch.flinch` seconds into it: a step back from the hazard, out and back over the recoil clip, `RECOIL_STEP_METRES` at most (the calm take `RECOIL_CALM_SHARE` of it). */
function stepBack(state: CityState, resident: number, out: ActivityReading): void {
  const toX = intAt(state, resident, RESIDENT_INT.alarmX) / CENTIMETRES_PER_METRE - out.x;
  const toZ = intAt(state, resident, RESIDENT_INT.alarmZ) / CENTIMETRES_PER_METRE - out.z;
  const distance = hypot2(toX, toZ);
  if (distance === 0) return;
  const step = detSin((Math.PI * scratch.flinch) / ACTIVITY_SECONDS.recoil) * RECOIL_STEP_METRES * (RECOIL_CALM_SHARE + (1 - RECOIL_CALM_SHARE) * residentNeuroticism(state, resident));
  out.x -= (toX / distance) * step;
  out.z -= (toZ / distance) * step;
}

/** Someone walking who saw a hazard flinches for the recoil clip's length from the moment they noticed it (the hazard's tick and their own delay), stepping back from it and facing it, then walks on. */
function readFlinch(state: CityState, resident: number, out: ActivityReading): void {
  if (intAt(state, resident, RESIDENT_INT.alarmTick) === NEVER_TICK) return;
  scratch.flinch = scratch.clock - intAt(state, resident, RESIDENT_INT.alarmTick) / DECISION_HZ - intAt(state, resident, RESIDENT_INT.alarmDelay) / ALARM_DELAY_STEPS_PER_SECOND;
  if (scratch.flinch < 0 || scratch.flinch >= ACTIVITY_SECONDS.recoil || !legPose(state, resident, scratch.clock, state.pose) || state.pose.evading) return;
  out.placed = true;
  out.x = state.pose.x;
  out.z = state.pose.z;
  out.partner = intAt(state, resident, RESIDENT_INT.alarmVictim);
  faceHazard(state, resident, out);
  stepBack(state, resident, out);
  out.code = ACTIVITY.recoil;
  out.sinceSeconds = scratch.flinch;
  out.leftSeconds = ACTIVITY_SECONDS.recoil - scratch.flinch;
}

/** Out at a door watching trouble: until they notice it they stand as they were; then a flinch and a step back, then standing looking at it; the one who phones for the ambulance stands on the phone, glancing at who is down. */
function readWatcher(state: CityState, resident: number, purpose: number, out: ActivityReading): void {
  if (purpose === PURPOSE.callAmbulance) {
    out.partner = intAt(state, resident, RESIDENT_INT.alarmVictim);
    faceHazard(state, resident, out);
    out.code = ACTIVITY.phoneCall;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = scratch.rest;
    return;
  }
  scratch.flinch = scratch.age - intAt(state, resident, RESIDENT_INT.alarmDelay) / ALARM_DELAY_STEPS_PER_SECOND;
  if (scratch.flinch < 0) {
    out.code = ACTIVITY.idle;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = scratch.rest;
    return;
  }
  out.partner = intAt(state, resident, RESIDENT_INT.alarmVictim);
  faceHazard(state, resident, out);
  if (scratch.flinch < ACTIVITY_SECONDS.recoil) {
    stepBack(state, resident, out);
    out.code = ACTIVITY.recoil;
    out.sinceSeconds = scratch.flinch;
    out.leftSeconds = ACTIVITY_SECONDS.recoil - scratch.flinch;
  } else {
    out.code = ACTIVITY.idle;
    out.sinceSeconds = scratch.flinch;
    out.leftSeconds = scratch.rest;
  }
}

function readOutdoor(state: CityState, resident: number, purpose: number, place: number, out: ActivityReading): void {
  const companion = companionIsHere(state, resident);
  const seat = intAt(state, resident, RESIDENT_INT.seat);
  out.partner = companion;
  if (purpose === PURPOSE.stoopSit && seat !== NO_SEAT) {
    readSitting(state, place, seat, out, ACTIVITY.sitSteps);
    return;
  }
  standAtDoor(state, resident, place, out);
  if (purpose === PURPOSE.lookOn || purpose === PURPOSE.callAmbulance) {
    readWatcher(state, resident, purpose, out);
    return;
  }
  const talking = companion >= 0 && (purpose === PURPOSE.stoopTalk || purpose === PURPOSE.argue || purpose === PURPOSE.stoopSit);
  out.code = talking ? ACTIVITY.talk : ACTIVITY.idle;
  out.sinceSeconds = scratch.age;
  out.leftSeconds = scratch.rest;
}

/** A resident held to `spot` of the owner table of `place` stands there (a customer's at the counter, a clerk's behind it): into `out`, fixed (the spots are a body's width apart). */
function standAt(state: CityState, place: number, spot: number, out: ActivityReading): void {
  const { seatCount, standCount } = state.venues;
  const own = spot - seatCount[place]!;
  const clerk = own >= standCount[place]!;
  standSpotAt(state, place, clerk ? own - standCount[place]! : own, clerk, standing);
  out.placed = true;
  out.fixed = true;
  out.x = standing.x;
  out.z = standing.z;
  out.yaw = standing.yaw;
  out.surfaceY = standing.surfaceY;
}

function readIndoors(state: CityState, resident: number, place: number, out: ActivityReading): void {
  const venue = state.venues.venueOf[place]!;
  const worker = intAt(state, resident, RESIDENT_INT.work) === place;
  if (!worker && !isCounterVenue(venue)) return;
  const spot = intAt(state, resident, RESIDENT_INT.seat);
  const { seatCount } = state.venues;
  if (worker) {
    if (spot === NO_SEAT) return;
    standAt(state, place, spot, out);
    out.code = ACTIVITY.idle;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = scratch.rest;
    return;
  }
  const hasCounter = state.venues.standCount[place]! > 0;
  if (hasCounter && scratch.age < ACTIVITY_SECONDS.buy) {
    if (spot !== NO_SEAT && spot >= seatCount[place]!) standAt(state, place, spot, out);
    else {
      buyLaneSpot(state, place, resident, standing);
      out.placed = true;
      out.x = standing.x;
      out.z = standing.z;
      out.yaw = standing.yaw;
      out.surfaceY = standing.surfaceY;
    }
    out.code = ACTIVITY.buy;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = ACTIVITY_SECONDS.buy - scratch.age;
    return;
  }
  if (spot === NO_SEAT) return;
  if (spot >= seatCount[place]!) {
    standAt(state, place, spot, out);
    out.code = ACTIVITY.idle;
    out.sinceSeconds = scratch.age;
    out.leftSeconds = scratch.rest;
    return;
  }
  if (hasCounter) scratch.age -= ACTIVITY_SECONDS.buy;
  readSitting(state, place, spot, out, ACTIVITY.sit);
}

function hasDoor(state: CityState, place: number): boolean {
  const venue = state.venues.venueOf[place]!;
  return venue !== VENUE.park && venue !== VENUE.transit && venue !== VENUE.other;
}

/** Door clips: the first and last `ACTIVITY_SECONDS.door` of a walk that leaves or enters a building. A leg by car is a walk to it, getting in (a clip, standing at it), the drive (nobody is seen), getting out (a clip) and a walk from it. */
function readWalk(state: CityState, resident: number, out: ActivityReading): void {
  const seconds = scratch.clock;
  let from = intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ;
  let to = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
  const leaveTick = intAt(state, resident, RESIDENT_INT.driveLeaveTick);
  if (leaveTick === NEVER_TICK && seconds - from >= ACTIVITY_SECONDS.door && to - seconds >= ACTIVITY_SECONDS.door) return;
  if (leaveTick !== NEVER_TICK) {
    const leaveSeconds = leaveTick / DECISION_HZ;
    const parkSeconds = intAt(state, resident, RESIDENT_INT.driveParkTick) / DECISION_HZ;
    const gotInSeconds = leaveSeconds - ACTIVITY_SECONDS.carIn;
    const gotOutSeconds = parkSeconds + ACTIVITY_SECONDS.carOut;
    if (seconds >= gotInSeconds && seconds < leaveSeconds) {
      out.code = ACTIVITY.carIn;
      out.sinceSeconds = seconds - gotInSeconds;
      out.leftSeconds = leaveSeconds - seconds;
      return;
    }
    if (seconds >= leaveSeconds && seconds < parkSeconds) return;
    if (seconds >= parkSeconds && seconds < gotOutSeconds) {
      out.code = ACTIVITY.carOut;
      out.sinceSeconds = seconds - parkSeconds;
      out.leftSeconds = gotOutSeconds - seconds;
      return;
    }
    if (seconds < leaveSeconds) to = gotInSeconds;
    else from = gotOutSeconds;
  }
  const doorSeconds = ACTIVITY_SECONDS.door;
  const since = seconds - from;
  const toEnd = to - seconds;
  if (to - from <= 2 * doorSeconds) return;
  if (since < doorSeconds && from === intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ && hasDoor(state, intAt(state, resident, RESIDENT_INT.fromPlace))) {
    out.code = ACTIVITY.door;
    out.sinceSeconds = since;
    out.leftSeconds = doorSeconds - since;
  } else if (toEnd < doorSeconds && to === intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ && hasDoor(state, intAt(state, resident, RESIDENT_INT.place))) {
    out.code = ACTIVITY.door;
    out.sinceSeconds = doorSeconds - toEnd;
    out.leftSeconds = toEnd;
  }
}

/** Fills `out` with what resident `resident` is doing at crowd time `seconds`, from their row alone: a pure function of the row and the time (any frame rate, no allocation). */
export function readActivity(state: CityState, resident: number, seconds: number, out: ActivityReading): void {
  out.code = ACTIVITY.none;
  out.sinceSeconds = 0;
  out.leftSeconds = ACTIVITY_OPEN_ENDED;
  out.partner = -1;
  out.surfaceY = 0;
  out.placed = false;
  out.fixed = false;
  const { ints } = state;
  const base = resident * RESIDENT_INT_STRIDE;
  if (ints[base + RESIDENT_INT.alive] === 0 || ints[base + RESIDENT_INT.species] !== SPECIES.person) return;
  const tick = seconds * DECISION_HZ;
  if ((ints[base + RESIDENT_INT.flags]! & (FLAG.hurt | FLAG.custody)) !== 0 || (tick >= state.hiddenFromTick[resident]! && tick < state.hiddenUntilTick[resident]!)) return;
  scratch.clock = seconds;
  scratch.tick = tick;
  const arriveTick = ints[base + RESIDENT_INT.arriveTick]!;
  if (ints[base + RESIDENT_INT.pathCount]! > 0 && tick >= ints[base + RESIDENT_INT.departTick]! && tick < arriveTick) {
    readWalk(state, resident, out);
    if (out.code === ACTIVITY.none) readFlinch(state, resident, out);
    return;
  }
  const nextTick = ints[base + RESIDENT_INT.nextDecisionTick]!;
  if (tick < arriveTick || tick >= nextTick) return;
  const place = ints[base + RESIDENT_INT.place]!;
  if (place === NO_PLACE) return;
  scratch.age = seconds - arriveTick / DECISION_HZ;
  scratch.rest = nextTick / DECISION_HZ - seconds;
  const purpose = ints[base + RESIDENT_INT.legPurpose]!;
  if (purpose === PURPOSE.fight) readFight(state, resident, out);
  else if (isOutdoorPurpose(purpose)) readOutdoor(state, resident, purpose, place, out);
  else readIndoors(state, resident, place, out);
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

/** A blow one civilian lands on another in a fight. */
export class CivilianBlow {
  striker = -1;
  victim = -1;
  /** Crowd second the swing lands. */
  landing = 0;
}

/**
 * The first fighter at or after `firstResident` whose swing lands on a civilian partner in crowd time (fromSeconds, toSeconds]: his index, with the pair in `out`; -1 when none does.
 * Only the one who started the fight swings (the lower id of the pair, as `readFight` casts them), so the victim is his partner. Pure in the rows and the times.
 */
export function findCivilianBlow(state: CityState, fromSeconds: number, toSeconds: number, firstResident: number, out: CivilianBlow): number {
  const { ints } = state;
  for (let resident = firstResident; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    const partner = ints[base + RESIDENT_INT.fightPartner]!;
    if (ints[base + RESIDENT_INT.alive] === 0 || partner < 0 || partner <= resident || ints[base + RESIDENT_INT.fightTick] === NEVER_TICK || ints[base + RESIDENT_INT.legPurpose] !== PURPOSE.fight) continue;
    const landing = swingLandingIn(ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ, fromSeconds, toSeconds);
    if (landing < 0 || landing >= ints[base + RESIDENT_INT.nextDecisionTick]! / DECISION_HZ) continue;
    out.striker = resident;
    out.victim = partner;
    out.landing = landing;
    return resident;
  }
  return -1;
}

/** Which of a fight's blows, counted on `victim`, knocks her out: 0 for a fight that ends with nobody down. One seeded draw per victim and fight, so every peer agrees. */
export function knockoutBlow(seed: number, victim: number, fightTick: number): number {
  const draw = residentDraws(seed, victim, STREAM.punch, fightTick)();
  return draw >= KNOCKOUT_SHARE ? 0 : KNOCKOUT_MIN_BLOWS + Math.floor((draw / KNOCKOUT_SHARE) * KNOCKOUT_BLOW_SPAN);
}
