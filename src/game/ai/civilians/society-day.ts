import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { dayOf } from "./civilian-clock.ts";
import {
  BABY_DIFF_BASE,
  BIRTH_CAP_SHARE,
  COURTSHIP_CENTRE,
  COURTSHIP_ROLL_MAX,
  COURTSHIP_ROLL_MIN,
  CURE_CHANCE,
  DEATH_PER_YEAR,
  FEAR_DAY_DECAY,
  FEAR_FLOOR,
  FIRE_CHANCE,
  FLAG,
  GENDER,
  HOME_CAPACITY,
  INJURED_DEATH_FACTOR,
  INJURY_BASE,
  JOB_AGE,
  JOB_FIND_CHANCE,
  MARRY_SHARE,
  MOVE_CHANCE,
  MOVE_IN_AGE_MAX,
  MOVE_IN_AGE_MIN,
  NEVER_TICK,
  NO_PLACE,
  PARTNER_SCAN,
  PROMOTION_CHANCE,
  RELATIONSHIP_DIFF,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  RETIRE_AGE,
  ROLL_RANGE,
  SPECIES,
  STREAM,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { EVENT_CODE, FEMALE_NAMES, MALE_NAMES, jobTitlesOf } from "./civilian-names.ts";
import { CityState, commitResident, logHistory, markDirty, residentName, retractResident, setMoodEvent } from "./civilian-state.ts";
import { createResident, drawFamilyName, drawGender, findWorkplace, setWork, startingTitle } from "./society.ts";

/** A resident's age in years on a game day: a named resident's is fixed, everyone else's is a year a day (the reference ages a year in each of its steps). */
export function ageOf(state: CityState, resident: number, day: number): number {
  const base = resident * RESIDENT_INT_STRIDE;
  const birthDay = state.ints[base + RESIDENT_INT.birthDay]!;
  return state.ints[base + RESIDENT_INT.flags]! & FLAG.cast ? -birthDay : day - birthDay;
}

/** One event in a resident's life: a line in the log, the mood it leaves, and the row goes out in the answer. */
export function noteEvent(state: CityState, resident: number, code: number, subject: number, tick: number): void {
  logHistory(state, resident, code, subject, tick);
  setMoodEvent(state, resident, code, tick);
  markDirty(state, resident);
}

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function isLivingPerson(state: CityState, resident: number): boolean {
  return intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person;
}

/** The lowest free slot after the named residents (a dead resident's, or one never lived in), or -1. */
function firstFreeSlot(state: CityState): number {
  for (let slot = state.cast.length; slot < state.capacity; slot++) if (intAt(state, slot, RESIDENT_INT.alive) === 0) return slot;
  return -1;
}

function emptiestHome(state: CityState, draw: number): number {
  const homes = state.index.byKind[PLACE_KIND.home]!;
  let best = NO_PLACE;
  for (let step = 0; step < homes.length; step++) {
    const home = homes[(Math.floor(draw * homes.length) + step) % homes.length]!;
    if (state.occupants[home]! >= HOME_CAPACITY || state.castHomes.has(home)) continue;
    if (best === NO_PLACE || state.occupants[home]! < state.occupants[best]!) best = home;
  }
  return best;
}

function mourn(state: CityState, dead: number, tick: number): void {
  const home = intAt(state, dead, RESIDENT_INT.home);
  const name = residentName(state, dead);
  for (let other = 0; other < state.capacity; other++) {
    if (other === dead || !isLivingPerson(state, other)) continue;
    const family = intAt(state, other, RESIDENT_INT.partner) === dead || intAt(state, other, RESIDENT_INT.parent) === dead || intAt(state, other, RESIDENT_INT.home) === home;
    if (!family) continue;
    if (intAt(state, other, RESIDENT_INT.partner) === dead) state.ints[other * RESIDENT_INT_STRIDE + RESIDENT_INT.partner] = NO_PLACE;
    if (intAt(state, other, RESIDENT_INT.parent) === dead) state.ints[other * RESIDENT_INT_STRIDE + RESIDENT_INT.parent] = NO_PLACE;
    noteEvent(state, other, EVENT_CODE.lostSomeone, name, tick);
  }
}

function die(state: CityState, resident: number, tick: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  mourn(state, resident, tick);
  retractResident(state, resident);
  state.ints[base + RESIDENT_INT.alive] = 0;
  state.ints[base + RESIDENT_INT.pathCount] = 0;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick;
  state.ints[base + RESIDENT_INT.nextDecisionTick] = NEVER_TICK;
  markDirty(state, resident);
}

function retire(state: CityState, resident: number, tick: number): void {
  const place = intAt(state, resident, RESIDENT_INT.work);
  setWork(state, resident, NO_PLACE, 0);
  noteEvent(state, resident, EVENT_CODE.retired, place, tick);
}

function setFlag(state: CityState, resident: number, flag: number, on: boolean): void {
  const at = resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags;
  const before = state.ints[at]!;
  state.ints[at] = on ? before | flag : before & ~flag;
  if (state.ints[at] !== before) markDirty(state, resident);
}

/** Work: the old retire, the jobless look for a place, the employed may be fired or promoted. */
function rollWork(state: CityState, resident: number, age: number, rolls: { job: number; work: number; pick: number }, tick: number): void {
  const place = intAt(state, resident, RESIDENT_INT.work);
  if (age >= RETIRE_AGE) {
    if (place !== NO_PLACE) retire(state, resident, tick);
    return;
  }
  if (age < JOB_AGE) return;
  if (place === NO_PLACE) {
    setFlag(state, resident, FLAG.jobless, true);
    if (rolls.job >= JOB_FIND_CHANCE) return;
    const found = findWorkplace(state, () => rolls.pick);
    if (found === NO_PLACE) return;
    setWork(state, resident, found, startingTitle(state, found, () => rolls.work));
    noteEvent(state, resident, EVENT_CODE.gotJob, found, tick);
    return;
  }
  if (intAt(state, resident, RESIDENT_INT.flags) & FLAG.laidOff) return;
  if (rolls.work < FIRE_CHANCE) {
    setWork(state, resident, NO_PLACE, 0);
    setFlag(state, resident, FLAG.jobless, true);
    noteEvent(state, resident, EVENT_CODE.fired, place, tick);
    return;
  }
  const entry = state.map.places[place]!;
  const title = intAt(state, resident, RESIDENT_INT.jobTitle);
  if (rolls.work < FIRE_CHANCE + PROMOTION_CHANCE && title + 1 < jobTitlesOf(entry.kind, entry.sector).length) {
    setWork(state, resident, place, title + 1);
    noteEvent(state, resident, EVENT_CODE.promoted, place, tick);
  }
}

function link(state: CityState, first: number, second: number): void {
  state.ints[first * RESIDENT_INT_STRIDE + RESIDENT_INT.partner] = second;
  state.ints[second * RESIDENT_INT_STRIDE + RESIDENT_INT.partner] = first;
}

/** A man over working age with no partner and another family's name, from the residents after a drawn start. */
function findMate(state: CityState, woman: number, day: number, pick: number): number {
  const family = intAt(state, woman, RESIDENT_INT.familyName);
  const start = Math.floor(pick * state.capacity);
  for (let step = 0; step < PARTNER_SCAN; step++) {
    const man = (start + step) % state.capacity;
    if (!isLivingPerson(state, man) || intAt(state, man, RESIDENT_INT.gender) !== GENDER.male) continue;
    if (intAt(state, man, RESIDENT_INT.flags) & FLAG.cast || intAt(state, man, RESIDENT_INT.partner) !== NO_PLACE) continue;
    if (ageOf(state, man, day) < JOB_AGE || intAt(state, man, RESIDENT_INT.familyName) === family) continue;
    return man;
  }
  return NO_PLACE;
}

function marry(state: CityState, woman: number, man: number, tick: number): void {
  link(state, woman, man);
  state.ints[woman * RESIDENT_INT_STRIDE + RESIDENT_INT.familyName] = intAt(state, man, RESIDENT_INT.familyName);
  const manHome = intAt(state, man, RESIDENT_INT.home);
  if (intAt(state, woman, RESIDENT_INT.home) !== manHome && state.occupants[manHome]! < HOME_CAPACITY) {
    retractResident(state, woman);
    state.ints[woman * RESIDENT_INT_STRIDE + RESIDENT_INT.home] = manHome;
    commitResident(state, woman);
  }
  noteEvent(state, woman, EVENT_CODE.married, residentName(state, man), tick);
  noteEvent(state, man, EVENT_CODE.married, residentName(state, woman), tick);
}

/** A baby at the mother's home, when the population is under its birth cap and a slot is free; true if one was born. */
function bearChild(state: CityState, mother: number, father: number, day: number, tick: number): boolean {
  const slot = firstFreeSlot(state);
  if (slot === -1 || state.alive >= state.targetPopulation * (1 + BIRTH_CAP_SHARE)) return false;
  const draw = residentDraws(state.seed, mother, STREAM.birth, day);
  const gender = drawGender(draw);
  const spec = {
    species: SPECIES.person,
    gender,
    firstName: Math.floor(draw() * (gender === GENDER.female ? FEMALE_NAMES : MALE_NAMES).length),
    familyName: intAt(state, mother, RESIDENT_INT.familyName),
    birthDay: day,
    home: intAt(state, mother, RESIDENT_INT.home),
    parent: mother,
    partner: NO_PLACE,
    flags: 0,
    paceFactor: 1,
  };
  createResident(state, slot, spec, tick);
  state.ints[mother * RESIDENT_INT_STRIDE + RESIDENT_INT.childCount]++;
  state.ints[father * RESIDENT_INT_STRIDE + RESIDENT_INT.childCount]++;
  noteEvent(state, slot, EVENT_CODE.born, residentName(state, mother), tick);
  noteEvent(state, mother, EVENT_CODE.baby, residentName(state, slot), tick);
  noteEvent(state, father, EVENT_CODE.baby, residentName(state, slot), tick);
  return true;
}

/** The reference's courtship band: a woman over 16 may have a baby with (and marry) a partner, start a relationship, or end one. */
function rollCourtship(state: CityState, woman: number, age: number, rolls: { court: number; pick: number; marry: number }, day: number, tick: number): void {
  const roll = rolls.court * ROLL_RANGE;
  if (roll <= COURTSHIP_ROLL_MIN || roll >= COURTSHIP_ROLL_MAX) return;
  const diff = Math.abs(roll - COURTSHIP_CENTRE) / 2;
  const partner = intAt(state, woman, RESIDENT_INT.partner);
  const mate = partner !== NO_PLACE ? partner : findMate(state, woman, day, rolls.pick);
  if (mate !== NO_PLACE && diff < BABY_DIFF_BASE - age / 2) {
    if (!bearChild(state, woman, mate, day, tick)) return;
    if (partner === NO_PLACE && rolls.marry < MARRY_SHARE) marry(state, woman, mate, tick);
  } else if (mate !== NO_PLACE && diff < RELATIONSHIP_DIFF && partner === NO_PLACE) {
    link(state, woman, mate);
    noteEvent(state, woman, EVENT_CODE.relationship, residentName(state, mate), tick);
    noteEvent(state, mate, EVENT_CODE.relationship, residentName(state, woman), tick);
  } else if (diff > RELATIONSHIP_DIFF && partner !== NO_PLACE) {
    state.ints[woman * RESIDENT_INT_STRIDE + RESIDENT_INT.partner] = NO_PLACE;
    state.ints[partner * RESIDENT_INT_STRIDE + RESIDENT_INT.partner] = NO_PLACE;
    noteEvent(state, woman, EVENT_CODE.breakup, residentName(state, partner), tick);
    noteEvent(state, partner, EVENT_CODE.breakup, residentName(state, woman), tick);
  }
}

function rollHealth(state: CityState, resident: number, age: number, roll: number, tick: number): void {
  const injured = (intAt(state, resident, RESIDENT_INT.flags) & FLAG.injured) !== 0;
  if (injured && roll < CURE_CHANCE) {
    setFlag(state, resident, FLAG.injured, false);
    noteEvent(state, resident, EVENT_CODE.cured, NO_PLACE, tick);
  } else if (!injured && roll < (INJURY_BASE + age) / ROLL_RANGE) {
    setFlag(state, resident, FLAG.injured, true);
    noteEvent(state, resident, EVENT_CODE.injured, NO_PLACE, tick);
  }
}

function rollMove(state: CityState, resident: number, pick: number, tick: number): void {
  if (intAt(state, resident, RESIDENT_INT.partner) !== NO_PLACE || intAt(state, resident, RESIDENT_INT.childCount) > 0) return;
  const home = emptiestHome(state, pick);
  if (home === NO_PLACE || home === intAt(state, resident, RESIDENT_INT.home)) return;
  retractResident(state, resident);
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.home] = home;
  commitResident(state, resident);
  noteEvent(state, resident, EVENT_CODE.moved, home, tick);
}

