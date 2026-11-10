import { describe, expect, it } from "vitest";
import { classStats } from "../../vehicle/vehicle-classes.ts";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildParkingSpots } from "../../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, HEADING, HEADING_COUNT, junctionIndex } from "../../world/openworld/openworld-roads.ts";
import { blankAiCar } from "../derby-ai.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { CRUISE_SPEED, NOSE_OVERHANG, PERSON_GAP, PERSON_REACH } from "./traffic-constants.ts";
import { TrafficDriver } from "./traffic-driver.ts";
import { LIGHT, lightState, SIGNAL_PHASE } from "./traffic-lights.ts";
import { CYCLE_SECONDS, KinematicCar, STEP_SECONDS } from "./traffic-world.test-util.ts";
import { pointAtArc, RoutePlanner, TripRoute } from "./trip-route.ts";

const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
const spots = buildParkingSpots(network);
const planner = new RoutePlanner(network, spots);
const driver = new TrafficDriver(network);
const sedan = classStats("sedan");
const CAR_ID = 1;

/** The junction the trip crosses, and a trip east along row 1 from the block west of it to the block east of it: pull out, one straight through the junction's signals, pull in. */
const junction = junctionIndex(network, 1, 1);
const fromSpot = spots.laneStart[junctionIndex(network, 0, 1) * HEADING_COUNT + HEADING.east]! + 1;
const toSpot = spots.laneStart[junction * HEADING_COUNT + HEADING.east]! + 3;
const barX = network.junctionX[junction]! - network.stopBar;

/** First instant of the cycle at which the east-west through lamp shows `state`. */
function timeShowing(state: number): number {
  for (let seconds = 0; seconds < CYCLE_SECONDS; seconds += 0.5) if (lightState(junction, SIGNAL_PHASE.eastWestThrough, seconds) === state) return seconds;
  throw new Error(`no ${state} in the cycle`);
}

/** A car on the trip's first space, driven by the driver for `seconds` with the signals' clock held at `clock`. */
function drive(route: TripRoute, car: KinematicCar, seconds: number, clock: number): void {
  const snap = blankAiCar(CAR_ID);
  for (let step = 0; step < seconds / STEP_SECONDS; step++) {
    car.snapshot(CAR_ID, snap);
    car.run(driver.think(snap, route, sedan, [snap], clock, STEP_SECONDS, false), STEP_SECONDS);
  }
}

function newTrip(): { route: TripRoute; car: KinematicCar } {
  const route = new TripRoute();
  expect(planner.plan(route, fromSpot, toSpot), "the planner finds a way between the spaces").toBe(true);
  expect(route.signalCount, "the way crosses the junction's signal").toBe(1);
  const car = new KinematicCar();
  car.stand(spots.x[fromSpot]!, spots.z[fromSpot]!, spots.yaw[fromSpot]!);
  driver.forget(CAR_ID);
  return { route, car };
}

