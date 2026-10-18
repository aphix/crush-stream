import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { QUIET_HZ } from "../kernel/constants.ts";
import { WORK } from "./sim-phases.ts";
import { newWorld, stepWorld, type World } from "./world-step.ts";

const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

/** The pacer's coarse step (s). */
const STEP = 1 / QUIET_HZ;

/** A car driving on at 25 m/s and one the race put away, 4 km off: the two cars `stepWorld` is given. */
function field(): { cars: DeformableCar[]; w: World } {
  const cars = [makeCar("shape"), makeCar("shape")];
  launch(cars[0]!, 0, 0, 0, 0, 25);
  launch(cars[1]!, 4000, 4000, 0, 0, 0);
  cars[1]!.stored = true;
  const w = newWorld(cars);
  w.lone = true;
  return { cars, w };
}

function carSlices(w: World): number {
  const work = w.phases.work;
  return work[WORK.liveCarSlices]! + work[WORK.wreckCarSlices]! + work[WORK.asleepCarSlices]!;
}

describe("given a car the race put away (`stored`) beside a car driving on", () => {
  it("when the world steps 1 s with `epi.storedSkip` at 1, then the put-away car is not stepped (nothing of it moves, no car-slice counted) and the driving car runs its slices", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.storedSkip = 1;
    const { cars, w } = field();
    const parked = cars[1]!;
    const x = parked.group.position.x;
    const z = parked.group.position.z;
    const y = parked.group.position.y;
    for (let s = 0; s < 80; s++) stepWorld(w, STEP);
    assert.equal(carSlices(w), 80, "one car-slice a step: the driving car's");
    assert.equal(parked.group.position.x, x, "the put-away car stands where it was (x)");
    assert.equal(parked.group.position.y, y, "(y)");
    assert.equal(parked.group.position.z, z, "(z)");
    assert.ok(cars[0]!.group.position.z > 20, "the driving car drove on");
    for (const car of cars) car.dispose();
  });

  it("when the world steps 1 s with the knob at 0, then both cars are stepped as before", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.storedSkip = 0;
    const { cars, w } = field();
    for (let s = 0; s < 80; s++) stepWorld(w, STEP);
    assert.equal(carSlices(w), 160, "two car-slices a step");
    for (const car of cars) car.dispose();
  });

  it("when the put-away car's roof carries weight (a rider's) and the knob is at 1, then the weight is taken and dropped each slice as a step would take it, not left in the slot for the car's first step after it is placed again", () => {
    loadEpicenter(EPICENTER_AT_LOAD);
    EPICENTER.storedSkip = 1;
    const { cars, w } = field();
    stepWorld(w, STEP);
    const surfaces = w.surfaces;
    surfaces.borneState(1, Float64Array.of(0, -0.05, 0, 0, 0, 0), 0, true);
    assert.equal(w.surfaces.cars.length, 2, "the world's roofs hold both cars");
    stepWorld(w, STEP);
    const left = new Float64Array(6);
    surfaces.borneState(1, left, 0, false);
    assert.equal(left.some((v) => v !== 0), false, "the put-away car's slot holds no borne weight after a step");
    for (const car of cars) car.dispose();
  });
});