/** One resident's day: the reference's chances, drawn from a stream keyed by (seed, resident, day) in a fixed order. */
function rollDay(state: CityState, resident: number, day: number, tick: number): void {
  const draw = residentDraws(state.seed, resident, STREAM.day, day);
  const rolls = { job: draw(), work: draw(), court: draw(), health: draw(), move: draw(), death: draw(), pick: draw(), marry: draw() };
  const age = ageOf(state, resident, day);
  const injured = (intAt(state, resident, RESIDENT_INT.flags) & FLAG.injured) !== 0;
  if (rolls.death < age * DEATH_PER_YEAR * (injured ? INJURED_DEATH_FACTOR : 1)) {
    die(state, resident, tick);
    return;
  }
  rollWork(state, resident, age, rolls, tick);
  if (age >= JOB_AGE && intAt(state, resident, RESIDENT_INT.gender) === GENDER.female) rollCourtship(state, resident, age, rolls, day, tick);
  rollHealth(state, resident, age, rolls.health, tick);
  if (age >= JOB_AGE && rolls.move < MOVE_CHANCE) rollMove(state, resident, rolls.pick, tick);
}

/** Someone new moves into a free slot to keep the city near its target population. */
function welcomeNewcomer(state: CityState, slot: number, day: number, tick: number): void {
  const draw = residentDraws(state.seed, slot, STREAM.arrival, day);
  const home = emptiestHome(state, draw());
  if (home === NO_PLACE) return;
  const gender = drawGender(draw);
  const age = MOVE_IN_AGE_MIN + Math.floor(draw() * (MOVE_IN_AGE_MAX - MOVE_IN_AGE_MIN));
  const spec = {
    species: SPECIES.person,
    gender,
    firstName: Math.floor(draw() * (gender === GENDER.female ? FEMALE_NAMES : MALE_NAMES).length),
    familyName: drawFamilyName(draw),
    birthDay: day - age,
    home,
    parent: NO_PLACE,
    partner: NO_PLACE,
    flags: FLAG.jobless,
    paceFactor: 1,
  };
  createResident(state, slot, spec, tick);
  noteEvent(state, slot, EVENT_CODE.arrived, home, tick);
}

function fadeFear(state: CityState): void {
  for (let node = 0; node < state.fear.length; node++) {
    if (state.fear[node] === 0) continue;
    state.fear[node] *= FEAR_DAY_DECAY;
    if (state.fear[node]! < FEAR_FLOOR) state.fear[node] = 0;
    state.fearDirty = true;
  }
}

/** The society's day tick: fear fades, each ordinary resident's chances play out, and newcomers fill the places the dead left. */
export function runGameDay(state: CityState, tick: number): void {
  const day = dayOf(tick, state.startHour);
  fadeFear(state);
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    if (isLivingPerson(state, resident) && !(intAt(state, resident, RESIDENT_INT.flags) & FLAG.cast)) rollDay(state, resident, day, tick);
  }
  while (state.alive < state.targetPopulation) {
    const slot = firstFreeSlot(state);
    if (slot === -1) return;
    const before = state.alive;
    welcomeNewcomer(state, slot, day, tick);
    if (state.alive === before) return;
  }
}
