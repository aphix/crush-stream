import { hypot2 } from "../../kernel/physics-core.js";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { dayOf, hourOfDay } from "./civilian-clock.ts";
import {
  AWAY_MINUTES,
  DECISION_HZ,
  DECISION_JITTER,
  DISTANCE_SCALE,
  EXIT_STOP_SHARE,
  FAVOURITE_CHANCE,
  FEAR_AVOID,
  FLAG,
  FRIDAY,
  HOURS_PER_GAME_DAY,
  JOB_AGE,
  MAX_PATH_NODES,
  NEED,
  NEED_COUNT,
  NIGHT_FEAR_WEIGHT,
  NIGHT_FROM_HOUR,
  NIGHT_TO_HOUR,
  NO_PLACE,
  PARTY_FIRST_HOUR,
  PARTY_INVITE_SHARE,
  PARTY_LAST_HOUR,
  PURPOSE,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SCHEDULE_SLACK_TICKS,
  SPECIES,
  STAY_MINUTES,
  STAY_UTILITY,
  STREAM,
  TICKS_PER_GAME_MINUTE,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { EVENT_CODE, PURPOSE_MOODS, VISIT_BASE } from "./civilian-names.ts";
import { CityState, logHistory, markDirty, measurePath, setMoodEvent } from "./civilian-state.ts";
import { nextAppointment, weekdayOf } from "./civilian-story.ts";
import { ageOf } from "./society-day.ts";
import { dwellTicksOf, evolveNeeds, needWeight } from "./needs.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function isOpen(state: CityState, place: number, tick: number): boolean {
  return state.closedUntilTick[place]! <= tick;
}

function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR;
}

function distanceBetween(state: CityState, from: number, to: number): number {
  const { placeX, placeZ } = state.index;
  return hypot2(placeX[to]! - placeX[from]!, placeZ[to]! - placeZ[from]!);
}

/** The open place of `kind` nearest to `from`, or none; ties go to the lower place id. */
function nearestOpen(state: CityState, kind: number, from: number, tick: number): number {
  const list = state.index.byKind[kind]!;
  let best = NO_PLACE;
  let bestDistance = Infinity;
  for (let at = 0; at < list.length; at++) {
    const place = list[at]!;
    if (!isOpen(state, place, tick)) continue;
    const distance = distanceBetween(state, from, place);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = place;
  }
  return best;
}

