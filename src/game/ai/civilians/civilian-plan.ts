import { hypot2 } from "../../kernel/physics-core.js";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { dayOf, hourOfDay } from "./civilian-clock.ts";
import {
  AWAY_MINUTES,
  CRIME_KIND,
  DECISION_HZ,
  DECISION_JITTER,
  DISTANCE_SCALE,
  CAR_IN_TICKS,
  CAR_OUT_TICKS,
  DRIVE_SPEED,
  EXIT_STOP_SHARE,
  FAVOURITE_CHANCE,
  FEAR_AVOID,
  FIGHT_TICKS,
  FLAG,
  FLEE_SPEED_FACTOR,
  FRIDAY,
  HOURS_PER_GAME_DAY,
  JOB_AGE,
  MAX_PATH_NODES,
  NEED,
  NEED_COUNT,
  NEVER_TICK,
  NIGHT_FEAR_WEIGHT,
  NIGHT_FROM_HOUR,
  NIGHT_TO_HOUR,
  NO_PLACE,
  PARTY_FIRST_HOUR,
  PARTY_INVITE_SHARE,
  PARK_TICKS,
  PARTY_LAST_HOUR,
  PURPOSE,
  RELEASE_REFORM_CHANCE,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SCHEDULE_SLACK_TICKS,
  SEAT_MIN_DWELL_MINUTES,
  SITTER_CHAT_REACH,
  SPECIES,
  STAY_MINUTES,
  STAY_UTILITY,
  STREAM,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { EVENT_CODE, PURPOSE_MOODS, VISIT_BASE } from "./civilian-names.ts";
import { CityState, logHistory, markDirty, measurePath, setMoodEvent, setVisitMood } from "./civilian-state.ts";
import { nextAppointment, weekdayOf } from "./civilian-story.ts";
import { ageOf } from "./society-day.ts";
import { crimeKindOf } from "./society-crime.ts";
import { dwellTicksOf, evolveNeeds, needWeight } from "./needs.ts";
import { carStandsAt, chooseCar, clearDriveLeg, planCarPath, reserveCar, walkMetres } from "./society-cars.ts";
import { clearWaits, planWaits } from "./society-crossing.ts";
import { claimSeat, claimStand, releaseSeat } from "./society-seats.ts";
import { INTERACTIONS, TARGET, considerInteractions, type InteractionRow } from "./society-table.ts";
import { isCounterVenue, isOutdoorPurpose, isSeatedVenue } from "./society-venues.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function isOpen(state: CityState, place: number, tick: number): boolean {
  return state.closedUntilTick[place]! <= tick;
}

/** Whether `place` is within its opening hours at `tick`: the reading its sign shows (`fillClosedPlaces`). */
function withinHours(state: CityState, place: number, tick: number): boolean {
  return state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hourOfDay(tick, state.startHour)]! >= 1;
}

function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR;
}

function distanceBetween(state: CityState, from: number, to: number): number {
  const { placeX, placeZ } = state.index;
  return hypot2(placeX[to]! - placeX[from]!, placeZ[to]! - placeZ[from]!);
}

/** The open place of `kind` that serves best from `from` at this hour (its opening hours' weight, falling with distance), or none; ties go to the lower place id. */
function nearestOpen(state: CityState, kind: number, from: number, tick: number, hour: number): number {
  const list = state.index.byKind[kind]!;
  let best = NO_PLACE;
  let bestScore = 0;
  for (let at = 0; at < list.length; at++) {
    const place = list[at]!;
    if (!isOpen(state, place, tick)) continue;
    const score = state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]! / (1 + distanceBetween(state, from, place) / DISTANCE_SCALE);
    if (best !== NO_PLACE && score <= bestScore) continue;
    bestScore = score;
    best = place;
  }
  return best;
}

