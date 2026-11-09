import { describe, expect, it } from "vitest";
import { ACTIVITY } from "./civilian-activity.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { DRIVE_SPEED, FLAG, NEED, NO_PLACE, NO_SEAT, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { INTERACTIONS } from "./society-table.ts";
import { SCENES, decideScene, newCast, societyMap, type Cast, type Outcome, type Scene } from "./society-scenes.test-util.ts";
import { COFFEE_SHOP, SUPERMARKET, decideAs, intAt, needsWith, placeIn, stageResident } from "./society.test-util.ts";

const HOUR_TICKS = TICKS_PER_GAME_HOUR;
/** Decisions a certain row is asked for, and a crime row (which fires in a share of them). */
const DECISIONS = 10;
const GATED_DECISIONS = 60;
/** The crime gate is 0.3 of the decisions that allow it: the share seen over `GATED_DECISIONS` falls in this band. */
const GATED_SHARE: readonly [number, number] = [0.08, 0.55];

function outcomesOf(scene: Scene, hour: number): Outcome[] {
  const cast = newCast(hour);
  const counts = scene.gated ? GATED_DECISIONS : DECISIONS;
  return Array.from({ length: counts }, (_, count) => decideScene(scene, cast, count));
}

function isAtItsPlace(scene: Scene, outcome: Outcome): boolean {
  const entry = societyMap.places[outcome.place]!;
  return scene.place === undefined ? entry.kind === scene.placeKind : entry.name === scene.place;
}

function expectScene(scene: Scene): void {
  const outcomes = outcomesOf(scene, scene.hour);
  const hits = outcomes.filter((outcome) => outcome.purpose === scene.purpose);
  if (scene.gated) {
    expect(hits.length / outcomes.length, "share of decisions a crime row fires in").toBeGreaterThan(GATED_SHARE[0]);
    expect(hits.length / outcomes.length, "share of decisions a crime row fires in").toBeLessThan(GATED_SHARE[1]);
  } else expect(hits.length, "decisions that chose the row").toBe(outcomes.length);
  for (const hit of hits) {
    expect(isAtItsPlace(scene, hit), `place ${societyMap.places[hit.place]!.name}`).toBe(true);
    expect(hit.code, "activity after arriving").toBe(scene.activity);
    expect(hit.placed, "the brain gives the position").toBe(scene.activity !== ACTIVITY.none);
    if (scene.activity === ACTIVITY.talk) expect(hit.partner, "who they talk with").toBe(hit.cast.neighbour);
  }
}

function expectNotOutsideItsHours(name: string, scene: Scene): void {
  const row = INTERACTIONS.find((candidate) => candidate.name === name)!;
  const outside = outcomesOf(scene, row.hours[1] % 24);
  expect(outside.filter((outcome) => outcome.purpose === scene.purpose).length, `decisions at hour ${row.hours[1] % 24} that chose a row for hours ${row.hours[0]}-${row.hours[1]}`).toBe(0);
}

describe("given the interaction table and a scene staged for each of its rows", () => {
  it("when the scenes and the rows are listed, then every row has one and no scene is for a row that is not there", () => {
    expect(Object.keys(SCENES).sort(), "scenes").toEqual(INTERACTIONS.map((row) => row.name).sort());
  });

  for (const [name, scene] of Object.entries(SCENES)) {
    it(`when ${name} is staged at hour ${scene.hour}, then they go where the row says and do what it says there`, () => {
      expectScene(scene);
    });

    const row = INTERACTIONS.find((candidate) => candidate.name === name)!;
    if (row.hours[0] === 0 && row.hours[1] === 24) continue;
    it(`when ${name} is staged at hour ${row.hours[1] % 24}, where its hours have ended, then the row is not chosen`, () => {
      expectNotOutsideItsHours(name, scene);
    });
  }
});

/** A jobless coffee fan at home who also wants company, with the bar as their favourite hangout. */
function coffeeFanWantingCompany(hour: number): Cast {
  const cast = newCast(hour);
  stageResident(cast.state, cast.resident, { place: placeIn(societyMap, "Rowhome B2-1"), tick: cast.tick, flags: FLAG.coffeeFan, needs: needsWith({ [NEED.social]: 0.9 }) });
  cast.state.ints[cast.resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteHangout] = placeIn(societyMap, PLACE_NAMES.bar);
  return cast;
}

