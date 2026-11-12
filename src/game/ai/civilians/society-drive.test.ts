import { describe, expect, it } from "vitest";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import {
  CAR_IN_TICKS,
  CAR_OUT_TICKS,
  CAR_WALK_METRES,
  DECISION_HZ,
  DRIVE_MIN_METRES,
  DRIVE_SPEED,
  EVENT_KIND,
  FLAG,
  LATERAL_MAX,
  MAX_PATH_NODES,
  NEED,
  NEVER_TICK,
  NO_INDEX,
  NO_PLACE,
  PARK_TICKS,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  TICKS_PER_GAME_DAY,
} from "./civilian-constants.ts";
import { applyIndividualEvents, queueEvents } from "./civilian-events.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { civilianLine } from "./civilian-mood.ts";
import { stateDigest } from "./civilian-run.test-util.ts";
import type { CityState } from "./civilian-state.ts";
import { computeTick } from "./civilian-tick.ts";
import { applyAnswer } from "./civilian-wire.ts";
import { createCityState } from "./society.ts";
import { ActivityReading, readActivity } from "./society-activity.ts";
import { carStandsAt } from "./society-cars.ts";
import { fillCommuterFeed } from "./society-commuters.ts";
import { newCast, societyMap, type Cast } from "./society-scenes.test-util.ts";
import { decideAs, farthestWorkplace, intAt, nearestPlace, nearestWorkplace, needsWith, placeIn, stageResident, withoutOtherCars } from "./society.test-util.ts";

import { hypot2 } from "../../kernel/physics-core.js";
const MORNING = 8;
const HOME = placeIn(societyMap, "Rowhome A1-1");
const SHIFT_NEED = 0.9;
const probe = newCast(MORNING);
const FAR = farthestWorkplace(probe.state, HOME, MORNING);

/** A crowd second in ticks of the brain's clock. */
function seconds(tick: number): number {
  return tick / DECISION_HZ;
}

type Driver = { cast: Cast; owner: number; row: (field: number) => number };

/** A resident with a car at \`carPlace\` (home when not given) whose shift starts now at \`work\`, no other car in their household, decided on at 08:00: the first decision. */
function setOut(work: number, carPlace = HOME): Driver {
  const cast = newCast(MORNING);
  const owner = cast.resident;
  withoutOtherCars(cast.state, HOME, [owner]);
  stageResident(cast.state, owner, { place: HOME, work, shiftStart: MORNING, tick: cast.tick, flags: FLAG.hasCar, carPlace, needs: needsWith({ [NEED.work]: SHIFT_NEED }) });
  decideAs(cast.state, owner, cast.tick, 0);
  return { cast, owner, row: (field) => intAt(cast.state, owner, field) };
}