describe("given a car on a trip that crosses a signalled junction", () => {
  // mutation: sed -i 's/if (!urgent) target = Math.min(target, this.signalLimit/if (urgent) target = Math.min(target, this.signalLimit/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light stays red, then the car stops with its nose short of the stop bar and waits there", () => {
    const { route, car } = newTrip();
    drive(route, car, 45, timeShowing(LIGHT.red));
    expect(car.speed, "speed at the bar").toBeLessThan(0.3);
    expect(car.group.position.x + NOSE_OVERHANG, "the car's nose against the bar").toBeLessThanOrEqual(barX + 0.2);
    expect(barX - car.group.position.x, "it came up to the bar, not stopped far back").toBeLessThan(NOSE_OVERHANG + 6);
  });

  // mutation: sed -i 's/if (!hold) return Infinity;/if (!hold \&\& false) return Infinity;/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light turns green after the car waited at it, then the car goes through the junction", () => {
    const { route, car } = newTrip();
    drive(route, car, 45, timeShowing(LIGHT.red));
    drive(route, car, 30, timeShowing(LIGHT.green));
    expect(car.group.position.x, "the car's x past the junction's box").toBeGreaterThan(network.junctionX[junction]! + network.boxHalf);
  });

  // mutation: sed -i 's/if (!urgent) target = Math.min(target, this.signalLimit/if (true) target = Math.min(target, this.signalLimit/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the car is urgent and the light stays red, then the signal does not hold it (it goes through)", () => {
    const { route, car } = newTrip();
    const snap = blankAiCar(CAR_ID);
    const clock = timeShowing(LIGHT.red);
    for (let step = 0; step < 45 / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], clock, STEP_SECONDS, true), STEP_SECONDS);
    }
    expect(car.group.position.x, "the urgent car's x, past the bar").toBeGreaterThan(barX + 2);
  });

  // mutation: sed -i 's/if (!hold) return Infinity;/if (!hold \&\& false) return Infinity;/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light is green all along, then the car passes the bar without stopping for it", () => {
    const { route, car } = newTrip();
    let slowest = Infinity;
    const snap = blankAiCar(CAR_ID);
    const clock = timeShowing(LIGHT.green);
    for (let step = 0; step < 40 / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], clock, STEP_SECONDS, false), STEP_SECONDS);
      if (Math.abs(car.group.position.x - barX) < 8 && car.speed > 0) slowest = Math.min(slowest, car.speed);
    }
    expect(slowest, "slowest speed within 8 m of the bar").toBeGreaterThan(5);
  });
});

describe("given a car chased by a patrol car behind it", () => {
  const LONG_TRIP_METRES = 200;

  /** A straight route south (+z) from the origin, `LONG_TRIP_METRES` long, every point's cap the cruise speed. */
  function straightRoute(): TripRoute {
    const route = new TripRoute();
    for (const z of [0, LONG_TRIP_METRES / 2, LONG_TRIP_METRES]) {
      route.x[route.count] = 0;
      route.z[route.count] = z;
      route.cap[route.count] = CRUISE_SPEED;
      route.arc[route.count] = z;
      route.count++;
    }
    return route;
  }

  function chaserAt(x: number, z: number) {
    const chaser = blankAiCar(9);
    chaser.x = x;
    chaser.z = z;
    return chaser;
  }

  // mutation: sed -i 's/    if (!urgent \&\& chaser === null) target = Math.min(target, this.signalLimit/    if (!urgent) target = Math.min(target, this.signalLimit/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light stays red, then the car runs it: it does not stop at the bar", () => {
    const { route, car } = newTrip();
    const snap = blankAiCar(CAR_ID);
    const clock = timeShowing(LIGHT.red);
    for (let step = 0; step < 45 / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], clock, STEP_SECONDS, false, chaserAt(car.group.position.x - 40, car.group.position.z)), STEP_SECONDS);
    }
    expect(car.group.position.x, "the chased car's x, past the bar").toBeGreaterThan(barX + 2);
  });

  // mutation: sed -i 's/let target = chaser !== null ? Math.min(FLEE_SPEED, cls.topSpeed) : urgent/let target = chaser !== null ? Math.min(CRUISE_SPEED, cls.topSpeed) : urgent/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the road is clear and long, then it drives faster than traffic ever does", () => {
    const route = straightRoute();
    const car = new KinematicCar();
    car.stand(0, 0, 0);
    driver.forget(CAR_ID);
    const snap = blankAiCar(CAR_ID);
    let fastest = 0;
    for (let step = 0; step < 25 / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], 0, STEP_SECONDS, false, chaserAt(0, car.group.position.z - 30)), STEP_SECONDS);
      fastest = Math.max(fastest, car.speed);
    }
    expect(fastest, "the top speed it reached").toBeGreaterThan(CRUISE_SPEED + 3);
  });

  // mutation: sed -i 's/    if (ahead > 0 || ahead < -SWERVE_BEHIND || Math.abs(side) > LINE_W) return 0;/    return 0;/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the chaser is close behind in its lane, then it swings its line off the chaser's; with the chaser far behind it holds its line", () => {
    const route = straightRoute();
    const steerWith = (chaser: ReturnType<typeof chaserAt>): number => {
      const car = new KinematicCar();
      car.stand(0, 0, 0);
      driver.forget(CAR_ID);
      const snap = car.snapshot(CAR_ID);
      return driver.think(snap, route, sedan, [snap], 0, STEP_SECONDS, false, chaser).steer;
    };
    expect(Math.abs(steerWith(chaserAt(0, -300))), "a chaser far behind: straight on").toBeLessThan(0.02);
    expect(steerWith(chaserAt(0, -10)), "a chaser dead behind: the nose swings off its line").toBeGreaterThan(0.1);
  });
});

