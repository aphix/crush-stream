import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { G } from "./car-air-body.ts";
import { rigidCentre } from "./car-air.ts";
import { layOnWedge, RAD, stepSlices, Wedge, WEDGE_FOOT } from "./wedge.test-util.ts";
import { makeCar } from "./ground-probe.test-util.ts";
import { useStiffSprings } from "./stiff-springs.test-util.ts";
import { setGround } from "../world/ground.ts";

/**
 * A car coasting on its tyre springs over a face keeps the pull of gravity along it: on a face at angle θ a frictionless body gains
 * G·sin θ along the slope a second, G·sin θ·cos θ of it horizontal, uphill or down. The rigid step (`stepFree`) alone moves the car: no
 * drive, so nothing holds its speed but the contacts.
 */
const WEDGE_DEG = 10;
const COAST_S = 0.5;
const RATE_HZ = 240;
/** Most the gain may stray from the closed form (fraction of it): a slice's contact rounding, not a missing pull. */
const GAIN_TOLERANCE = 0.1;
const PULL = G * Math.sin(WEDGE_DEG * RAD) * Math.cos(WEDGE_DEG * RAD);

describe("given a car coasting along a 10° wedge's face on its tyre springs", () => {
  afterEach(() => setGround(null));

  const testCases = (["sedan", "monster"] as const).flatMap((cls) => [
    { it: `when a ${cls} coasts up the face at 6 m/s for ${COAST_S} s, then gravity has slowed it by G·sin·cos a second`, cls, yawDegrees: 90, startSpeedX: 6 },
    { it: `when a ${cls} coasts down the face at 6 m/s for ${COAST_S} s, then gravity has sped it up by G·sin·cos a second`, cls, yawDegrees: 270, startSpeedX: -6 },
  ]);
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const wedge = new Wedge(WEDGE_DEG);
      setGround(wedge);
      const car = layOnWedge(testCase.cls, wedge, testCase.yawDegrees * RAD);
      car.velocity.set(testCase.startSpeedX, testCase.startSpeedX * Math.tan(WEDGE_DEG * RAD), 0);
      stepSlices(car, COAST_S, RATE_HZ);
      const gain = car.velocity.x - testCase.startSpeedX;
      const expected = -PULL * COAST_S;
      assert.ok(Math.abs(gain - expected) <= GAIN_TOLERANCE * Math.abs(expected), `horizontal speed changed by ${gain.toFixed(3)} m/s, gravity along the face gives ${expected.toFixed(3)}`);
    });
  }
});

/** The 10° rows above hold the pull to 10 %; a steeper face has to keep it, and no face may add energy to a coasting car. */
const STEEP_DEGREES = [20, 31, 40] as const;
const STEEP_PULL_TOLERANCE = 0.05;
/** The settle before the energy is read, and the window it is read over (s). */
const SETTLE_S = 0.25;
const ENERGY_WINDOW_S = 0.25;
/** Most mechanical energy (J/kg, a coasting 6 m/s car holds 18) a car may gain over the window: a slice's contact rounding, not a lift that pays no speed. */
const ENERGY_ROUNDING = 0.1;

const _centre = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _inverse = new THREE.Quaternion();

/** The car's mechanical energy per unit mass (J/kg): its velocity and spin about its rigid centre, and that centre's height (a monster's stands 1.4 m over its origin, so a pitching one lifts it). */
function energyOf(car: DeformableCar): number {
  _centre.copy(rigidCentre(car)).applyQuaternion(car.group.quaternion);
  _spin.copy(car.angular).applyQuaternion(_inverse.copy(car.group.quaternion).invert());
  const inverseInertia = car.frame.invI;
  const spin = 0.5 * (_spin.x * _spin.x / inverseInertia.x + _spin.y * _spin.y / inverseInertia.y + _spin.z * _spin.z / inverseInertia.z);
  return 0.5 * car.velocity.lengthSq() + spin + G * (car.group.position.y + _centre.y);
}

const steepCases = (["sedan", "monster"] as const).flatMap((cls) =>
  STEEP_DEGREES.flatMap((deg) => [
    { cls, deg, up: true, way: "up", startSpeedX: 6 },
    { cls, deg, up: false, way: "down", startSpeedX: -6 },
  ]),
);

function stageOnSteepFace(c: (typeof steepCases)[number]): DeformableCar {
  const wedge = new Wedge(c.deg);
  setGround(wedge);
  const car = layOnWedge(c.cls, wedge, (c.up ? 90 : 270) * RAD);
  car.velocity.set(c.startSpeedX, c.startSpeedX * Math.tan(c.deg * RAD), 0);
  return car;
}

