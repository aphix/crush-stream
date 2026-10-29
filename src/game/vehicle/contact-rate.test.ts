import { describe, expect, it } from "vitest";
import { contactHz } from "./car-air-points.ts";
import { stepFree } from "./car-air.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { stepSlices } from "./wedge.test-util.ts";

/**
 * The world cuts a step finer (`contactHz`) only for a car that holds a hard contact or is about to: every car rolling on its tyre
 * springs asks for the plain slice, or one car in a field of thirty-two would drag all of them to the fine rate.
 */
const SLICE_HZ = 144;

describe("given a car on flat ground, its tyres in their springs", () => {
  it("when a sedan has rolled for 2 s at 8 m/s, then it asks for the plain slice", () => {
    const car = makeCar("sedan");
    car.spawnFacing(0, 0, 0, 8);
    stepSlices(car, 2, SLICE_HZ);
    expect(contactHz(car), "the rate a rolling sedan asks for").toBe(0);
  });

  it("when a sedan is let down from 0.25 m, then some slice of the landing asks for a finer rate and the settled car does not", () => {
    const car = makeCar("sedan");
    car.spawnFacing(0, 0, 0, 0);
    car.group.position.y = 0.25;
    let finest = 0;
    for (let s = 0; s < 2 * SLICE_HZ; s++) {
      stepFree(car, 1 / SLICE_HZ);
      finest = Math.max(finest, contactHz(car));
    }
    expect(finest, "no slice of the landing asked for a finer rate").toBeGreaterThan(0);
    expect(contactHz(car), "the rate the car asks for 2 s after it landed").toBe(0);
  });
});

describe("given a car whose belly is in the ground", () => {
  /** How far (m) the lowest belly point is under the ground in the row below. */
  const BELLY_IN = 0.008;
  it(`when a sedan rolls at 3 m/s with its lowest belly point ${BELLY_IN * 1000} mm under the road, then it asks for a finer slice`, () => {
    const car = makeCar("sedan");
    car.spawnFacing(0, 0, 0, 3);
    car.group.position.y = -BELLY_IN - Math.min(...car.frame.belly.map(([, y]) => y));
    stepFree(car, 1 / SLICE_HZ);
    expect(contactHz(car), "the rate a sedan with its belly in the road asks for").toBeGreaterThan(0);
  });
});