/** Ticks a resident walks from one place's door to another's, or -1 when it cannot. */
function walkTicks(state: CityState, resident: number, from: number, to: number): number {
  const metres = walkMetres(state, from, to);
  if (metres < 0) return -1;
  return Math.max(1, Math.ceil((metres / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.pace]!) * DECISION_HZ));
}

/** The place that would answer `need` for this resident now (a favourite, the best open one for the hour, or a story's), written to `state.chosenPlace` with the purpose in `state.chosenPurpose`. */
function candidateFor(state: CityState, resident: number, need: number, current: number, tick: number, hour: number, draw: () => number): void {
  state.chosenPurpose = need;
  state.chosenPlace = NO_PLACE;
  const person = intAt(state, resident, RESIDENT_INT.species) === SPECIES.person;
  const day = dayOf(tick, state.startHour);
  const adult = person && ageOf(state, resident, day) >= JOB_AGE;
  if (need === NEED.rest) state.chosenPlace = intAt(state, resident, RESIDENT_INT.home);
  else if (need === NEED.solitude) state.chosenPlace = nearestOpen(state, PLACE_KIND.hide, current, tick, hour);
  else if (need === NEED.work) {
    const work = intAt(state, resident, RESIDENT_INT.work);
    if (adult && work !== NO_PLACE && !(intAt(state, resident, RESIDENT_INT.flags) & FLAG.laidOff) && isOpen(state, work, tick)) state.chosenPlace = work;
  } else if (need === NEED.food) state.chosenPlace = favouriteOrNearest(state, RESIDENT_INT.favouriteFood, PLACE_KIND.food, resident, current, tick, hour, draw);
  else if (need === NEED.social) {
    const deck = state.index.placeByName.get(PLACE_NAMES.okaforDeck);
    const partyHour = hour >= PARTY_FIRST_HOUR && hour <= PARTY_LAST_HOUR;
    if (deck !== undefined && partyHour && weekdayOf(state, day) === FRIDAY && draw() < PARTY_INVITE_SHARE) {
      state.chosenPlace = deck;
      state.chosenPurpose = PURPOSE.partyGuest;
    } else state.chosenPlace = favouriteOrNearest(state, RESIDENT_INT.favouriteHangout, PLACE_KIND.hangout, resident, current, tick, hour, draw);
  } else if (adult && state.index.exitStops.length > 0 && draw() < EXIT_STOP_SHARE) {
    state.chosenPlace = state.index.exitStops[Math.floor(draw() * state.index.exitStops.length)]!;
    state.chosenPurpose = PURPOSE.busAway;
  } else {
    const shop = favouriteOrNearest(state, RESIDENT_INT.favouriteShop, PLACE_KIND.shop, resident, current, tick, hour, draw);
    state.chosenPlace = shop !== NO_PLACE ? shop : nearestOpen(state, PLACE_KIND.transit, current, tick, hour);
  }
}

function favouriteOrNearest(state: CityState, field: number, kind: number, resident: number, current: number, tick: number, hour: number, draw: () => number): number {
  const favourite = intAt(state, resident, field);
  if (favourite !== NO_PLACE && isOpen(state, favourite, tick) && draw() < FAVOURITE_CHANCE) return favourite;
  return nearestOpen(state, kind, current, tick, hour);
}