describe("given a car owner at home whose shift starts at the workplace farthest across the city", () => {
  const { cast, owner, row } = setOut(FAR.place);
  const { state } = cast;
  const leave = row(RESIDENT_INT.driveLeaveTick);
  const park = row(RESIDENT_INT.driveParkTick);
  const arrive = row(RESIDENT_INT.arriveTick);
  const first = owner * MAX_PATH_NODES;
  const pose = new LegPose();
  const reading = new ActivityReading();
  const { graph } = societyMap;

  function at(second: number): { walking: boolean; x: number; z: number; code: number } {
    const walking = legPose(state, owner, second, pose);
    readActivity(state, owner, second, reading);
    return { walking, x: pose.x, z: pose.z, code: reading.code };
  }

  it("when the walk is at least three blocks, then the leg is by car: the way to the car, to where it parks and in, with the car nodes at the doors' spurs", () => {
    expect(FAR.metres, "metres of the longest walk from home").toBeGreaterThanOrEqual(DRIVE_MIN_METRES);
    expect(row(RESIDENT_INT.legPurpose), "what the leg is for").toBe(NEED.work);
    expect(row(RESIDENT_INT.carOwner), "whose car").toBe(owner);
    expect(row(RESIDENT_INT.driveFirst), "the node they get in at, after the door").toBe(1);
    expect(row(RESIDENT_INT.driveLast), "the node they get out at, before the door").toBe(row(RESIDENT_INT.pathCount) - 2);
    expect(state.pathNodes[first + 1], "the car's node at home").toBe(state.index.carNode[HOME]);
    expect(state.pathNodes[first + row(RESIDENT_INT.driveLast)], "the car's node at work").toBe(state.index.carNode[FAR.place]);
    expect(row(RESIDENT_INT.driveLeaveTick) - row(RESIDENT_INT.departTick), "ticks to get to the car and in").toBeGreaterThanOrEqual(CAR_IN_TICKS);
    expect(park - leave, "ticks in the car").toBeGreaterThan(PARK_TICKS);
    expect(arrive - park, "ticks to get out and walk in").toBeGreaterThan(CAR_OUT_TICKS);
    expect(row(RESIDENT_INT.nextDecisionTick), "tick of the next decision").toBeGreaterThan(arrive);
  });

  it("when the car is looked at, then it is the owner's, reserved from the decision, leaving with them in it and parked at work", () => {
    expect(row(RESIDENT_INT.carPlace), "where the car stood").toBe(HOME);
    expect(row(RESIDENT_INT.carTo), "where it will stand").toBe(FAR.place);
    expect(row(RESIDENT_INT.carLeaveTick), "tick it leaves").toBe(leave);
    expect(row(RESIDENT_INT.carParkTick), "tick it is parked").toBe(park);
    expect(carStandsAt(state, owner, leave - 1), "where it stands before it leaves").toBe(HOME);
    expect(carStandsAt(state, owner, leave), "where it stands on the road").toBe(NO_PLACE);
    expect(carStandsAt(state, owner, park), "where it stands once parked").toBe(FAR.place);
  });

  it("when they are looked at all along, then they walk to the car, stand at it getting in, are not seen in it, stand at the other car getting out, and walk in to the door", () => {
    const toCar = (n: number) => ({ x: graph.nodeX[n]!, z: graph.nodeZ[n]! });
    const homeCar = toCar(state.index.carNode[HOME]!);
    const workCar = toCar(state.index.carNode[FAR.place]!);
    const door = societyMap.places[FAR.place]!;
    const depart = seconds(row(RESIDENT_INT.departTick));
    expect(at(depart + 0.01).walking, "on foot as they set out").toBe(true);
    const getting = at(seconds(leave) - 1);
    expect([getting.walking, getting.code].join("/"), "standing at the car, getting in").toBe([true, ACTIVITY.carIn].join("/"));
    expect(hypot2(getting.x - homeCar.x, getting.z - homeCar.z), "metres from the car's node: their lateral offset at most").toBeLessThanOrEqual(LATERAL_MAX + 0.01);
    expect(reading.sinceSeconds, "seconds into getting in").toBeCloseTo(ACTIVITY_SECONDS.carIn - 1, 5);
    const driving = at(seconds(leave + park) / 2);
    expect([driving.walking, driving.code, reading.placed].join("/"), "in the car: nobody on foot").toBe([false, ACTIVITY.none, false].join("/"));
    const out = at(seconds(park) + 1);
    expect([out.walking, out.code].join("/"), "standing at the parked car, getting out").toBe([true, ACTIVITY.carOut].join("/"));
    expect(hypot2(out.x - workCar.x, out.z - workCar.z), "metres from the car's node at work: their lateral offset at most").toBeLessThanOrEqual(LATERAL_MAX + 0.01);
    expect(reading.sinceSeconds, "seconds into getting out").toBeCloseTo(1, 5);
    const walking = at(seconds(park + CAR_OUT_TICKS) + 1);
    expect([walking.walking, walking.code].join("/"), "walking in").toBe([true, ACTIVITY.none].join("/"));
    const arriving = at(seconds(arrive) - 0.001);
    expect(arriving.walking, "still on their way as they arrive").toBe(true);
    expect(hypot2(arriving.x - door.doorX, arriving.z - door.doorZ), "metres from the door as they arrive").toBeLessThan(0.01);
    expect(at(seconds(arrive)).walking, "on foot once the leg is over").toBe(false);
  });

  it("when someone looks at them in the car, then the line says they are driving for work", () => {
    expect(civilianLine(state, owner, (leave + park) >> 1), "the look-at line in the car").toContain(" - driving for work -> ");
  });
});

type FeedLegs = { count: number; resident: Int32Array; fromPlace: Int32Array; toPlace: Int32Array; arriveSeconds: Float64Array };
type FeedCars = { count: number; resident: Int32Array; place: Int32Array };
/** The traffic's two lists for a city at a tick, and where in each (-1: not in it) one resident is. */
type FeedRead = { legs: FeedLegs; cars: FeedCars; leg: number; parked: number };

function feedAt(state: CityState, tick: number, resident: number): FeedRead {
  const legs: FeedLegs = { count: 0, resident: new Int32Array(state.capacity), fromPlace: new Int32Array(state.capacity), toPlace: new Int32Array(state.capacity), arriveSeconds: new Float64Array(state.capacity) };
  const cars: FeedCars = { count: 0, resident: new Int32Array(state.capacity), place: new Int32Array(state.capacity) };
  fillCommuterFeed(state, tick, legs, cars);
  return { legs, cars, leg: legs.resident.subarray(0, legs.count).indexOf(resident), parked: cars.resident.subarray(0, cars.count).indexOf(resident) };
}

