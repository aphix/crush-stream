import { describe, expect, it } from "vitest";
import { applyDrive, idleDrive, type DriveInput } from "./car-drive.ts";
import type { DeformableCar } from "./car.ts";
import { FLIGHT } from "./car-flight.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { assertSameNumbers } from "./test-support.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

/**
 * A highlight keyframe holds a car as its flight block (`DeformableCar.flight`) and the replay drives on from it: a car rebuilt from
 * its block must then take every following slice exactly as the live car does, to the bit (the drive reads the heading off the
 * quaternion before it sets it from the Euler angles, and each is the other's derived copy only up to rounding).
 * The pair is one car and its twin, both driven with the same pedals on the same flat road, one slice at a time.
 */
const SLICE_S = 1 / QUIET_HZ;
const SLICES = 60;
const WARM_SLICES = 20;
const SPAWN_SPEED = 20;
const FULL_TURN = 2 * Math.PI;
const HEADING_COUNT = 16;
/** Headings spread round the compass, none a multiple of a right angle. */
const HEADINGS = Array.from({ length: HEADING_COUNT }, (_, k) => 0.123 + (k * FULL_TURN) / HEADING_COUNT);
const PEDALS: DriveInput = { throttle: 1, steer: 0.4, brake: 0, ebrake: false, boost: false };

function twinFromFlightBlock(car: DeformableCar): DeformableCar {
  const block = new Float64Array(FLIGHT);
  car.flight(block, 0, false);
  const twin = makeCar("sedan");
  twin.spawnFacing(0, 0, 0, 0);
  twin.flight(block, 0, true);
  return twin;
}

function poseAndMotion(car: DeformableCar): number[] {
  return [...car.group.position.toArray(), ...car.group.quaternion.toArray(), ...car.velocity.toArray(), ...car.angular.toArray(), car.yaw, car.pitch, car.roll];
}

/** Every slice of `SLICES`, the live car and its twin from the block, in a world each: the first slice at which they differ (-1: none). */
function firstSliceTheyDiffer(car: DeformableCar, twin: DeformableCar): number {
  const live = newWorld([car], null);
  const rebuilt = newWorld([twin], null);
  for (let slice = 0; slice < SLICES; slice++) {
    applyDrive(car, PEDALS, SLICE_S);
    stepWorld(live, SLICE_S);
    applyDrive(twin, PEDALS, SLICE_S);
    stepWorld(rebuilt, SLICE_S);
    const a = poseAndMotion(car);
    const b = poseAndMotion(twin);
    if (a.some((x, i) => x !== b[i])) return slice;
  }
  return -1;
}

function headingsWhereTheyDiffer(placeAt: (car: DeformableCar, heading: number) => void): string[] {
  const bad: string[] = [];
  for (const heading of HEADINGS) {
    const car = makeCar("sedan");
    placeAt(car, heading);
    const slice = firstSliceTheyDiffer(car, twinFromFlightBlock(car));
    if (slice >= 0) bad.push(`heading ${heading.toFixed(3)}: differ from slice ${slice}`);
  }
  return bad;
}

describe("given a car and a twin rebuilt from its flight block, driven on with the same pedals", () => {
  it("when the car has been driven on for some slices (its quaternion turned by the rigid step after the drive set it), at every heading, then both take every next slice to the bit", () => {
    const bad = headingsWhereTheyDiffer((car, heading) => {
      car.spawnFacing(3, -5, heading, SPAWN_SPEED);
      const warm = newWorld([car], null);
      for (let slice = 0; slice < WARM_SLICES; slice++) {
        applyDrive(car, PEDALS, SLICE_S);
        stepWorld(warm, SLICE_S);
      }
    });
    expect(bad).toHaveLength(0);
  });

  it("when the car was just placed facing a yaw a full turn past its heading (its Euler angles are not the quaternion's derived copy), at every heading, then both take every next slice to the bit", () => {
    const bad = headingsWhereTheyDiffer((car, heading) => car.spawnFacing(3, -5, heading + FULL_TURN, SPAWN_SPEED));
    expect(bad).toHaveLength(0);
  });
});

const IDLE = idleDrive();
const STEER: DriveInput = { ...IDLE, steer: 1 };
/** Slices of full steer on the sleeping wreck: they turn its body about 4.6 cm off the spot it fell asleep at (measured), and it sleeps on. */
const STEER_SLICES = 30;