/** The place and purpose with the highest utility (urgency x the hour's weight, falling with distance and with fear at the door), a need's or an interaction row's (`society-table.ts`); `state.chosenPlace` is none when nothing beats `STAY_UTILITY`. */
function chooseByUtility(state: CityState, resident: number, current: number, tick: number, hour: number, draw: () => number): void {
  const person = intAt(state, resident, RESIDENT_INT.species) === SPECIES.person;
  const shiftStart = intAt(state, resident, RESIDENT_INT.shiftStart);
  const fearWeight = isNight(hour) ? NIGHT_FEAR_WEIGHT : 1;
  let bestUtility = STAY_UTILITY;
  let bestPlace = NO_PLACE;
  let bestPurpose: number = NEED.rest;
  state.chosenRow = -1;
  state.chosenPartner = NO_PLACE;
  for (let need = 0; need < NEED_COUNT; need++) {
    const urgency = state.scratchNeeds[need]!;
    if (urgency <= 0 || (!person && need !== NEED.rest && need !== NEED.solitude)) continue;
    const weight = needWeight(need, hour, shiftStart);
    if (weight <= 0) continue;
    candidateFor(state, resident, need, current, tick, hour, draw);
    const place = state.chosenPlace;
    if (place === NO_PLACE) continue;
    const door = state.index.doorNode[place]!;
    const hours = state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]!;
    const utility = ((urgency * weight * hours) / (1 + distanceBetween(state, current, place) / DISTANCE_SCALE) / (1 + FEAR_AVOID * fearWeight * state.fear[door]!)) * (1 + (draw() * 2 - 1) * DECISION_JITTER);
    if (utility <= bestUtility) continue;
    bestUtility = utility;
    bestPlace = place;
    bestPurpose = state.chosenPurpose;
  }
  state.chosenPlace = bestPlace;
  state.chosenPurpose = bestPurpose;
  considerInteractions(state, resident, current, tick, hour, bestUtility, draw);
}

/** A customer takes a free seat at a coffee shop, bar or diner for a dwell worth sitting through, else a standing spot of their own at a counter; staff take a clerk's spot; someone sitting out takes a stoop seat. */
function takeSeat(state: CityState, resident: number, place: number, purpose: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  if (purpose === PURPOSE.stoopSit) {
    claimSeat(state, resident, place, true);
    return;
  }
  const dwellMinutes = (state.ints[base + RESIDENT_INT.nextDecisionTick]! - state.ints[base + RESIDENT_INT.arriveTick]!) / TICKS_PER_GAME_MINUTE;
  if (state.ints[base + RESIDENT_INT.species] !== SPECIES.person) return;
  if (state.ints[base + RESIDENT_INT.work] === place) {
    if (state.venues.clerkCount[place]! > 0) claimStand(state, resident, place, true);
    return;
  }
  if (dwellMinutes < SEAT_MIN_DWELL_MINUTES) return;
  const venue = state.venues.venueOf[place]!;
  if (isSeatedVenue(venue) && claimSeat(state, resident, place, false)) return;
  if (isCounterVenue(venue)) claimStand(state, resident, place, false);
}

/** The resident dwells where they are until `nextDecision`: no leg. */
function stayPut(state: CityState, resident: number, tick: number, place: number, dwellTicks: number, purpose: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  releaseSeat(state, resident);
  state.ints[base + RESIDENT_INT.fromPlace] = place;
  state.ints[base + RESIDENT_INT.place] = place;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = tick + Math.max(1, dwellTicks);
  state.ints[base + RESIDENT_INT.pathCount] = 0;
  state.ints[base + RESIDENT_INT.legPurpose] = purpose;
  state.ints[base + RESIDENT_INT.companion] = NO_PLACE;
  state.ints[base + RESIDENT_INT.decisionCount]++;
  clearDriveLeg(state, resident);
  for (let need = 0; need < NEED_COUNT; need++) state.floats[floatBase + RESIDENT_FLOAT.needs + need] = state.scratchNeeds[need]!;
  takeSeat(state, resident, place, purpose);
  markDirty(state, resident);
}

function ticksOf(seconds: number): number {
  return Math.ceil(seconds * DECISION_HZ);
}