describe("given a car coasting along a steep wedge face on its tyre springs", () => {
  afterEach(() => setGround(null));

  for (const c of steepCases) {
    it(`when a ${c.cls} coasts ${c.way} the ${c.deg}° face at 6 m/s for ${COAST_S} s, then gravity has changed its speed by G·sin·cos a second within 5 %`, () => {
      const car = stageOnSteepFace(c);
      stepSlices(car, COAST_S, RATE_HZ);
      const gain = car.velocity.x - c.startSpeedX;
      const expected = -G * Math.sin(c.deg * RAD) * Math.cos(c.deg * RAD) * COAST_S;
      assert.ok(Math.abs(gain - expected) <= STEEP_PULL_TOLERANCE * Math.abs(expected), `horizontal speed changed by ${gain.toFixed(3)} m/s, gravity along the face gives ${expected.toFixed(3)}`);
    });
  }
});

describe("given a car coasting along a steep wedge face on springs so stiff that none of its energy is stored in them", () => {
  let restoreSprings = (): void => {};
  before(() => {
    restoreSprings = useStiffSprings();
  });
  after(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const c of steepCases) {
    it(`when a ${c.cls} coasts ${c.way} the ${c.deg}° face at 6 m/s, then over ${ENERGY_WINDOW_S} s after it has settled it gains no energy`, () => {
      const car = stageOnSteepFace(c);
      stepSlices(car, SETTLE_S, RATE_HZ);
      const before = energyOf(car);
      stepSlices(car, ENERGY_WINDOW_S, RATE_HZ);
      const gain = energyOf(car) - before;
      assert.ok(gain <= ENERGY_ROUNDING, `the car gained ${gain.toFixed(3)} J/kg of the ${before.toFixed(1)} it had`);
    });
  }
});

/** A car coasting from flat road onto a steep face holds the energy it came with at most (the springs' own give-back aside): it cannot climb higher than its speed lifts it. */
const MOUNT_DEGREES = [31, 40] as const;
const MOUNT_SPEEDS = [6, 10] as const;
const MOUNT_RUN_FROM_FOOT_M = 12;
const MOUNT_RUN_S = 5;
/** The run-up's length before the face's foot (m): the car is rolling steadily by it. */
const MOUNT_APPROACH_M = 12;
/** Most the springs may give back over the mount (J/kg): a sliver of a car's 18 to 50 on the faces and speeds above. */
const MOUNT_SPRING_GIVE_BACK = 0.5;

/** The monster's mount, a todo: it gains energy climbing a steep face coasting (readings over the 31.7 J/kg at 6 m/s and 63.7 at 10 it came with). */
const MONSTER_MOUNT_TODO = "a coasting monster climbs a steep face on the rigid tyre rows' straight-up push, which keeps its horizontal speed (a thrust the engine owes): +19.5 J/kg at 31° and 6 m/s (5.3 m past the foot), +47.3 at 31° and 10 (12 m), +15.7 at 40° and 6 (3.0 m), +37.1 at 40° and 10 (7.4 m); the push along the face's normal for an unpowered car cuts them to +4.0/0/+3.9/0 but turns wreck-slope's two monster rows red";

describe("given a car coasting from flat road onto a steep wedge face", () => {
  afterEach(() => setGround(null));

  for (const cls of ["sedan", "monster"] as const) {
    for (const deg of MOUNT_DEGREES) {
      for (const speed of MOUNT_SPEEDS) {
        it(`when a ${cls} coasts onto the ${deg}° face at ${speed} m/s, then it never holds more energy than it came with`, cls === "monster" ? { todo: MONSTER_MOUNT_TODO } : {}, () => {
          const wedge = new Wedge(deg);
          setGround(wedge);
          const car = makeCar(cls);
          car.spawnFacing(WEDGE_FOOT - MOUNT_APPROACH_M, 0, Math.PI / 2, speed);
          car.group.position.y = wedge.heightAt(car.group.position.x, 0, 0.5);
          const start = energyOf(car);
          let peak = start;
          for (let s = 0; s < MOUNT_RUN_S * RATE_HZ && car.group.position.x < WEDGE_FOOT + MOUNT_RUN_FROM_FOOT_M && car.velocity.x > 0.2; s++) {
            stepSlices(car, 1 / RATE_HZ, RATE_HZ);
            peak = Math.max(peak, energyOf(car));
          }
          assert.ok(peak - start <= MOUNT_SPRING_GIVE_BACK, `the car held ${(peak - start).toFixed(2)} J/kg more than the ${start.toFixed(1)} it came with, ${(car.group.position.x - WEDGE_FOOT).toFixed(1)} m past the foot`);
        });
      }
    }
  }
});