describe("given the traffic's feed read at the ticks of a car owner's trip", () => {
  const { cast, owner, row } = setOut(FAR.place);
  const { state } = cast;
  const leave = row(RESIDENT_INT.driveLeaveTick);
  const park = row(RESIDENT_INT.driveParkTick);

  it("when it is read while they walk to the car, then the car stands at home and is on no leg", () => {
    for (const tick of [row(RESIDENT_INT.departTick), leave - 1]) {
      const feed = feedAt(state, tick, owner);
      expect([feed.leg, feed.cars.place[feed.parked]].join("/"), `tick ${tick}: leg index, kerb place`).toBe([-1, HOME].join("/"));
    }
  });

  it("when it is read from the tick they have got in to the tick it is parked, then it is on a leg from home to work due when it is parked, and not at a kerb", () => {
    for (const tick of [leave, park - 1]) {
      const feed = feedAt(state, tick, owner);
      expect(feed.parked, `tick ${tick}: kerb index`).toBe(-1);
      expect([feed.legs.fromPlace[feed.leg], feed.legs.toPlace[feed.leg], feed.legs.arriveSeconds[feed.leg]].join("/"), `tick ${tick}: from, to and due`).toBe([HOME, FAR.place, seconds(park)].join("/"));
    }
  });

  it("when it is read once it is parked, then it stands at the kerb of the workplace and is on no leg", () => {
    const feed = feedAt(state, park, owner);
    expect([feed.leg, feed.cars.place[feed.parked]].join("/"), "leg index, kerb place").toBe([-1, FAR.place].join("/"));
  });
});

describe("given a trip of less than three blocks, and a car standing too far from them", () => {
  const near = nearestWorkplace(probe.state, HOME, MORNING);

  it("when a car owner's shift starts at a workplace under three blocks away, then they walk, and the car stays parked at home, empty", () => {
    expect(near.metres, "metres of the shortest walk to a workplace").toBeLessThan(DRIVE_MIN_METRES);
    const { cast, owner, row } = setOut(near.place);
    expect([row(RESIDENT_INT.carOwner), row(RESIDENT_INT.driveFirst), row(RESIDENT_INT.carTo)].join("/"), "car owner of the leg, node they get in at, where the car goes").toBe([NO_PLACE, NO_INDEX, NO_PLACE].join("/"));
    expect(row(RESIDENT_INT.legPurpose), "what the leg is for").toBe(NEED.work);
    expect(carStandsAt(cast.state, owner, row(RESIDENT_INT.arriveTick)), "where the car stands when they get there").toBe(HOME);
  });

  it("when the car stands where the walk to it is over what they will do, then they walk the whole way", () => {
    const farCar = placeIn(societyMap, "Mifflin Mini Mart");
    const { cast, owner, row } = setOut(FAR.place, farCar);
    expect(cast.state.index.carNode[farCar], "the far car's node is not home's").not.toBe(cast.state.index.carNode[HOME]);
    expect([row(RESIDENT_INT.carOwner), row(RESIDENT_INT.driveFirst)].join("/"), "car owner of the leg, node they get in at").toBe([NO_PLACE, NO_INDEX].join("/"));
    expect(carStandsAt(cast.state, owner, row(RESIDENT_INT.arriveTick)), "where the car stands").toBe(farCar);
    expect(cast.state.floats[owner * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed], "metres a second of the leg: a walk's").toBeLessThan(DRIVE_SPEED);
  });
});

describe("given a car standing at a neighbouring door within a short walk of home", () => {
  const neighbour = nearestPlace(probe.state, HOME);

  it("when the owner sets out for the far workplace, then they walk to the car at that door first, and get in there", () => {
    expect(neighbour.metres, "metres to the nearest door").toBeLessThanOrEqual(CAR_WALK_METRES);
    const { cast, owner, row } = setOut(FAR.place, neighbour.place);
    const { state } = cast;
    expect(row(RESIDENT_INT.carOwner), "whose car").toBe(owner);
    expect(state.pathNodes[owner * MAX_PATH_NODES + row(RESIDENT_INT.driveFirst)], "the node they get in at").toBe(state.index.carNode[neighbour.place]);
    expect(state.pathNodes[owner * MAX_PATH_NODES], "the node they set out from").toBe(state.index.doorNode[HOME]);
    expect(row(RESIDENT_INT.carPlace), "where the car stood").toBe(neighbour.place);
    expect(row(RESIDENT_INT.carTo), "where it parks").toBe(FAR.place);
  });
});