/** A sedan hit on the nose so it is a wreck, stepped on idle pedals until `until(car)` holds (a failure if it never does within 10 s). */
function wreckUntil(until: (car: DeformableCar) => boolean): DeformableCar {
  const car = makeCar("sedan");
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  car.updateSkin();
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2.05), car.forward.clone().negate(), 0.5, 0.5);
  const world = newWorld([car], null);
  for (let slice = 0; slice < 10 * 120 && !until(car); slice++) {
    applyDrive(car, IDLE, SLICE_S);
    stepWorld(world, SLICE_S);
    car.stepBreakage(SLICE_S);
    car.updateSkin();
  }
  expect(until(car), `the wreck never reached the state (restS ${car.restS}, asleep ${car.asleep})`).toBeTruthy();
  return car;
}

describe("given a wreck at rest and a twin rebuilt from its flight block", () => {
  it("when the wreck is asleep, then the twin is asleep with its rest timer and the plan position it sleeps at", () => {
    const car = wreckUntil((c) => c.asleep);
    const twin = twinFromFlightBlock(car);
    expect(twin.asleep, "the twin woke").toBeTruthy();
    expect(twin.restS).toBe(car.restS);
    expect(twin.sleepX).toBe(car.sleepX);
    expect(twin.sleepZ).toBe(car.sleepZ);
  });

  it("when the wreck asleep has been turned where it lies by a steer (a race gives its AI wrecks pedals), then the twin sleeps at the spot the wreck fell asleep at, not where the turn left its body", () => {
    const car = wreckUntil((c) => c.asleep);
    for (let slice = 0; slice < STEER_SLICES; slice++) {
      applyDrive(car, STEER, SLICE_S);
      car.integrate(SLICE_S);
    }
    expect(car.asleep, "the steer woke the wreck: nothing moved its body off its sleep spot").toBeTruthy();
    expect(car.group.position.x !== car.sleepX || car.group.position.z !== car.sleepZ, "the steer did not move the body off its sleep spot").toBeTruthy();
    const twin = twinFromFlightBlock(car);
    expect(twin.sleepX).toBe(car.sleepX);
    expect(twin.sleepZ).toBe(car.sleepZ);
  });

  it("when the wreck is resting but not yet asleep, then the twin is awake with the wreck's rest timer, not zero", () => {
    const car = wreckUntil((c) => c.restS > 0.2 && !c.asleep);
    const twin = twinFromFlightBlock(car);
    expect(!twin.asleep, "the twin sleeps early").toBe(true);
    expect(twin.restS).toBe(car.restS);
  });
});

/** How high (m) the driven car is lifted off the road: it flies all of `FLY_SLICES` and `AIR_SLICES`. */
const LIFT_M = 3;
/** Slices it flies before its block is taken: a car on its wheels re-reads their rate off its speed in its next slice, a flying one keeps it (`spinWheels`). */
const FLY_SLICES = 5;
/** Slices both fly after, the drawn wheels' rate dying in the air, before a wheel pops. */
const AIR_SLICES = 30;

describe("given a car whose drawn wheels a drive turned, flying, and a twin rebuilt from its flight block", () => {
  it("when both fly on and each pops its front-left wheel, then the twin's wheel leaves where and at the turn the car's does, not at a turn the restore zeroed", () => {
    const car = makeCar("sedan");
    car.spawnFacing(3, -5, HEADINGS[1]!, SPAWN_SPEED);
    const live = newWorld([car], null);
    for (let slice = 0; slice < WARM_SLICES; slice++) {
      applyDrive(car, PEDALS, SLICE_S);
      stepWorld(live, SLICE_S);
    }
    car.group.position.y += LIFT_M;
    for (let slice = 0; slice < FLY_SLICES; slice++) {
      applyDrive(car, IDLE, SLICE_S);
      stepWorld(live, SLICE_S);
    }
    expect(car.airborne, "the car flies when its block is taken").toBeTruthy();
    const twin = twinFromFlightBlock(car);
    const rebuilt = newWorld([twin], null);
    for (let slice = 0; slice < AIR_SLICES; slice++) {
      applyDrive(car, IDLE, SLICE_S);
      stepWorld(live, SLICE_S);
      applyDrive(twin, IDLE, SLICE_S);
      stepWorld(rebuilt, SLICE_S);
    }
    expect(car.airborne && car["wheelSpin"][0] !== 0, "the car flies with its wheels turned").toBeTruthy();
    car["dropWheel"](0, "hubFL");
    twin["dropWheel"](0, "hubFL");
    const [carWheel, twinWheel] = [car, twin].map((c) => [...c["looseWheels"][0]!.object.position.toArray(), ...c["looseWheels"][0]!.object.quaternion.toArray()]);
    assertSameNumbers(twinWheel!, carWheel!, "the popped wheel's position and turn");
  });
});
