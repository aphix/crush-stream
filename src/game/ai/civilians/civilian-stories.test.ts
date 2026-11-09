import { describe, expect, it } from "vitest";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { FRIDAY, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, SATURDAY, SPECIES, TICKS_PER_GAME_MINUTE } from "./civilian-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { historyLines, moodOf } from "./civilian-mood.ts";
import { MOOD } from "./civilian-names.ts";
import { runTicks, tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { blockOfDay, newAppointmentSlot, nextAppointment, weekdayOf } from "./civilian-story.ts";
import { createCityState } from "./society.ts";

const map = buildFixtureMap();

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

function castResident(state: CityState, key: string): number {
  const found = state.cast.findIndex((resolved) => resolved.member.key === key);
  if (found === -1) throw new Error(`no cast member ${key}`);
  return found;
}

/** A city of 60 stepped through `tick` (that tick included). */
function cityAt(tick: number, seed = 31): CityState {
  const state = createCityState(seed, map, 60);
  runTicks(state, tick + 1);
  return state;
}

/** Resident is dwelling at the named place at the end of `state`'s last tick: arrived, not yet leaving. */
function isDwellingAt(state: CityState, resident: number, placeName: string): boolean {
  const tick = state.nextTick - 1;
  return intAt(state, resident, RESIDENT_INT.place) === placeNamed(map, placeName) && intAt(state, resident, RESIDENT_INT.arriveTick) <= tick && tick < intAt(state, resident, RESIDENT_INT.nextDecisionTick);
}

/** The first game day from day 1 on that falls on `weekday`. */
function dayFallingOn(state: CityState, weekday: number): number {
  for (let day = 1; day <= 7; day++) if (weekdayOf(state, day) === weekday) return day;
  throw new Error("no such weekday in a week");
}

describe("given the neighbourhood on its first days", () => {
  const probe = createCityState(31, map, 60);

  it("when it is seven in the morning on each of three days, then Sal is at his pigeon coop", () => {
    const sal = castResident(probe, "sal");
    for (let day = 1; day <= 3; day++) {
      const state = cityAt(tickOfHour(probe, day, 7));
      expect(isDwellingAt(state, sal, PLACE_NAMES.salCoop), `Sal at the coop at 7:00 on day ${day}`).toBe(true);
      expect(historyLines(state, sal)[0], `Sal's last log line on day ${day}`).toBe(`fed the pigeons at ${PLACE_NAMES.salCoop}`);
    }
  });

  it("when it is five past eleven at night, then Dee has reached the bodega for her coffee", () => {
    const dee = castResident(probe, "dee");
    const state = cityAt(tickOfHour(probe, 2, 23) + 5 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(state, dee, PLACE_NAMES.bodega), "Dee at the bodega at 23:05").toBe(true);
    expect(intAt(state, dee, RESIDENT_INT.legPurpose), "why she is there").toBe(PURPOSE.deeCoffee);
  });

  it("when dawn breaks, then Biscuit is in Mrs. Kowalski's yard and she is out there with her broom, angry", () => {
    const biscuit = castResident(probe, "biscuit");
    const halina = castResident(probe, "halina");
    const biscuitAt = cityAt(tickOfHour(probe, 2, 5) + 55 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(biscuitAt, biscuit, PLACE_NAMES.kowalskiYard), "Biscuit in the yard at 5:55").toBe(true);
    const halinaAt = cityAt(tickOfHour(probe, 2, 6) + 2 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(halinaAt, halina, PLACE_NAMES.kowalskiYard), "Mrs. Kowalski in the yard at 6:02").toBe(true);
    expect(moodOf(halinaAt, halina, halinaAt.nextTick - 1), "her mood with the broom in hand").toBe(MOOD.angry);
  });

  it("when it is Friday evening, then the Okafors are up on their rooftop deck, and on another evening they are not", () => {
    const friday = dayFallingOn(probe, FRIDAY);
    const emeka = castResident(probe, "emeka");
    const party = cityAt(tickOfHour(probe, friday, 19) + 10 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(party, emeka, PLACE_NAMES.okaforDeck), "Emeka on the deck on a Friday at 19:10").toBe(true);
    const sunday = dayFallingOn(probe, SATURDAY) + 1;
    const quiet = cityAt(tickOfHour(probe, sunday, 19) + 10 * TICKS_PER_GAME_MINUTE);
    expect(weekdayOf(quiet, sunday), "the other evening is not a Friday").not.toBe(FRIDAY);
    expect(isDwellingAt(quiet, emeka, PLACE_NAMES.okaforDeck), "Emeka on the deck on another evening").toBe(false);
  });

  it("when it is Saturday morning, then the van's owner is at the van in the alley", () => {
    const vince = castResident(probe, "vince");
    const state = cityAt(tickOfHour(probe, dayFallingOn(probe, SATURDAY), 10) + 5 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(state, vince, PLACE_NAMES.vanAlley), "Vince at the van at 10:05 on a Saturday").toBe(true);
  });

  it("when the bodega dog sets out in the afternoon, then the tabby gang runs from the park as he gets there", () => {
    const duke = castResident(probe, "duke");
    const tux = castResident(probe, "tux");
    const before = cityAt(tickOfHour(probe, 2, 15) + 4 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(before, tux, PLACE_NAMES.parkCourt), "a tabby in the park at 15:04").toBe(true);
    expect(intAt(before, duke, RESIDENT_INT.species), "Duke is a dog").toBe(SPECIES.dog);
    const dukeArrives = cityAt(tickOfHour(probe, 2, 15) + 9 * TICKS_PER_GAME_MINUTE);
    expect(isDwellingAt(dukeArrives, duke, PLACE_NAMES.parkCourt), "the dog in the park at 15:09").toBe(true);
    expect(isDwellingAt(dukeArrives, tux, PLACE_NAMES.parkCourt), "the tabby still in the park at 15:09").toBe(false);
  });
});

describe("given a flyer-poster and the days of a week", () => {
  const state = createCityState(31, map, 60);
  const jamal = castResident(state, "jamal");

  it("when each day's first appointment of his is read, then the block he walks differs from the day before and no block is left out in nine days", () => {
    const blocks: number[] = [];
    const slot = newAppointmentSlot();
    for (let day = 1; day <= 9; day++) {
      expect(nextAppointment(state, jamal, tickOfHour(state, day, 9), slot), `an appointment on day ${day}`).toBe(true);
      blocks.push(state.index.blockOf[slot.place]!);
      expect(blockOfDay(state.seed, day), `block of day ${day}`).toBe(blocks[day - 1]);
    }
    for (let day = 1; day < blocks.length; day++) expect(blocks[day], `block on day ${day + 1} against the day before`).not.toBe(blocks[day - 1]);
    expect(new Set(blocks).size, "blocks walked in nine days").toBe(9);
  });

  it("when two days pass, then he walks out with flyers only to places on that day's block", () => {
    const walks: number[] = [];
    const city = createCityState(31, map, 60);
    const target = tickOfHour(city, 3, 0);
    runTicks(city, tickOfHour(city, 2, 0));
    while (city.nextTick < target) {
      runTicks(city, 1);
      if (intAt(city, jamal, RESIDENT_INT.legPurpose) === PURPOSE.jamalFlyers && intAt(city, jamal, RESIDENT_INT.departTick) === city.nextTick - 1) walks.push(city.index.blockOf[intAt(city, jamal, RESIDENT_INT.place)]!);
    }
    expect(walks.length, "walks out with flyers on day 2").toBeGreaterThanOrEqual(2);
    for (const block of walks) expect(block, "block of a flyer walk on day 2").toBe(blockOfDay(city.seed, 2));
  });
});