describe("given three of a household, one with a car", () => {
  function household(): { cast: Cast; owner: number; driver: number; other: number } {
    const cast = newCast(MORNING);
    const [owner, driver, other] = [cast.state.capacity - 1, cast.state.capacity - 2, cast.state.capacity - 3] as [number, number, number];
    withoutOtherCars(cast.state, HOME, [owner, driver, other]);
    stageResident(cast.state, owner, { place: HOME, home: HOME, tick: cast.tick, nextDecision: cast.tick + TICKS_PER_GAME_DAY, flags: FLAG.hasCar, carPlace: HOME });
    for (const person of [driver, other]) stageResident(cast.state, person, { place: HOME, home: HOME, work: FAR.place, shiftStart: MORNING, tick: cast.tick, needs: needsWith({ [NEED.work]: SHIFT_NEED }) });
    return { cast, owner, driver, other };
  }

  it("when one with no car sets out on a long trip, then they take the household's car, which is then the owner's trip, and the next to set out walks", () => {
    const { cast, owner, driver, other } = household();
    const { state } = cast;
    decideAs(state, driver, cast.tick, 0);
    expect(intAt(state, driver, RESIDENT_INT.carOwner), "whose car the first takes").toBe(owner);
    expect(intAt(state, owner, RESIDENT_INT.carTo), "where the owner's car will stand").toBe(FAR.place);
    expect(intAt(state, owner, RESIDENT_INT.carLeaveTick), "tick it leaves").toBe(intAt(state, driver, RESIDENT_INT.driveLeaveTick));
    decideAs(state, other, cast.tick, 0);
    expect([intAt(state, other, RESIDENT_INT.carOwner), intAt(state, other, RESIDENT_INT.driveFirst)].join("/"), "car owner and node they get in at for the second").toBe([NO_PLACE, NO_INDEX].join("/"));
  });
});

describe("given a driver knocked down on their way to the car, and one knocked down after they have parked", () => {
  function knockedAt(tickOf: (driver: Driver) => number): Driver {
    const driver = setOut(FAR.place);
    const tick = tickOf(driver);
    queueEvents(driver.cast.state, tick, [EVENT_KIND.knock, driver.owner, seconds(tick)]);
    applyIndividualEvents(driver.cast.state, tick);
    return driver;
  }

  it("when it is before they get in, then the car trip is given up and it stays at home", () => {
    const { cast, owner, row } = knockedAt((driver) => driver.row(RESIDENT_INT.driveLeaveTick) - 2);
    expect([row(RESIDENT_INT.carTo), row(RESIDENT_INT.driveLeaveTick), row(RESIDENT_INT.carOwner)].join("/"), "where the car goes, tick they get in, whose car, after the knock").toBe([NO_PLACE, NEVER_TICK, NO_PLACE].join("/"));
    expect(carStandsAt(cast.state, owner, row(RESIDENT_INT.arriveTick) + 10), "where the car stands").toBe(HOME);
    expect(intAt(cast.state, owner, RESIDENT_INT.flags) & FLAG.hurt, "hurt").toBe(FLAG.hurt);
  });

  it("when it is after the car is parked, then the car stays where it parked", () => {
    const { cast, owner } = knockedAt((driver) => driver.row(RESIDENT_INT.driveParkTick) + CAR_OUT_TICKS + 4);
    expect(carStandsAt(cast.state, owner, intAt(cast.state, owner, RESIDENT_INT.carParkTick) + 100), "where the car stands").toBe(FAR.place);
  });
});

/** Most car trips a city has under way at once over two game days: stepped by its own tick, and by a peer that only applies the answers. */
describe("given a city of a hundred living two game days", () => {
  const state = createCityState(11, societyMap, 100);
  const mirror = createCityState(11, societyMap, 100);
  const trips = new Set<string>();
  for (let tick = 0; tick < 2 * TICKS_PER_GAME_DAY; tick++) {
    applyAnswer(mirror, computeTick(state, tick));
    if (tick % 20 !== 0) continue;
    for (let resident = 0; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.carTo) !== NO_PLACE) trips.add(`${resident}/${intAt(state, resident, RESIDENT_INT.carLeaveTick)}`);
    }
  }

  it("when they are counted, then residents made car trips, and a peer that only heard the answers holds the same city", () => {
    expect(trips.size, "car trips seen").toBeGreaterThan(0);
    expect(stateDigest(mirror), "digest of the mirror").toBe(stateDigest(state));
  });
});