/** Where a trip by car puts the ticks: the driver walks to the car at their own pace, gets in (a clip), drives and parks, gets out (a clip), then walks in; the leg's ticks and the car's are written here. Returns the leg's length in ticks, or -1 (nothing written) for a `customer` who would reach a place outside its hours. */
function timeCarLeg(state: CityState, resident: number, tick: number, owner: number, stand: number, destination: number, metres: number, customer: boolean): number {
  const base = resident * RESIDENT_INT_STRIDE;
  const first = resident * MAX_PATH_NODES;
  const pace = state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.pace]!;
  const toCar = state.pathDistance[first + state.ints[base + RESIDENT_INT.driveFirst]!]!;
  const toKerb = state.pathDistance[first + state.ints[base + RESIDENT_INT.driveLast]!]!;
  const leaveTick = tick + ticksOf(toCar / pace) + CAR_IN_TICKS;
  const parkTick = leaveTick + ticksOf((toKerb - toCar) / DRIVE_SPEED) + PARK_TICKS;
  const legTicks = Math.max(1, parkTick + CAR_OUT_TICKS + ticksOf((metres - toKerb) / pace) - tick);
  if (customer && !withinHours(state, destination, tick + legTicks)) return -1;
  reserveCar(state, resident, owner, stand, destination, leaveTick, parkTick);
  return legTicks;
}

/**
 * Plans the walk from where resident `resident` dwells to `destination` and a stay there, by car when one of the household's is free and within a short walk and the trip is long (`chooseCar`): the walk to the car,
 * the drive, the walk in, all one leg of the path. False when no walk of the allowed length exists (nothing written), or when a `customer` would reach a place outside its hours (the caller stays her put). The needs it keeps are `state.scratchNeeds`.
 */
function planLeg(state: CityState, resident: number, tick: number, destination: number, purpose: number, dwellTicks: number, customer = false): boolean {
  const base = resident * RESIDENT_INT_STRIDE;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  const current = state.ints[base + RESIDENT_INT.place]!;
  const hour = hourOfDay(tick, state.startHour);
  const fearWeight = isNight(hour) ? NIGHT_FEAR_WEIGHT : 1;
  const count = state.finder.find(state.index.doorNode[current]!, state.index.doorNode[destination]!, state.fear, fearWeight, state.pathNodes, resident * MAX_PATH_NODES, MAX_PATH_NODES);
  if (count === 0) return false;
  releaseSeat(state, resident);
  state.ints[base + RESIDENT_INT.pathCount] = count;
  let metres = measurePath(state, resident);
  clearDriveLeg(state, resident);
  const owner = chooseCar(state, resident, current, purpose, metres, tick);
  const stand = owner === NO_PLACE ? NO_PLACE : carStandsAt(state, owner, tick);
  const byCar = owner !== NO_PLACE && planCarPath(state, resident, current, stand, destination, fearWeight);
  if (byCar) metres = measurePath(state, resident);
  const pace = state.floats[floatBase + RESIDENT_FLOAT.pace]!;
  state.floats[floatBase + RESIDENT_FLOAT.speed] = pace * (purpose === PURPOSE.flee ? FLEE_SPEED_FACTOR : 1);
  clearWaits(state, resident);
  const legTicks = byCar ? timeCarLeg(state, resident, tick, owner, stand, destination, metres, customer) : Math.max(1, ticksOf(metres / state.floats[floatBase + RESIDENT_FLOAT.speed]!)) + planWaits(state, resident, tick);
  // A customer goes in only while the place is open: not by a walk that reaches it after it shuts.
  if (legTicks < 0 || (customer && !withinHours(state, destination, tick + legTicks))) {
    clearDriveLeg(state, resident);
    clearWaits(state, resident);
    return false;
  }
  state.ints[base + RESIDENT_INT.fromPlace] = current;
  state.ints[base + RESIDENT_INT.place] = destination;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick + legTicks;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = tick + legTicks + Math.max(1, dwellTicks);
  state.ints[base + RESIDENT_INT.legPurpose] = purpose;
  state.ints[base + RESIDENT_INT.companion] = NO_PLACE;
  state.ints[base + RESIDENT_INT.decisionCount]++;
  for (let need = 0; need < NEED_COUNT; need++) state.floats[floatBase + RESIDENT_FLOAT.needs + need] = state.scratchNeeds[need]!;
  logHistory(state, resident, VISIT_BASE + purpose, destination, tick);
  if (PURPOSE_MOODS[purpose]! !== -1) setVisitMood(state, resident, VISIT_BASE + purpose, tick);
  takeSeat(state, resident, destination, purpose);
  markDirty(state, resident);
  return true;
}

