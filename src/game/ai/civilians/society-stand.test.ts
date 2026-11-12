import { describe, expect, it } from "vitest";
import { ACTIVITY } from "./civilian-activity.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { BODY_GAP } from "./civilian-crowd-constants.ts";
import { CLERK_SPOTS, DECISION_HZ, FLAG, NEED, NO_PLACE, NO_SEAT, PURPOSE, RESIDENT_INT, SPECIES, STAND_SPACING, STAND_SPOTS, TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { sendResidentTo } from "./civilian-plan.ts";
import { tickAt } from "./civilian-clock.ts";
import { FRAME_SECONDS, newCrowd } from "./civilian-crowd.test-util.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { applyAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { COFFEE_SHOP, intAt, placeIn, stageResident, withoutOtherCars } from "./society.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";

const EVENING = 20;
const HOME = placeIn(societyMap, "Rowhome B2-1");
const BAR = placeIn(societyMap, PLACE_NAMES.bar);
const COFFEE = placeIn(societyMap, COFFEE_SHOP);
const SHOP = placeIn(societyMap, PLACE_NAMES.bodega);
/** The bar has two seats: with this many drinkers in at once the rest stand. */
const DRINKERS = 8;
const SEATS_AT_THE_BAR = 2;
/** Ticks a customer who stops for a moment has: a quarter of a minute of game time is not a stay to hold a spot for. */
const NO_DWELL_LEFT = 8;
const AFTER_BUYING = 8;
/** A drink's stay: an hour of game time, in ticks. */
const A_DRINKS_TICKS = TICKS_PER_GAME_HOUR;

/** A busy evening at the bar: `count` drinkers, none with a car, each sent from home to the bar at once for a drink, in order. */
function busyBar(count: number): { cast: Cast; drinkers: number[] } {
  const cast = newCast(EVENING);
  const drinkers = Array.from({ length: count }, (_, at) => cast.resident + at);
  withoutOtherCars(cast.state, HOME, drinkers);
  for (const resident of drinkers) {
    stageResident(cast.state, resident, { place: HOME, home: HOME, tick: cast.tick, flags: FLAG.drinker });
    sendResidentTo(cast.state, resident, cast.tick, BAR, PURPOSE.drink, A_DRINKS_TICKS);
  }
  return { cast, drinkers };
}

const reading = new ActivityReading();
const CROWD_SIZE = 80;
const CROWD_DRINKERS = 10;
/** The crowd's clock starts here, so that the staged drinkers set out at a decision tick well after its start. */
const START_SECONDS = 6;
/** What the relaxation leaves of an overlap (m). */
const RESIDUAL = 0.005;

/** Where a resident is drawn at `seconds` into their stay, if the brain places them. */
function placedAt(state: CityState, resident: number, secondsIntoStay: number): { x: number; z: number; code: number } | null {
  const arrive = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
  readActivity(state, resident, arrive + secondsIntoStay, reading);
  return reading.placed ? { x: reading.x, z: reading.z, code: reading.code } : null;
}

function nearestPair(spots: readonly { x: number; z: number }[]): number {
  let nearest = Infinity;
  for (let first = 0; first < spots.length; first++) for (let second = first + 1; second < spots.length; second++) nearest = Math.min(nearest, hypot2(spots[first]!.x - spots[second]!.x, spots[first]!.z - spots[second]!.z));
  return nearest;
}

describe("given eight drinkers in at the bar together, which has two seats and a counter", () => {
  const { cast, drinkers } = busyBar(DRINKERS);
  const { state } = cast;
  const atBar = drinkers.filter((resident) => intAt(state, resident, RESIDENT_INT.place) === BAR);
  const seated = atBar.filter((resident) => intAt(state, resident, RESIDENT_INT.seat) < state.venues.seatCount[BAR]!);
  const standing = atBar.filter((resident) => intAt(state, resident, RESIDENT_INT.seat) >= state.venues.seatCount[BAR]!);

  it("when they have all set out, then everyone is going to the bar, two take its seats and six each take a standing spot of their own, and no one is left without", () => {
    expect(atBar.length, "drinkers going to the bar").toBe(DRINKERS);
    expect(seated.length, "drinkers with a seat").toBe(SEATS_AT_THE_BAR);
    expect(standing.length, "drinkers with a standing spot").toBe(DRINKERS - SEATS_AT_THE_BAR);
    expect(new Set(atBar.map((resident) => intAt(state, resident, RESIDENT_INT.seat))).size, "different seats and spots held").toBe(DRINKERS);
    expect(atBar.filter((resident) => intAt(state, resident, RESIDENT_INT.seat) === NO_SEAT).length, "drinkers with nothing").toBe(0);
  });

  it("when the standing ones are drawn after buying, then each stands on a spot of their own, a standing spot's spacing from every other, and is fixed there", () => {
    const spots = standing.map((resident) => placedAt(state, resident, AFTER_BUYING)!);
    expect(spots.every((spot) => spot !== null), "every standing drinker is placed").toBe(true);
    expect(nearestPair(spots), "metres between the two nearest").toBeGreaterThanOrEqual(STAND_SPACING - 0.001);
    expect(STAND_SPACING, "a standing spot's spacing against a body's width").toBeGreaterThan(BODY_GAP);
    for (const resident of standing) {
      placedAt(state, resident, AFTER_BUYING);
      expect([reading.code, reading.fixed].join("/"), `activity and fixed of standing drinker ${resident}`).toBe([ACTIVITY.idle, true].join("/"));
    }
  });

  it("when they are all drawn in the moment they buy, then the standing ones are on their own spots there too, apart", () => {
    const spots = standing.map((resident) => placedAt(state, resident, 1)!);
    expect(spots.every((spot) => spot !== null && spot.code === ACTIVITY.buy), "every standing drinker buys at their spot").toBe(true);
    expect(nearestPair(spots), "metres between the two nearest").toBeGreaterThanOrEqual(STAND_SPACING - 0.001);
  });
});

describe("given more drinkers than the bar has seats and standing spots", () => {
  const { cast, drinkers } = busyBar(SEATS_AT_THE_BAR + STAND_SPOTS + 3);
  const { state } = cast;

  it("when they have all set out, then the three who found no spot hold none and are not drawn inside, and no spot has two holders", () => {
    const without = drinkers.filter((resident) => intAt(state, resident, RESIDENT_INT.place) === BAR && intAt(state, resident, RESIDENT_INT.seat) === NO_SEAT);
    expect(without.length, "drinkers without a spot").toBe(3);
    for (const resident of without) expect(placedAt(state, resident, AFTER_BUYING), `where drinker ${resident} without a spot is drawn after buying`).toBeNull();
    const held = drinkers.map((resident) => intAt(state, resident, RESIDENT_INT.seat)).filter((spot) => spot !== NO_SEAT);
    expect(new Set(held).size, "different spots held").toBe(held.length);
  });
});

describe("given four clerks at a coffee shop that has clerk spots", () => {
  const cast = newCast(EVENING);
  const { state } = cast;
  const clerks = [cast.resident, cast.resident + 1, cast.resident + 2, cast.resident + 3];
  withoutOtherCars(state, HOME, clerks);
  for (const clerk of clerks) {
    stageResident(state, clerk, { place: HOME, home: HOME, work: COFFEE, shiftStart: EVENING, tick: cast.tick });
    sendResidentTo(state, clerk, cast.tick, COFFEE, NEED.work, A_DRINKS_TICKS);
  }

  it("when the clerks are at work, then three have a clerk spot of their own, a spot's spacing apart behind the counter, and the fourth has none and is not drawn", () => {
    const spots = clerks.map((clerk) => intAt(state, clerk, RESIDENT_INT.seat));
    const held = spots.filter((spot) => spot !== NO_SEAT);
    expect(held.length, "clerks with a spot").toBe(CLERK_SPOTS);
    expect(new Set(held).size, "different spots").toBe(CLERK_SPOTS);
    const placed = clerks.filter((clerk) => intAt(state, clerk, RESIDENT_INT.seat) !== NO_SEAT).map((clerk) => placedAt(state, clerk, AFTER_BUYING)!);
    expect(placed.every((spot) => spot !== null && spot.code === ACTIVITY.idle), "every clerk with a spot is placed, idle").toBe(true);
    expect(nearestPair(placed), "metres between the two nearest clerks").toBeGreaterThanOrEqual(STAND_SPACING - 0.001);
    const lost = clerks.find((clerk) => intAt(state, clerk, RESIDENT_INT.seat) === NO_SEAT)!;
    expect(placedAt(state, lost, AFTER_BUYING), "where the clerk without a spot is drawn").toBeNull();
  });
});

describe("given customers who stop for a moment at the bodega, too briefly to hold a spot", () => {
  it("when they buy, then each is drawn on a lane of the counter, buying, and not fixed: the crowd keeps those who share a lane apart", () => {
    const cast = newCast(EVENING);
    const { state } = cast;
    const people = [cast.resident, cast.resident + 1, cast.resident + 2];
    for (const resident of people) stageResident(state, resident, { place: SHOP, home: HOME, tick: cast.tick, dwell: 1, nextDecision: cast.tick + NO_DWELL_LEFT });
    for (const resident of people) {
      placedAt(state, resident, 0.2);
      expect([reading.code, reading.placed, reading.fixed].join("/"), `activity, placed and fixed of customer ${resident}`).toBe([ACTIVITY.buy, true, false].join("/"));
      expect(intAt(state, resident, RESIDENT_INT.seat), "spot held").toBe(NO_SEAT);
    }
  });
});

describe("given a crowd with a busy evening at the bar: ten drinkers sent there from one door", () => {
  it("when it is drawn from the first one's arrival to the last one's, then no two people drawn inside the bar are ever closer than a body's width", () => {
    const crowd = newCrowd(societyMap, CROWD_SIZE);
    crowd.step(START_SECONDS, [], true);
    const { state } = crowd;
    const startTick = tickAt(START_SECONDS);
    const drinkers: number[] = [];
    for (let resident = 0; resident < state.capacity && drinkers.length < CROWD_DRINKERS; resident++) {
      if (intAt(state, resident, RESIDENT_INT.alive) === 1 && intAt(state, resident, RESIDENT_INT.species) === SPECIES.person && intAt(state, resident, RESIDENT_INT.home) !== BAR) drinkers.push(resident);
    }
    withoutOtherCars(state, HOME, drinkers);
    for (const resident of drinkers) {
      const home = intAt(state, resident, RESIDENT_INT.home);
      stageResident(state, resident, { place: home, home, tick: startTick, nextDecision: startTick + 4 * A_DRINKS_TICKS, flags: FLAG.drinker });
      sendResidentTo(state, resident, startTick, BAR, PURPOSE.drink, A_DRINKS_TICKS);
    }
    const lastArrival = Math.max(...drinkers.map((resident) => intAt(state, resident, RESIDENT_INT.arriveTick))) / DECISION_HZ;
    let closest = Infinity;
    let inside = 0;
    for (let seconds = START_SECONDS + FRAME_SECONDS; seconds < lastArrival + AFTER_BUYING; seconds += FRAME_SECONDS) {
      crowd.step(seconds, [], true);
      const spots: { x: number; z: number }[] = [];
      for (const resident of drinkers) {
        const arrive = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
        if (seconds >= arrive && crowd.poses.shown[resident] === 1) spots.push({ x: crowd.poses.x[resident]!, z: crowd.poses.z[resident]! });
      }
      inside = Math.max(inside, spots.length);
      if (spots.length > 1) closest = Math.min(closest, nearestPair(spots));
    }
    expect(inside, "most drinkers drawn inside at once").toBeGreaterThan(SEATS_AT_THE_BAR);
    expect(closest, "metres between the two nearest people drawn inside the bar").toBeGreaterThanOrEqual(BODY_GAP - RESIDUAL);
  });
});

/** Over a game day and a half, every sample: standing spots and seats never doubly held, the rows say what the owner table says, and no two people the brain places and fixes inside one venue are closer than a body's width. */
describe("given the neighbourhood living a game day and a half with seats and counters at the coffee shop, the bar and the bodega", () => {
  const state = createCityState(5, societyMap, 60);
  const mirror = createCityState(5, societyMap, 60);
  const problems: string[] = [];
  let mostStanding = 0;
  const SAMPLE_EVERY = 30;
  const TICKS = (TICKS_PER_GAME_DAY * 3) / 2;
  for (let tick = 0; tick < TICKS; tick++) {
    applyAnswer(mirror, computeTick(state, tick));
    if (tick % SAMPLE_EVERY !== 0) continue;
    const held = new Map<number, number>();
    const byPlace = new Map<number, { x: number; z: number }[]>();
    for (let resident = 0; resident < state.capacity; resident++) {
      const spot = intAt(state, resident, RESIDENT_INT.seat);
      if (spot === NO_SEAT || intAt(state, resident, RESIDENT_INT.alive) === 0) continue;
      const place = intAt(state, resident, RESIDENT_INT.place);
      const slot = state.venues.seatBase[place]! + spot;
      if (held.has(slot)) problems.push(`slot ${slot} of ${societyMap.places[place]!.name} held by ${held.get(slot)} and ${resident} at tick ${tick}`);
      held.set(slot, resident);
      if (state.seatOwner[slot] !== resident) problems.push(`owner table says ${state.seatOwner[slot]} for resident ${resident}'s slot at tick ${tick}`);
      const seconds = tick / DECISION_HZ;
      const arrive = intAt(state, resident, RESIDENT_INT.arriveTick) / DECISION_HZ;
      if (seconds < arrive || tick >= intAt(state, resident, RESIDENT_INT.nextDecisionTick)) continue;
      readActivity(state, resident, seconds, reading);
      if (!reading.placed || !reading.fixed) continue;
      if (spot >= state.venues.seatCount[place]!) mostStanding++;
      byPlace.set(place, [...(byPlace.get(place) ?? []), { x: reading.x, z: reading.z }]);
    }
    for (const [place, spots] of byPlace) if (nearestPair(spots) < BODY_GAP) problems.push(`two fixed people ${nearestPair(spots).toFixed(2)} m apart in ${societyMap.places[place]!.name} at tick ${tick}`);
  }

  it("when it is sampled all along, then no spot ever has two holders, the owner table agrees with the rows, and no two fixed people in one venue are closer than a body's width", () => {
    expect(problems.slice(0, 3), "problems found").toEqual([]);
    expect(mostStanding, "samples of someone standing at a spot").toBeGreaterThan(0);
  });

  it("when a city that only hears the answers has lived the same time, then it holds the same spots", () => {
    expect(stateDigest(mirror), "digest of the whole state").toBe(stateDigest(state));
    expect(mirror.seatOwner.join(","), "who owns which seat and spot").toBe(state.seatOwner.join(","));
  });

  it("when no one holds a spot, then the table is empty of them: nobody owns a slot the rows do not name", () => {
    let owned = 0;
    for (let slot = 0; slot < state.seatOwner.length; slot++) if (state.seatOwner[slot] !== NO_PLACE) owned++;
    let named = 0;
    for (let resident = 0; resident < state.capacity; resident++) if (intAt(state, resident, RESIDENT_INT.seat) !== NO_SEAT && intAt(state, resident, RESIDENT_INT.alive) === 1) named++;
    expect(owned, "slots owned").toBe(named);
  });
});
