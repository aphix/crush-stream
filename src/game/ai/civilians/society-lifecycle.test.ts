import { describe, expect, it } from "vitest";
import { BROKE_AFTER_DAYS, CRIME_LEAN, FLAG, JOB_AGE, NO_PLACE, REFORM_CHANCE, RESIDENT_INT, RETIRE_AGE } from "./civilian-constants.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { EVENT_CODE } from "./civilian-names.ts";
import { tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { buildAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { ageOf, runGameDay } from "./society-day.ts";
import { rollCrimeDay } from "./society-crime.ts";
import { intAt, stageResident, type Stage } from "./society.test-util.ts";

const SEED = 7;
/** Rolls spread evenly over [0, 1): the share of them that turn a resident criminal is the day's chance, to a thousandth. */
const GRID = 2000;
const MIDDLE_AGE = 40;
const YOUNG_AGE = 20;

/** The share of an even spread of daily rolls that turn the staged resident into a criminal (or, for one who is, that leave them one). */
function stillCriminalShare(stage: Omit<Stage, "place" | "tick">, criminal: boolean): number {
  const map = buildFixtureMap();
  const state = createCityState(SEED, map, 60);
  const resident = state.cast.length;
  const tick = tickOfHour(state, 2, 12);
  let flagged = 0;
  for (let roll = 0; roll < GRID; roll++) {
    stageResident(state, resident, { ...stage, place: 0, tick, flags: (stage.flags ?? 0) | (criminal ? FLAG.criminal : 0) });
    rollCrimeDay(state, resident, stage.age ?? MIDDLE_AGE, (roll + 0.5) / GRID, tick);
    if ((intAt(state, resident, RESIDENT_INT.flags) & FLAG.criminal) !== 0) flagged++;
  }
  return flagged / GRID;
}

const EMPLOYED = { work: 1 };
const JOBLESS = {};
/** Out of work for the days before the roll that make the roll's day the one that makes them broke. */
const NEARLY_BROKE = { joblessDays: BROKE_AFTER_DAYS - 1 };

describe("given daily rolls spread evenly over a resident of each circumstance", () => {
  it("when an employed adult in middle age is rolled, then the chance of turning to crime is the base", () => {
    expect(stillCriminalShare(EMPLOYED, false), "share turned").toBeCloseTo(CRIME_LEAN.base, 3);
  });

  it("when the adult is out of work, then being unemployed adds its part", () => {
    expect(stillCriminalShare(JOBLESS, false), "share turned").toBeCloseTo(CRIME_LEAN.base + CRIME_LEAN.unemployed, 3);
  });

  it("when they have been out of work long enough to be broke, then being broke adds its part", () => {
    const share = stillCriminalShare(NEARLY_BROKE, false);
    expect(share, "share turned").toBeCloseTo(CRIME_LEAN.base + CRIME_LEAN.unemployed + CRIME_LEAN.broke, 3);
  });

  it("when an employed adult is angry, then being angry adds its part", () => {
    expect(stillCriminalShare({ ...EMPLOYED, moodEvent: EVENT_CODE.stoopWrecked }, false), "share turned").toBeCloseTo(CRIME_LEAN.base + CRIME_LEAN.angry, 3);
  });

  it("when an employed adult is young, then being young adds its part", () => {
    expect(stillCriminalShare({ ...EMPLOYED, age: YOUNG_AGE }, false), "share turned").toBeCloseTo(CRIME_LEAN.base + CRIME_LEAN.young, 3);
  });

  it("when someone is all of them at once, then the parts add up", () => {
    const all = CRIME_LEAN.base + CRIME_LEAN.unemployed + CRIME_LEAN.broke + CRIME_LEAN.angry + CRIME_LEAN.young;
    expect(stillCriminalShare({ ...NEARLY_BROKE, moodEvent: EVENT_CODE.stoopWrecked, age: YOUNG_AGE }, false), "share turned").toBeCloseTo(all, 3);
  });

  it("when criminals are rolled, then they give it up sooner with a job: twice the chance", () => {
    expect(1 - stillCriminalShare(JOBLESS, true), "share who gave up out of work").toBeCloseTo(REFORM_CHANCE, 3);
    expect(1 - stillCriminalShare(EMPLOYED, true), "share who gave up in work").toBeCloseTo(2 * REFORM_CHANCE, 3);
  });
});

/** The share of working-age generated residents who are criminals, among those with a job and those without, over several seeds' cities as they start. */
function startingShares(seeds: readonly number[]): { employed: number; jobless: number } {
  const counts = { employed: [0, 0], jobless: [0, 0] };
  for (const seed of seeds) {
    const state = createCityState(seed, buildFixtureMap(4), 300);
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      const age = ageOf(state, resident, 0);
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || age < JOB_AGE || age >= RETIRE_AGE) continue;
      const group = intAt(state, resident, RESIDENT_INT.work) !== NO_PLACE ? counts.employed : counts.jobless;
      group[0]!++;
      if ((intAt(state, resident, RESIDENT_INT.flags) & FLAG.criminal) !== 0) group[1]!++;
    }
  }
  return { employed: counts.employed[1]! / counts.employed[0]!, jobless: counts.jobless[1]! / counts.jobless[0]! };
}

