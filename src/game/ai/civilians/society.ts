import { hypot2 } from "../../kernel/physics-core.js";
import { PLACE_KIND, type OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { CAST } from "./civilian-cast.ts";
import { startHourOf } from "./civilian-clock.ts";
import {
  ADULT_AGE_MAX,
  ADULT_AGE_MIN,
  ADULT_AGE_RANGE,
  CAST_NAME_BASE,
  CHILD_AGE_LIMIT,
  COUPLE_SHARE,
  DAYS_PER_WEEK,
  EMPLOYMENT_RATE,
  FAVOURITE_POOL,
  FEMALE_SHARE,
  FLAG,
  GENDER,
  GROWTH_HEADROOM,
  INITIAL_SPREAD_TICKS,
  JOB_AGE,
  LATERAL_MAX,
  MIN_SPARE_SLOTS,
  MOOD_HOLD_TICKS,
  NEED,
  NEVER_TICK,
  NO_PLACE,
  PARENT_AGE_MAX,
  PARENT_AGE_MIN,
  PARTNER_AGE_GAP,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  RETIRE_AGE,
  SHIFT_START_MIN,
  SHIFT_START_SPAN,
  SPECIES,
  SPECIES_SPEED,
  STREAM,
  WALK_SPEED_SPREAD,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import { buildMapIndex } from "./civilian-map-index.ts";
import { FAMILY_NAMES, FEMALE_NAMES, MALE_NAMES, NAME_NONE, castTitleIndex, jobTitlesOf } from "./civilian-names.ts";
import { CityState, commitResident, retractResident } from "./civilian-state.ts";
import { castHomesOf, resolveCast } from "./civilian-story.ts";
import { rollNeeds } from "./needs.ts";

/** What a new resident is born, moves in or starts out as: the fields a row is made from. */
export type ResidentSpec = { species: number; gender: number; firstName: number; familyName: number; birthDay: number; home: number; parent: number; partner: number; flags: number; paceFactor: number };

/** A row's job: the place (or none) and the title step; the headcounts follow. */
export function setWork(state: CityState, resident: number, place: number, title: number): void {
  const base = resident * RESIDENT_INT_STRIDE;
  retractResident(state, resident);
  state.ints[base + RESIDENT_INT.work] = place;
  state.ints[base + RESIDENT_INT.jobTitle] = title;
  state.ints[base + RESIDENT_INT.flags] &= ~FLAG.jobless;
  commitResident(state, resident);
}

/** The first workplace from a drawn start that still has a free job, or none. */
export function findWorkplace(state: CityState, draw: () => number): number {
  const list = state.index.workplaces;
  const start = Math.floor(draw() * list.length);
  for (let step = 0; step < list.length; step++) {
    const place = list[(start + step) % list.length]!;
    if (state.headcount[place]! < state.index.jobCapacity[place]!) return place;
  }
  return NO_PLACE;
}

/** A starting job title rank at a place: low ranks are common (a squared draw). */
export function startingTitle(state: CityState, place: number, draw: () => number): number {
  const entry = state.map.places[place]!;
  const titles = jobTitlesOf(entry.kind, entry.sector);
  const unit = draw();
  return Math.floor(unit * unit * titles.length);
}

export function drawGender(draw: () => number): number {
  return draw() < FEMALE_SHARE ? GENDER.female : GENDER.male;
}

/** The place a resident will favour of a kind: one of the `FAVOURITE_POOL` nearest to home, by a draw. */
function favouriteNear(state: CityState, kind: number, home: number, draw: () => number): number {
  const { placeX, placeZ } = state.index;
  const awayFromHome = (place: number) => hypot2(placeX[place]! - placeX[home]!, placeZ[place]! - placeZ[home]!);
  const ranked = Array.from(state.index.byKind[kind]!).sort((first, second) => awayFromHome(first) - awayFromHome(second) || first - second);
  return ranked.length === 0 ? NO_PLACE : ranked[Math.floor(draw() * Math.min(FAVOURITE_POOL, ranked.length))]!;
}

/** Writes a whole new row for resident `id` (a start resident, a birth or a newcomer) at `tick`, living at home with a first decision soon; the slot's old row is gone. */
export function createResident(state: CityState, id: number, spec: ResidentSpec, tick: number): void {
  const base = id * RESIDENT_INT_STRIDE;
  const floatBase = id * RESIDENT_FLOAT_STRIDE;
  const { ints, floats } = state;
  retractResident(state, id);
  ints.fill(0, base, base + RESIDENT_INT_STRIDE);
  floats.fill(0, floatBase, floatBase + RESIDENT_FLOAT_STRIDE);
  const draw = residentDraws(state.seed, id, STREAM.create, 0);
  const favourites = residentDraws(state.seed, id, STREAM.create, 1);
  const person = spec.species === SPECIES.person;
  ints[base + RESIDENT_INT.alive] = 1;
  ints[base + RESIDENT_INT.species] = spec.species;
  ints[base + RESIDENT_INT.firstName] = spec.firstName;
  ints[base + RESIDENT_INT.familyName] = spec.familyName;
  ints[base + RESIDENT_INT.gender] = spec.gender;
  ints[base + RESIDENT_INT.birthDay] = spec.birthDay;
  ints[base + RESIDENT_INT.home] = spec.home;
  ints[base + RESIDENT_INT.work] = NO_PLACE;
  ints[base + RESIDENT_INT.shiftStart] = SHIFT_START_MIN + Math.floor(draw() * SHIFT_START_SPAN);
  ints[base + RESIDENT_INT.partner] = spec.partner;
  ints[base + RESIDENT_INT.parent] = spec.parent;
  ints[base + RESIDENT_INT.flags] = spec.flags;
  ints[base + RESIDENT_INT.moodTick] = -2 * MOOD_HOLD_TICKS;
  ints[base + RESIDENT_INT.favouriteFood] = person ? favouriteNear(state, PLACE_KIND.food, spec.home, favourites) : NO_PLACE;
  ints[base + RESIDENT_INT.favouriteHangout] = person ? favouriteNear(state, PLACE_KIND.hangout, spec.home, favourites) : NO_PLACE;
  ints[base + RESIDENT_INT.favouriteShop] = person ? favouriteNear(state, PLACE_KIND.shop, spec.home, favourites) : NO_PLACE;
  ints[base + RESIDENT_INT.fromPlace] = spec.home;
  ints[base + RESIDENT_INT.place] = spec.home;
  ints[base + RESIDENT_INT.departTick] = tick;
  ints[base + RESIDENT_INT.arriveTick] = tick;
  ints[base + RESIDENT_INT.nextDecisionTick] = tick + Math.floor(draw() * INITIAL_SPREAD_TICKS);
  ints[base + RESIDENT_INT.legPurpose] = NEED.rest;
  ints[base + RESIDENT_INT.storyTick] = -1;
  rollNeeds(floats, floatBase, draw);
  floats[floatBase + RESIDENT_FLOAT.speed] = SPECIES_SPEED[spec.species]! * spec.paceFactor * (1 + (draw() * 2 - 1) * WALK_SPEED_SPREAD);
  floats[floatBase + RESIDENT_FLOAT.lateral] = (draw() * 2 - 1) * LATERAL_MAX;
  state.hiddenFromTick[id] = NEVER_TICK;
  state.hiddenUntilTick[id] = NEVER_TICK;
  commitResident(state, id);
}

function drawName(draw: () => number, gender: number): number {
  return Math.floor(draw() * (gender === GENDER.female ? FEMALE_NAMES : MALE_NAMES).length);
}

export function drawFamilyName(draw: () => number): number {
  return Math.floor(draw() * FAMILY_NAMES.length);
}

function adultSpec(draw: () => number, home: number, age: number, gender: number): ResidentSpec {
  return { species: SPECIES.person, gender, firstName: drawName(draw, gender), familyName: drawFamilyName(draw), birthDay: -age, home, parent: NO_PLACE, partner: NO_PLACE, flags: 0, paceFactor: 1 };
}

/** One household of `size` at `home`, made from its own draws: an adult, a partner (half the time) or a flatmate, then children of a parent in the years for it, else more adults. Returns the next free resident id. */
function composeHousehold(state: CityState, firstId: number, home: number, size: number): number {
  const draw = residentDraws(state.seed, home, STREAM.create, 2);
  const adultAge = () => ADULT_AGE_MIN + Math.floor(draw() * ADULT_AGE_RANGE);
  let id = firstId;
  const lead = adultSpec(draw, home, adultAge(), drawGender(draw));
  const adults = [lead];
  if (size >= 2) {
    const coupled = draw() < COUPLE_SHARE;
    const leadAge = -lead.birthDay;
    const age = coupled ? Math.min(ADULT_AGE_MAX, Math.max(ADULT_AGE_MIN, leadAge + Math.floor((draw() * 2 - 1) * PARTNER_AGE_GAP))) : adultAge();
    const second = adultSpec(draw, home, age, coupled ? 1 - lead.gender : drawGender(draw));
    if (coupled) {
      const mansFamily = lead.gender === GENDER.male ? lead.familyName : second.familyName;
      lead.familyName = mansFamily;
      second.familyName = mansFamily;
      lead.partner = firstId + 1;
      second.partner = firstId;
    }
    adults.push(second);
  }
  const mother = adults.findIndex((adult) => adult.gender === GENDER.female);
  const parentAge = -lead.birthDay;
  const hasChildren = mother !== -1 && parentAge >= PARENT_AGE_MIN && parentAge <= PARENT_AGE_MAX;
  for (const adult of adults) createResident(state, id++, adult, 0);
  for (let member = adults.length; member < size; member++) {
    const age = hasChildren ? Math.floor(draw() * CHILD_AGE_LIMIT) : adultAge();
    const spec = adultSpec(draw, home, age, drawGender(draw));
    if (hasChildren) {
      spec.parent = firstId + mother;
      spec.familyName = adults[mother]!.familyName;
      state.ints[(firstId + mother) * RESIDENT_INT_STRIDE + RESIDENT_INT.childCount]++;
    }
    createResident(state, id++, spec, 0);
  }
  return id;
}

function createCastMembers(state: CityState): void {
  const slots = new Map<string, number>();
  for (let id = 0; id < state.cast.length; id++) slots.set(state.cast[id]!.member.key, id);
  for (let id = 0; id < state.cast.length; id++) {
    const resolved = state.cast[id]!;
    const { member } = resolved;
    const castIndex = CAST.indexOf(member);
    const partner = member.partner === null ? undefined : slots.get(member.partner);
    const parent = member.parent === null ? undefined : slots.get(member.parent);
    const spec = {
      species: member.species,
      gender: member.gender,
      firstName: CAST_NAME_BASE + castIndex,
      familyName: member.family === "" ? NAME_NONE : CAST_NAME_BASE + castIndex,
      birthDay: -member.age,
      home: resolved.home,
      parent: parent ?? NO_PLACE,
      partner: partner ?? NO_PLACE,
      flags: FLAG.cast,
      paceFactor: member.paceFactor,
    };
    createResident(state, id, spec, 0);
    if (resolved.workplace !== NO_PLACE) setWork(state, id, resolved.workplace, castTitleIndex(member));
    if (parent !== undefined) state.ints[parent * RESIDENT_INT_STRIDE + RESIDENT_INT.childCount]++;
  }
}

function giveStartingJobs(state: CityState, firstGenerated: number, end: number): void {
  for (let id = firstGenerated; id < end; id++) {
    const base = id * RESIDENT_INT_STRIDE;
    const age = -state.ints[base + RESIDENT_INT.birthDay]!;
    if (age < JOB_AGE || age >= RETIRE_AGE) continue;
    const draw = residentDraws(state.seed, id, STREAM.create, 3);
    const place = draw() < EMPLOYMENT_RATE ? findWorkplace(state, draw) : NO_PLACE;
    if (place === NO_PLACE) state.ints[base + RESIDENT_INT.flags] |= FLAG.jobless;
    else setWork(state, id, place, startingTitle(state, place, draw));
  }
}

/**
 * The people of the neighbourhood from a seed and the map, at crowd time 0: the named cast (animals too), then `playableResidents` people in all (the cast counts among them) spread
 * over the homes, adults in work at the start in the proportion `EMPLOYMENT_RATE`. Nobody lives, works or goes beyond the walls.
 */
export function createCityState(seed: number, map: OpenWorldMap, playableResidents: number): CityState {
  const index = buildMapIndex(map);
  const cast = resolveCast(index);
  const castHomes = castHomesOf(cast);
  const homes = index.byKind[PLACE_KIND.home]!.filter((home) => !castHomes.has(home));
  const castPeople = cast.filter((resolved) => resolved.member.species === SPECIES.person).length;
  const generated = homes.length === 0 ? 0 : Math.max(0, playableResidents - castPeople);
  const capacity = cast.length + generated + Math.ceil(generated * GROWTH_HEADROOM) + MIN_SPARE_SLOTS;
  const startWeekday = Math.floor(residentDraws(seed, 0, STREAM.week, 0)() * DAYS_PER_WEEK);
  const state = new CityState(seed, map, index, cast, startHourOf(seed), startWeekday, capacity);
  state.targetPopulation = castPeople + generated;
  createCastMembers(state);
  let id = cast.length;
  for (let slot = 0; slot < homes.length && generated > 0; slot++) {
    const size = Math.floor(generated / homes.length) + (slot < generated % homes.length ? 1 : 0);
    if (size > 0) id = composeHousehold(state, id, homes[slot]!, size);
  }
  giveStartingJobs(state, cast.length, id);
  return state;
}