/** Metres of the shortest walk (fear ignored) from one place's door to another's, or -1 when there is none. */
function walkMetres(state: CityState, from: number, to: number): number {
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

/** Ticks a resident walks from one place's door to another's, or -1 when it cannot. */
function walkTicks(state: CityState, resident: number, from: number, to: number): number {
  const metres = walkMetres(state, from, to);
  if (metres < 0) return -1;
  return Math.max(1, Math.ceil((metres / state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!) * DECISION_HZ));
}

/** The place that would answer `need` for this resident now (a favourite, the nearest open one, or a story's), written to `state.chosenPlace` with the purpose in `state.chosenPurpose`. */
function candidateFor(state: CityState, resident: number, need: number, current: number, tick: number, hour: number, draw: () => number): void {
  state.chosenPurpose = need;
  state.chosenPlace = NO_PLACE;
  const person = intAt(state, resident, RESIDENT_INT.species) === SPECIES.person;
  const day = dayOf(tick, state.startHour);
  const adult = person && ageOf(state, resident, day) >= JOB_AGE;
  if (need === NEED.rest) state.chosenPlace = intAt(state, resident, RESIDENT_INT.home);
  else if (need === NEED.solitude) state.chosenPlace = nearestOpen(state, PLACE_KIND.hide, current, tick);
  else if (need === NEED.work) {
    const work = intAt(state, resident, RESIDENT_INT.work);
    if (adult && work !== NO_PLACE && !(intAt(state, resident, RESIDENT_INT.flags) & FLAG.laidOff) && isOpen(state, work, tick)) state.chosenPlace = work;
  } else if (need === NEED.food) state.chosenPlace = favouriteOrNearest(state, RESIDENT_INT.favouriteFood, PLACE_KIND.food, resident, current, tick, draw);
  else if (need === NEED.social) {
    const deck = state.index.placeByName.get(PLACE_NAMES.okaforDeck);
    const partyHour = hour >= PARTY_FIRST_HOUR && hour <= PARTY_LAST_HOUR;
    if (deck !== undefined && partyHour && weekdayOf(state, day) === FRIDAY && draw() < PARTY_INVITE_SHARE) {
      state.chosenPlace = deck;
      state.chosenPurpose = PURPOSE.partyGuest;
    } else state.chosenPlace = favouriteOrNearest(state, RESIDENT_INT.favouriteHangout, PLACE_KIND.hangout, resident, current, tick, draw);
  } else if (adult && state.index.exitStops.length > 0 && draw() < EXIT_STOP_SHARE) {
    state.chosenPlace = state.index.exitStops[Math.floor(draw() * state.index.exitStops.length)]!;
    state.chosenPurpose = PURPOSE.busAway;
  } else {
    const shop = favouriteOrNearest(state, RESIDENT_INT.favouriteShop, PLACE_KIND.shop, resident, current, tick, draw);
    state.chosenPlace = shop !== NO_PLACE ? shop : nearestOpen(state, PLACE_KIND.transit, current, tick);
  }
}

function favouriteOrNearest(state: CityState, field: number, kind: number, resident: number, current: number, tick: number, draw: () => number): number {
  const favourite = intAt(state, resident, field);
  if (favourite !== NO_PLACE && isOpen(state, favourite, tick) && draw() < FAVOURITE_CHANCE) return favourite;
  return nearestOpen(state, kind, current, tick);
}

/** The place and purpose with the highest utility (urgency x the hour's weight, falling with distance and with fear at the door); `state.chosenPlace` is none when nothing beats `STAY_UTILITY`. */
function chooseByUtility(state: CityState, resident: number, current: number, tick: number, hour: number, draw: () => number): void {
  const person = intAt(state, resident, RESIDENT_INT.species) === SPECIES.person;
  const shiftStart = intAt(state, resident, RESIDENT_INT.shiftStart);
  const fearWeight = isNight(hour) ? NIGHT_FEAR_WEIGHT : 1;
  let bestUtility = STAY_UTILITY;
  let bestPlace = NO_PLACE;
  let bestPurpose: number = NEED.rest;
  for (let need = 0; need < NEED_COUNT; need++) {
    const urgency = state.scratchNeeds[need]!;
    if (urgency <= 0 || (!person && need !== NEED.rest && need !== NEED.solitude)) continue;
    const weight = needWeight(need, hour, shiftStart);
    if (weight <= 0) continue;
    candidateFor(state, resident, need, current, tick, hour, draw);
    const place = state.chosenPlace;
    if (place === NO_PLACE) continue;
    const door = state.index.doorNode[place]!;
    const hours = state.index.hourWeight[place * HOURS_PER_GAME_DAY + hour]!;
    const utility = ((urgency * weight * hours) / (1 + distanceBetween(state, current, place) / DISTANCE_SCALE) / (1 + FEAR_AVOID * fearWeight * state.fear[door]!)) * (1 + (draw() * 2 - 1) * DECISION_JITTER);
    if (utility <= bestUtility) continue;
    bestUtility = utility;
    bestPlace = place;
    bestPurpose = state.chosenPurpose;
  }
  state.chosenPlace = bestPlace;
  state.chosenPurpose = bestPurpose;
}

/** The resident dwells where they are until `nextDecision`: no leg. */
function stayPut(state: CityState, resident: number, tick: number, place: number, dwellTicks: number, purpose: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  state.ints[base + RESIDENT_INT.fromPlace] = place;
  state.ints[base + RESIDENT_INT.place] = place;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = tick + Math.max(1, dwellTicks);
  state.ints[base + RESIDENT_INT.pathCount] = 0;
  state.ints[base + RESIDENT_INT.legPurpose] = purpose;
  state.ints[base + RESIDENT_INT.decisionCount]++;
  for (let need = 0; need < NEED_COUNT; need++) state.floats[floatBase + RESIDENT_FLOAT.needs + need] = state.scratchNeeds[need]!;
  markDirty(state, resident);
}

/** Plans the walk from where resident `resident` dwells to `destination` and a stay there; false (nothing written) when no walk of the allowed length exists. The needs it keeps are `state.scratchNeeds`. */
function planLeg(state: CityState, resident: number, tick: number, destination: number, purpose: number, dwellTicks: number): boolean {
  const base = resident * RESIDENT_INT_STRIDE;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  const current = state.ints[base + RESIDENT_INT.place]!;
  const hour = hourOfDay(tick, state.startHour);
  const count = state.finder.find(state.index.doorNode[current]!, state.index.doorNode[destination]!, state.fear, isNight(hour) ? NIGHT_FEAR_WEIGHT : 1, state.pathNodes, resident * MAX_PATH_NODES, MAX_PATH_NODES);
  if (count === 0) return false;
  state.ints[base + RESIDENT_INT.pathCount] = count;
  const metres = measurePath(state, resident);
  const legTicks = Math.max(1, Math.ceil((metres / state.floats[floatBase + RESIDENT_FLOAT.speed]!) * DECISION_HZ));
  state.ints[base + RESIDENT_INT.fromPlace] = current;
  state.ints[base + RESIDENT_INT.place] = destination;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick + legTicks;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = tick + legTicks + Math.max(1, dwellTicks);
  state.ints[base + RESIDENT_INT.legPurpose] = purpose;
  state.ints[base + RESIDENT_INT.decisionCount]++;
  for (let need = 0; need < NEED_COUNT; need++) state.floats[floatBase + RESIDENT_FLOAT.needs + need] = state.scratchNeeds[need]!;
  logHistory(state, resident, VISIT_BASE + purpose, destination, tick);
  if (PURPOSE_MOODS[purpose]! !== -1) setMoodEvent(state, resident, VISIT_BASE + purpose, tick);
  markDirty(state, resident);
  return true;
}

/** Sends a resident who is dwelling to `destination` now (a story's or an event's errand), with their needs worked out to `tick`; false when no walk exists. */
export function sendResidentTo(state: CityState, resident: number, tick: number, destination: number, purpose: number, dwellTicks: number): boolean {
  const base = resident * RESIDENT_INT_STRIDE;
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, state.ints[base + RESIDENT_INT.departTick]!, state.ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[state.ints[base + RESIDENT_INT.place]!]!, state.scratchNeeds);
  return planLeg(state, resident, tick, destination, purpose, dwellTicks);
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

/** Closes a spell in hospital or away on the bus: a line for the return. */
function noteReturn(state: CityState, resident: number, tick: number, current: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  if ((state.ints[base + RESIDENT_INT.flags]! & FLAG.hurt) !== 0) {
    state.ints[base + RESIDENT_INT.flags] &= ~FLAG.hurt;
    logHistory(state, resident, EVENT_CODE.backFromHospital, current, tick);
    setMoodEvent(state, resident, EVENT_CODE.backFromHospital, tick);
  } else if (state.ints[base + RESIDENT_INT.legPurpose] === PURPOSE.busAway) {
    logHistory(state, resident, EVENT_CODE.backOnBus, current, tick);
  }
}

/** Resident `resident`'s decision at the end of a dwell, at `tick`: a named resident's appointment first, else the best need by utility; a leg to the place, or a stay. */
export function decideResident(state: CityState, resident: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const current = state.ints[base + RESIDENT_INT.place]!;
  const hour = hourOfDay(tick, state.startHour);
  evolveNeeds(state.floats, resident * RESIDENT_FLOAT_STRIDE, state.ints[base + RESIDENT_INT.departTick]!, state.ints[base + RESIDENT_INT.arriveTick]!, tick, state.index.kindOf[current]!, state.scratchNeeds);
  noteReturn(state, resident, tick, current);
  const named = (state.ints[base + RESIDENT_INT.flags]! & FLAG.cast) !== 0;
  if (named && keepAppointment(state, resident, tick, current)) return;
  const draw = residentDraws(state.seed, resident, STREAM.decision, state.ints[base + RESIDENT_INT.decisionCount]!);
  chooseByUtility(state, resident, current, tick, hour, draw);
  const purpose = state.chosenPurpose;
  const walksAway = state.chosenPlace !== NO_PLACE && state.chosenPlace !== current;
  const place = walksAway && named && !walkFitsBeforeAppointment(state, resident, tick, current, state.chosenPlace) ? NO_PLACE : state.chosenPlace;
  const kind = place === NO_PLACE ? PLACE_KIND.home : state.index.kindOf[place]!;
  const dwell = purpose === PURPOSE.busAway ? Math.round((AWAY_MINUTES[0] + (AWAY_MINUTES[1] - AWAY_MINUTES[0]) * draw()) * TICKS_PER_GAME_MINUTE) : dwellTicksOf(kind, draw());
  if (place === NO_PLACE) stayPut(state, resident, tick, current, STAY_MINUTES * TICKS_PER_GAME_MINUTE, NEED.rest);
  else if (place === current || !planLeg(state, resident, tick, place, purpose, dwell)) stayPut(state, resident, tick, current, dwell, purpose);
  if (named) cutDwellForAppointment(state, resident, tick);
}