describe("given the time of day choosing between a coffee shop and a bar", () => {
  it("when it is eight in the morning, then they go for coffee, never to the bar", () => {
    const cast = coffeeFanWantingCompany(8);
    for (let count = 0; count < DECISIONS; count++) {
      decideAs(cast.state, cast.resident, cast.tick, count);
      expect(societyMap.places[intAt(cast.state, cast.resident, RESIDENT_INT.place)]!.name, `place chosen in decision ${count}`).toBe(COFFEE_SHOP);
      stageResident(cast.state, cast.resident, { place: placeIn(societyMap, "Rowhome B2-1"), tick: cast.tick, flags: FLAG.coffeeFan, needs: needsWith({ [NEED.social]: 0.9 }) });
    }
  });

  it("when it is nine at night, then they go to the bar, never for coffee", () => {
    const cast = coffeeFanWantingCompany(21);
    for (let count = 0; count < DECISIONS; count++) {
      decideAs(cast.state, cast.resident, cast.tick, count);
      expect(societyMap.places[intAt(cast.state, cast.resident, RESIDENT_INT.place)]!.name, `place chosen in decision ${count}`).toBe(PLACE_NAMES.bar);
      cast.state.ints[cast.resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteHangout] = placeIn(societyMap, PLACE_NAMES.bar);
      stageResident(cast.state, cast.resident, { place: placeIn(societyMap, "Rowhome B2-1"), tick: cast.tick, flags: FLAG.coffeeFan, needs: needsWith({ [NEED.social]: 0.9 }) });
    }
  });
});

describe("given an errand on someone's mind and the hour of the day", () => {
  function errandAt(hour: number): number {
    const cast = newCast(hour);
    stageResident(cast.state, cast.resident, { place: placeIn(societyMap, "Rowhome B2-1"), tick: cast.tick, needs: needsWith({ [NEED.errand]: 0.9 }) });
    decideAs(cast.state, cast.resident, cast.tick, 0);
    return intAt(cast.state, cast.resident, RESIDENT_INT.place);
  }

  it("when it is noon, then they go to a shop that is open, and in the small hours there is no shop they set out for", () => {
    const noon = societyMap.places[errandAt(12)]!;
    expect([PLACE_NAMES.bodega, SUPERMARKET, "Tasker Barber", "Spin Cycle Laundry", "Mifflin Mini Mart", PLACE_NAMES.busStop], "place chosen at noon: a shop, or the bus out").toContain(noon.name);
    expect(errandAt(2), "place they are at after deciding at 2:00").toBe(placeIn(societyMap, "Rowhome B2-1"));
  });
});

describe("given a tired employed resident who drinks, at the end of a shift", () => {
  const scene = SCENES["a drink after work"]!;
  const cast = newCast(scene.hour);
  decideScene(scene, cast, 0);
  const { state, resident } = cast;
  const work = placeIn(societyMap, "Mifflin Mini Mart");
  const home = placeIn(societyMap, "Rowhome B2-1");

  it("when they decide, then they set out from work for the bar", () => {
    expect(intAt(state, resident, RESIDENT_INT.fromPlace), "where they set out from").toBe(work);
    expect(societyMap.places[intAt(state, resident, RESIDENT_INT.place)]!.name, "where they are going").toBe(PLACE_NAMES.bar);
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the walk is for").toBe(PURPOSE.drink);
  });

  it("when they have had their drink and decide again, then they go home", () => {
    const leaving = intAt(state, resident, RESIDENT_INT.nextDecisionTick);
    decideAs(state, resident, leaving, 1);
    expect(intAt(state, resident, RESIDENT_INT.fromPlace), "where they set out from").toBe(placeIn(societyMap, PLACE_NAMES.bar));
    expect(intAt(state, resident, RESIDENT_INT.place), "where they are going").toBe(home);
  });
});

