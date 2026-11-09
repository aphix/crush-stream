import { hypot2 } from "../../kernel/physics-core.js";
import { tickAt } from "./civilian-clock.ts";
import {
  CENTIMETRES_PER_METRE,
  CRIME_COOLDOWN_TICKS,
  CRIME_FEAR,
  CRIME_KIND,
  FEAR_RADIUS,
  FIGHT_ANGRY_FACTOR,
  FIGHT_CHANCE,
  FIGHT_FEAR,
  FIGHT_TICKS,
  FIGHT_WANTED_TICKS,
  FLAG,
  FLEE_INSIDE_MINUTES,
  JAIL_TICKS,
  NEED,
  NEED_COUNT,
  NEVER_TICK,
  NO_PLACE,
  PURPOSE,
  REPORT_MINUTES,
  REPORT_SHARE,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
  STREAM,
  TICKS_PER_GAME_MINUTE,
  WANTED_TICKS,
  WITNESS_RADIUS,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { legPose } from "./civilian-leg.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { sendResidentTo, standOutside } from "./civilian-plan.ts";
import { markDirty, residentName, type CityState } from "./civilian-state.ts";
import { crimeKindOf, isAngry } from "./society-crime.ts";
import { evolveNeeds } from "./needs.ts";
import { noteEvent } from "./society-day.ts";
import { releaseSeat } from "./society-seats.ts";
import { isOutdoorPurpose } from "./society-venues.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

/** The place with a door nearest to (x, z), or none. */
export function nearestPlaceTo(state: CityState, x: number, z: number, except: number): number {
  const { placeX, placeZ, doorNode } = state.index;
  let best = NO_PLACE;
  let bestDistance = Infinity;
  for (let place = 0; place < state.index.placeCount; place++) {
    if (doorNode[place]! < 0 || place === except) continue;
    const distance = hypot2(placeX[place]! - x, placeZ[place]! - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = place;
  }
  return best;
}

/** Fear of the corners within `FEAR_RADIUS` of (x, z), falling off linearly to the edge. */
export function raiseFear(state: CityState, x: number, z: number, amount: number): void {
  const { nodeX, nodeZ } = state.map.graph;
  for (let node = 0; node < state.fear.length; node++) {
    const distance = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
    if (distance >= FEAR_RADIUS) continue;
    state.fear[node] = Math.min(1, state.fear[node]! + amount * (1 - distance / FEAR_RADIUS));
    state.fearDirty = true;
  }
}

function isDwelling(state: CityState, resident: number, tick: number): boolean {
  return intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.arriveTick) <= tick && tick < intAt(state, resident, RESIDENT_INT.nextDecisionTick);
}

/** Someone who lives the street's life and can be drawn into events: a living, unhurt, free person with no story of their own. */
function isFreePerson(state: CityState, resident: number): boolean {
  return intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person && (intAt(state, resident, RESIDENT_INT.flags) & (FLAG.hurt | FLAG.custody | FLAG.cast)) === 0;
}

/** Runs home (or just goes in, if already there) and stays in for a while. */
function fleeHome(state: CityState, resident: number, tick: number): void {
  const home = intAt(state, resident, RESIDENT_INT.home);
  const stayIn = FLEE_INSIDE_MINUTES * TICKS_PER_GAME_MINUTE;
  if (intAt(state, resident, RESIDENT_INT.place) === home) standOutside(state, resident, tick, NEED.rest, stayIn);
  else sendResidentTo(state, resident, tick, home, PURPOSE.flee, stayIn);
}

/** Everyone standing at a door within `WITNESS_RADIUS` of a crime or fight at `place` sees it: most report it, the rest run home. */
function witnessAll(state: CityState, place: number, tick: number, partyA: number, partyB: number): void {
  const { placeX, placeZ } = state.index;
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === partyA || resident === partyB || !isFreePerson(state, resident) || !isDwelling(state, resident, tick)) continue;
    if (!isOutdoorPurpose(intAt(state, resident, RESIDENT_INT.legPurpose)) || intAt(state, resident, RESIDENT_INT.fightTick) !== NEVER_TICK) continue;
    const at = intAt(state, resident, RESIDENT_INT.place);
    if (hypot2(placeX[at]! - placeX[place]!, placeZ[at]! - placeZ[place]!) > WITNESS_RADIUS) continue;
    if (residentDraws(state.seed, resident, STREAM.crime, tick)() < REPORT_SHARE) {
      standOutside(state, resident, tick, PURPOSE.report, REPORT_MINUTES * TICKS_PER_GAME_MINUTE);
      noteEvent(state, resident, EVENT_CODE.reportedCrime, place, tick);
    } else {
      fleeHome(state, resident, tick);
      noteEvent(state, resident, EVENT_CODE.fledDanger, place, tick);
    }
  }
}

