import { hypot2 } from "../../kernel/physics-core.js";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { dayOf } from "./civilian-clock.ts";
import {
  COFFEE_DETOUR_METRES,
  COFFEE_LEAD_HOURS,
  CRIME_PER_DECISION,
  DECISION_JITTER,
  DISTANCE_SCALE,
  FEAR_AVOID,
  FLAG,
  HOURS_PER_GAME_DAY,
  JOB_AGE,
  NEED,
  NEIGHBOUR_REACH,
  NIGHT_FEAR_WEIGHT,
  NIGHT_FROM_HOUR,
  NIGHT_TO_HOUR,
  NO_PLACE,
  PULL_LEAD_TICKS,
  PURPOSE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  RETIRE_AGE,
  SHIFT_DWELL_MINUTES,
  SPECIES,
  TICKS_PER_GAME_MINUTE,
  TIRED_REST_LEVEL,
} from "./civilian-constants.ts";
import { moodOf } from "./civilian-mood.ts";
import { MOOD } from "./civilian-names.ts";
import type { CityState } from "./civilian-state.ts";
import { ageOf } from "./society-day.ts";
import { VENUE, isHourIn, isOutdoorPurpose } from "./society-venues.ts";

/** Who a resident is to the table: bits a row asks for any of. */
const JOB = { employed: 1, jobless: 2, broke: 4, retired: 8, child: 16, adult: 32, criminal: 64, wanted: 128 } as const;
/** Where they must be now: anywhere, at home, or at their workplace after a shift's length of dwell. */
const FROM = { anywhere: 0, home: 1, work: 2 } as const;
/** How a row picks its place. */
export const TARGET = { coffeeOnTheWay: 1, coffee: 2, bar: 3, supermarket: 4, ownDoor: 5, neighbour: 6, shopDoor: 7, shopWithStaff: 8, stoopSitter: 9, parkedCar: 10, hideout: 11 } as const;

const moods = (...list: number[]): number => list.reduce((mask, mood) => mask | (1 << mood), 0);
/** A row that lists no moods takes any but afraid. */
const ANY_MOOD = 0;
const ALL_DAY = [0, HOURS_PER_GAME_DAY] as const;

/**
 * Mood x job x location -> what a resident does where. A row applies when the resident has any of `jobs` (0: any), all `traits` (FLAG bits), a mood in `moods` (none listed: any but afraid), is `from` where it says, in
 * `hours` [from, to) with the `need` at least `needLevel` (-1: no need). Its worth against a need's utility (0..1) is `strength` times the need's level; `target` picks the place, `dwell` is game minutes.
 */
export type InteractionRow = {
  name: string;
  purpose: number;
  jobs: number;
  traits: number;
  moods: number;
  from: number;
  hours: readonly [number, number];
  need: number;
  needLevel: number;
  strength: number;
  target: number;
  dwell: readonly [number, number];
};

const CALM_MOODS = moods(MOOD.fine, MOOD.happy, MOOD.proud, MOOD.lonely, MOOD.restless);
const LOW_MOODS = moods(MOOD.sad, MOOD.angry, MOOD.annoyed, MOOD.worried, MOOD.restless);

