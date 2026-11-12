import { describe, expect, it } from "vitest";
import { ACTIVITY } from "./civilian-activity.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { BODY_GAP } from "./civilian-crowd-constants.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_LEAD_TICKS, FLAG, NEED, NO_PLACE, NO_SEAT, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES, TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { decideResident, sendResidentTo, standOutside } from "./civilian-plan.ts";
import { fleeHome } from "./society-reactions.ts";
import { tickAt } from "./civilian-clock.ts";
import { FRAME_SECONDS, newCrowd } from "./civilian-crowd.test-util.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { applyAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { COFFEE_SHOP, intAt, needsWith, placeIn, stageResident, withoutOtherCars } from "./society.test-util.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { CLERK_SPOTS, COUNTER_STRIDE, STAND_SPACING, STAND_SPOTS } from "../../world/openworld/walk-graph.ts";
import { claimSeat, claimStand, releaseSeat } from "./society-seats.ts";
import { newAppointmentSlot, nextAppointment } from "./civilian-story.ts";
import { applyIndividualEvents, queueEvents } from "./civilian-events.ts";
import { isSeatedVenue } from "./society-venues.ts";

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

  // mutation: sed -i 's/^  const keeps = here \&\& state.ints\[base + RESIDENT_INT.work\] !== place .*$/  const keeps = false;/' src/game/ai/civilians/civilian-plan.ts
  it("when the lowest standing spot comes free and every other drinker with a standing spot stays for another round, then each keeps the spot she holds", () => {
    const tick = intAt(state, drinkers[0]!, RESIDENT_INT.arriveTick) + 4;
    const standers = drinkers.filter((resident) => intAt(state, resident, RESIDENT_INT.seat) >= state.venues.seatCount[BAR]!).sort((a, b) => intAt(state, a, RESIDENT_INT.seat) - intAt(state, b, RESIDENT_INT.seat));
    expect(standers.length, "control: drinkers holding a standing spot").toBe(STAND_SPOTS);
    releaseSeat(state, standers[0]!);
    for (const resident of standers.slice(1)) {
      const before = intAt(state, resident, RESIDENT_INT.seat);
      standOutside(state, resident, tick, PURPOSE.drink, A_DRINKS_TICKS);
      expect(intAt(state, resident, RESIDENT_INT.seat), `drinker ${resident}'s spot after another round`).toBe(before);
    }
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

const city = buildOpenWorldMap(layOutLots());
const KELLYS = placeIn(city, "Kelly's Tap Room");
/** A drink's stay in a room of the city, in ticks, and the pace (m/s) she walks it. */
const ROOM_STAY = TICKS_PER_GAME_HOUR;
const ROOM_PACE = 1.4;
const ROOM_ARRIVE = 400;

/** Resident `resident` of `state` in at `place` from tick `ROOM_ARRIVE` for `ROOM_STAY`, having walked there; she holds what `claim` gives her. */
function inRoom(state: CityState, resident: number, place: number, claim: () => boolean): boolean {
  stageResident(state, resident, { place, tick: ROOM_ARRIVE + ROOM_STAY, dwell: ROOM_STAY, purpose: PURPOSE.drink });
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.fromPlace] = HOME_OF_ROOM;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = ROOM_PACE;
  return claim();
}
const HOME_OF_ROOM = placeIn(city, city.places.find((place) => place.interior === "rowhome")!.name);

/** Where she is drawn every frame from tick `from` to tick `to`, null where she is not drawn. */
function drawnBetween(state: CityState, resident: number, from: number, to: number): ({ x: number; z: number; code: number; fixed: boolean } | null)[] {
  const frames: ({ x: number; z: number; code: number; fixed: boolean } | null)[] = [];
  for (let frame = 0; frame < (to - from) / DECISION_HZ / FRAME_SECONDS; frame++) {
    readActivity(state, resident, from / DECISION_HZ + frame * FRAME_SECONDS, reading);
    frames.push(reading.placed || reading.code !== ACTIVITY.none ? { x: reading.x, z: reading.z, code: reading.code, fixed: reading.fixed } : null);
  }
  return frames;
}

/** Where she is drawn every frame of her stay in a room, null where she is not drawn. */
const drawnThrough = (state: CityState, resident: number): ({ x: number; z: number; code: number; fixed: boolean } | null)[] => drawnBetween(state, resident, ROOM_ARRIVE, ROOM_ARRIVE + ROOM_STAY);

/** Her stay's frames, then (she sets out home as it ends) those of her walk out and the first second of her leg. */
function stayAndLeave(state: CityState, resident: number): ({ x: number; z: number; code: number; fixed: boolean } | null)[] {
  const stay = drawnBetween(state, resident, intAt(state, resident, RESIDENT_INT.arriveTick), intAt(state, resident, RESIDENT_INT.nextDecisionTick));
  const leave = intAt(state, resident, RESIDENT_INT.nextDecisionTick);
  expect(sendResidentTo(state, resident, leave, HOME_OF_ROOM, NEED.rest, TICKS_PER_GAME_HOUR), "control: she sets out home").toBe(true);
  return [...stay, ...drawnBetween(state, resident, leave, intAt(state, resident, RESIDENT_INT.departTick) + DECISION_HZ)];
}

/** The longest move (m) between two drawn frames in a row. */
const longestStep = (frames: readonly ({ x: number; z: number } | null)[]): number => Math.max(...frames.slice(1).map((frame, at) => hypot2(frame!.x - frames[at]!.x, frame!.z - frames[at]!.z)));

describe("given a customer at a seat or a standing spot in a bar, a coffee shop and a store of the city, each room with an aisle", () => {
  // mutation: sed -i 's/^  if (atLane < 0) {/  if (false) {/' src/game/ai/civilians/society-activity.ts
  it("when she is drawn every frame of her stay and of her leaving, then she starts at the door, sits or stands at her spot, is at the door as her walk sets off, and never moves a metre in a frame", () => {
    for (const name of ["Kelly's Tap Room", "Daily Grind Coffee", "Bodega Supreme"]) {
      const place = placeIn(city, name);
      const state = createCityState(5, city, 60);
      const resident = state.cast.length;
      const seated = isSeatedVenue(state.venues.venueOf[place]!);
      expect(city.places[place]!.aisle, `control: ${name} has an aisle`).toBeDefined();
      expect(inRoom(state, resident, place, () => (seated ? claimSeat(state, resident, place, false) : claimStand(state, resident, place, false))), `${name}: she holds a seat or spot`).toBe(true);
      const mid = drawnThrough(state, resident)[(ROOM_STAY / DECISION_HZ / FRAME_SECONDS) >> 1]!;
      const frames = stayAndLeave(state, resident);
      const door = city.places[place]!;
      const setOff = frames.length - 1 / FRAME_SECONDS;
      expect(frames.every((frame) => frame !== null), `${name}: drawn every frame`).toBe(true);
      expect(mid.code, `${name}: what she does mid-stay`).toBe(seated ? ACTIVITY.sit : ACTIVITY.idle);
      expect(hypot2(frames[0]!.x - door.doorX, frames[0]!.z - door.doorZ), `${name}: metres from the door, first frame`).toBeLessThan(1);
      expect(hypot2(frames[setOff]!.x - door.doorX, frames[setOff]!.z - door.doorZ), `${name}: metres from the door as her walk sets off`).toBeLessThan(1);
      expect(frames[setOff]!.code, `${name}: the door clip as her walk sets off`).toBe(ACTIVITY.door);
      expect(longestStep(frames), `${name}: the longest step between frames (m)`).toBeLessThan(1);
    }
  });

  // mutation: sed -i 's/^  const keeps = here \&\& state.ints\[base + RESIDENT_INT.work\] !== place .*$/  const keeps = false;/' src/game/ai/civilians/civilian-plan.ts
  it("when she stays at the bar for another round, then she keeps her seat and is drawn sitting on through the change of round, never walking", () => {
    const state = createCityState(5, city, 60);
    const resident = state.cast.length;
    for (let other = resident + 1; other < resident + 8; other++) claimSeat(state, other, KELLYS, false);
    inRoom(state, resident, KELLYS, () => claimSeat(state, resident, KELLYS, false));
    const seat = intAt(state, resident, RESIDENT_INT.seat);
    const round = ROOM_ARRIVE + ROOM_STAY;
    const before = drawnBetween(state, resident, round - DECISION_HZ, round);
    for (let other = resident + 1; other < resident + 8; other++) releaseSeat(state, other);
    standOutside(state, resident, round, PURPOSE.drink, ROOM_STAY);
    expect(intAt(state, resident, RESIDENT_INT.seat), "her seat after the round").toBe(seat);
    const frames = [...before, ...drawnBetween(state, resident, round, round + 2 * DECISION_HZ)];
    expect(frames.every((frame) => frame?.code === ACTIVITY.sit), "sitting every frame across the round").toBe(true);
    expect(longestStep(frames), "the longest step between frames (m)").toBe(0);
  });
});

describe("given Kelly's Tap Room with every seat and standing spot by its counter taken", () => {
  const state = createCityState(5, city, 150);
  const counter = city.places[KELLYS]!.counter!;
  let next = state.cast.length;
  while (claimSeat(state, next, KELLYS, false)) next++;
  for (let spot = 0; spot < STAND_SPOTS; spot++) claimStand(state, next++, KELLYS, false);
  const roomers: number[] = [];
  for (;;) {
    const resident = next++;
    if (!inRoom(state, resident, KELLYS, () => claimStand(state, resident, KELLYS, false))) break;
    roomers.push(resident);
  }
  const late = next;

  // mutation: sed -i 's/^    standCount\[place\] = counterSpots >= 1 ? STAND_SPOTS + (entry.standRoom?.length ?? 0) : 0;/    standCount[place] = counterSpots >= 1 ? STAND_SPOTS : 0;/' src/game/ai/civilians/society-venues.ts
  it("when more customers come in, then each takes a spot of her own in the room's standing room, drawn mid-stay standing loose on the customers' side, a metre from the next", () => {
    expect(roomers.length, "customers in the standing room").toBe(city.places[KELLYS]!.standRoom!.length);
    const spots = roomers.map((resident) => drawnThrough(state, resident)[(ROOM_STAY / DECISION_HZ / FRAME_SECONDS) >> 1]);
    for (const spot of spots) {
      expect([spot?.code, spot?.fixed].join("/"), "what she does mid-stay, and fixed").toBe([ACTIVITY.idle, false].join("/"));
      const towardCustomers = (spot!.x - counter[COUNTER_STRIDE]!) * (counter[0]! - counter[COUNTER_STRIDE]!) + (spot!.z - counter[COUNTER_STRIDE + 1]!) * (counter[1]! - counter[COUNTER_STRIDE + 1]!);
      expect(towardCustomers, "on the customers' side of the counter").toBeGreaterThan(0);
    }
    expect(nearestPair(spots.map((spot) => spot!)), "metres between the two nearest").toBeGreaterThanOrEqual(0.99);
  });

  // mutation: sed -i 's/(!withinHours(state, current, tick) || fullBesideHer(state, resident, current))/!withinHours(state, current, tick)/' src/game/ai/civilians/civilian-plan.ts
  it("when someone at the full bar who holds nothing there decides, wanting nothing but to stay, then she does not stay in it: she sets out home", () => {
    const resident = late + 1;
    const tick = ROOM_ARRIVE + ROOM_STAY;
    stageResident(state, resident, { place: KELLYS, home: HOME_OF_ROOM, tick, dwell: 8, purpose: PURPOSE.drink, needs: needsWith({}) });
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.fromPlace] = HOME_OF_ROOM;
    state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = ROOM_PACE;
    decideResident(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.place), "where she is or heads after deciding").toBe(HOME_OF_ROOM);
  });

  // mutation: sed -i '/^  state.ints\[base + RESIDENT_INT.nextDecisionTick\] = state.ints\[base + RESIDENT_INT.arriveTick\]! + walkIn + BUY_TICKS;/d' src/game/ai/civilians/civilian-plan.ts
  it("when one more comes in with the standing room full too, then she stays only to walk in and buy, drawn every frame of it, and walks out from the counter as she leaves", () => {
    stageResident(state, late, { place: HOME_OF_ROOM, tick: ROOM_ARRIVE, purpose: NEED.rest });
    state.floats[late * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = ROOM_PACE;
    expect(sendResidentTo(state, late, ROOM_ARRIVE, KELLYS, PURPOSE.drink, ROOM_STAY), "control: she sets out for the bar").toBe(true);
    expect(intAt(state, late, RESIDENT_INT.seat), "nothing of her own").toBe(NO_SEAT);
    const stay = intAt(state, late, RESIDENT_INT.nextDecisionTick) - intAt(state, late, RESIDENT_INT.arriveTick);
    expect(stay, "her stay (ticks): the walk in and the buying").toBeLessThan(10 * DECISION_HZ);
    const frames = stayAndLeave(state, late);
    expect(frames.every((frame) => frame !== null), "drawn every frame: never in the room unseen").toBe(true);
    expect(frames.some((frame) => frame!.code === ACTIVITY.buy), "she buys").toBe(true);
    expect(longestStep(frames), "the longest step between frames (m)").toBeLessThan(1);
  });
});

