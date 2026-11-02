import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, runWall, tickWorld } from "./crash-scenarios.test-util.ts";
import { outlineOf } from "./cage-outline.ts";
import { carrier, centreOfMass, bindBody, N, OWN, pointVel, R } from "../vehicle/car-air-body.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { CarSurfaces } from "../vehicle/car-surfaces.ts";
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
/** A push closing (m/s) between the rigid step's graze (`CRASH.grazeMps`, 1.8) and `PUSH_MAX`: only the rows' arming meets it once the pushed car is armed. */
const BRUSH_CLOSING = 2.8;
/** The equivalent barrier speed (m/s) of the hit that arms a car before the push, and the speed (m/s) a wreck's nose moves at. */
const ARMING_EBS = 2.8;
const WRECK_SPEED = 6;
/** The speed (m/s) a car slides along a parked car's flank, pressing in at `PRESS_SPEED`. */
const SLIDE_SPEED = 8;
const PRESS_SPEED = 1;
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

/** Arms `car`'s masses with a hit at `local` (car frame) along `inward` (car frame), then sets every mass and the car to `vz` along z: the hit's own impulse taken back. */
function arm(car: DeformableCar, local: THREE.Vector3, inward: THREE.Vector3, vz: number): void {
  car.group.updateMatrixWorld(true);
  car.applyImpact(car.group.localToWorld(local.clone()), inward.clone().transformDirection(car.group.matrixWorld), ARMING_EBS, ARMING_EBS);
  for (const m of car.deform.masses) m.vel.set(0, 0, vz);
  car.velocity.set(0, 0, vz);
  car.angular.set(0, 0, 0);
}

/** A car driving `closing` m/s faster than a car ahead at `targetSpeed` whose rear took an arming hit just before the push: it is a car whose masses run, so the push's rows meet it as a car without a reaction. */
function armedPushRun(targetSpeed: number, closing: number): { pusher: DeformableCar; pushed: DeformableCar } {
  const pushed = makeCar();
  const pusher = makeCar();
  launch(pushed, 0, 0, 0, 0, targetSpeed);
  launch(pusher, -QUARTER_OFFSET, outlineOf(pushed).zLo - outlineOf(pusher).zHi - START_GAP, 0, 0, targetSpeed + closing);
  arm(pushed, new THREE.Vector3(0, 0.5, outlineOf(pushed).zLo), new THREE.Vector3(0, 0, 1), targetSpeed);
  step([pushed, pusher], [FREEWHEEL, FREEWHEEL]);
  return { pusher, pushed };
}

/** The closing (m/s) the rigid step reads for a body moving `bodySpeed` m/s along z in front of the nose of an armed wreck moving `noseSpeed` m/s along z. */
function closingOnNose(noseSpeed: number, bodySpeed: number): number {
  const wreck = makeCar();
  launch(wreck, 0, 0, 0, 0, noseSpeed);
  arm(wreck, new THREE.Vector3(0, 0.5, outlineOf(wreck).zHi), new THREE.Vector3(0, 0, -1), noseSpeed);
  const surfaces = new CarSurfaces();
  surfaces.cars = [wreck];
  const standing = makeCar();
  const v = new THREE.Vector3(0, 0, bodySpeed);
  const w = new THREE.Vector3();
  bindBody(standing.group, v, w, new THREE.Vector3(), new THREE.Vector3(1, 1, 1), -1, false, DT);
  centreOfMass.set(0, 0.5, outlineOf(wreck).zHi + 0.5);
  R[0]!.set(0, 0, -0.5);
  N[0]!.set(0, 0, 1);
  OWN[0] = 0;
  carrier(surfaces, 0, 0, 1);
  return -pointVel(0, v, w, new THREE.Vector3()).dot(N[0]!);
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

describe("given a car driving 2.8 m/s faster than the car ahead, a closing the rigid step's graze (1.8 m/s) would crash it at", () => {
  it("when the car ahead drives at 25 m/s, then the car behind keeps driving and the car ahead crashes", () => {
    const { pusher, pushed } = pushRun(TARGET_SPEED, BRUSH_CLOSING);
    expect(pusher.crashed, "the pusher crashed on a 2.8 m/s push").toBe(false);
    expect(pushed.crashed, "the pushed car took no hit").toBe(true);
  });
});

describe("given a car ahead already armed (an earlier hit made its masses run), a car driving faster than it with its nose on its rear quarter", () => {
  it("when the car behind closes at 2.8 m/s, then it keeps driving: a push on a car is a push whether the car is armed or not", () => {
    const { pusher, pushed } = armedPushRun(TARGET_SPEED, BRUSH_CLOSING);
    expect(pusher.crashed, "the pusher crashed on a 2.8 m/s push against an armed car").toBe(false);
    expect(pusher.velocity.z - pushed.velocity.z, "the pusher went through the armed car").toBeLessThan(PASS_THROUGH_SLACK);
  });

  it("when the car behind closes at 4 m/s, then both crash", () => {
    const { pusher } = armedPushRun(TARGET_SPEED, CRASH_CLOSING);
    expect(pusher.crashed, "a 4 m/s hit on an armed car is no push").toBe(true);
  });
});

describe("given a car sliding 8 m/s along a parked car's flank, pressing in at 1 m/s", () => {
  it("when they touch, then the slide is no push: both cars crash as they would on any 1 m/s contact", () => {
    const parked = makeCar();
    const slider = makeCar();
    launch(parked, 0, 0, 0, 0, 0);
    launch(slider, outlineOf(parked).xLo - outlineOf(slider).xHi - 0.01, -2, 0, PRESS_SPEED, SLIDE_SPEED);
    step([parked, slider], [PARKED, FREEWHEEL], () => slider.crashed);
    expect(slider.crashed, "the slider took a push's exemption on a flank scrape").toBe(true);
    expect(parked.crashed).toBe(true);
  });

  it("when the parked car is already armed and the slider presses in at 2.8 m/s, then the slider crashes: the rows read the slide too", () => {
    const parked = makeCar();
    const slider = makeCar();
    launch(parked, 0, 0, 0, 0, 0);
    arm(parked, new THREE.Vector3(outlineOf(parked).xLo, 0.5, 0), new THREE.Vector3(1, 0, 0), 0);
    launch(slider, outlineOf(parked).xLo - outlineOf(slider).xHi - 0.01, -2, 0, BRUSH_CLOSING, SLIDE_SPEED);
    step([parked, slider], [PARKED, FREEWHEEL], () => slider.crashed);
    expect(slider.crashed, "the slider took a push's exemption on a scrape of an armed car").toBe(true);
  });
});

describe("given the nose of an armed wreck, which the rigid step reads as a surface moving with it, and a body in front of it", () => {
  it("when the nose moves into the body at 6 m/s, then the body reads no closing: the wreck takes no reaction, so its speed is no impulse for the body", () => {
    expect(closingOnNose(WRECK_SPEED, 0)).toBeCloseTo(0, 6);
  });

  it("when the nose moves away from a body driving at it at 5 m/s (backing at 3 m/s), then the body reads the 2 m/s it closes at", () => {
    expect(closingOnNose(-3, -5)).toBeCloseTo(2, 6);
  });
});