describe("given customers at the coffee shop, which has three seats", () => {
  const cast = newCast(8);
  const { state } = cast;
  const coffee = placeIn(societyMap, COFFEE_SHOP);
  const customers = [0, 1, 2, 3, 4].map((offset) => cast.resident + offset);
  for (const customer of customers) {
    stageResident(state, customer, { place: placeIn(societyMap, "Rowhome B2-1"), tick: cast.tick, flags: FLAG.coffeeFan });
    decideAs(state, customer, cast.tick, 0);
  }
  const held = customers.filter((customer) => intAt(state, customer, RESIDENT_INT.seat) !== NO_SEAT);

  it("when they have all come in, then three sit, each in a seat of their own, and the other two stand", () => {
    expect(customers.every((customer) => intAt(state, customer, RESIDENT_INT.place) === coffee), "everyone went to the coffee shop").toBe(true);
    expect(held.length, "customers who hold a seat").toBe(3);
    expect(new Set(held.map((customer) => intAt(state, customer, RESIDENT_INT.seat))).size, "different seats held").toBe(3);
    for (const customer of held) expect(state.seatOwner[state.venues.seatBase[coffee]! + intAt(state, customer, RESIDENT_INT.seat)], "who the seat's owner is").toBe(customer);
  });

  it("when someone who holds a seat leaves for work, then the seat is free and the next customer takes it", () => {
    const leaver = held[0]!;
    const seat = intAt(state, leaver, RESIDENT_INT.seat);
    const later = cast.tick + HOUR_TICKS;
    stageResident(state, leaver, { place: coffee, tick: later, work: placeIn(societyMap, "Moore Street Pizza"), shiftStart: 9, needs: needsWith({ [NEED.work]: 0.9 }) });
    state.ints[leaver * RESIDENT_INT_STRIDE + RESIDENT_INT.seat] = seat;
    state.seatOwner[state.venues.seatBase[coffee]! + seat] = leaver;
    decideAs(state, leaver, later, 1);
    expect(intAt(state, leaver, RESIDENT_INT.seat), "the leaver's seat after they go").toBe(NO_SEAT);
    expect(state.seatOwner[state.venues.seatBase[coffee]! + seat], "who holds the seat they left").toBe(NO_PLACE);
    const waiting = customers.find((customer) => !held.includes(customer))!;
    stageResident(state, waiting, { place: placeIn(societyMap, "Rowhome B2-1"), tick: later, flags: FLAG.coffeeFan });
    decideAs(state, waiting, later, 1);
    expect(intAt(state, waiting, RESIDENT_INT.seat), "the seat the next customer takes").toBe(seat);
  });
});

describe("given a car owner at home whose shift is starting, and one whose car is left at work", () => {
  const home = placeIn(societyMap, "Rowhome B2-1");
  const work = placeIn(societyMap, "Mifflin Mini Mart");

  function driverAt(hour: number, place: number, carPlace: number, needs: Readonly<Record<number, number>>): Cast {
    const cast = newCast(hour);
    stageResident(cast.state, cast.resident, { place, home, work, tick: cast.tick, flags: FLAG.hasCar, carPlace, needs: needsWith(needs) });
    decideAs(cast.state, cast.resident, cast.tick, 0);
    return cast;
  }

  it("when they set out for work from the car's kerb, then they drive: a drive leg at the driving pace, the car follows them to work", () => {
    const { state, resident } = driverAt(8, home, home, { [NEED.work]: 0.9 });
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the leg is").toBe(PURPOSE.drive);
    expect(intAt(state, resident, RESIDENT_INT.legReason), "what it is for").toBe(NEED.work);
    expect(state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed], "speed of the leg").toBe(DRIVE_SPEED);
    expect(intAt(state, resident, RESIDENT_INT.carPlace), "where the car will stand").toBe(work);
    const reading = new ActivityReading();
    readActivity(state, resident, (intAt(state, resident, RESIDENT_INT.departTick) + 4) / 2, reading);
    expect(reading.code, "what the drawing is told while they drive").toBe(ACTIVITY.none);
    expect(reading.placed, "the brain places nobody on a drive").toBe(false);
  });

  it("when they have left the car at work and set out from somewhere else, then they walk", () => {
    const bar = placeIn(societyMap, PLACE_NAMES.bar);
    const { state, resident } = driverAt(23, bar, work, { [NEED.rest]: 1 });
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the leg is").toBe(NEED.rest);
    expect(intAt(state, resident, RESIDENT_INT.carPlace), "where the car stands").toBe(work);
  });
});