/** The indoor seat of `place`'s own room farthest from its door: the longest walk out. */
function farthestSeat(place: number): number {
  const { seats, counter, doorX, doorZ } = city.places[place]!;
  let far = -1;
  for (let seat = 0; seat * 4 < seats!.length; seat++) {
    if (seats![seat * 4 + 3]! > counter![3]!) continue;
    if (far < 0 || hypot2(seats![seat * 4]! - doorX, seats![seat * 4 + 1]! - doorZ) > hypot2(seats![far * 4]! - doorX, seats![far * 4 + 1]! - doorZ)) far = seat;
  }
  return far;
}

/** Seats `resident` of `state` in seat `seat` of `place`: the owner table and her row. */
function seatIn(state: CityState, resident: number, place: number, seat: number): void {
  state.seatOwner[state.venues.seatBase[place]! + seat] = resident;
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.seat] = seat;
}

describe("given Dee, a named resident, at the back of Kelly's Tap Room on the evening of her coffee at the bodega", () => {
  // mutation: sed -i 's/^  return walk < 0 ? walk : walk + walkOutTicks(state, resident, from, leftSpotOf(state, resident, from, tick));/  return walk;/' src/game/ai/civilians/civilian-plan.ts
  it("when she lives her decisions up to it, then she sets off from her seat after walking out and still reaches the bodega by her appointment's tick", () => {
    const state = createCityState(5, city, 60);
    const dee = state.cast.findIndex((member) => member.member.key === "dee");
    const slot = newAppointmentSlot();
    expect(nextAppointment(state, dee, TICKS_PER_GAME_DAY, slot), "control: she has an appointment").toBe(true);
    const home = intAt(state, dee, RESIDENT_INT.home);
    const sitsDown = slot.arriveTick - 4 * TICKS_PER_GAME_HOUR;
    stageResident(state, dee, { place: KELLYS, home, tick: sitsDown + 4, dwell: 4, nextDecision: sitsDown + 4, purpose: PURPOSE.drink, flags: FLAG.cast });
    state.ints[dee * RESIDENT_INT_STRIDE + RESIDENT_INT.fromPlace] = home;
    state.floats[dee * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = state.floats[dee * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.pace]!;
    seatIn(state, dee, KELLYS, farthestSeat(KELLYS));
    let decided = sitsDown + 4;
    for (let decision = 0; decision < 40 && intAt(state, dee, RESIDENT_INT.legPurpose) !== PURPOSE.deeCoffee; decision++) {
      decided = intAt(state, dee, RESIDENT_INT.nextDecisionTick);
      decideResident(state, dee, decided);
    }
    expect(intAt(state, dee, RESIDENT_INT.legPurpose), "control: she sets out for her coffee").toBe(PURPOSE.deeCoffee);
    expect(intAt(state, dee, RESIDENT_INT.fromPlace), "control: from Kelly's").toBe(KELLYS);
    expect(intAt(state, dee, RESIDENT_INT.departTick) - decided, "control: ticks of her walk out before the leg sets off").toBeGreaterThan(10);
    expect(intAt(state, dee, RESIDENT_INT.arriveTick), `the tick she reaches the bodega, against her appointment's ${slot.arriveTick}`).toBeLessThanOrEqual(slot.arriveTick);
  });
});

describe("given a customer walking out of Kelly's Tap Room toward home", () => {
  // mutation: sed -i 's/^  const at = placeNow(state, resident, struck);/  const at = ints[base + RESIDENT_INT.place]!;/' src/game/ai/civilians/civilian-events.ts
  it("when she is knocked down before she reaches the door, then the knock is recorded at Kelly's door, not at her home's", () => {
    const state = createCityState(5, city, 60);
    const resident = state.cast.length;
    inRoom(state, resident, KELLYS, () => claimSeat(state, resident, KELLYS, false));
    seatIn(state, resident, KELLYS, farthestSeat(KELLYS));
    const leave = ROOM_ARRIVE + ROOM_STAY;
    expect(sendResidentTo(state, resident, leave, HOME_OF_ROOM, NEED.rest, TICKS_PER_GAME_HOUR), "control: she sets out home").toBe(true);
    const knockedAt = leave + 2;
    expect(intAt(state, resident, RESIDENT_INT.departTick), "control: still walking out when she is knocked").toBeGreaterThan(knockedAt);
    queueEvents(state, knockedAt, [EVENT_KIND.knock, resident, knockedAt / DECISION_HZ]);
    applyIndividualEvents(state, knockedAt + EVENT_LEAD_TICKS);
    const door = city.places[KELLYS]!;
    const x = intAt(state, resident, RESIDENT_INT.knockX) / 100;
    const z = intAt(state, resident, RESIDENT_INT.knockZ) / 100;
    expect(hypot2(x - state.index.placeX[KELLYS]!, z - state.index.placeZ[KELLYS]!), `metres from Kelly's (door ${door.doorX.toFixed(1)}, ${door.doorZ.toFixed(1)}) to where the knock is recorded`).toBeLessThan(1);
  });
});

describe("given a customer at the back of Kelly's Tap Room who has just set out, still walking out of it", () => {
  /** She sets out from the farthest seat for `destination` at the stay's end; the tick two after, while she still walks out. */
  function walkingOut(state: CityState, resident: number, destination: number, purpose: number): number {
    inRoom(state, resident, KELLYS, () => claimSeat(state, resident, KELLYS, false));
    releaseSeat(state, resident);
    seatIn(state, resident, KELLYS, farthestSeat(KELLYS));
    const leave = ROOM_ARRIVE + ROOM_STAY;
    expect(sendResidentTo(state, resident, leave, destination, purpose, TICKS_PER_GAME_HOUR), "control: she sets out").toBe(true);
    expect(intAt(state, resident, RESIDENT_INT.departTick), "control: still walking out two ticks on").toBeGreaterThan(leave + 2);
    return leave + 2;
  }

  // mutation: sed -i 's/^  const at = placeNow(state, resident, tick);$/  const at = intAt(state, resident, RESIDENT_INT.place);/' src/game/ai/civilians/society-reactions.ts
  it("when she is told to flee home, then she keeps walking out of the bar to its door and is not inside her home that tick", () => {
    const state = createCityState(5, city, 60);
    const resident = state.cast.length;
    const tick = walkingOut(state, resident, HOME_OF_ROOM, NEED.rest);
    state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.home] = HOME_OF_ROOM;
    fleeHome(state, resident, tick);
    expect(intAt(state, resident, RESIDENT_INT.fromPlace), "the place her walk sets out from").toBe(KELLYS);
    expect(intAt(state, resident, RESIDENT_INT.pathCount), "on a walk home").toBeGreaterThan(0);
    expect(intAt(state, resident, RESIDENT_INT.departTick), "still walking out that tick").toBeGreaterThan(tick);
    readActivity(state, resident, tick / DECISION_HZ, reading);
    expect(reading.placed, "drawn in the bar that tick").toBe(true);
    expect(hypot2(reading.x - state.index.placeX[KELLYS]!, reading.z - state.index.placeZ[KELLYS]!), "metres from the bar's middle where she is drawn").toBeLessThan(10);
  });

  // mutation: sed -i 's/here \&\& state.ints\[base + RESIDENT_INT.place\] === place \&\& /here \&\& /' src/game/ai/civilians/civilian-plan.ts
  it("when a stay at the bar replaces her leg to another bar, then she holds no seat of that other bar under this one", () => {
    const state = createCityState(5, city, 60);
    const resident = state.cast.length;
    const other = placeIn(city, "Mifflin Bar");
    const tick = walkingOut(state, resident, other, PURPOSE.drink);
    expect(intAt(state, resident, RESIDENT_INT.seat), "control: she holds a seat at the other bar").not.toBe(NO_SEAT);
    standOutside(state, resident, tick, PURPOSE.drink, TICKS_PER_GAME_HOUR, KELLYS);
    const seat = intAt(state, resident, RESIDENT_INT.seat);
    expect(seat === NO_SEAT || state.seatOwner[state.venues.seatBase[KELLYS]! + seat] === resident, `seat ${seat}: none, or one of Kelly's she owns`).toBe(true);
  });
});

