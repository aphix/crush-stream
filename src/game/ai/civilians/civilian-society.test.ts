import { describe, expect, it } from "vitest";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { CAST, PLACE_NAMES } from "./civilian-cast.ts";
import { EVENT_KIND, FLAG, GENDER, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { residentNameText } from "./civilian-mood.ts";
import { runTicks, stateDigest, tickOfHour, type EventsByTick } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { buildAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { ageOf, runGameDay } from "./society-day.ts";

const map = buildFixtureMap();

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function castResident(state: CityState, key: string): number {
  const found = state.cast.findIndex((resolved) => resolved.member.key === key);
  if (found === -1) throw new Error(`no cast member ${key}`);
  return found;
}

/** A knock on a generated resident and a wreck on the bodega on the second day, as the host would send them. */
function eventsOfTwoDays(state: CityState): EventsByTick {
  const knockAt = tickOfHour(state, 1, 9);
  const wreckAt = tickOfHour(state, 1, 15);
  return new Map([
    [knockAt, [EVENT_KIND.knock, state.cast.length + 3, knockAt / 2]],
    [wreckAt, [EVENT_KIND.wreck, placeNamed(map, PLACE_NAMES.bodega), wreckAt / 2]],
  ]);
}

function digestAfterThreeDays(seed: number): string {
  const state = createCityState(seed, map, 60);
  const legs = runTicks(state, 3 * TICKS_PER_GAME_DAY, eventsOfTwoDays(state));
  return `${stateDigest(state)}/${legs.length}/${legs.split(",").slice(-40).join(",")}`;
}

describe("given the fixture neighbourhood and a seed", () => {
  it("when the city is built twice, then both hold the same people, and a day with events later the same state and legs", () => {
    expect(digestAfterThreeDays(4321), "digest of the same seed after three days with a knock and a wreck").toBe(digestAfterThreeDays(4321));
  });

  it("when the city is built from another seed, then its state and legs after the same three days differ", () => {
    expect(digestAfterThreeDays(4321), "digest of seed 4321").not.toBe(digestAfterThreeDays(4322));
  });
});

describe("given a city of 60 built on the fixture neighbourhood", () => {
  const state = createCityState(77, map, 60);

  it("when it is built, then 60 people live in it, the cast among them by name, each in a home of the neighbourhood", () => {
    let homed = 0;
    for (let resident = 0; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person) continue;
      const home = map.places[intAt(state, resident, RESIDENT_INT.home)]!;
      if (home.kind === PLACE_KIND.home && home.doorNode >= 0) homed++;
    }
    expect(state.alive, "people alive").toBe(60);
    expect(homed, "people living in a home inside the walls").toBe(60);
    const sal = castResident(state, "sal");
    expect(residentNameText(state, sal), "the pigeon man's name").toBe("Sal Russo");
    expect(ageOf(state, sal, 0), "his age").toBe(63);
    expect(map.places[intAt(state, sal, RESIDENT_INT.home)]!.name, "his home").toBe(PLACE_NAMES.salHome);
  });

  it("when it is built, then nobody lives, works or has a favourite place beyond the walls and the cast's animals are residents too", () => {
    for (let resident = 0; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
      for (const field of [RESIDENT_INT.home, RESIDENT_INT.work, RESIDENT_INT.favouriteFood, RESIDENT_INT.favouriteHangout, RESIDENT_INT.favouriteShop]) {
        const place = intAt(state, resident, field);
        if (place !== NO_PLACE) expect(map.places[place]!.doorNode, `door of place ${field} of ${resident}`).toBeGreaterThanOrEqual(0);
      }
    }
    const animals = CAST.filter((member) => member.species !== SPECIES.person).length;
    let animalRows = 0;
    for (let resident = 0; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.species) !== SPECIES.person) animalRows++;
    expect(animals, "animals in the cast").toBeGreaterThan(4);
    expect(animalRows, "animals living in the city").toBe(animals);
  });
});

/** The reference's working years: a job from 16, retirement at 65. */
const FIRST_WORKING_AGE = 16;
const RETIREMENT_AGE = 65;

/** What one game day did to the society, by diffing the rows before and after (rows of residents who lived through it, and slots that changed hands). */
type DayCounts = { deaths: number; births: number; arrivals: number; hired: number; fired: number; promoted: number; retired: number; couples: number; employedDays: number; deathHazard: number; livingDays: number };

const DAY_COUNT_KEYS: (keyof DayCounts)[] = ["deaths", "births", "arrivals", "hired", "fired", "promoted", "retired", "couples", "employedDays", "deathHazard", "livingDays"];