describe("given a person standing on the car's way (a crossing, a lane)", () => {
  const PERSON_AT_ARC_M = 30;
  const WAIT_S = 20;
  const STOPPED_MPS = 0.3;

  function personAhead(route: TripRoute): { count: number; x: Float32Array; z: Float32Array; shown: Uint8Array } {
    const spot = { x: 0, z: 0, tx: 0, tz: 0 };
    pointAtArc(route, PERSON_AT_ARC_M, 0, spot);
    return { count: 1, x: Float32Array.of(spot.x), z: Float32Array.of(spot.z), shown: Uint8Array.of(1) };
  }

  function driveFor(route: TripRoute, car: KinematicCar, seconds: number): void {
    const snap = blankAiCar(CAR_ID);
    for (let step = 0; step < seconds / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], timeShowing(LIGHT.green), STEP_SECONDS, false), STEP_SECONDS);
    }
  }

  // mutation: sed -i 's/      if (this.personNear(sample.x, sample.z)) return Math.sqrt(2 \* FOLLOW_BRAKE \* Math.max(0, ahead - PERSON_GAP));/      \/\/ no person/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light is green and she stands in its lane, then the car stops short of her and waits; when she has gone it drives on past where she stood", () => {
    const { route, car } = newTrip();
    const person = personAhead(route);
    driver.people = person;
    driveFor(route, car, WAIT_S);
    const gap = hypot2(person.x[0]! - car.group.position.x, person.z[0]! - car.group.position.z);
    expect(car.speed, "it waits").toBeLessThan(STOPPED_MPS);
    expect(gap, "its centre this far from her: its nose is clear of her").toBeGreaterThan(PERSON_GAP - 1);
    expect(gap, "and not stopped far short").toBeLessThan(PERSON_GAP + 4);
    person.shown[0] = 0;
    driveFor(route, car, WAIT_S);
    expect(car.group.position.x, "past where she stood").toBeGreaterThan(person.x[0]! + 2);
    driver.people = null;
  });

  // mutation: sed -i 's/  private personNear(x: number, z: number): boolean {/  private personNear(x: number, z: number): boolean {\n    return false;/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when she stands on the pavement beside the lane, then the car does not stop for her", () => {
    const { route, car } = newTrip();
    const person = personAhead(route);
    person.z[0] = person.z[0]! + PERSON_REACH + 1;
    driver.people = person;
    let slowest = Infinity;
    const snap = blankAiCar(CAR_ID);
    for (let step = 0; step < 6 / STEP_SECONDS; step++) {
      car.snapshot(CAR_ID, snap);
      car.run(driver.think(snap, route, sedan, [snap], timeShowing(LIGHT.green), STEP_SECONDS, false), STEP_SECONDS);
      if (car.group.position.x > 5) slowest = Math.min(slowest, car.speed);
    }
    expect(slowest, "it did not slow to a stop on the way").toBeGreaterThan(1);
    driver.people = null;
  });
});
