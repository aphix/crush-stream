import { hypot2 } from "../../kernel/physics-core.js";
import { beforeAll, describe, expect, it } from "vitest";
import { PLACE_KIND } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { hourOfDay } from "./civilian-clock.ts";
import { DECISION_HZ, FLAG, FRIDAY, HOURS_PER_GAME_DAY, JOB_AGE, MAX_PATH_NODES, NEED, NEED_COUNT, NO_PLACE, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY } from "./civilian-constants.ts";
import { buildFixtureMap, placeNamed } from "./civilian-graph.test-util.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { decideResident } from "./civilian-plan.ts";
import { tickOfHour } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { weekdayOf } from "./civilian-story.ts";
import { ageOf } from "./society-day.ts";

const map = buildFixtureMap();

function intAt(state: CityState, resident: number, field: number): number {
  return state.ints[resident * RESIDENT_INT_STRIDE + field]!;
}

/** The first generated adult for whom `fits`: the person a scene is staged with. */
function adultWhere(state: CityState, fits: (resident: number) => boolean): number {
  for (let resident = state.cast.length; resident < state.capacity; resident++) {
    if (intAt(state, resident, RESIDENT_INT.alive) === 1 && ageOf(state, resident, 0) >= JOB_AGE && fits(resident)) return resident;
  }
  throw new Error("no such resident");
}

/** Has resident `resident` dwelling at `place` since `tick` with the given needs, as a decision at `tick` will find them. */
function dwellingWithNeeds(state: CityState, resident: number, place: number, tick: number, needs: readonly number[]): void {
  const base = resident * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.place] = place;
  state.ints[base + RESIDENT_INT.fromPlace] = place;
  state.ints[base + RESIDENT_INT.departTick] = tick;
  state.ints[base + RESIDENT_INT.arriveTick] = tick;
  state.ints[base + RESIDENT_INT.pathCount] = 0;
  for (let need = 0; need < NEED_COUNT; need++) state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.needs + need] = needs[need]!;
}

const CALM = 0.1;
const needsOf = (urgent: number): number[] => Array.from({ length: NEED_COUNT }, (_, need) => (need === urgent ? 1 : CALM));

describe("given a resident at home whose needs are set and a decision comes due on day 2", () => {
  it("when they are hungry at noon, then they set out for a place to eat", () => {
    const state = createCityState(5, map, 60);
    const resident = adultWhere(state, () => true);
    const tick = tickOfHour(state, 2, 12);
    dwellingWithNeeds(state, resident, intAt(state, resident, RESIDENT_INT.home), tick, needsOf(NEED.food));
    decideResident(state, resident, tick);
    expect(map.places[intAt(state, resident, RESIDENT_INT.place)]!.kind, "kind of the place they head for").toBe(PLACE_KIND.food);
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the walk (or drive, for a car owner) is for").toBe(NEED.food);
    expect(intAt(state, resident, RESIDENT_INT.pathCount), "nodes on the walk").toBeGreaterThan(1);
  });

  it("when they are worn out at midnight away from home, then they head home", () => {
    const state = createCityState(5, map, 60);
    const resident = adultWhere(state, () => true);
    const tick = tickOfHour(state, 2, 23);
    dwellingWithNeeds(state, resident, placeNamed(map, PLACE_NAMES.bodega), tick, needsOf(NEED.rest));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they head for").toBe(intAt(state, resident, RESIDENT_INT.home));
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the walk is for").toBe(NEED.rest);
  });

  it("when they have a job and their shift is starting, then they set out for work", () => {
    const state = createCityState(5, map, 60);
    const opensForShift = (candidate: number): boolean => {
      const work = intAt(state, candidate, RESIDENT_INT.work);
      return work !== NO_PLACE && state.venues.hourWeight[work * HOURS_PER_GAME_DAY + intAt(state, candidate, RESIDENT_INT.shiftStart)]! >= 1;
    };
    const resident = adultWhere(state, opensForShift);
    const tick = tickOfHour(state, 2, intAt(state, resident, RESIDENT_INT.shiftStart));
    dwellingWithNeeds(state, resident, intAt(state, resident, RESIDENT_INT.home), tick, needsOf(NEED.work));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they head for").toBe(intAt(state, resident, RESIDENT_INT.work));
    expect(intAt(state, resident, RESIDENT_INT.legPurpose), "what the walk (or drive, for a car owner) is for").toBe(NEED.work);
  });

  it("when nothing is pressing, then they stay where they are", () => {
    const state = createCityState(5, map, 60);
    const resident = adultWhere(state, () => true);
    const home = intAt(state, resident, RESIDENT_INT.home);
    const tick = tickOfHour(state, 2, 12);
    dwellingWithNeeds(state, resident, home, tick, needsOf(-1));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they stay at").toBe(home);
    expect(intAt(state, resident, RESIDENT_INT.pathCount), "nodes on a walk").toBe(0);
    expect(intAt(state, resident, RESIDENT_INT.nextDecisionTick), "when they decide again").toBeGreaterThan(tick);
  });
});