export const INTERACTIONS: readonly InteractionRow[] = [
  { name: "coffee on the way to work", purpose: PURPOSE.coffee, jobs: JOB.employed, traits: FLAG.coffeeFan, moods: ANY_MOOD, from: FROM.home, hours: [5, 10], need: -1, needLevel: 0, strength: 0.6, target: TARGET.coffeeOnTheWay, dwell: [15, 30] },
  { name: "morning coffee out of work", purpose: PURPOSE.coffee, jobs: JOB.jobless | JOB.retired, traits: FLAG.coffeeFan, moods: ANY_MOOD, from: FROM.home, hours: [7, 11], need: -1, needLevel: 0, strength: 0.5, target: TARGET.coffee, dwell: [20, 45] },
  { name: "a drink after work", purpose: PURPOSE.drink, jobs: JOB.employed, traits: FLAG.drinker, moods: ANY_MOOD, from: FROM.work, hours: [17, 3], need: NEED.rest, needLevel: TIRED_REST_LEVEL, strength: 0.8, target: TARGET.bar, dwell: [60, 150] },
  { name: "a drink to forget", purpose: PURPOSE.drink, jobs: JOB.adult, traits: 0, moods: LOW_MOODS, from: FROM.anywhere, hours: [16, 3], need: -1, needLevel: 0, strength: 0.6, target: TARGET.bar, dwell: [45, 120] },
  { name: "the shopping", purpose: PURPOSE.shopping, jobs: JOB.adult, traits: 0, moods: moods(MOOD.busy, MOOD.fine, MOOD.happy, MOOD.proud, MOOD.hungry), from: FROM.anywhere, hours: [10, 19], need: NEED.errand, needLevel: 0.25, strength: 0.4, target: TARGET.supermarket, dwell: [20, 40] },
  { name: "sitting out on the stoop in the evening", purpose: PURPOSE.stoopSit, jobs: JOB.adult, traits: 0, moods: CALM_MOODS, from: FROM.home, hours: [17, 21], need: NEED.social, needLevel: 0.25, strength: 0.5, target: TARGET.ownDoor, dwell: [30, 90] },
  { name: "sitting out on the stoop by day", purpose: PURPOSE.stoopSit, jobs: JOB.retired | JOB.jobless, traits: 0, moods: CALM_MOODS, from: FROM.home, hours: [10, 15], need: NEED.social, needLevel: 0.25, strength: 0.5, target: TARGET.ownDoor, dwell: [30, 90] },
  { name: "a chat with a neighbour", purpose: PURPOSE.stoopTalk, jobs: JOB.adult, traits: 0, moods: moods(MOOD.happy, MOOD.lonely, MOOD.fine, MOOD.proud), from: FROM.home, hours: [10, 20], need: NEED.social, needLevel: 0.4, strength: 0.45, target: TARGET.neighbour, dwell: [10, 25] },
  { name: "a row with a neighbour", purpose: PURPOSE.argue, jobs: JOB.adult, traits: 0, moods: moods(MOOD.angry, MOOD.annoyed), from: FROM.home, hours: [8, 22], need: -1, needLevel: 0, strength: 0.9, target: TARGET.neighbour, dwell: [8, 18] },
  { name: "loitering when broke", purpose: PURPOSE.loiter, jobs: JOB.broke, traits: 0, moods: ANY_MOOD, from: FROM.home, hours: [11, 23], need: -1, needLevel: 0, strength: 0.4, target: TARGET.shopDoor, dwell: [30, 120] },
  { name: "lifting from a shop", purpose: PURPOSE.shoplift, jobs: JOB.criminal, traits: 0, moods: ANY_MOOD, from: FROM.anywhere, hours: [10, 19], need: -1, needLevel: 0, strength: 0.9, target: TARGET.shopWithStaff, dwell: [10, 16] },
  { name: "mugging someone on their stoop", purpose: PURPOSE.mug, jobs: JOB.criminal, traits: 0, moods: ANY_MOOD, from: FROM.anywhere, hours: [20, 5], need: -1, needLevel: 0, strength: 0.9, target: TARGET.stoopSitter, dwell: [10, 16] },
  { name: "trying the parked cars", purpose: PURPOSE.breakIn, jobs: JOB.criminal, traits: 0, moods: ANY_MOOD, from: FROM.anywhere, hours: [22, 5], need: -1, needLevel: 0, strength: 0.9, target: TARGET.parkedCar, dwell: [10, 16] },
  { name: "lying low while wanted", purpose: PURPOSE.flee, jobs: JOB.wanted, traits: 0, moods: ANY_MOOD, from: FROM.anywhere, hours: ALL_DAY, need: -1, needLevel: 0, strength: 1.5, target: TARGET.hideout, dwell: [45, 120] },
];

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function jobsOf(state: CityState, resident: number, day: number): number {
  const flags = intAt(state, resident, RESIDENT_INT.flags);
  const age = ageOf(state, resident, day);
  if (age < JOB_AGE) return JOB.child;
  let jobs: number = JOB.adult;
  if (age >= RETIRE_AGE) jobs |= JOB.retired;
  else if (intAt(state, resident, RESIDENT_INT.work) !== NO_PLACE && (flags & FLAG.laidOff) === 0) jobs |= JOB.employed;
  else jobs |= JOB.jobless;
  if ((flags & FLAG.broke) !== 0) jobs |= JOB.broke;
  if ((flags & FLAG.wanted) !== 0) jobs |= JOB.wanted;
  else if ((flags & (FLAG.criminal | FLAG.custody)) === FLAG.criminal) jobs |= JOB.criminal;
  return jobs;
}

function distanceBetween(state: CityState, from: number, to: number): number {
  const { placeX, placeZ } = state.index;
  return hypot2(placeX[to]! - placeX[from]!, placeZ[to]! - placeZ[from]!);
}

function isOpenAt(state: CityState, place: number, tick: number, hour: number): boolean {
  return state.closedUntilTick[place]! <= tick && state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]! >= 1;
}

/** The nearest place of `venue` that is open at this hour and not shut by a wreck; ties go to the lower place id. */
function nearestOpenVenue(state: CityState, venue: number, from: number, tick: number, hour: number): number {
  const list = state.venues.byVenue[venue]!;
  let best = NO_PLACE;
  let bestDistance = Infinity;
  for (let at = 0; at < list.length; at++) {
    const place = list[at]!;
    const distance = distanceBetween(state, from, place);
    if (distance >= bestDistance || !isOpenAt(state, place, tick, hour)) continue;
    bestDistance = distance;
    best = place;
  }
  return best;
}

