import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { GQ } from "../world/ground-clock.ts";
import { setGround } from "../world/ground.ts";
import { blankPoint, pointOn } from "../world/track.ts";
import { track } from "./ejection-slope.test-util.ts";
import { frame, makeCar, worldOf } from "./ground-probe.test-util.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";

/**
 * The rigid step skips every body point of a slice when the surfaces under the whole body are lower than its lowest point (`stepFree`'s
 * `allClear`). That bound must clear only what each point's own test would: a wreck's points are armed about its masses' centre, not the car's
 * stock centre, and a gate boxed about the stock one cleared rows the point test asks (a clip's replay, with no neighbour roof near the wreck
 * to switch the gate off, then read different rows from the live sim: 0.1 m of pose in 1.6 s).
 */

const NOSE_HIT_M = 2.05;
const HIT_MPS = 30;
const SECONDS = 4;
/** The attitudes a wreck is dropped in (pitch, yaw, roll about the car's own axes). */
const ATTITUDES: readonly (readonly [number, number, number])[] = [
  [0, 0, Math.PI],
  [0.5, 0, Math.PI],
  [-0.5, 0, Math.PI],
  [0, 0, Math.PI / 2],
  [0, 0, -Math.PI / 2],
  [0.3, 0, 0.6],
];

/** A wreck of `cls` dropped in `attitude` 0.5 m up on the stunt course's start straight and left `SECONDS` s. */
function restedWreck(cls: VehicleClassId, attitude: readonly [number, number, number]): void {
  const trk = track("stunt");
  const ground = trk.ground();
  setGround(ground);
  const pt = blankPoint();
  pointOn(trk.path, 0, pt);
  const car = makeCar(cls);
  car.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), 0);
  car.updateSkin();
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, NOSE_HIT_M), car.forward.clone().negate(), HIT_MPS, HIT_MPS);
  car.group.rotation.set(attitude[0], attitude[1], attitude[2], "YXZ");
  car.group.updateMatrixWorld(true);
  car.group.position.y += ground.heightAt(pt.x, pt.z, pt.y) + 0.5 - new THREE.Box3().setFromObject(car.group).min.y;
  car.airborne = true;
  car.parked = true;
  const world = worldOf(car);
  const st = { acc: 0 };
  for (let f = 0; f < SECONDS * FRAME_HZ; f++) frame(world, null, st);
}

describe("given a wreck dropped in six attitudes on the stunt course's start straight and left to rest, with the ground clock verifying the whole-body gate", () => {
  afterEach(() => {
    GQ.on = false;
    GQ.check = false;
    setGround(null);
  });

  for (const cls of ["sedan", "truck", "monster"] as const) {
    it(`when it is a ${cls}, then every slice the gate skipped the points of is one where reading them anyway makes no contact row`, () => {
      GQ.allClear.slices = GQ.allClear.wreckSlices = GQ.allClear.rowSlices = GQ.allClear.rows = GQ.allClear.wreckRowSlices = 0;
      GQ.on = true;
      GQ.check = true;
      for (const attitude of ATTITUDES) restedWreck(cls, attitude);
      const c = GQ.allClear;
      assert.ok(c.wreckSlices > 0, `the gate skipped no slice of a wreck (${c.slices} slices in all): nothing here to check`);
      assert.equal(c.wreckRowSlices, 0, `the gate skipped the points of ${c.wreckRowSlices} of ${c.wreckSlices} wreck slices where reading them made ${c.rows} contact rows`);
    });
  }
});