describe("given a resident with company on their mind whose home is by the court in the park", () => {
  const state = createCityState(5, map, 60);
  const park = placeNamed(map, PLACE_NAMES.parkCourt);
  const nextDoor = placeNamed(map, "Rowhome B2-1");
  const resident = adultWhere(state, (candidate) => intAt(state, candidate, RESIDENT_INT.home) === nextDoor);
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteHangout] = park;
  let evening = 2;
  while (weekdayOf(state, evening) === FRIDAY) evening++;

  function headsOutAt(day: number, hour: number): number {
    const tick = tickOfHour(state, day, hour);
    dwellingWithNeeds(state, resident, nextDoor, tick, needsOf(NEED.social));
    decideResident(state, resident, tick);
    return intAt(state, resident, RESIDENT_INT.place);
  }

  it("when it is four in the afternoon, then they go to the court", () => {
    expect(headsOutAt(evening, 16), "place they head for at 16:00").toBe(park);
  });

  it("when it is nine at night and the court is empty, then they do not go to the court: they stay in, or go where it is open, the bar", () => {
    const bar = placeNamed(map, PLACE_NAMES.bar);
    expect([nextDoor, bar], "place they are at after deciding at 21:00").toContain(headsOutAt(evening, 21));
    expect(headsOutAt(evening, 21), "place they are at after deciding at 21:00").not.toBe(park);
  });
});

