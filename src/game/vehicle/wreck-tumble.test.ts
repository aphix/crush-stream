import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { assignClass, CLASSES } from "./vehicle-classes.ts";
import { paint, DT } from "./test-support.ts";
import { rigidCentre } from "./car-air.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";

/**
 * A lifted wreck's rigid step turns it about its centre of mass, its masses' centroid lifted with its body (`wreckCentre`, `centreLift`:
 * the monster's 0.71 m, fading as the body tips past `UPRIGHT_UP_Y`), the physical one: the masses are its stock frame, without the
 * lifted body's mass. The deform reads `velocity` at the masses' centroid instead (`armMasses`' seatVelocity, its momentum hold), and the
 * two stand ω × lift apart: a monster wreck tumbling off the owner's stack column at 9 rad/s ended with its masses 11.7 m/s off its body
 * (stack-column, union 5af15133). Read about the rigid centre, the masses' momentum should be the body's.
 */
const splitAtCentre =
  "after the overhaul (Main ruling (c)): the deform reads velocity at the lifted wreck centre (seatVelocity, its momentum hold); union 721a9201 reads 5.16 m/s off at up 0.50; an unlifted wreck centre reads 0.00 but drops the monster wreck's centre of mass 0.71 m, and 7 rest rows read it (CarRig rig-lift ce1c7955, parked)";
const SPIN = 9;
const SECONDS = 0.5;
/** How far (m/s) the masses' vertical velocity, referred to the rigid centre, may stand off the body's. */
const OFF_MAX = 0.5;

/** A monster wreck 6 m up, its masses live (armed at rest), then rolling about its length at `SPIN` rad/s about its rigid centre, masses and body alike. */
function tumbling(): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, CLASSES.monster.style);
  assignClass(car, "monster");
  car.spawnFacing(0, 0, 0, 0);
  car.group.position.y = 6;
  car.group.updateMatrixWorld(true);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.angular.set(0, 0, SPIN);
  const c = rigidCentre(car).clone().applyMatrix4(car.group.matrixWorld);
  const r = new THREE.Vector3();
  for (const m of car.deform.masses) m.vel.copy(car.velocity).add(r.subVectors(m.world, c).cross(car.angular).negate());
  return car;
}

/** The masses' mean vertical velocity referred to the car's rigid centre (their centroid's, less the spin's lever from that centre). */
function massesAtCentre(car: DeformableCar): number {
  const ms = car.deform.masses;
  const total = car.deform.totalMass;
  const cm = new THREE.Vector3();
  let vy = 0;
  for (const m of ms) {
    cm.addScaledVector(m.world, m.mass / total);
    vy += (m.vel.y * m.mass) / total;
  }
  const c = rigidCentre(car).clone().applyQuaternion(car.group.quaternion).add(car.group.position);
  const w = car.angular;
  return vy - (w.z * (cm.x - c.x) - w.x * (cm.z - c.z));
}

describe("given a monster wreck tumbling in the air at 9 rad/s about its length, its lifted centre falling to its masses' as it lies over", () => {
  it(`when it tumbles for ${SECONDS} s, then its masses' vertical velocity about its centre stays within ${OFF_MAX} m/s of its body's`, { todo: splitAtCentre }, (t) => {
    const car = tumbling();
    const w = newWorld([car]);
    let worst = 0;
    let at = "";
    for (let f = 0; f < SECONDS / DT; f++) {
      stepWorld(w, DT);
      const off = Math.abs(massesAtCentre(car) - car.velocity.y);
      if (off <= worst) continue;
      worst = off;
      const up = 1 - 2 * (car.group.quaternion.x ** 2 + car.group.quaternion.z ** 2);
      at = `step ${f}: body ${car.velocity.y.toFixed(2)} m/s, masses ${massesAtCentre(car).toFixed(2)}, up ${up.toFixed(2)}`;
    }
    t.diagnostic(`worst ${worst.toFixed(2)} m/s (${at})`);
    assert.ok(car.deform.massActive, "the monster is no wreck");
    assert.ok(worst < OFF_MAX, `the masses stood ${worst.toFixed(2)} m/s off the body (${at})`);
  });
});