/** The criminal at the crime place, when the host's crime event lands: wanted for a game day from the tick it happened (so a peer that hears late writes the same row), a line in their log. Nothing happens unless they are there with a crime purpose and no crime open. */
export function applyCrime(state: CityState, criminal: number, seconds: number, tick: number): void {
  const base = criminal * RESIDENT_INT_STRIDE;
  const { ints } = state;
  const kind = crimeKindOf(ints[base + RESIDENT_INT.legPurpose]!);
  if (ints[base + RESIDENT_INT.alive] === 0 || kind === CRIME_KIND.none || ints[base + RESIDENT_INT.crimeTick] !== NEVER_TICK) return;
  if ((ints[base + RESIDENT_INT.flags]! & (FLAG.wanted | FLAG.custody | FLAG.hurt)) !== 0 || !isDwelling(state, criminal, tick)) return;
  const place = ints[base + RESIDENT_INT.place]!;
  const happened = tickAt(seconds);
  ints[base + RESIDENT_INT.crimeTick] = happened;
  ints[base + RESIDENT_INT.crimeKind] = kind;
  ints[base + RESIDENT_INT.crimePlace] = place;
  ints[base + RESIDENT_INT.flags] |= FLAG.wanted;
  ints[base + RESIDENT_INT.wantedUntilTick] = happened + WANTED_TICKS;
  ints[base + RESIDENT_INT.crimeNotBefore] = happened + CRIME_COOLDOWN_TICKS;
  const victim = ints[base + RESIDENT_INT.crimeVictim]!;
  if (kind === CRIME_KIND.theft) noteEvent(state, criminal, EVENT_CODE.shoplifted, place, happened);
  else if (kind === CRIME_KIND.breakIn) noteEvent(state, criminal, EVENT_CODE.brokeIntoCar, place, happened);
  else noteEvent(state, criminal, EVENT_CODE.muggedSomeone, victim >= 0 ? residentName(state, victim) : NO_PLACE, happened);
}

/** Everyone else's side of a crime, `EVENT_LEAD_TICKS` after it: the corner is feared, the shop's staff, the car's owner or the mugged are angry or afraid, and witnesses react. */
export function reactToCrime(state: CityState, criminal: number, tick: number): void {
  const base = criminal * RESIDENT_INT_STRIDE;
  const kind = state.ints[base + RESIDENT_INT.crimeKind]!;
  if (state.ints[base + RESIDENT_INT.crimeTick] === NEVER_TICK) return;
  const place = state.ints[base + RESIDENT_INT.crimePlace]!;
  const victim = state.ints[base + RESIDENT_INT.crimeVictim]!;
  const { nodeX, nodeZ } = state.map.graph;
  const door = state.index.doorNode[place]!;
  raiseFear(state, nodeX[door]!, nodeZ[door]!, CRIME_FEAR);
  if (kind === CRIME_KIND.theft) {
    for (let resident = 0; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.work) === place && resident !== criminal) noteEvent(state, resident, EVENT_CODE.shopRobbed, place, tick);
  } else if (victim >= 0 && intAt(state, victim, RESIDENT_INT.alive) === 1) {
    if (kind === CRIME_KIND.breakIn) noteEvent(state, victim, EVENT_CODE.carBrokenInto, place, tick);
    else {
      noteEvent(state, victim, EVENT_CODE.wasMugged, place, tick);
      if (isFreePerson(state, victim)) fleeHome(state, victim, tick);
    }
  }
  witnessAll(state, place, tick, criminal, victim);
}