describe("given a shop and a workplace that are shut, with nobody afraid of them", () => {
  it("when someone at the shut shop wants an errand, then they leave for another shop, and while it is open they stay", () => {
    const state = createCityState(5, map, 60);
    const resident = adultWhere(state, () => true);
    const bodega = placeNamed(map, PLACE_NAMES.bodega);
    const tick = tickOfHour(state, 2, 11);
    dwellingWithNeeds(state, resident, bodega, tick, needsOf(NEED.errand));
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteShop] = bodega;
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they are at while the shop is open").toBe(bodega);
    state.closedUntilTick[bodega] = tick + 1000;
    dwellingWithNeeds(state, resident, bodega, tick, needsOf(NEED.errand));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they head for while it is shut").not.toBe(bodega);
    expect(intAt(state, resident, RESIDENT_INT.pathCount), "nodes on their walk").toBeGreaterThan(1);
  });

  it("when someone's workplace is shut at the start of their shift, then they do not set out for it", () => {
    const state = createCityState(5, map, 60);
    const resident = adultWhere(state, (candidate) => intAt(state, candidate, RESIDENT_INT.work) !== NO_PLACE);
    const work = intAt(state, resident, RESIDENT_INT.work);
    const tick = tickOfHour(state, 2, intAt(state, resident, RESIDENT_INT.shiftStart));
    state.closedUntilTick[work] = tick + 1000;
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.flags] |= FLAG.laidOff;
    dwellingWithNeeds(state, resident, intAt(state, resident, RESIDENT_INT.home), tick, needsOf(NEED.work));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "place they are at after deciding").not.toBe(work);
  });

  // mutation: sed -i 's/planLeg(state, resident, tick, place, purpose, dwell, customer)/planLeg(state, resident, tick, place, purpose, dwell)/' src/game/ai/civilians/civilian-plan.ts
  it("when the only open shop is open as she decides but her walk there would end after it shuts, then she does not set out for it; at noon she does", () => {
    const bodega = placeNamed(map, PLACE_NAMES.bodega);
    const errandAt = (tickOf: (state: CityState) => number) => {
      const state = createCityState(5, map, 60);
      for (const shop of state.index.byKind[PLACE_KIND.shop]!) if (shop !== bodega) state.closedUntilTick[shop] = TICKS_PER_GAME_DAY * 10;
      const resident = adultWhere(state, () => true);
      state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteShop] = bodega;
      const tick = tickOf(state);
      dwellingWithNeeds(state, resident, intAt(state, resident, RESIDENT_INT.home), tick, needsOf(NEED.errand));
      decideResident(state, resident, tick);
      return { state, tick, place: intAt(state, resident, RESIDENT_INT.place), walk: intAt(state, resident, RESIDENT_INT.arriveTick) - tick };
    };
    const noon = errandAt((state) => tickOfHour(state, 2, 12));
    expect(noon.place, "control: at noon she heads for the bodega").toBe(bodega);
    const late = errandAt((state) => tickOfHour(state, 2, 22) - Math.floor(noon.walk / 2));
    const weightAt = (tick: number): number => late.state.venues.hourWeight[bodega * HOURS_PER_GAME_DAY + hourOfDay(tick, late.state.startHour)]!;
    expect(weightAt(late.tick), "control: open as she decides").toBe(1);
    expect(weightAt(late.tick + noon.walk), "control: shut when her walk would end").toBeLessThan(1);
    expect(late.place, "where she is after deciding, half her walk before closing").not.toBe(bodega);
  });

  // mutation: sed -i 's/ \&\& home !== current \&\& !withinHours(state, current, tick);/ \&\& home !== current \&\& false;/' src/game/ai/civilians/civilian-plan.ts
  it("when a customer is at the shop after it has shut and wants nothing pressing, then she walks home rather than staying inside", () => {
    const state = createCityState(5, map, 60);
    const bodega = placeNamed(map, PLACE_NAMES.bodega);
    const resident = adultWhere(state, (candidate) => intAt(state, candidate, RESIDENT_INT.work) !== bodega && intAt(state, candidate, RESIDENT_INT.home) !== bodega);
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.favouriteShop] = bodega;
    const tick = tickOfHour(state, 2, 23);
    expect(state.venues.hourWeight[bodega * HOURS_PER_GAME_DAY + 23], "control: the shop is shut at 23:00").toBeLessThan(1);
    dwellingWithNeeds(state, resident, bodega, tick, needsOf(NEED.errand));
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "where she heads").toBe(intAt(state, resident, RESIDENT_INT.home));
    expect(intAt(state, resident, RESIDENT_INT.pathCount), "nodes on her walk").toBeGreaterThan(1);
  });
});

/** Steps a city of 60 through `days` game days, handing each tick's answer to `each`. */
function liveThrough(days: number, each: (state: CityState, answerTick: number, rows: readonly number[]) => void): CityState {
  const state = createCityState(31, map, 60);
  for (let tick = 0; tick < days * TICKS_PER_GAME_DAY; tick++) {
    const answer = computeTick(state, tick);
    each(state, tick, Array.from(answer.residents));
  }
  return state;
}

function edgeExists(from: number, to: number): boolean {
  const graph = map.graph;
  for (let edge = graph.edgeStart[from]!; edge < graph.edgeStart[from + 1]!; edge++) if (graph.edgeTo[edge] === to) return true;
  return false;
}