function playDay(state: CityState, day: number): DayCounts {
  const before = state.ints.slice();
  const field = (rows: Int32Array, resident: number, which: number) => rows[resident * RESIDENT_INT_STRIDE + which]!;
  const counts: DayCounts = { deaths: 0, births: 0, arrivals: 0, hired: 0, fired: 0, promoted: 0, retired: 0, couples: 0, employedDays: 0, deathHazard: 0, livingDays: 0 };
  const dayTick = tickOfHour(state, day, 0);
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    if (field(before, resident, RESIDENT_INT.alive) !== 1) continue;
    const age = day - field(before, resident, RESIDENT_INT.birthDay);
    const injured = (field(before, resident, RESIDENT_INT.flags) & FLAG.injured) !== 0;
    counts.livingDays++;
    counts.deathHazard += (age / 5000) * (injured ? 2 : 1);
    if (field(before, resident, RESIDENT_INT.work) !== NO_PLACE && age >= FIRST_WORKING_AGE && age < RETIREMENT_AGE && !(field(before, resident, RESIDENT_INT.flags) & FLAG.laidOff)) counts.employedDays++;
  }
  runGameDay(state, dayTick);
  buildAnswer(state, dayTick);
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    const wasAlive = field(before, resident, RESIDENT_INT.alive) === 1;
    const isAlive = intAt(state, resident, RESIDENT_INT.alive) === 1;
    const sameFolk = [RESIDENT_INT.firstName, RESIDENT_INT.gender, RESIDENT_INT.birthDay].every((which) => intAt(state, resident, which) === field(before, resident, which));
    if (wasAlive && (!isAlive || !sameFolk)) counts.deaths++;
    if (isAlive && (!wasAlive || !sameFolk)) {
      if (intAt(state, resident, RESIDENT_INT.parent) === NO_PLACE) counts.arrivals++;
      else counts.births++;
    }
    if (!wasAlive || !isAlive || !sameFolk || field(before, resident, RESIDENT_INT.species) !== SPECIES.person) continue;
    const workBefore = field(before, resident, RESIDENT_INT.work);
    const workAfter = intAt(state, resident, RESIDENT_INT.work);
    const age = ageOf(state, resident, day);
    if (workBefore === NO_PLACE && workAfter !== NO_PLACE) counts.hired++;
    else if (workBefore !== NO_PLACE && workAfter === NO_PLACE && age >= RETIREMENT_AGE) counts.retired++;
    else if (workBefore !== NO_PLACE && workAfter === NO_PLACE) counts.fired++;
    else if (workBefore !== NO_PLACE && intAt(state, resident, RESIDENT_INT.jobTitle) > field(before, resident, RESIDENT_INT.jobTitle)) counts.promoted++;
    if (field(before, resident, RESIDENT_INT.partner) === NO_PLACE && intAt(state, resident, RESIDENT_INT.partner) !== NO_PLACE && intAt(state, resident, RESIDENT_INT.gender) === GENDER.female) counts.couples++;
  }
  return counts;
}

describe("given a city of 200 living through 150 game days of the reference's daily chances", () => {
  const days = 150;
  const state = createCityState(2024, buildFixtureMap(4), 200);
  const totals: DayCounts = { deaths: 0, births: 0, arrivals: 0, hired: 0, fired: 0, promoted: 0, retired: 0, couples: 0, employedDays: 0, deathHazard: 0, livingDays: 0 };
  const alivePerDay: number[] = [];
  const workersOutsideTheirYears: string[] = [];
  const sal = castResident(state, "sal");
  const halina = castResident(state, "halina");
  for (let day = 1; day <= days; day++) {
    const counts = playDay(state, day);
    for (const key of DAY_COUNT_KEYS) totals[key] += counts[key];
    alivePerDay.push(state.alive);
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) !== 1 || intAt(state, resident, RESIDENT_INT.work) === NO_PLACE) continue;
      const age = ageOf(state, resident, day);
      if (age < FIRST_WORKING_AGE || age >= RETIREMENT_AGE) workersOutsideTheirYears.push(`resident ${resident} aged ${age} on day ${day}`);
    }
  }

  it("when the days have passed, then people have died at about a year-of-age in 5000 a day, doubled while hurt", () => {
    expect(totals.deaths, "deaths").toBeGreaterThan(totals.deathHazard * 0.7);
    expect(totals.deaths, "deaths").toBeLessThan(totals.deathHazard * 1.4);
    expect(totals.livingDays, "resident-days lived").toBeGreaterThan(20000);
  });

  it("when the days have passed, then about 30 in 5000 of the employed were fired a day and as many promoted", () => {
    const expected = (totals.employedDays * 30) / 5000;
    expect(totals.fired, "firings").toBeGreaterThan(expected * 0.6);
    expect(totals.fired, "firings").toBeLessThan(expected * 1.5);
    expect(totals.promoted, "promotions").toBeGreaterThan(expected * 0.3);
    expect(totals.promoted, "promotions").toBeLessThan(expected * 1.5);
  });

  it("when the days have passed, then nobody under 16 or over 64 held a job on any day, and the jobless found work", () => {
    expect(workersOutsideTheirYears.slice(0, 3), "people in work outside working age").toHaveLength(0);
    expect(totals.retired, "retirements").toBeGreaterThan(5);
    expect(totals.hired, "jobs found").toBeGreaterThan(50);
  });

  it("when the days have passed, then babies were born, couples formed, and the population stayed within 15 % of its 200", () => {
    expect(totals.births, "births").toBeGreaterThan(5);
    expect(totals.couples, "new couples").toBeGreaterThan(5);
    expect(totals.arrivals, "newcomers moving in").toBeGreaterThan(5);
    expect(Math.min(...alivePerDay), "fewest alive on a day").toBeGreaterThan(200 * 0.85);
    expect(Math.max(...alivePerDay), "most alive on a day").toBeLessThan(200 * 1.15);
  });

  it("when the days have passed, then the named residents are alive and the age they started at", () => {
    expect(intAt(state, sal, RESIDENT_INT.alive), "Sal alive").toBe(1);
    expect(ageOf(state, sal, days), "Sal's age after 150 days").toBe(63);
    expect(ageOf(state, halina, days), "Mrs. Kowalski's age after 150 days").toBe(71);
  });
});