/** The open coffee shop that adds least walking between where they are and their workplace, when the detour is small and the shift is not close. */
function coffeeOnTheWay(state: CityState, resident: number, current: number, tick: number, hour: number): number {
  const work = intAt(state, resident, RESIDENT_INT.work);
  const hoursToShift = (intAt(state, resident, RESIDENT_INT.shiftStart) - hour + HOURS_PER_GAME_DAY) % HOURS_PER_GAME_DAY;
  if (work === NO_PLACE || hoursToShift < COFFEE_LEAD_HOURS) return NO_PLACE;
  const list = state.venues.byVenue[VENUE.coffee]!;
  const direct = distanceBetween(state, current, work);
  let best = NO_PLACE;
  let bestDetour = COFFEE_DETOUR_METRES;
  for (let at = 0; at < list.length; at++) {
    const place = list[at]!;
    const detour = distanceBetween(state, current, place) + distanceBetween(state, place, work) - direct;
    if (detour >= bestDetour || !isOpenAt(state, place, tick, hour)) continue;
    bestDetour = detour;
    best = place;
  }
  return best;
}

/** Residents dwelling now where the walk graph has their door (`ok` says whether this one counts); the nearest to `current` is the partner. */
function nearestDweller(state: CityState, resident: number, current: number, tick: number, ok: (other: number, place: number) => boolean): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let other = 0; other < state.capacity; other++) {
    if (other === resident || intAt(state, other, RESIDENT_INT.alive) === 0 || intAt(state, other, RESIDENT_INT.species) !== SPECIES.person) continue;
    if ((intAt(state, other, RESIDENT_INT.flags) & (FLAG.hurt | FLAG.custody | FLAG.cast)) !== 0) continue;
    const place = intAt(state, other, RESIDENT_INT.place);
    if (state.index.doorNode[place]! < 0 || intAt(state, other, RESIDENT_INT.arriveTick) > tick || intAt(state, other, RESIDENT_INT.nextDecisionTick) - tick < PULL_LEAD_TICKS) continue;
    const distance = distanceBetween(state, current, place);
    if (distance >= bestDistance || !ok(other, place)) continue;
    bestDistance = distance;
    best = other;
  }
  return best;
}

function neighbourDoor(state: CityState, resident: number, current: number, tick: number): number {
  const neighbour = nearestDweller(state, resident, current, tick, (_, place) => state.index.kindOf[place] === PLACE_KIND.home && place !== current && distanceBetween(state, current, place) <= NEIGHBOUR_REACH);
  state.scratchPartner = neighbour;
  return neighbour === -1 ? NO_PLACE : intAt(state, neighbour, RESIDENT_INT.place);
}

/** A shop or supermarket with staff on its books, the nearer of the two. */
function staffedShop(state: CityState, current: number, tick: number, hour: number): number {
  const shop = nearestOpenVenue(state, VENUE.shop, current, tick, hour);
  const market = nearestOpenVenue(state, VENUE.supermarket, current, tick, hour);
  const staffed = (place: number) => place !== NO_PLACE && state.headcount[place]! > 0;
  if (staffed(shop) && (!staffed(market) || distanceBetween(state, current, shop) <= distanceBetween(state, current, market))) return shop;
  return staffed(market) ? market : NO_PLACE;
}

/** The place of the nearest person out on a stoop or at a door (not a mugger), who is the victim. */
function stoopSitter(state: CityState, resident: number, current: number, tick: number): number {
  const victim = nearestDweller(state, resident, current, tick, (other) => isOutdoorPurpose(intAt(state, other, RESIDENT_INT.legPurpose)) && intAt(state, other, RESIDENT_INT.legPurpose) !== PURPOSE.mug);
  state.scratchPartner = victim;
  return victim === -1 ? NO_PLACE : intAt(state, victim, RESIDENT_INT.place);
}

/** The kerb of the nearest parked car of someone dwelling at it, whose owner is the victim. */
function parkedCar(state: CityState, resident: number, current: number, tick: number): number {
  const owner = nearestDweller(state, resident, current, tick, (other) => (intAt(state, other, RESIDENT_INT.flags) & FLAG.hasCar) !== 0 && intAt(state, other, RESIDENT_INT.carPlace) === intAt(state, other, RESIDENT_INT.place));
  state.scratchPartner = owner;
  return owner === -1 ? NO_PLACE : intAt(state, owner, RESIDENT_INT.carPlace);
}

function nearestHideout(state: CityState, current: number): number {
  const list = state.index.byKind[PLACE_KIND.hide]!;
  let best = NO_PLACE;
  let bestDistance = Infinity;
  for (let at = 0; at < list.length; at++) {
    const distance = distanceBetween(state, current, list[at]!);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = list[at]!;
  }
  return best;
}