describe("given the neighbourhood living through a game day", () => {
  const legs: { from: number; to: number; nodes: number[]; purpose: number; departTick: number; tick: number }[] = [];
  const placesEverIn = new Set<number>();
  beforeAll(() => {
    liveThrough(1, (state, tick, rows) => {
    for (const resident of rows) {
      const count = intAt(state, resident, RESIDENT_INT.pathCount);
      placesEverIn.add(intAt(state, resident, RESIDENT_INT.place));
      if (count === 0) continue;
      const nodes = Array.from(state.pathNodes.subarray(resident * MAX_PATH_NODES, resident * MAX_PATH_NODES + count));
      legs.push({ from: intAt(state, resident, RESIDENT_INT.fromPlace), to: intAt(state, resident, RESIDENT_INT.place), nodes, purpose: intAt(state, resident, RESIDENT_INT.legPurpose), departTick: intAt(state, resident, RESIDENT_INT.departTick), tick });
    }
    });
  });

  it("when every walk they set out on is read, then each follows the streets from the door it leaves to the door it is going to", () => {
    expect(legs.length, "walks planned in a day").toBeGreaterThan(40);
    for (const leg of legs) {
      expect(leg.nodes[0], `first node of a walk from ${map.places[leg.from]!.name}`).toBe(map.places[leg.from]!.doorNode);
      expect(leg.nodes[leg.nodes.length - 1], `last node of a walk to ${map.places[leg.to]!.name}`).toBe(map.places[leg.to]!.doorNode);
      for (let step = 1; step < leg.nodes.length; step++) expect(edgeExists(leg.nodes[step - 1]!, leg.nodes[step]!), `street from ${leg.nodes[step - 1]} to ${leg.nodes[step]}`).toBe(true);
      expect(leg.departTick, "tick a walk sets out on").toBeLessThanOrEqual(leg.tick);
    }
  });

  it("when the day is over, then nobody has been anywhere beyond the walls, and the only way out of the neighbourhood is the bus stop on Moore", () => {
    for (const place of placesEverIn) expect(map.places[place]!.doorNode, `door of place ${map.places[place]!.name}`).toBeGreaterThanOrEqual(0);
    const toTheBus = legs.filter((leg) => leg.purpose === PURPOSE.busAway);
    expect(toTheBus.length, "walks to leave by bus").toBeGreaterThan(0);
    for (const leg of toTheBus) expect(Array.from(map.portals), `portals holding the door of ${map.places[leg.to]!.name}`).toContain(map.places[leg.to]!.doorNode);
  });
});

describe("given a resident whose walk is under way", () => {
  const state = createCityState(31, map, 60);
  const pose = new LegPose();
  let walker = -1;
  for (let tick = 0; tick < 2000 && walker === -1; tick++) {
    computeTick(state, tick);
    for (let resident = 0; resident < state.capacity; resident++) {
      const legTicks = intAt(state, resident, RESIDENT_INT.arriveTick) - intAt(state, resident, RESIDENT_INT.departTick);
      if (intAt(state, resident, RESIDENT_INT.pathCount) > 4 && legTicks > 40 && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person) walker = resident;
    }
  }
  const depart = intAt(state, walker, RESIDENT_INT.departTick) / DECISION_HZ;
  const arrive = intAt(state, walker, RESIDENT_INT.arriveTick) / DECISION_HZ;
  const speed = state.floats[walker * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  const from = map.places[intAt(state, walker, RESIDENT_INT.fromPlace)]!;
  const to = map.places[intAt(state, walker, RESIDENT_INT.place)]!;

  it("when they are asked for where they are as they set out and as they arrive, then they stand at the door they left and at the door they came to", () => {
    expect(legPose(state, walker, depart, pose), "on the walk as it starts").toBe(true);
    expect(pose.x, "x as they set out").toBeCloseTo(from.doorX, 3);
    expect(pose.z, "z as they set out").toBeCloseTo(from.doorZ, 3);
    expect(legPose(state, walker, arrive - 0.001, pose), "on the walk until it ends").toBe(true);
    expect(hypot2(pose.x - to.doorX, pose.z - to.doorZ), "metres from the door as they arrive").toBeLessThan(0.01);
    expect(legPose(state, walker, arrive, pose), "on the walk once it ends").toBe(false);
    expect(legPose(state, walker, depart - 0.5, pose), "on the walk before it starts").toBe(false);
  });

  it("when they are asked for where they are all along the walk, then they move at their own walking pace", () => {
    const seconds = (arrive - depart) / 40;
    const before = new LegPose();
    legPose(state, walker, depart, before);
    let longest = 0;
    for (let sample = 1; sample < 40; sample++) {
      legPose(state, walker, depart + sample * seconds, pose);
      longest = Math.max(longest, hypot2(pose.x - before.x, pose.z - before.z));
      before.x = pose.x;
      before.z = pose.z;
    }
    expect(longest, "most metres moved between two samples").toBeLessThan(speed * seconds + 0.3);
    expect(longest, "most metres moved between two samples").toBeGreaterThan(speed * seconds * 0.5);
  });

  it("when the same moment is asked twice, then the answer is the same", () => {
    const again = new LegPose();
    legPose(state, walker, depart + 3, pose);
    legPose(state, walker, depart + 3, again);
    expect(again.x, "x asked twice").toBe(pose.x);
    expect(again.z, "z asked twice").toBe(pose.z);
    expect(again.yaw, "heading asked twice").toBe(pose.yaw);
  });
});