/** Puts a fighter at the door nearest the spot for `FIGHT_TICKS`, the other fighter (or -1: a player) noted; two civilians at each other are wanted for assault. */
function enterFight(state: CityState, resident: number, other: number, anchor: number, spotX: number, spotZ: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  standOutside(state, resident, tick, PURPOSE.fight, FIGHT_TICKS, anchor);
  state.ints[base + RESIDENT_INT.fightTick] = tick;
  state.ints[base + RESIDENT_INT.fightPartner] = other;
  state.ints[base + RESIDENT_INT.fightX] = Math.round(spotX * CENTIMETRES_PER_METRE);
  state.ints[base + RESIDENT_INT.fightZ] = Math.round(spotZ * CENTIMETRES_PER_METRE);
  if (other >= 0) {
    state.ints[base + RESIDENT_INT.flags] |= FLAG.wanted;
    state.ints[base + RESIDENT_INT.wantedUntilTick] = tick + FIGHT_WANTED_TICKS;
  }
  if (other >= 0) noteEvent(state, resident, EVENT_CODE.fought, residentName(state, other), tick);
  else noteEvent(state, resident, EVENT_CODE.foughtStranger, anchor, tick);
}

/** Where a resident is at crowd time `seconds`: on their leg, else at their place's door. */
function spotOf(state: CityState, resident: number, seconds: number): { x: number; z: number } {
  if (legPose(state, resident, seconds, state.pose)) return { x: state.pose.x, z: state.pose.z };
  const place = state.map.places[intAt(state, resident, RESIDENT_INT.place)]!;
  return { x: place.doorX, z: place.doorZ };
}

/** A fight between `victim` and `other` (-1: a player) where the victim stood at `seconds`: both stop for it, snapped to the nearest door; people at doors about see it. */
export function startFight(state: CityState, victim: number, other: number, seconds: number, tick: number): void {
  if (!isFreePerson(state, victim) || intAt(state, victim, RESIDENT_INT.fightTick) !== NEVER_TICK) return;
  const spot = spotOf(state, victim, seconds);
  const anchor = nearestPlaceTo(state, spot.x, spot.z, NO_PLACE);
  if (anchor === NO_PLACE) return;
  const second = other >= 0 && isFreePerson(state, other) && intAt(state, other, RESIDENT_INT.fightTick) === NEVER_TICK ? other : -1;
  enterFight(state, victim, second, anchor, spot.x, spot.z, tick);
  if (second >= 0) enterFight(state, second, victim, anchor, spot.x, spot.z, tick);
  raiseFear(state, spot.x, spot.z, FIGHT_FEAR);
  witnessAll(state, anchor, tick, victim, second);
}

/** A push: the seeded chance that it becomes a fight, small, and several times larger when either is angry. */
export function applyPush(state: CityState, subject: number, seconds: number, tick: number): void {
  const victim = subject % state.capacity;
  const other = Math.floor(subject / state.capacity) - 1;
  const angry = isAngry(state, victim, tick) || (other >= 0 && isAngry(state, other, tick));
  if (residentDraws(state.seed, victim, STREAM.fight, tickAt(seconds))() >= FIGHT_CHANCE * (angry ? FIGHT_ANGRY_FACTOR : 1)) return;
  startFight(state, victim, other, seconds, tick);
}

/** A civilian run down in front of someone standing at a door: the seeded chance that they take on the driver. */
export function applyKnockWitness(state: CityState, knocked: number, seconds: number, tick: number): void {
  if ((intAt(state, knocked, RESIDENT_INT.flags) & FLAG.hurt) === 0) return;
  const spotX = intAt(state, knocked, RESIDENT_INT.knockX) / CENTIMETRES_PER_METRE;
  const spotZ = intAt(state, knocked, RESIDENT_INT.knockZ) / CENTIMETRES_PER_METRE;
  const { placeX, placeZ } = state.index;
  let witness = -1;
  let nearest = WITNESS_RADIUS;
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === knocked || !isFreePerson(state, resident) || !isDwelling(state, resident, tick) || !isOutdoorPurpose(intAt(state, resident, RESIDENT_INT.legPurpose))) continue;
    const at = intAt(state, resident, RESIDENT_INT.place);
    const distance = hypot2(placeX[at]! - spotX, placeZ[at]! - spotZ);
    if (distance >= nearest) continue;
    nearest = distance;
    witness = resident;
  }
  if (witness < 0) return;
  const chance = FIGHT_CHANCE * (isAngry(state, witness, tick) ? FIGHT_ANGRY_FACTOR : 1);
  if (residentDraws(state.seed, witness, STREAM.fight, tickAt(seconds))() < chance) startFight(state, witness, -1, seconds, tick);
}

