import { describe, expect, it } from "vitest";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { FLAG, NEED, NEED_COUNT, NO_PLACE, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import { buildFixtureMap } from "./civilian-graph.test-util.ts";
import { buildingLines, civilianLine, historyLines, moodOf } from "./civilian-mood.ts";
import { EVENT_CODE, KIND_WORDS, MOOD } from "./civilian-names.ts";
import { runTicks, tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { buildAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { noteEvent, runGameDay } from "./society-day.ts";

const map = buildFixtureMap();

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function castResident(state: CityState, key: string): number {
  const found = state.cast.findIndex((resolved) => resolved.member.key === key);
  if (found === -1) throw new Error(`no cast member ${key}`);
  return found;
}

describe("given the pigeon man and the orange cat as their morning walks begin", () => {
  it("when each is looked at, then the line names them, what they are up to, where to, and how they feel", () => {
    const atSeven = createCityState(31, map, 60);
    const biscuit = castResident(atSeven, "biscuit");
    const sal = castResident(atSeven, "sal");
    runTicks(atSeven, tickOfHour(atSeven, 2, 7) - 40);
    for (let tick = 0; tick < 80 && intAt(atSeven, sal, RESIDENT_INT.legPurpose) !== PURPOSE.salPigeons; tick++) runTicks(atSeven, 1);
    const tick = atSeven.nextTick - 1;
    expect(civilianLine(atSeven, sal, tick), "line about Sal as he sets out").toBe(`Sal Russo, 63 - feeding the pigeons -> ${PLACE_NAMES.salCoop}, feeling happy`);
    const atDawn = createCityState(31, map, 60);
    runTicks(atDawn, tickOfHour(atDawn, 2, 5) + 50 * 2);
    for (let step = 0; step < 40 && intAt(atDawn, biscuit, RESIDENT_INT.legPurpose) !== PURPOSE.biscuitSteals; step++) runTicks(atDawn, 1);
    expect(civilianLine(atDawn, biscuit, atDawn.nextTick - 1), "line about the cat as it sets out").toBe(`Biscuit, an orange cat - stealing fish -> ${PLACE_NAMES.kowalskiYard}, feeling hungry`);
  });
});

describe("given an employed adult dwelling at their workplace", () => {
  const state = createCityState(31, map, 60);
  let worker = -1;
  for (let resident = state.cast.length; resident < state.capacity && worker === -1; resident++) if (intAt(state, resident, RESIDENT_INT.work) !== NO_PLACE) worker = resident;
  const workplace = map.places[intAt(state, worker, RESIDENT_INT.work)]!;
  const tick = tickOfHour(state, 2, 11);
  state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.place] = intAt(state, worker, RESIDENT_INT.work);
  state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.departTick] = tick;
  state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.arriveTick] = tick;
  state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.pathCount] = 0;
  state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.legPurpose] = NEED.work;

  function setNeeds(values: number): void {
    for (let need = 0; need < NEED_COUNT; need++) state.floats[worker * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.needs + need] = need === values ? 0.9 : 0.1;
  }

  it("when they are looked at, then the line has their name, age, job and workplace, what the walk was for and where they are", () => {
    setNeeds(-1);
    const line = civilianLine(state, worker, tick);
    expect(line.includes(` - work -> ${workplace.name}, feeling `), `"${line}" names the walk and the place`).toBe(true);
    expect(line, "line").toMatch(new RegExp(`^[A-Z]\\w+ [A-Z]\\w+, \\d+, [A-Za-z ]+ at ${workplace.name} - `));
  });

  it("when a need has grown over three quarters, then they feel it; when they have just been promoted, then they feel proud for eighteen game hours and then not", () => {
    setNeeds(NEED.food);
    expect(moodOf(state, worker, tick), "mood with food urgent").toBe(MOOD.hungry);
    setNeeds(NEED.rest);
    expect(moodOf(state, worker, tick), "mood with rest urgent").toBe(MOOD.exhausted);
    noteEvent(state, worker, EVENT_CODE.promoted, intAt(state, worker, RESIDENT_INT.work), tick);
    buildAnswer(state, tick);
    expect(moodOf(state, worker, tick + 100), "mood just after a promotion").toBe(MOOD.proud);
    expect(moodOf(state, worker, tick + 18 * 120 - 1), "mood just inside eighteen game hours").toBe(MOOD.proud);
    expect(moodOf(state, worker, tick + 18 * 120 + 1), "mood just past eighteen game hours").not.toBe(MOOD.proud);
  });

  it("when they are in hospital, then the mood is hurt and the line says so", () => {
    state.ints[worker * RESIDENT_INT_STRIDE + RESIDENT_INT.flags] |= FLAG.hurt;
    expect(moodOf(state, worker, tick), "mood in hospital").toBe(MOOD.hurt);
    expect(civilianLine(state, worker, tick), "line in hospital").toContain(", in hospital - recovering, feeling hurt");
  });
});

describe("given two hundred game days of the society's own life events", () => {
  const state = createCityState(2024, buildFixtureMap(4), 200);
  const lines = new Set<string>();
  for (let day = 1; day <= 200; day++) {
    const tick = tickOfHour(state, day, 0);
    runGameDay(state, tick);
    buildAnswer(state, tick);
    if (day % 10 === 0) for (let resident = 0; resident < state.capacity; resident++) for (const line of historyLines(state, resident)) lines.add(line);
  }

  it("when the life logs are read, then every kind of event reads as a sentence about a person or a place", () => {
    const sentences = [/^got a job at .+/, /^was fired from .+/, /^was promoted at .+/, /^retired from .+/, /^married [A-Z]\w+ [A-Z]\w+$/, /^had a baby: [A-Z]\w+ [A-Z]\w+$/, /^was born to [A-Z]\w+ [A-Z]\w+$/, /^moved (to|into) .+/, /^lost [A-Z]\w+ [A-Z]\w+$/, /^started seeing [A-Z]\w+ [A-Z]\w+$/];
    for (const sentence of sentences) expect(Array.from(lines).some((line) => sentence.test(line)), `a log line like ${sentence}`).toBe(true);
    expect(lines.has(""), "an empty log line").toBe(false);
  });
});

describe("given a day and a half of the neighbourhood", () => {
  const state = createCityState(31, map, 60);
  runTicks(state, 4300);
  let busiest = 0;
  for (let place = 0; place < map.places.length; place++) if (state.headcount[place]! > state.headcount[busiest]!) busiest = place;
  const home = intAt(state, state.cast.length, RESIDENT_INT.home);

  it("when the busiest workplace is looked at, then its lines give its kind, its staff and who went there lately", () => {
    const name = map.places[busiest]!.name;
    const { title, lines } = buildingLines(state, busiest, state.nextTick);
    expect(title, "title").toBe(name);
    expect(lines[0], "kind line").toBe(KIND_WORDS[map.places[busiest]!.kind]);
    expect(lines.some((line) => line.startsWith("works here: ")), "a line about who works there").toBe(true);
    expect(lines.some((line) => new RegExp(`^[A-Z]\\w+ [A-Z]\\w+ .+ ${name}$`).test(line)), "a line about a recent visit").toBe(true);
  });

  it("when a home is looked at, then its lines say who lives there", () => {
    const { title, lines } = buildingLines(state, home, state.nextTick);
    expect(title, "title").toBe(map.places[home]!.name);
    expect(lines[0], "kind line").toBe("home");
    expect(lines.some((line) => line.startsWith("lives here: ")), "a line about who lives there").toBe(true);
  });
});