/** Sends a resident who is dwelling to `destination` now (a story's or an event's errand), with their needs worked out to `tick`; false when no walk exists. */
export function sendResidentTo(state: CityState, resident: number, tick: number, destination: number, purpose: number, dwellTicks: number): boolean {
  const base = resident * RESIDENT_INT_STRIDE;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, state.ints[base + RESIDENT_INT.departTick]!, state.ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[state.ints[base + RESIDENT_INT.place]!]!, state.scratchNeeds);
  return planLeg(state, resident, tick, destination, purpose, dwellTicks);
}

/** A resident is made to dwell at `place` (where they are, by default) for `purpose` until `dwellTicks` have gone, with their needs worked out to `tick`. */
export function standOutside(state: CityState, resident: number, tick: number, purpose: number, dwellTicks: number, place = state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.place]!): void {
  const base = resident * RESIDENT_INT_STRIDE;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, state.ints[base + RESIDENT_INT.departTick]!, state.ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[state.ints[base + RESIDENT_INT.place]!]!, state.scratchNeeds);
  stayPut(state, resident, tick, place, dwellTicks, purpose);
}

/** A named resident's appointment that is due: leaves in time to be there at the appointed tick. */
function keepAppointment(state: CityState, resident: number, tick: number, current: number): boolean {
  const slot = state.appointment;
  if (!nextAppointment(state, resident, Math.max(intAt(state, resident, RESIDENT_INT.storyTick), tick), slot)) return false;
  const walk = slot.place === current ? 0 : walkTicks(state, resident, current, slot.place);
  if (walk < 0 || !isOpen(state, slot.place, tick) || tick < slot.arriveTick - walk - SCHEDULE_SLACK_TICKS) return false;
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.storyTick] = slot.arriveTick;
  if (slot.place === current) stayPut(state, resident, tick, current, slot.arriveTick + slot.dwellTicks - tick, slot.purpose);
  else if (!planLeg(state, resident, tick, slot.place, slot.purpose, slot.dwellTicks)) return false;
  return true;
}

/** A named resident's walk is worth taking only if they get there in time to leave again for their next appointment. */
function walkFitsBeforeAppointment(state: CityState, resident: number, tick: number, current: number, destination: number): boolean {
  const slot = state.appointment;
  if (!nextAppointment(state, resident, Math.max(intAt(state, resident, RESIDENT_INT.storyTick), tick), slot)) return true;
  const there = walkTicks(state, resident, current, destination);
  const onward = slot.place === destination ? 0 : walkTicks(state, resident, destination, slot.place);
  return there < 0 || onward < 0 || tick + there <= slot.arriveTick - onward - SCHEDULE_SLACK_TICKS;
}

/** A named resident does not sleep through their next appointment: the dwell just planned is cut to end in time to walk there. */
function cutDwellForAppointment(state: CityState, resident: number, tick: number): void {
  const slot = state.appointment;
  const base = resident * RESIDENT_INT_STRIDE;
  if (!nextAppointment(state, resident, Math.max(state.ints[base + RESIDENT_INT.storyTick]!, tick), slot)) return;
  const place = state.ints[base + RESIDENT_INT.place]!;
  const walk = slot.place === place ? 0 : walkTicks(state, resident, place, slot.place);
  if (walk < 0) return;
  const leaveBy = slot.arriveTick - walk - SCHEDULE_SLACK_TICKS;
  if (leaveBy >= state.ints[base + RESIDENT_INT.nextDecisionTick]!) return;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = Math.max(state.ints[base + RESIDENT_INT.arriveTick]!, leaveBy, tick + 1);
}

