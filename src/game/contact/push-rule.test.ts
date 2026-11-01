import { describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, runWall, tickWorld } from "./crash-scenarios.test-util.ts";
import { outlineOf } from "./cage-outline.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { DT } from "../vehicle/test-support.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";

/** Metres between the two cars' outlines when a run starts, and how far (m) the car behind stands to one side, so its nose meets the other's rear quarter. */
const START_GAP = 1;
const QUARTER_OFFSET = 0.7;
/** Seconds a run is stepped at the most: the touch comes within half a second of it. */
const RUN_SECONDS = 1.5;
/** Seconds the run goes on after the touch it waits for (`until`): the car behind drives on into the wreck it made, which a real push is followed by a brake for. */
const TOUCH_SETTLE = 0.1;
/** The speed (m/s) of a car the cop pushes, and the closings (m/s) a push and a crash are staged at. */
const TARGET_SPEED = 25;
const PUSH_CLOSING = 2;
const CRASH_CLOSING = 4;
/** A nudge closing under the rigid step's graze (`CRASH.grazeMps`): only the pair contact reads it. */
const CREEP_CLOSING = 1;
/** The most (m/s) the car behind may still be faster than the car ahead after the touch: the touch took the closing, it did not pass through. */
const PASS_THROUGH_SLACK = 0.3;

/** Steps `cars` through the engine's own step, each on its pedals, for `RUN_SECONDS`, or until `TOUCH_SETTLE` after `until` is first true. */
function step(cars: DeformableCar[], pedals: DriveInput[], until: () => boolean = () => false): void {
  for (const car of cars) layOnGround(car);
  const world = makeWorld(cars, false, false);
  for (const [i, car] of cars.entries()) world.pedals.set(car, pedals[i]!);
  let settled = 0;
  for (let frame = 0; frame < RUN_SECONDS / DT && settled < TOUCH_SETTLE; frame++) {
    tickWorld(world);
    if (until()) settled += DT;
  }
}

/** A car driving `closing` m/s faster than the car ahead, which is at `targetSpeed`, its nose set on the ahead car's rear quarter. */
function pushRun(targetSpeed: number, closing: number): { pusher: DeformableCar; pushed: DeformableCar } {
  const pushed = makeCar();
  const pusher = makeCar();
  launch(pushed, 0, 0, 0, 0, targetSpeed);
  launch(pusher, -QUARTER_OFFSET, outlineOf(pushed).zLo - outlineOf(pusher).zHi - START_GAP, 0, 0, targetSpeed + closing);
  step([pushed, pusher], [targetSpeed === 0 ? PARKED : FREEWHEEL, FREEWHEEL], () => pushed.crashed);
  return { pusher, pushed };
}

/** Two cars nose to nose, each driving `eachSpeed` m/s at the other. */
function headOn(eachSpeed: number): DeformableCar[] {
  const a = makeCar();
  const b = makeCar();
  launch(a, 0, 0, 0, 0, eachSpeed);
  launch(b, 0, outlineOf(a).zHi + outlineOf(b).zHi + START_GAP, Math.PI, 0, -eachSpeed);
  step([a, b], [FREEWHEEL, FREEWHEEL]);
  return [a, b];
}

describe("given a car driving 2 m/s faster than the car ahead, its nose on the ahead car's rear quarter", () => {
  it("when the car ahead drives at 25 m/s, then the car behind keeps driving and the car ahead crashes", () => {
    const { pusher, pushed } = pushRun(TARGET_SPEED, PUSH_CLOSING);
    expect(pusher.crashed, "the pusher crashed on a 2 m/s push").toBe(false);
    expect(pushed.crashed, "the pushed car took no hit").toBe(true);
    expect(pusher.velocity.z - pushed.velocity.z, "the pusher went through the pushed car").toBeLessThan(PASS_THROUGH_SLACK);
  });

  it("when the car ahead is parked, then the car nudging it keeps driving and the parked car crashes", () => {
    const { pusher, pushed } = pushRun(0, PUSH_CLOSING);
    expect(pusher.crashed, "the nudger crashed on a 2 m/s nudge").toBe(false);
    expect(pushed.crashed, "the nudged car took no hit").toBe(true);
    expect(pusher.velocity.z - pushed.velocity.z, "the nudger went through the parked car").toBeLessThan(PASS_THROUGH_SLACK);
  });

  it("when the car ahead is parked and the car behind closes at 1 m/s, then the car behind keeps driving and the parked car crashes", () => {
    const { pusher, pushed } = pushRun(0, CREEP_CLOSING);
    expect(pusher.crashed, "the nudger crashed on a 1 m/s nudge").toBe(false);
    expect(pushed.crashed, "the nudged car took no hit").toBe(true);
  });
});

describe("given a car driving 4 m/s faster than the car ahead, its nose on the ahead car's rear quarter", () => {
  it("when the car ahead drives at 25 m/s, then both cars crash", () => {
    const { pusher, pushed } = pushRun(TARGET_SPEED, CRASH_CLOSING);
    expect(pusher.crashed, "a 4 m/s hit is no push").toBe(true);
    expect(pushed.crashed).toBe(true);
  });

  it("when the car ahead is parked, then both cars crash", () => {
    const { pusher, pushed } = pushRun(0, CRASH_CLOSING);
    expect(pusher.crashed, "a 4 m/s hit is no nudge").toBe(true);
    expect(pushed.crashed).toBe(true);
  });
});

describe("given two cars each driving at the other", () => {
  it("when they close at 2.4 m/s, then each is pushing and neither crashes nor passes through the other", () => {
    const [a, b] = headOn(1.2);
    expect(a.crashed || b.crashed, "a car crashed on a 2.4 m/s push").toBe(false);
    expect(a.group.position.z, "the cars passed through each other").toBeLessThan(b.group.position.z);
  });

  it("when they close at 4.8 m/s, then both crash", () => {
    const cars = headOn(2.4);
    expect(cars.map((car) => car.crashed)).toEqual([true, true]);
  });
});

describe("given a car driving into a wall, which is no car to push", () => {
  it("when it meets the wall at 2 m/s, then it crashes", () => {
    const car = makeCar();
    runWall(2 * 3.6, 1, "front", { car });
    expect(car.crashed).toBe(true);
  });

  it("when it meets the wall at 3 m/s, then it crashes", () => {
    const car = makeCar();
    runWall(3 * 3.6, 1, "front", { car });
    expect(car.crashed).toBe(true);
  });
});