describe("given eight cities as they start", () => {
  const shares = startingShares([1, 2, 3, 4, 5, 6, 7, 8]);

  it("when the criminals among the working-age are counted, then a few percent of the jobless are and far fewer of those in work", () => {
    expect(shares.jobless, "share of the jobless who are criminals").toBeGreaterThan(0.03);
    expect(shares.jobless, "share of the jobless who are criminals").toBeLessThan(0.2);
    expect(shares.employed, "share of the employed who are criminals").toBeLessThan(shares.jobless / 3);
  });
});

/** A city's working-age criminals and its broke, counted. */
function countCriminals(state: CityState, day: number): Set<number> {
  const criminals = new Set<number>();
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    const age = ageOf(state, resident, day);
    if (intAt(state, resident, RESIDENT_INT.alive) === 1 && age >= JOB_AGE && age < RETIRE_AGE && (intAt(state, resident, RESIDENT_INT.flags) & FLAG.criminal) !== 0) criminals.add(resident);
  }
  return criminals;
}

describe("given a city of 200 living forty game days of the daily chances", () => {
  const state = createCityState(2024, buildFixtureMap(4), 200);
  const started = countCriminals(state, 0);
  let turned = 0;
  let gaveUp = 0;
  let before = started;
  for (let day = 1; day <= 40; day++) {
    runGameDay(state, tickOfHour(state, day, 0));
    buildAnswer(state, tickOfHour(state, day, 0));
    const now = countCriminals(state, day);
    for (const resident of now) if (!before.has(resident)) turned++;
    for (const resident of before) if (!now.has(resident)) gaveUp++;
    before = now;
  }

  it("when the days have passed, then people have turned to crime and others have given it up, and the criminals are a few in a hundred", () => {
    expect(turned, "residents who turned to crime").toBeGreaterThan(0);
    expect(gaveUp, "residents who gave it up").toBeGreaterThan(0);
    expect(before.size / state.alive, "share of the city that are criminals").toBeGreaterThan(0.002);
    expect(before.size / state.alive, "share of the city that are criminals").toBeLessThan(0.15);
  });

  it("when the days have passed, then everyone out of work for the days that make someone broke is broke, and nobody else is", () => {
    for (let resident = state.cast.length; resident < state.capacity; resident++) {
      const age = ageOf(state, resident, 40);
      if (intAt(state, resident, RESIDENT_INT.alive) === 0 || age < JOB_AGE || age >= RETIRE_AGE) continue;
      const days = intAt(state, resident, RESIDENT_INT.joblessDays);
      expect((intAt(state, resident, RESIDENT_INT.flags) & FLAG.broke) !== 0, `resident ${resident} out of work ${days} days`).toBe(days >= BROKE_AFTER_DAYS);
    }
  });
});