/** Closes a spell in hospital, in custody or away on the bus: a line for the return (and, from custody, a chance of giving crime up). */
function noteReturn(state: CityState, resident: number, tick: number, current: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  if ((state.ints[base + RESIDENT_INT.flags]! & FLAG.hurt) !== 0) {
    state.ints[base + RESIDENT_INT.flags] &= ~FLAG.hurt;
    logHistory(state, resident, EVENT_CODE.backFromHospital, current, tick);
    setMoodEvent(state, resident, EVENT_CODE.backFromHospital, tick);
  } else if ((state.ints[base + RESIDENT_INT.flags]! & FLAG.custody) !== 0) {
    state.ints[base + RESIDENT_INT.flags] &= ~FLAG.custody;
    if (residentDraws(state.seed, resident, STREAM.crime, tick)() < RELEASE_REFORM_CHANCE) state.ints[base + RESIDENT_INT.flags] &= ~FLAG.criminal;
    logHistory(state, resident, EVENT_CODE.released, current, tick);
    setMoodEvent(state, resident, EVENT_CODE.released, tick);
  } else if (state.ints[base + RESIDENT_INT.legPurpose] === PURPOSE.busAway) {
    logHistory(state, resident, EVENT_CODE.backOnBus, current, tick);
  }
}

/** A fight is over once its ticks have run. */
function endFight(state: CityState, resident: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  if (state.ints[base + RESIDENT_INT.fightTick] === NEVER_TICK || tick < state.ints[base + RESIDENT_INT.fightTick]! + FIGHT_TICKS) return;
  state.ints[base + RESIDENT_INT.fightTick] = NEVER_TICK;
  state.ints[base + RESIDENT_INT.fightPartner] = NO_PLACE;
}

/** A neighbour dwelling at home comes out to talk or argue at the door from when the visitor gets there until the visitor leaves. */
function pullOut(state: CityState, neighbour: number, tick: number, purpose: number, visitor: number): void {
  standOutside(state, neighbour, tick, purpose, 1);
  const visiting = visitor * RESIDENT_INT_STRIDE;
  const at = neighbour * RESIDENT_INT_STRIDE;
  state.ints[at + RESIDENT_INT.arriveTick] = state.ints[visiting + RESIDENT_INT.arriveTick]!;
  state.ints[at + RESIDENT_INT.nextDecisionTick] = state.ints[visiting + RESIDENT_INT.nextDecisionTick]!;
  state.ints[at + RESIDENT_INT.companion] = visitor;
}

/** Someone out on their stoop within chatting distance who is on their own: the two talk. */
function linkNearbySitter(state: CityState, resident: number, tick: number): void {
  const home = intAt(state, resident, RESIDENT_INT.place);
  for (let other = 0; other < state.capacity; other++) {
    const base = other * RESIDENT_INT_STRIDE;
    if (other === resident || state.ints[base + RESIDENT_INT.legPurpose] !== PURPOSE.stoopSit || state.ints[base + RESIDENT_INT.companion] !== NO_PLACE) continue;
    if (state.ints[base + RESIDENT_INT.alive] === 0 || state.ints[base + RESIDENT_INT.arriveTick]! > tick || state.ints[base + RESIDENT_INT.nextDecisionTick]! <= tick) continue;
    if (distanceBetween(state, home, state.ints[base + RESIDENT_INT.place]!) > SITTER_CHAT_REACH) continue;
    state.ints[base + RESIDENT_INT.companion] = resident;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.companion] = other;
    markDirty(state, other);
    return;
  }
}

/** What a chosen row does beyond the resident's own row: brings its neighbour out, joins a neighbour sitting out, or names the victim of a crime attempt. */
function afterInteraction(state: CityState, resident: number, tick: number, row: InteractionRow): void {
  const partner = state.chosenPartner;
  if (row.target === TARGET.neighbour && partner !== NO_PLACE) {
    pullOut(state, partner, tick, row.purpose, resident);
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.companion] = partner;
  } else if (row.purpose === PURPOSE.stoopSit) linkNearbySitter(state, resident, tick);
  else if (crimeKindOf(row.purpose) !== CRIME_KIND.none) state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.crimeVictim] = partner;
}

