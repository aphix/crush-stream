import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { hourOfDay, tickAt } from "./civilian-clock.ts";
import {
  CENTIMETRES_PER_METRE,
  CLOSED_DAYS,
  EVENT_KIND,
  EVENT_LEAD_TICKS,
  EVENT_TRIPLE,
  FLAG,
  HOSPITAL_NEEDS,
  HOSPITAL_TICKS,
  JAIL_TICKS,
  JAYWALK_CUSTODY_TICKS,
  KNOCK_FEAR,
  ATTENTION_CRASH,
  LOOK_ON_CRASH_MINUTES,
  MECHANIC_LOOK_MINUTES,
  MECHANIC_REACH,
  NEED,
  NEED_COUNT,
  NO_BEARING,
  NO_PLACE,
  PURPOSE,
  RADIO_BLOCKS,
  RADIO_HOUR,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  SPECIES,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  TICKS_PER_GAME_MINUTE,
  WRECK_FEAR,
} from "./civilian-constants.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { legPose } from "./civilian-leg.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { CityState, logHistory, markDirty, residentName, setClosedUntil, setMoodEvent } from "./civilian-state.ts";
import { applyBust, applyCrime, applyJaywalk, applyKnockWitness, applyPush, nearestPlaceTo, raiseFear, reactToCrime, releaseFightPartner, startFight } from "./society-reactions.ts";
import { WALKER_BEARING_STEPS } from "./civilian-crowd-constants.ts";
import { sendResidentTo } from "./civilian-plan.ts";
import { alarmAt, alarmAtKnock, callAmbulanceFor } from "./society-alarm.ts";
import { dropCarLeg } from "./society-cars.ts";
import { noteEvent } from "./society-day.ts";

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function nextHourTick(tick: number): number {
  return Math.ceil(tick / TICKS_PER_GAME_HOUR) * TICKS_PER_GAME_HOUR;
}

/**
 * Takes the host's events (kind, subject, crowd seconds; see `EVENT_KIND`), posted with tick `postTick`, into the queue. A civilian run down or busted changes at their own tick; everyone drawn into an event
 * (witnesses, a fight's two, a crime's victims) changes `EVENT_LEAD_TICKS` after it, and the society at the first hour tick after that: none before the post, so no peer rewinds. A civilian is off the street from the tick of
 * a knock, bust or jaywalk arrest, at once (never let back early: the worker and an inline step must hide the same). Subjects out of range are dropped.
 */
export function queueEvents(state: CityState, postTick: number, events: ArrayLike<number>): void {
  for (let at = 0; at + EVENT_TRIPLE <= events.length; at += EVENT_TRIPLE) {
    const kind = events[at]!;
    const seconds = events[at + 2]!;
    let subject = events[at + 1]!;
    let bearing = NO_BEARING;
    let byCar = false;
    if (kind === EVENT_KIND.push || kind === EVENT_KIND.fight) {
      const next = at + EVENT_TRIPLE;
      const party = next + EVENT_TRIPLE <= events.length && events[next + 2] === seconds ? events[next]! : -1;
      const named = events[next + 1]!;
      if ((party === EVENT_KIND.walker || party === EVENT_KIND.car) && Number.isInteger(named) && named >= 0 && named < WALKER_BEARING_STEPS) bearing = named;
      byCar = party === EVENT_KIND.car;
      if (party === EVENT_KIND.alongside || party === EVENT_KIND.walker || party === EVENT_KIND.car) at += EVENT_TRIPLE;
      if (!subjectInRange(state, EVENT_KIND.knock, subject)) continue;
      if (party === EVENT_KIND.alongside && subjectInRange(state, EVENT_KIND.knock, named)) subject += state.capacity * (named + 1);
    }
    if (!subjectInRange(state, kind, subject)) continue;
    const happened = tickAt(seconds);
    const reactionTick = Math.max(happened + EVENT_LEAD_TICKS, postTick);
    state.events.push({ kind, subject, seconds, bearing, byCar, individualTick: Math.max(happened, postTick), reactionTick, societyTick: nextHourTick(reactionTick), individualDone: false, reactionDone: false });
    const hiddenTicks = kind === EVENT_KIND.knock ? HOSPITAL_TICKS : kind === EVENT_KIND.bust ? JAIL_TICKS : kind === EVENT_KIND.jaywalk ? JAYWALK_CUSTODY_TICKS : 0;
    if (hiddenTicks === 0) continue;
    state.hiddenFromTick[subject] = happened;
    state.hiddenUntilTick[subject] = happened + hiddenTicks;
  }
}