describe("given customers who leave Kelly's Tap Room at the end of a stay cut short", () => {
  // mutation: sed -i 's/^  if (age < ROOM.walkIn + ROOM.buy + ROOM.walkOn \/ 2) {/  if (age < ROOM.walkIn + ROOM.buy + 9e9) {/' src/game/ai/civilians/civilian-plan.ts
  it("when one's stay is cut at closing to a few minutes and another's is 20 ticks in a seat at the back, then each walks out from her seat with no jump over a metre", () => {
    for (const stay of [8 * DECISION_HZ, 20]) {
      const state = createCityState(5, city, 60);
      const resident = state.cast.length;
      stageResident(state, resident, { place: HOME_OF_ROOM, tick: ROOM_ARRIVE, purpose: NEED.rest });
      state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = ROOM_PACE;
      expect(sendResidentTo(state, resident, ROOM_ARRIVE, KELLYS, PURPOSE.drink, TICKS_PER_GAME_HOUR), "control: she sets out for the bar").toBe(true);
      releaseSeat(state, resident);
      seatIn(state, resident, KELLYS, farthestSeat(KELLYS));
      state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.nextDecisionTick] = intAt(state, resident, RESIDENT_INT.arriveTick) + stay;
      const frames = stayAndLeave(state, resident);
      expect(frames.every((frame) => frame !== null), `stay of ${stay} ticks: drawn every frame`).toBe(true);
      expect(longestStep(frames), `stay of ${stay} ticks: the longest step between frames (m)`).toBeLessThan(1);
    }
  });
});

