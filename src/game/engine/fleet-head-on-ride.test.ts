import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "../vehicle/car.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { makeWorld, PARKED, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { C_OWNER, HIT_SIZE } from "../world/surfaces.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * The owner's head-on flicker (17 m/s, muscle car and sedan): when the noses packed, a wreck's front tyres read the other wreck's crushed top,
 * the rigid step took no row from them, but the drawn ride seated on it, so each nose jumped up 12-19 cm and back. Staged here directly: a
 * muscle car's wreck set down with its front tyres on a parked sedan wreck's bonnet and its rear tyres on the road.
 */
const FRAME = 1 / FRAME_HZ;
/** Frames read: while the front tyres still stand on the bonnet; the pair's push slides the car off onto the road by 0.3 s, where its nose lands (a seat on the ground, no flicker). */
const ON_TOP_FRAMES = 15;
/** A drawn front wheel seated more than this (m) over its hub stands on something: the parked wreck's bonnet is the only thing under it. */
const RAISED = 0.05;
const FRONT_WHEELS = 2;
/** Plan z (m) of the muscle car's front axle over the sedan's bonnet, and the bonnet's height there (m), which its front tyres are set on. */
const AXLE_OVER_Z = 1.6;
const BONNET_Y = 0.7;
/** Half the wheelbase (m) and the hub's height (m) the car is pitched about. */
const HALF_BASE = 1.34;
const HUB_Y = 0.32;

/** A car of class `cls` as a wreck at rest at (x, y, z), heading `yaw`, pitched nose-up by `pitch` (rad). */
function wreckAt(cls: VehicleClassId, x: number, y: number, z: number, yaw: number, pitch: number): DeformableCar {
  const car = makeCar(cls);
  car.spawnFacing(x, z, yaw, 0);
  car.group.position.y = y;
  car.group.rotation.set(-pitch, yaw, 0, "YXZ");
  car.group.updateMatrixWorld(true);
  car.deform.bindKinematic(car.group, car.velocity, car.angular);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.crashed = true;
  return car;
}

/** The pair of the staging: a sedan wreck parked at the origin, a muscle car's wreck over its bonnet, in a world with idle pedals. */
function bonnetStaging(): { over: DeformableCar; cars: readonly DeformableCar[]; w: ReturnType<typeof makeWorld> } {
  const parked = wreckAt("sedan", 0, 0, 0, 0, 0);
  const pitch = Math.asin(BONNET_Y / (2 * HALF_BASE));
  const over = wreckAt("muscle", 0, HUB_Y + HALF_BASE * Math.sin(pitch) - HUB_Y * Math.cos(pitch), AXLE_OVER_Z + HALF_BASE * Math.cos(pitch), Math.PI, pitch);
  const cars = [parked, over];
  return { over, cars, w: makeWorld(cars, false, false, PARKED) };
}

describe("given a muscle car's wreck set with its front tyres on a parked sedan wreck's bonnet and its rear tyres on the road", () => {
  it("when its front tyres read the other wreck's top, which the rigid step takes no row from, then the world hears the two touch: a highlight clip that keeps the car keeps the wreck its tyres lost their row to", () => {
    const { w } = bonnetStaging();
    let heard = false;
    w.world.partTouch = () => (heard = true);
    for (let frame = 0; frame < ON_TOP_FRAMES; frame++) tickWorld(w, FRAME);
    assert.ok(heard, "the world never heard the muscle car and the sedan wreck touch");
  });

  it("when its front tyres read the other wreck's top, which the rigid step takes no row from, then its drawn nose is not seated on it: no raise and no raise/flat flips", () => {
    const { over, cars, w } = bonnetStaging();
    let onTop = 0;
    let raised = 0;
    let flips = 0;
    let most = 0;
    let was = false;
    for (let frame = 0; frame < ON_TOP_FRAMES; frame++) {
      tickWorld(w, FRAME);
      for (let i = 0; i < FRONT_WHEELS; i++) {
        const own = over.wheelHit[i * HIT_SIZE + C_OWNER]!;
        if (own >= 0 && cars[own]!.deform.massActive) onTop++;
      }
      const seat = Math.max(over.suspension.seat[0]!, over.suspension.seat[1]!);
      most = Math.max(most, seat);
      const up = seat > RAISED;
      if (up) raised++;
      if (up !== was) flips++;
      was = up;
    }
    assert.ok(onTop > 0, "no front tyre read the other wreck's top: the staging proves nothing");
    assert.equal(flips, 0, `drawn front raise/flat flips (${raised} frames raised, seat up to ${(most * 1000).toFixed(0)} mm)`);
    assert.equal(raised, 0, `drawn front raised in ${raised} frames (seat up to ${(most * 1000).toFixed(0)} mm)`);
  });
});