/** A knock's, crime's, bust's, jaywalk arrest's or ambulance call's subject is a resident, a wreck's a place with a door, a danger's a walk-graph node, a push's or fight's a packed pair of residents (victim + capacity * (other + 1), other -1: a player); another kind (a lone `alongside`, `walker` or `car` too) is dropped. */
function subjectInRange(state: CityState, kind: number, subject: number): boolean {
  if (!Number.isInteger(subject) || subject < 0) return false;
  if (kind === EVENT_KIND.wreck) return subject < state.index.placeCount && state.index.doorNode[subject]! >= 0;
  if (kind === EVENT_KIND.danger) return subject < state.index.nodeCount;
  if (kind === EVENT_KIND.push || kind === EVENT_KIND.fight) return subject < state.capacity * (state.capacity + 1);
  return (kind === EVENT_KIND.knock || kind === EVENT_KIND.crime || kind === EVENT_KIND.bust || kind === EVENT_KIND.jaywalk || kind === EVENT_KIND.ambulance) && subject < state.capacity;
}

/** The knocked civilian is out of the neighbourhood's streets and in hospital until `HOSPITAL_TICKS` after the knock, then home: their row says so, whatever they were doing. */
function knockResident(state: CityState, resident: number, seconds: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  const { ints } = state;
  if (ints[base + RESIDENT_INT.alive] === 0 || (ints[base + RESIDENT_INT.flags]! & FLAG.hurt) !== 0) return;
  const struck = tickAt(seconds);
  const onLeg = legPose(state, resident, seconds, state.pose);
  dropCarLeg(state, resident, struck);
  const spotX = onLeg ? state.pose.x : state.index.placeX[ints[base + RESIDENT_INT.place]!]!;
  const spotZ = onLeg ? state.pose.z : state.index.placeZ[ints[base + RESIDENT_INT.place]!]!;
  const home = ints[base + RESIDENT_INT.home]!;
  ints[base + RESIDENT_INT.knockX] = Math.round(spotX * CENTIMETRES_PER_METRE);
  ints[base + RESIDENT_INT.knockZ] = Math.round(spotZ * CENTIMETRES_PER_METRE);
  ints[base + RESIDENT_INT.knockTick] = struck;
  ints[base + RESIDENT_INT.flags] |= FLAG.hurt;
  ints[base + RESIDENT_INT.fromPlace] = home;
  ints[base + RESIDENT_INT.place] = home;
  ints[base + RESIDENT_INT.departTick] = struck;
  ints[base + RESIDENT_INT.arriveTick] = struck;
  ints[base + RESIDENT_INT.pathCount] = 0;
  ints[base + RESIDENT_INT.legPurpose] = NEED.rest;
  ints[base + RESIDENT_INT.nextDecisionTick] = Math.max(struck + HOSPITAL_TICKS, tick + 1);
  for (let need = 0; need < NEED_COUNT; need++) state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.needs + need] = HOSPITAL_NEEDS[need]!;
  logHistory(state, resident, EVENT_CODE.knocked, nearestPlaceTo(state, spotX, spotZ, NO_PLACE), struck);
  setMoodEvent(state, resident, EVENT_CODE.knocked, struck);
  markDirty(state, resident);
}