describe("given a customer seated at the back of Kelly's Tap Room who steps out to look on", () => {
  // mutation: sed -i 's/^  const walkOut = here \&\& isOutdoorPurpose(purpose) \&\& purpose !== PURPOSE.fight ? (out >= 0 ? out - tick : walkOutTicks(state, resident, place, left)) : 0;/  const walkOut = 0;/' src/game/ai/civilians/civilian-plan.ts
  it("when she stands outside its door, then she first stands up and walks out to it, never moving a metre in a frame", () => {
    const state = createCityState(5, city, 60);
    const resident = state.cast.length;
    inRoom(state, resident, KELLYS, () => claimSeat(state, resident, KELLYS, false));
    releaseSeat(state, resident);
    seatIn(state, resident, KELLYS, farthestSeat(KELLYS));
    const tick = ROOM_ARRIVE + ROOM_STAY / 2;
    const before = drawnBetween(state, resident, tick - DECISION_HZ, tick);
    standOutside(state, resident, tick, PURPOSE.lookOn, 60);
    const after = drawnBetween(state, resident, tick, intAt(state, resident, RESIDENT_INT.arriveTick) + DECISION_HZ);
    const frames = [...before, ...after];
    expect(before.at(-1)?.code, "control: sitting as she decides").toBe(ACTIVITY.sit);
    expect(frames.every((frame) => frame !== null), "drawn every frame").toBe(true);
    expect(longestStep(frames), "the longest step between frames (m)").toBeLessThan(1);
  });
});