/** A bust: the wanted (or fighting) resident is taken off the street for `JAIL_TICKS`, then home; crime and fight state clear. Anyone else is left alone and un-hidden. */
export function applyBust(state: CityState, resident: number, seconds: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  const arrestable = (ints[base + RESIDENT_INT.flags]! & FLAG.wanted) !== 0 || ints[base + RESIDENT_INT.fightTick] !== NEVER_TICK;
  if (ints[base + RESIDENT_INT.alive] === 0 || !arrestable || (ints[base + RESIDENT_INT.flags]! & FLAG.custody) !== 0) {
    state.hiddenFromTick[resident] = NEVER_TICK;
    state.hiddenUntilTick[resident] = NEVER_TICK;
    return;
  }
  const struck = tickAt(seconds);
  const home = ints[base + RESIDENT_INT.home]!;
  const was = ints[base + RESIDENT_INT.place]!;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, ints[base + RESIDENT_INT.departTick]!, ints[base + RESIDENT_INT.arriveTick]!, struck, state.index.kindOf[was]!, state.scratchNeeds);
  releaseSeat(state, resident);
  ints[base + RESIDENT_INT.fromPlace] = home;
  ints[base + RESIDENT_INT.place] = home;
  ints[base + RESIDENT_INT.departTick] = struck;
  ints[base + RESIDENT_INT.arriveTick] = struck;
  ints[base + RESIDENT_INT.pathCount] = 0;
  ints[base + RESIDENT_INT.legPurpose] = NEED.rest;
  ints[base + RESIDENT_INT.legReason] = NEED.rest;
  ints[base + RESIDENT_INT.companion] = NO_PLACE;
  ints[base + RESIDENT_INT.nextDecisionTick] = struck + JAIL_TICKS;
  ints[base + RESIDENT_INT.flags] = (ints[base + RESIDENT_INT.flags]! | FLAG.custody) & ~FLAG.wanted;
  ints[base + RESIDENT_INT.wantedUntilTick] = 0;
  ints[base + RESIDENT_INT.crimeTick] = NEVER_TICK;
  ints[base + RESIDENT_INT.crimeKind] = CRIME_KIND.none;
  ints[base + RESIDENT_INT.crimePlace] = NO_PLACE;
  ints[base + RESIDENT_INT.crimeVictim] = NO_PLACE;
  ints[base + RESIDENT_INT.fightTick] = NEVER_TICK;
  for (let need = 0; need < NEED_COUNT; need++) state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.needs + need] = state.scratchNeeds[need]!;
  noteEvent(state, resident, EVENT_CODE.arrested, was, struck);
}

/** The partner of a busted fighter is let go of the fight (their dwell runs out as it was). */
export function releaseFightPartner(state: CityState, busted: number): void {
  for (let resident = 0; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.fightPartner) !== busted || intAt(state, resident, RESIDENT_INT.fightTick) === NEVER_TICK) continue;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.fightTick] = NEVER_TICK;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.fightPartner] = NO_PLACE;
    markDirty(state, resident);
  }
}

/** At an hour tick: wanted spells that have run out end, and the open crime with them. */
export function expireWanted(state: CityState, tick: number): void {
  for (let resident = 0; resident < state.capacity; resident++) {
    const base = resident * RESIDENT_INT_STRIDE;
    if ((state.ints[base + RESIDENT_INT.flags]! & FLAG.wanted) === 0 || tick < state.ints[base + RESIDENT_INT.wantedUntilTick]!) continue;
    state.ints[base + RESIDENT_INT.flags] &= ~FLAG.wanted;
    state.ints[base + RESIDENT_INT.crimeTick] = NEVER_TICK;
    state.ints[base + RESIDENT_INT.crimeKind] = CRIME_KIND.none;
    state.ints[base + RESIDENT_INT.crimePlace] = NO_PLACE;
    state.ints[base + RESIDENT_INT.crimeVictim] = NO_PLACE;
    markDirty(state, resident);
  }
}