/** A resident let out of custody away from home (the police station) goes home, whatever they would have chosen. */
function goHomeFromCustody(state: CityState, resident: number, current: number): void {
  if (current === intAt(state, resident, RESIDENT_INT.home)) return;
  state.chosenPlace = intAt(state, resident, RESIDENT_INT.home);
  state.chosenPurpose = NEED.rest;
  state.chosenRow = -1;
}

/** Resident `resident`'s decision at the end of a dwell, at `tick`: a named resident's appointment first, else the best need or table row by utility; a leg to the place, or a stay. */
export function decideResident(state: CityState, resident: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const current = state.ints[base + RESIDENT_INT.place]!;
  const hour = hourOfDay(tick, state.startHour);
  const letOut = (state.ints[base + RESIDENT_INT.flags]! & FLAG.custody) !== 0;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, state.ints[base + RESIDENT_INT.departTick]!, state.ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[current]!, state.scratchNeeds);
  noteReturn(state, resident, tick, current);
  endFight(state, resident, tick);
  const named = (state.ints[base + RESIDENT_INT.flags]! & FLAG.cast) !== 0;
  if (named && keepAppointment(state, resident, tick, current)) return;
  const draw = residentDraws(state.seed, resident, STREAM.decision, state.ints[base + RESIDENT_INT.decisionCount]!);
  chooseByUtility(state, resident, current, tick, hour, draw);
  if (letOut) goHomeFromCustody(state, resident, current);
  const purpose = state.chosenPurpose;
  const row = state.chosenRow >= 0 ? INTERACTIONS[state.chosenRow]! : null;
  const walksAway = state.chosenPlace !== NO_PLACE && state.chosenPlace !== current;
  const place = walksAway && named && !walkFitsBeforeAppointment(state, resident, tick, current, state.chosenPlace) ? NO_PLACE : state.chosenPlace;
  const kind = place === NO_PLACE ? PLACE_KIND.home : state.index.kindOf[place]!;
  let dwell: number;
  if (purpose === PURPOSE.busAway) dwell = Math.round((AWAY_MINUTES[0] + (AWAY_MINUTES[1] - AWAY_MINUTES[0]) * draw()) * TICKS_PER_GAME_MINUTE);
  else if (row !== null) dwell = Math.round((row.dwell[0] + (row.dwell[1] - row.dwell[0]) * draw()) * TICKS_PER_GAME_MINUTE);
  else dwell = dwellTicksOf(kind, draw());
  const customer = purpose !== NEED.work && !isOutdoorPurpose(purpose);
  const home = state.ints[base + RESIDENT_INT.home]!;
  // Outside a place's hours (its sign shows it shut) a customer is not kept inside it: with nowhere else to go she goes home.
  const shutIn = current !== state.ints[base + RESIDENT_INT.work] && home !== NO_PLACE && home !== current && !withinHours(state, current, tick);
  if (place !== NO_PLACE && place !== current && planLeg(state, resident, tick, place, purpose, dwell, customer)) {
    if (row !== null) afterInteraction(state, resident, tick, row);
  } else if (!(shutIn && (place !== current || customer) && planLeg(state, resident, tick, home, NEED.rest, dwellTicksOf(PLACE_KIND.home, draw())))) {
    if (place === NO_PLACE) stayPut(state, resident, tick, current, STAY_MINUTES * TICKS_PER_GAME_MINUTE, NEED.rest);
    else if (place !== current) stayPut(state, resident, tick, current, dwell, row === null ? purpose : NEED.rest);
    else {
      stayPut(state, resident, tick, current, dwell, purpose);
      if (row !== null) afterInteraction(state, resident, tick, row);
    }
  }
  if (named) cutDwellForAppointment(state, resident, tick);
}