/** A crash near the garage gets the mechanic out to look: from the garage, to the wreck (or the next door over when the garage itself was hit). */
function sendMechanicOut(state: CityState, wreckPlace: number, tick: number): void {
  const garage = state.index.placeByName.get(PLACE_NAMES.garage);
  if (garage === undefined) return;
  const { placeX, placeZ } = state.index;
  if (hypot2(placeX[wreckPlace]! - placeX[garage]!, placeZ[wreckPlace]! - placeZ[garage]!) > MECHANIC_REACH) return;
  for (let resident = 0; resident < state.cast.length; resident++) {
    if (state.cast[resident]!.member.trait !== "mechanic") continue;
    const base = resident * RESIDENT_INT_STRIDE;
    const dwellingAtGarage = state.ints[base + RESIDENT_INT.alive] === 1 && state.ints[base + RESIDENT_INT.place] === garage && tick >= state.ints[base + RESIDENT_INT.arriveTick]! && tick < state.ints[base + RESIDENT_INT.nextDecisionTick]!;
    if (!dwellingAtGarage || (state.ints[base + RESIDENT_INT.flags]! & FLAG.hurt) !== 0) continue;
    const destination = wreckPlace !== garage ? wreckPlace : nearestPlaceTo(state, placeX[garage]!, placeZ[garage]!, garage);
    sendResidentTo(state, resident, tick, destination, PURPOSE.mechanicOut, MECHANIC_LOOK_MINUTES * TICKS_PER_GAME_MINUTE);
  }
}

/** Events whose own tick has come: the civilian run down changes now (`knockResident`), the criminal's crime or the busted one's custody starts; a wreck near the garage gets the mechanic out. */
export function applyIndividualEvents(state: CityState, tick: number): void {
  for (let at = 0; at < state.events.length; at++) {
    const event = state.events[at]!;
    if (event.individualDone || event.individualTick > tick) continue;
    event.individualDone = true;
    if (event.kind === EVENT_KIND.knock) knockResident(state, event.subject, event.seconds, tick);
    else if (event.kind === EVENT_KIND.wreck) sendMechanicOut(state, event.subject, tick);
    else if (event.kind === EVENT_KIND.crime) applyCrime(state, event.subject, event.seconds, tick);
    else if (event.kind === EVENT_KIND.bust) applyBust(state, event.subject, event.seconds);
    else if (event.kind === EVENT_KIND.jaywalk) applyJaywalk(state, event.subject, event.seconds);
  }
}

/** Events whose reaction tick has come: others drawn into them (a knock's witnesses, a crime's, a push's or fight's two, a busted fighter's partner). */
export function applyReactionEvents(state: CityState, tick: number): void {
  for (let at = 0; at < state.events.length; at++) {
    const event = state.events[at]!;
    if (event.reactionDone || event.reactionTick > tick) continue;
    event.reactionDone = true;
    if (event.kind === EVENT_KIND.knock) {
      applyKnockWitness(state, event.subject, event.seconds, tick);
      alarmAtKnock(state, event.subject, tick);
    } else if (event.kind === EVENT_KIND.ambulance) callAmbulanceFor(state, event.subject, tick);
    else if (event.kind === EVENT_KIND.wreck) {
      const door = state.index.doorNode[event.subject]!;
      alarmAt(state, state.map.graph.nodeX[door]!, state.map.graph.nodeZ[door]!, tick, NO_PLACE, LOOK_ON_CRASH_MINUTES, ATTENTION_CRASH);
    } else if (event.kind === EVENT_KIND.danger) alarmAt(state, state.map.graph.nodeX[event.subject]!, state.map.graph.nodeZ[event.subject]!, tick, NO_PLACE, LOOK_ON_CRASH_MINUTES, ATTENTION_CRASH);
    else if (event.kind === EVENT_KIND.crime) reactToCrime(state, event.subject, tick);
    else if (event.kind === EVENT_KIND.bust) releaseFightPartner(state, event.subject);
    else if (event.kind === EVENT_KIND.push) applyPush(state, event.subject, event.seconds, tick, event.bearing, event.byCar);
    else if (event.kind === EVENT_KIND.fight) startFight(state, event.subject % state.capacity, Math.floor(event.subject / state.capacity) - 1, event.seconds, tick, event.bearing, event.byCar);
  }
}

function forEachHousemate(state: CityState, home: number, except: number, act: (resident: number) => void): void {
  for (let resident = 0; resident < state.capacity; resident++) {
    if (resident === except || intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person) continue;
    if (intAt(state, resident, RESIDENT_INT.home) === home) act(resident);
  }
}

