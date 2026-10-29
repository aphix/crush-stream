import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { makeCar, runWall } from "../contact/crash-scenarios.test-util.ts";
import { makeBox, strikeCar } from "../contact/external-contact.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { PLATE } from "./compactor.ts";
import { JerseyBarrier } from "./engine-props.ts";
import { firePiston } from "./piston-rig.test-util.ts";
import { QUIET_HZ } from "../kernel/constants.ts";

/**
 * One car, one hard flat face, one closing speed, delivered by every striker the scenes have (docs/UNIFIED_CONTACT.md 13): the
 * range's slab held still with the car driving into it (the reference: a car against a solid), the piston, the moving slab, and
 * the press plate. Each leaves the nose crushed and the drivetrain at some health; "the same everywhere" is those healths agreeing.
 */

/** The squash setting the calibration is made at (`docs/CRASH_CALIBRATION.md`). */
const SQUASH = 0.32;
/** Start the car 6 m from the struck face so no striker's approach is in the measurement. */
const RUN_UP = 6;
const SLICE = 1 / QUIET_HZ;
const SECONDS = 4;
/** The piston's mass (kg): 23 times the car's, so it is nearly the unmoving face the slab is. */
const PISTON_KG = 20000;

type Striker = "slab held still, car drives in" | "piston" | "moving slab" | "press plate";

const STRIKERS: readonly Striker[] = ["slab held still, car drives in", "piston", "moving slab", "press plate"];

function parked(): DeformableCar {
  const car = makeCar("shape", SQUASH);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** The car's drivetrain health (1 whole, 0 dead) after `striker` met its nose at `kph`. */
function healthAfter(striker: Striker, kph: number): number {
  const speed = kph / 3.6;
  if (striker === "slab held still, car drives in") {
    const car = makeCar("shape", SQUASH);
    runWall(kph, 1, "front", { car });
    return car.deform.drivetrainHealth;
  }
  const car = parked();
  if (striker === "piston") {
    firePiston(car, "front", { speedKph: kph, massKg: PISTON_KG, hardness: 1, after: 1.5 });
  } else if (striker === "moving slab") {
    // A held slab is a kinematic striker (`kg` Infinity): its speed is its own, whatever the car gives back.
    const slab = new JerseyBarrier(new THREE.Scene(), new THREE.Group());
    slab.kg = Infinity;
    slab.yaw = Math.PI / 2;
    slab.group.rotation.y = slab.yaw;
    slab.group.position.set(0, 0, RUN_UP);
    const world = newWorld([car], slab);
    for (let step = 0; step < SECONDS / SLICE; step++) {
      slab.vel.set(0, 0, -speed);
      slab.step(SLICE);
      stepWorld(world, SLICE);
    }
  } else {
    // The press plate: the compactor's own slab (`PLATE`, kinematic, hardness 1) closing at `speed` instead of the press's 0.55 m/s.
    const plate = makeBox();
    plate.hx = PLATE.hx;
    plate.hy = PLATE.hy;
    plate.hz = PLATE.hz;
    plate.y = PLATE.y;
    plate.yaw = Math.PI;
    plate.vz = -speed;
    let z = RUN_UP + PLATE.hz;
    for (let step = 0; step < SECONDS / SLICE; step++) {
      z -= speed * SLICE;
      plate.z = z;
      strikeCar(car, plate, SLICE, true);
      if (car.deform.massActive) {
        car.deform.stepStructure(SLICE, car.group.quaternion);
        strikeCar(car, plate, SLICE, false);
        car.syncPose(SLICE);
      }
      car.afterContacts(SLICE);
      car.stepBreakage(SLICE);
    }
  }
  return car.deform.drivetrainHealth;
}

// docs/UNIFIED_CONTACT.md 13 (owner: "a hard surface crushes a car the same way whether it moves a little or is static"): the press
// plate, the piston and the moving jersey slab meet a car through one contact (`strikeCar`), so at one closing speed each leaves the
// drivetrain where the static slab leaves it. The band is the calibration suite's own health band (0.2).
const HEALTH_BAND = 0.2;
const REFERENCE = STRIKERS[0]!;

describe("given a sedan meeting a hard flat face head-on at a closing speed that half-kills its drivetrain (50 km/h)", () => {
  const reference = healthAfter(REFERENCE, 50);

  it("when the static slab is the face, then the drivetrain is neither whole nor dead, so the band can tell a wrong striker", () => {
    expect(reference > HEALTH_BAND && reference < 1 - HEALTH_BAND, `reference health ${reference.toFixed(3)}`).toBeTruthy();
  });

  for (const striker of STRIKERS.slice(1)) {
    it(`when the ${striker} is the face at 50 km/h, then the drivetrain health is within ${HEALTH_BAND} of the static slab's`, () => {
      const got = healthAfter(striker, 50);
      expect(Math.abs(got - reference), `${striker}: ${got.toFixed(3)} against the static slab's ${reference.toFixed(3)}`).toBeLessThanOrEqual(HEALTH_BAND);
    });
  }
});

describe("given the same sedan meeting the face at 40 km/h (a hurt drivetrain) and at 56 km/h (a dead one)", () => {
  for (const kph of [40, 56]) {
    for (const striker of STRIKERS.slice(1)) {
      it(`when the ${striker} is the face at ${kph} km/h, then the drivetrain health is within ${HEALTH_BAND} of the static slab's`, () => {
        const want = healthAfter(REFERENCE, kph);
        const got = healthAfter(striker, kph);
        expect(Math.abs(got - want), `${striker} at ${kph} km/h: ${got.toFixed(3)} against ${want.toFixed(3)}`).toBeLessThanOrEqual(HEALTH_BAND);
      });
    }
  }
});
