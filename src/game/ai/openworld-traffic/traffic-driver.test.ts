import { describe, expect, it } from "vitest";
import { classStats } from "../../vehicle/vehicle-classes.ts";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildParkingSpots } from "../../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, HEADING, HEADING_COUNT, junctionIndex } from "../../world/openworld/openworld-roads.ts";
import { blankAiCar } from "../derby-ai.ts";
import { CRUISE_SPEED, NOSE_OVERHANG } from "./traffic-constants.ts";
import { TrafficDriver } from "./traffic-driver.ts";
import { LIGHT, lightState, SIGNAL_PHASE } from "./traffic-lights.ts";
import { CYCLE_SECONDS, KinematicCar, STEP_SECONDS } from "./traffic-world.test-util.ts";
import { RoutePlanner, TripRoute } from "./trip-route.ts";

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
