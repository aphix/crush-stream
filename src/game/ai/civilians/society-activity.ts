import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  ALARM_DELAY_STEPS_PER_SECOND,
  CENTIMETRES_PER_METRE,
  DECISION_HZ,
  DOOR_SPREAD,
  FIGHT_HALF_GAP,
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
import { SEAT_STRIDE, STAND_COLUMNS, STAND_SPOTS } from "../../world/openworld/walk-graph.ts";
import { buyLaneSpot, laneOf, spotTable, StandSpot, standSpotAt } from "./society-seats.ts";
import { AISLE_ROUTE, AISLE_WALK, fromSpotTable, LEFT_DOOR, leftSpotAt, WALK, walkAisle, walkOutTicks } from "./society-aisle.ts";
import { VENUE, isCounterVenue, isOutdoorPurpose } from "./society-venues.ts";

/** What one resident is doing at a crowd time, for the crowd to copy into the drawn poses: `placed` says the brain gives their position (seated, at a counter, standing at a door, fighting) and `x`, `z`, `yaw` hold it; else they are on a leg (or inside) and the leg's pose applies. */
export class ActivityReading {
  code: number = ACTIVITY.none;
  sinceSeconds = 0;
  leftSeconds = ACTIVITY_OPEN_ENDED;
  partner = -1;
  surfaceY = 0;
  /** A placed body walking (inside a room): how fast (m/s) and how far she has walked (m), for her stride. 0 when she stands. */
  speed = 0;
  walked = 0;
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
  const bearing = intAt(state, resident, RESIDENT_INT.fightBearing);
  // A pair met on a walk stands at its own spots, each facing the other (`startFight`); a pair met at a door is split along x.
  const split = civilianPair && bearing === NO_BEARING;
  out.x = intAt(state, resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE + (split ? side * FIGHT_HALF_GAP : 0);
  out.z = intAt(state, resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
  out.yaw = split ? -side * QUARTER_TURN : bearingYaw(bearing);
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

/** Where `spot` of the owner table of `place` is (a customer's standing spot or a clerk's), into `into`. */
function spotOf(state: CityState, place: number, spot: number, into: StandSpot): void {
  const { seatCount, standCount } = state.venues;
  const own = spot - seatCount[place]!;
  const clerk = own >= standCount[place]!;
  standSpotAt(state, place, clerk ? own - standCount[place]! : own, clerk, into);
}

/** A resident held to `spot` of the owner table of `place` stands there (a customer's at the counter, a clerk's behind it): into `out`, fixed (the spots are a body's width apart). */
function standAt(state: CityState, place: number, spot: number, out: ActivityReading): void {
  spotOf(state, place, spot, standing);
  out.placed = true;
  out.fixed = true;
  out.x = standing.x;
  out.z = standing.z;
  out.yaw = standing.yaw;
  out.surfaceY = standing.surfaceY;
}

/** What she ends at in a room: a seat, a standing or clerk's spot by the counter (fixed), or a loose spot (her standing room, or the lane for a short stop) the crowd keeps her apart on. */
const TARGET = { seat: 0, spot: 1, loose: 2 } as const;

/** A stay in a room with an aisle, as seconds: the walk from the door to where she buys, the buying, the walk on to her target; the walk being read; what she ends at. */
class RoomScratch {
  walkIn = 0;
  buy = 0;
  walkOn = 0;
  walking = 0;
  target: number = TARGET.loose;
}

const room = new RoomScratch();
/** Where she buys, where she spends the stay, and the door. */
const lane = new StandSpot();
const target = new StandSpot();
const doorway = new StandSpot();

function copySpot(from: StandSpot, to: StandSpot): void {
  to.x = from.x;
  to.z = from.z;
  to.yaw = from.yaw;
  to.surfaceY = from.surfaceY;
}

/** Where a resident in a room buys and ends (`lane`, `target`, `room.target`, `room.buy`): staff at their clerk's spot, a customer at her standing spot by the counter (buying there), or at her seat, her spot of standing room or the lane for a short stop (buying on the lane first). False: she holds nothing to walk to. */
function roomTarget(state: CityState, resident: number, place: number, worker: boolean, spot: number): boolean {
  room.buy = worker ? 0 : ACTIVITY_SECONDS.buy;
  const own = spot - state.venues.seatCount[place]!;
  const table = spotTable(state, place);
  if (spot !== NO_SEAT && own >= 0 && (worker || own < STAND_SPOTS || own >= state.venues.standCount[place]!)) {
    fromSpotTable(table, STAND_COLUMNS + own, target);
    copySpot(target, lane);
    room.target = TARGET.spot;
    return true;
  }
  if (worker) return false;
  fromSpotTable(table, laneOf(resident), lane);
  room.target = TARGET.loose;
  if (own >= 0) {
    fromSpotTable(table, STAND_COLUMNS + own, target);
    return true;
  }
  if (spot !== NO_SEAT) {
    leftSpotAt(state, resident, place, spot, target);
    room.target = TARGET.seat;
    return true;
  }
  copySpot(lane, target);
  return true;
}

/** The stay's walks at her pace (a straight metre's `AISLE_ROUTE` seconds), squeezed to fit a stay too short for them. A stay that goes on from the last one where she is (another round, `RESIDENT_INT.leftSpot`) is walked only from where she was: none when she keeps her spot, all of it when she was out at the door. */
function roomTimes(state: CityState, resident: number, place: number): void {
  const entry = state.map.places[place]!;
  const left = intAt(state, resident, RESIDENT_INT.leftSpot);
  const goesOn = intAt(state, resident, RESIDENT_INT.pathCount) === 0 && intAt(state, resident, RESIDENT_INT.fromPlace) === place && left !== LEFT_DOOR;
  if (goesOn) {
    room.buy = 0;
    room.walkIn = 0;
    if (left === NO_SEAT) copySpot(target, lane);
    else leftSpotAt(state, resident, place, left, lane);
  }
  const perMetre = AISLE_ROUTE / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  // Math.sqrt inline, not a kernel call: a double returned from a call is boxed, two a civilian a frame.
  const inX = lane.x - entry.doorX;
  const inZ = lane.z - entry.doorZ;
  const onX = target.x - lane.x;
  const onZ = target.z - lane.z;
  const walkIn = goesOn ? 0 : Math.sqrt(inX * inX + inZ * inZ) * perMetre;
  const walkOn = Math.sqrt(onX * onX + onZ * onZ) * perMetre;
  const stay = scratch.age + scratch.rest;
  room.buy = Math.min(room.buy, stay);
  const spare = stay - room.buy;
  const fit = walkIn + walkOn > spare ? Math.max(0, spare) / (walkIn + walkOn) : 1;
  room.walkIn = walkIn * fit;
  room.walkOn = walkOn * fit;
}

/** She walks the aisle as `AISLE_WALK` asks, over `room.walking` seconds: placed, not fixed, at her pace. */
function walkRoom(aisle: Float32Array, out: ActivityReading): boolean {
  walkAisle(aisle);
  out.placed = true;
  out.fixed = false;
  out.code = ACTIVITY.none;
  out.x = AISLE_WALK[WALK.x]!;
  out.z = AISLE_WALK[WALK.z]!;
  out.yaw = AISLE_WALK[WALK.yaw]!;
  out.speed = AISLE_WALK[WALK.length]! / room.walking;
  out.walked = AISLE_WALK[WALK.walked]!;
  return true;
}

/** Sets `AISLE_WALK`'s walk from `from` to `to` (heading as `to` faces where no aisle edge gives one); the caller sets the share walked and `room.walking`. */
function aimWalk(from: StandSpot, to: StandSpot): void {
  AISLE_WALK[WALK.yaw] = to.yaw;
  AISLE_WALK[WALK.fromX] = from.x;
  AISLE_WALK[WALK.fromZ] = from.z;
  AISLE_WALK[WALK.toX] = to.x;
  AISLE_WALK[WALK.toZ] = to.z;
}

/** A stay in a room with an aisle: walked in from the door to where she buys, then on to her seat or spot, where she stays (her walk out belongs to leaving: `readLeaving`). False: nothing to draw. */
function readRoom(state: CityState, resident: number, place: number, worker: boolean, spot: number, out: ActivityReading): boolean {
  if (!roomTarget(state, resident, place, worker, spot)) return false;
  roomTimes(state, resident, place);
  const entry = state.map.places[place]!;
  const aisle = entry.aisle!;
  const atLane = scratch.age - room.walkIn;
  const atTarget = atLane - room.buy;
  if (atLane < 0) {
    doorway.x = entry.doorX;
    doorway.z = entry.doorZ;
    aimWalk(doorway, lane);
    AISLE_WALK[WALK.share] = scratch.age / room.walkIn;
    room.walking = room.walkIn;
    return walkRoom(aisle, out);
  }
  if (atLane < room.buy) return readBuying(out);
  if (atTarget < room.walkOn) {
    aimWalk(lane, target);
    AISLE_WALK[WALK.share] = atTarget / room.walkOn;
    room.walking = room.walkOn;
    return walkRoom(aisle, out);
  }
  const sitting = room.walkIn + room.buy + room.walkOn === 0 ? ACTIVITY_SECONDS.sitDown : 0;
  scratch.age = atTarget - room.walkOn + sitting;
  if (room.target === TARGET.seat) {
    // She stands up as she leaves (`readLeaving`), not at the stay's end: another round may follow.
    scratch.rest = ACTIVITY_OPEN_ENDED;
    readSitting(state, place, spot, out, ACTIVITY.sit);
    return true;
  }
  placeAt(target, room.target === TARGET.spot, out);
  out.code = ACTIVITY.idle;
  out.sinceSeconds = scratch.age;
  out.leftSeconds = scratch.rest;
  return true;
}

/** Buying at `lane`: fixed at a spot of her own, loose on the lane. */
function readBuying(out: ActivityReading): boolean {
  placeAt(lane, room.target === TARGET.spot, out);
  out.code = ACTIVITY.buy;
  out.sinceSeconds = scratch.age - room.walkIn;
  out.leftSeconds = room.buy - out.sinceSeconds;
  return true;
}

function placeAt(spot: StandSpot, fixed: boolean, out: ActivityReading): void {
  out.placed = true;
  out.fixed = fixed;
  out.x = spot.x;
  out.z = spot.z;
  out.yaw = spot.yaw;
  out.surfaceY = spot.surfaceY;
}

/** Her leg out of a room with an aisle sets off `walkOutTicks` late: until it does she stands up from her seat and walks from where she was (`RESIDENT_INT.leftSpot`) to the door. */
function readLeaving(state: CityState, resident: number, out: ActivityReading): void {
  const place = intAt(state, resident, RESIDENT_INT.fromPlace);
  const left = intAt(state, resident, RESIDENT_INT.leftSpot);
  const depart = intAt(state, resident, RESIDENT_INT.departTick);
  const ticks = walkOutTicks(state, resident, place, left);
  const since = scratch.clock - (depart - ticks) / DECISION_HZ;
  if (ticks === 0 || since < 0) return;
  const seat = leftSpotAt(state, resident, place, left, target);
  const standing = seat ? ACTIVITY_SECONDS.standUp : 0;
  if (since < standing) {
    scratch.age = ACTIVITY_OPEN_ENDED;
    scratch.rest = standing - since;
    readSitting(state, place, left, out, ACTIVITY.sit);
    return;
  }
  const entry = state.map.places[place]!;
  doorway.x = entry.doorX;
  doorway.z = entry.doorZ;
  doorway.yaw = target.yaw > 0 ? target.yaw - Math.PI : target.yaw + Math.PI;
  room.walking = depart / DECISION_HZ - (scratch.clock - since) - standing;
  aimWalk(target, doorway);
  AISLE_WALK[WALK.share] = (since - standing) / room.walking;
  walkRoom(entry.aisle!, out);
}

function readIndoors(state: CityState, resident: number, place: number, out: ActivityReading): void {
  const venue = state.venues.venueOf[place]!;
  const worker = intAt(state, resident, RESIDENT_INT.work) === place;
  if (!worker && !isCounterVenue(venue)) return;
  const spot = intAt(state, resident, RESIDENT_INT.seat);
  const { seatCount } = state.venues;
  if (state.map.places[place]!.aisle !== undefined && readRoom(state, resident, place, worker, spot, out)) return;
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
  if (since < doorSeconds && from === intAt(state, resident, RESIDENT_INT.departTick) / DECISION_HZ && (intAt(state, resident, RESIDENT_INT.flags) & FLAG.fromOutside) === 0 && hasDoor(state, intAt(state, resident, RESIDENT_INT.fromPlace))) {
    out.code = ACTIVITY.door;
    out.sinceSeconds = since;
    out.leftSeconds = doorSeconds - since;
  // A walk with no dwell after it ended at a shut door (`planLeg`): she does not go in.
  } else if (toEnd < doorSeconds && to === intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ && intAt(state, resident, RESIDENT_INT.nextDecisionTick) > intAt(state, resident, RESIDENT_INT.arriveTick) && hasDoor(state, intAt(state, resident, RESIDENT_INT.place))) {
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
  out.speed = 0;
  out.walked = 0;
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
  if (ints[base + RESIDENT_INT.pathCount]! > 0 && tick < ints[base + RESIDENT_INT.departTick]!) {
    readLeaving(state, resident, out);
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

/** A blow one civilian lands on another in a fight, and the crowd time `findCivilianBlow` searches: fields, since a double passed to a call that is not inlined is boxed. */
export class CivilianBlow {
  striker = -1;
  victim = -1;
  /** Crowd second the swing lands. */
  landing = 0;
  /** The window searched: (fromSeconds, toSeconds]. */
  fromSeconds = 0;
  toSeconds = 0;
}

/**
 * The first fighter at or after `firstResident` whose swing lands on a civilian partner in crowd time (`out.fromSeconds`, `out.toSeconds`]: his index, with the pair in `out`; -1 when none does.
 * Only the one who started the fight swings (the lower id of the pair, as `readFight` casts them), so the victim is his partner. Pure in the rows and the times.
 */
export function findCivilianBlow(state: CityState, firstResident: number, out: CivilianBlow): number {
  const { ints } = state;
  for (let resident = firstResident; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    const partner = ints[base + RESIDENT_INT.fightPartner]!;
    if (ints[base + RESIDENT_INT.alive] === 0 || partner < 0 || partner <= resident || ints[base + RESIDENT_INT.fightTick] === NEVER_TICK || ints[base + RESIDENT_INT.legPurpose] !== PURPOSE.fight) continue;
    const landing = swingLandingIn(ints[base + RESIDENT_INT.arriveTick]! / DECISION_HZ, out.fromSeconds, out.toSeconds);
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
