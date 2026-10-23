import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ASK, G, N, OWN, PRESS, R, SHARE, SOFT, springPushes } from "./car-air-body.ts";
import { droop, SPRINGS } from "./car-suspension.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";

/**
 * A tyre's spring push (`springPushes`) against how far its wheel is pressed past the rest ride: on the ground the wheel hangs down to its droop
 * plane, a preloaded spring holding it there, and the surface comes up under it; on another car's top it does not hang down, and the contact begins at
 * the rest ride. Either way the push must meet its start from nothing, not step to the preload or the weight.
 */
const SPRING = SPRINGS.sedan;
const OMEGA = 2 * Math.PI * SPRING.hz;
const STIFF = (OMEGA * OMEGA) / 4;
const DAMP = (SPRING.zeta * OMEGA) / 2;
const TRAVEL = droop("sedan");
const SHARE_OF_CAR = 0.25;
const WEIGHT = SHARE_OF_CAR * G;
const FRAME = carFrame(CAR_STYLES.sedan);

/** The push (m/s², per unit mass of the car) of one tyre of a level car, on the ground or on another car's top, pressed `x` m past the rest ride, in slices of `dt`, the body falling at its own slice of gravity (no closing for the damper to read). */
function push(x: number, dt: number, onCar = false): number {
  for (let c = 0; c < 4; c++) SOFT[c] = c === 0;
  OWN[0] = onCar ? 1 : -1;
  N[0]!.set(0, 1, 0);
  R[0]!.set(0.68, -0.5, 1.25);
  SHARE[0] = SHARE_OF_CAR;
  PRESS[0] = x;
  springPushes(FRAME, 1, STIFF, DAMP, TRAVEL, dt, new THREE.Quaternion(), new THREE.Vector3(0, -G * dt, 0), new THREE.Vector3());
  return ASK[0]! / dt;
}

const starts = [
  { where: "the droop plane under the rest ride", from: -TRAVEL, onCar: false },
  { where: "the rest ride, on another car's top", from: 0, onCar: true },
] as const;

for (const { where, from, onCar } of starts) {
  describe(`given a tyre's wheel pressed up by a surface under it, its contact beginning at ${where}`, () => {
    it("when it is pressed a millimetre past the start, then it pushes under 15 % of its weight, and the push grows by no more than 5 % of its weight per quarter millimetre up to its weight", () => {
      const dt = 1 / 240;
      const first = push(from + 0.001, dt, onCar);
      assert.ok(first < 0.15 * WEIGHT, `1 mm past the start of its contact the tyre pushes ${((100 * first) / WEIGHT).toFixed(0)} % of its weight`);
      let before = push(from + 0.0001, dt, onCar);
      for (let x = from + 0.00035; x <= 0.012; x += 0.00025) {
        const now = push(x, dt, onCar);
        assert.ok(now >= before - 1e-9, `the push falls from ${before.toFixed(3)} to ${now.toFixed(3)} m/s2 at ${(1000 * (x - from)).toFixed(2)} mm past the start`);
        assert.ok(now - before <= 0.05 * WEIGHT, `the push steps by ${((100 * (now - before)) / WEIGHT).toFixed(1)} % of the weight at ${(1000 * (x - from)).toFixed(2)} mm past the start`);
        before = now;
      }
    });
  });
}

describe("given a tyre's wheel pressed to the rest ride and past it", () => {
  it("when it is pressed there, then it carries its share of the weight at the rest ride and the spring's rate beyond, at 60, 144, 240 and 480 Hz alike", () => {
    for (const hz of [60, 144, 240, 480]) {
      const dt = 1 / hz;
      const rest = push(0.012, dt) - STIFF * 0.012;
      assert.ok(Math.abs(rest - WEIGHT) < 0.01 * WEIGHT, `at ${hz} Hz the tyre at the rest ride pushes ${rest.toFixed(3)} m/s2, its weight ${WEIGHT.toFixed(3)}`);
      const past = push(0.02, dt, true);
      assert.ok(Math.abs(past - (WEIGHT + STIFF * 0.02)) < 0.01 * WEIGHT, `at ${hz} Hz 2 cm past the rest ride it pushes ${past.toFixed(3)} m/s2, the spring ${(WEIGHT + STIFF * 0.02).toFixed(3)}`);
      const low = push(-0.05, dt);
      assert.ok(Math.abs(low - push(-0.05, 1 / 480)) < 0.01 * WEIGHT, `at ${hz} Hz 5 cm under the rest ride it pushes ${low.toFixed(3)} m/s2, at 480 Hz ${push(-0.05, 1 / 480).toFixed(3)}`);
    }
  });
});
