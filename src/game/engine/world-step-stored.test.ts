import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { WORK } from "./sim-phases.ts";
import { newWorld, stepWorld, type World } from "./world-step.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

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

describe("given a car the race put away (`stored`) beside a car driving on, with `epi.storedSkip` set", () => {
  it("when the world steps 1 s with the knob at 1, then the put-away car is not stepped (nothing of it moves, no car-slice counted) and the driving car runs its slices", () => {
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

  it("when the world steps 1 s with the knob at 0 or 2, then both cars are stepped as before", () => {
    for (const knob of [0, 2]) {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.storedSkip = knob;
      const { cars, w } = field();
      for (let s = 0; s < 80; s++) stepWorld(w, STEP);
      assert.equal(carSlices(w), 160, `knob ${knob}: two car-slices a step`);
      for (const car of cars) car.dispose();
    }
  });

  it("when a car with wheelspin and a sliding drive is placed again, then the knob at 1 or 2 starts it with the drive's integrators at rest, and at 0 leaves them as they were", () => {
    for (const knob of [0, 1, 2]) {
      loadEpicenter(EPICENTER_AT_LOAD);
      EPICENTER.storedSkip = knob;
      const car = makeCar("shape");
      car.drive.spin = 1;
      car.drive.spinSpeed = 1.7;
      car.drive.slide = 0.4;
      car.spawnFacing(10, 20, 0, 0);
      const fresh = knob > 0;
      assert.equal(car.drive.spin, fresh ? 0 : 1, `knob ${knob}: spin`);
      assert.equal(car.drive.spinSpeed, fresh ? 0 : 1.7, `knob ${knob}: spin speed`);
      assert.equal(car.drive.slide, fresh ? 0 : 0.4, `knob ${knob}: slide`);
      car.dispose();
    }
  });
});