function targetPlace(state: CityState, resident: number, row: InteractionRow, current: number, tick: number, hour: number, draw: () => number): number {
  state.scratchPartner = NO_PLACE;
  if (row.jobs === JOB.criminal && (tick < intAt(state, resident, RESIDENT_INT.crimeNotBefore) || draw() >= CRIME_PER_DECISION)) return NO_PLACE;
  switch (row.target) {
    case TARGET.coffeeOnTheWay:
      return coffeeOnTheWay(state, resident, current, tick, hour);
    case TARGET.coffee:
      return nearestOpenVenue(state, VENUE.coffee, current, tick, hour);
    case TARGET.bar:
      return nearestOpenVenue(state, VENUE.bar, current, tick, hour);
    case TARGET.supermarket: {
      const market = nearestOpenVenue(state, VENUE.supermarket, current, tick, hour);
      return market !== NO_PLACE ? market : nearestOpenVenue(state, VENUE.shop, current, tick, hour);
    }
    case TARGET.ownDoor:
      return intAt(state, resident, RESIDENT_INT.home);
    case TARGET.neighbour:
      return neighbourDoor(state, resident, current, tick);
    case TARGET.shopDoor: {
      const shop = nearestOpenVenue(state, VENUE.shop, current, tick, hour);
      return shop !== NO_PLACE ? shop : nearestOpenVenue(state, VENUE.supermarket, current, tick, hour);
    }
    case TARGET.shopWithStaff:
      return staffedShop(state, current, tick, hour);
    case TARGET.stoopSitter:
      return stoopSitter(state, resident, current, tick);
    case TARGET.parkedCar:
      return parkedCar(state, resident, current, tick);
    case TARGET.hideout:
      return nearestHideout(state, current);
    default:
      return NO_PLACE;
  }
}

function applies(state: CityState, resident: number, row: InteractionRow, jobs: number, mood: number, current: number, tick: number, hour: number): boolean {
  if (row.jobs !== 0 && (row.jobs & jobs) === 0) return false;
  if ((intAt(state, resident, RESIDENT_INT.flags) & row.traits) !== row.traits) return false;
  if (row.moods === ANY_MOOD ? mood === MOOD.afraid : ((row.moods >> mood) & 1) === 0) return false;
  if (!isHourIn(hour, row.hours[0], row.hours[1])) return false;
  if (row.from === FROM.home && current !== intAt(state, resident, RESIDENT_INT.home)) return false;
  if (row.from === FROM.work && (current !== intAt(state, resident, RESIDENT_INT.work) || tick - intAt(state, resident, RESIDENT_INT.arriveTick) < SHIFT_DWELL_MINUTES * TICKS_PER_GAME_MINUTE)) return false;
  return row.need === -1 || state.scratchNeeds[row.need]! >= row.needLevel;
}

/** Offers every row that applies to the resident as a candidate against `bestUtility` (the best need's): the winner is written to `state.chosenPlace`, `chosenPurpose`, `chosenRow` and `chosenPartner`; returns the best utility. Needs `scratchNeeds` worked out to `tick`. Named residents keep their own stories. */
export function considerInteractions(state: CityState, resident: number, current: number, tick: number, hour: number, bestUtility: number, draw: () => number): number {
  const flags = intAt(state, resident, RESIDENT_INT.flags);
  if (intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person || (flags & (FLAG.cast | FLAG.hurt | FLAG.custody)) !== 0) return bestUtility;
  const jobs = jobsOf(state, resident, dayOf(tick, state.startHour));
  if ((jobs & JOB.child) !== 0) return bestUtility;
  const mood = moodOf(state, resident, tick);
  const fearWeight = hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR ? NIGHT_FEAR_WEIGHT : 1;
  let best = bestUtility;
  for (let at = 0; at < INTERACTIONS.length; at++) {
    const row = INTERACTIONS[at]!;
    if (!applies(state, resident, row, jobs, mood, current, tick, hour)) continue;
    const place = targetPlace(state, resident, row, current, tick, hour, draw);
    if (place === NO_PLACE) continue;
    const level = row.need === -1 ? 1 : state.scratchNeeds[row.need]!;
    const hours = state.venues.hourWeight[place * HOURS_PER_GAME_DAY + hour]!;
    const utility = ((row.strength * level * hours) / (1 + distanceBetween(state, current, place) / DISTANCE_SCALE) / (1 + FEAR_AVOID * fearWeight * state.fear[state.index.doorNode[place]!]!)) * (1 + (draw() * 2 - 1) * DECISION_JITTER);
    if (utility <= best) continue;
    best = utility;
    state.chosenRow = at;
    state.chosenPlace = place;
    state.chosenPurpose = row.purpose;
    state.chosenPartner = state.scratchPartner;
  }
  return best;
}
