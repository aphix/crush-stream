import * as THREE from "three";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bowPointAt, bowTurnSteps, type Bow } from "./car-curve.ts";

const EXACT = 1e-12;
const RAD_PER_DEGREE = Math.PI / 180;

const BOW_FROM: [number, number, number] = [0, 0, 0];
const BOW_TO: [number, number, number] = [2, 0, 0];

/** The tangent at `t` of the quadratic from (0,0,0) to (2,0,0) whose middle stands `bow` off the chord along +y: its control point is (1, 2·bow, 0). */
function tangentAt(bow: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(1, 2 * bow * (1 - t) - 2 * bow * t, 0).normalize();
}

const middleCases = [
  { it: "when it bows 0.3 m toward +y, then its middle stands 0.3 m off the chord along +y", bow: 0.3, toward: [0, 1, 0] as const, expectedMiddle: [1, 0.3, 0] },
  { it: "when `toward` also leans along the chord, then only its square part counts and the middle still stands 0.3 m along +y", bow: 0.3, toward: [1, 1, 0] as const, expectedMiddle: [1, 0.3, 0] },
  { it: "when `toward` is longer than a unit, then its length doesn't scale the bow", bow: 0.3, toward: [0, 4, 0] as const, expectedMiddle: [1, 0.3, 0] },
  { it: "when the bow is negative, then the middle stands that far the other way", bow: -0.3, toward: [0, 1, 0] as const, expectedMiddle: [1, -0.3, 0] },
  { it: "when it bows toward +z, then the middle leaves the xy plane by the bow", bow: 0.2, toward: [0, 0, 1] as const, expectedMiddle: [1, 0, 0.2] },
] as const;

describe("given a bowed edge 2 m long along x", () => {
  for (const testCase of middleCases) {
    it(testCase.it, () => {
      const b: Bow = { from: BOW_FROM, to: BOW_TO, bow: testCase.bow, toward: testCase.toward };
      const start = bowPointAt(b, 0, new THREE.Vector3());
      const middle = bowPointAt(b, 0.5, new THREE.Vector3());
      const end = bowPointAt(b, 1, new THREE.Vector3());
      assert.ok(start.distanceTo(new THREE.Vector3(...BOW_FROM)) < EXACT, `start ${start.toArray()}`);
      assert.ok(end.distanceTo(new THREE.Vector3(...BOW_TO)) < EXACT, `end ${end.toArray()}`);
      assert.ok(Math.abs(middle.x - testCase.expectedMiddle[0]) < EXACT, `middle x ${middle.x}`);
      assert.ok(Math.abs(middle.y - testCase.expectedMiddle[1]) < EXACT, `middle y ${middle.y}`);
      assert.ok(Math.abs(middle.z - testCase.expectedMiddle[2]) < EXACT, `middle z ${middle.z}`);
    });
  }
});

const turnCases = [
  { it: "when it doesn't bow, then two samples (its ends) cover it", bow: 0, toward: [0, 1, 0] as const, maxTurnDegrees: 10, expectedSteps: 1 },
  { it: "when it bows 1 m (its tangent turns 126.87°) at 10° a step, then 13 equal steps cover it", bow: 1, toward: [0, 1, 0] as const, maxTurnDegrees: 10, expectedSteps: 13 },
  { it: "when it bows 1 m at 2° a step, then 64 steps cover it", bow: 1, toward: [0, 1, 0] as const, maxTurnDegrees: 2, expectedSteps: 64 },
  { it: "when it bows 0.04 m (9.15° of turn) at 10° a step, then one step covers it", bow: 0.04, toward: [0, 1, 0] as const, maxTurnDegrees: 10, expectedSteps: 1 },
  { it: "when it bows 0.05 m (11.42° of turn) at 10° a step, then two steps cover it", bow: 0.05, toward: [0, 1, 0] as const, maxTurnDegrees: 10, expectedSteps: 2 },
  { it: "when `toward` also leans along the chord, then only its square part counts: the same 13 steps", bow: 1, toward: [1, 1, 0] as const, maxTurnDegrees: 10, expectedSteps: 13 },
  { it: "when `toward` is longer than a unit, then its length doesn't scale the bow: the same 13 steps", bow: 1, toward: [0, 4, 0] as const, maxTurnDegrees: 10, expectedSteps: 13 },
] as const;

describe("given a bowed edge 2 m long along x, sampled by turn", () => {
  for (const testCase of turnCases) {
    it(testCase.it, () => {
      const b: Bow = { from: BOW_FROM, to: BOW_TO, bow: testCase.bow, toward: testCase.toward };
      const maxTurn = testCase.maxTurnDegrees * RAD_PER_DEGREE;
      const ts = bowTurnSteps(b, maxTurn);
      assert.equal(ts.length - 1, testCase.expectedSteps, "steps");
      assert.equal(ts[0], 0, "first sample at the start");
      assert.equal(ts[ts.length - 1], 1, "last sample at the end");
      const before = new THREE.Vector3();
      const after = new THREE.Vector3();
      const turns: number[] = [];
      for (let k = 1; k < ts.length; k++) {
        assert.ok(ts[k]! > ts[k - 1]!, `samples ascend at ${k}`);
        tangentAt(testCase.bow, ts[k - 1]!, before);
        tangentAt(testCase.bow, ts[k]!, after);
        turns.push(before.angleTo(after));
      }
      for (const [k, turn] of turns.entries()) {
        assert.ok(turn <= maxTurn + 1e-9, `step ${k} turns ${turn / RAD_PER_DEGREE}° (max ${testCase.maxTurnDegrees}°)`);
        assert.ok(Math.abs(turn - turns[0]!) < 1e-9, `step ${k} turns as much as the first (${turn} vs ${turns[0]})`);
      }
    });
  }
});

describe("given a bowed edge whose middle control point sits at (1, 2, 0) (from the origin to (2, 0, 0), bowing 1 m toward +y)", () => {
  it("when its curve is read at the ends, then it leaves and arrives along each control leg (out at 63.4° above the chord, back in at 63.4° below)", () => {
    const b: Bow = { from: BOW_FROM, to: BOW_TO, bow: 1, toward: [0, 1, 0] };
    // A step of 1e-6 along t: the chord from the end reads the tangent to well within 1e-5.
    const step = 1e-6;
    const start = bowPointAt(b, step, new THREE.Vector3()).sub(bowPointAt(b, 0, new THREE.Vector3())).normalize();
    const end = bowPointAt(b, 1, new THREE.Vector3()).sub(bowPointAt(b, 1 - step, new THREE.Vector3())).normalize();
    const legTolerance = 1e-5;
    const leg = 1 / Math.sqrt(5);
    assert.ok(Math.abs(start.x - leg) < legTolerance && Math.abs(start.y - 2 * leg) < legTolerance, `start tangent ${start.toArray()}`);
    assert.ok(Math.abs(end.x - leg) < legTolerance && Math.abs(end.y + 2 * leg) < legTolerance, `end tangent ${end.toArray()}`);
  });
});