function closePlace(state: CityState, place: number, tick: number): void {
  setClosedUntil(state, place, tick + CLOSED_DAYS * TICKS_PER_GAME_DAY);
  for (let resident = 0; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.work) !== place) continue;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags] |= FLAG.laidOff;
    noteEvent(state, resident, EVENT_CODE.workplaceClosed, place, tick);
  }
}

function applyWreck(state: CityState, place: number, tick: number): void {
  const { nodeX, nodeZ } = state.map.graph;
  const door = state.index.doorNode[place]!;
  raiseFear(state, nodeX[door]!, nodeZ[door]!, WRECK_FEAR);
  if (state.index.kindOf[place] === PLACE_KIND.home) forEachHousemate(state, place, NO_PLACE, (resident) => noteEvent(state, resident, EVENT_CODE.stoopWrecked, place, tick));
  else closePlace(state, place, tick);
}

function applyKnock(state: CityState, resident: number, tick: number): void {
  if ((intAt(state, resident, RESIDENT_INT.flags) & FLAG.hurt) === 0) return;
  raiseFear(state, intAt(state, resident, RESIDENT_INT.knockX) / CENTIMETRES_PER_METRE, intAt(state, resident, RESIDENT_INT.knockZ) / CENTIMETRES_PER_METRE, KNOCK_FEAR);
  const name = residentName(state, resident);
  forEachHousemate(state, intAt(state, resident, RESIDENT_INT.home), resident, (housemate) => noteEvent(state, housemate, EVENT_CODE.familyKnocked, name, tick));
}

/** At an hour tick: the society's side of every event whose hour has come (fear of the spot, a closed place and its laid-off staff, an angry family). */
export function applySocietyEvents(state: CityState, tick: number): void {
  for (let at = 0; at < state.events.length; at++) {
    const event = state.events[at]!;
    if (event.societyTick > tick) continue;
    if (event.kind === EVENT_KIND.knock) applyKnock(state, event.subject, tick);
    else if (event.kind === EVENT_KIND.wreck) applyWreck(state, event.subject, tick);
  }
}

/** At an hour tick: places shut long enough reopen, and their staff are back at work. */
export function reopenClosedPlaces(state: CityState, tick: number): void {
  for (let place = 0; place < state.index.placeCount; place++) {
    const until = state.closedUntilTick[place]!;
    if (until === 0 || until > tick) continue;
    setClosedUntil(state, place, 0);
    for (let resident = 0; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.work) !== place || !(intAt(state, resident, RESIDENT_INT.flags) & FLAG.laidOff)) continue;
      state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags] &= ~FLAG.laidOff;
      noteEvent(state, resident, EVENT_CODE.workplaceReopened, place, tick);
    }
  }
}

/** The pirate radio comes on at `RADIO_HOUR`: the houses of the blocks it reaches hear the static. */
export function broadcastStatic(state: CityState, tick: number): void {
  if (hourOfDay(tick, state.startHour) !== RADIO_HOUR) return;
  for (let host = 0; host < state.cast.length; host++) {
    if (state.cast[host]!.member.trait !== "radio" || intAt(state, host, RESIDENT_INT.alive) === 0) continue;
    const name = residentName(state, host);
    for (let resident = 0; resident < state.capacity; resident++) {
      const home = intAt(state, resident, RESIDENT_INT.home);
      if (resident === host || intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person) continue;
      if ((RADIO_BLOCKS as readonly number[]).includes(state.index.blockOf[home]!)) noteEvent(state, resident, EVENT_CODE.staticComplaint, name, tick);
    }
  }
}

/** Closes the tick's books: events whose individual tick has passed are done, those whose society tick has passed are gone. Every peer, with or without the worker's answer, ends a tick with this. */
export function completeEvents(state: CityState, tick: number): void {
  let kept = 0;
  for (let at = 0; at < state.events.length; at++) {
    const event = state.events[at]!;
    if (event.individualTick <= tick) event.individualDone = true;
    if (event.reactionTick <= tick) event.reactionDone = true;
    if (event.societyTick > tick) state.events[kept++] = event;
  }
  state.events.length = kept;
}
