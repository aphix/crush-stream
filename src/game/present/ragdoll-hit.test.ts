import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { type RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";

const WALKER = SLOTS - 1;
const SPEED = 6;
/** Part indices (`PARTS` order) the rows name. */
const TORSO = 0;
const HEAD = 1;
const LEFT_THIGH = 8;
const RIGHT_FOREARM = 3;

/** The way a camera in front of him, looking along -z a little down, pushes: along -z with a lift. */
const FROM_FRONT = { x: 0, y: 0.29, z: -0.957 };
const FROM_BEHIND = { x: 0, y: 0.29, z: 0.957 };

const cases: readonly {
  it: string;
  at: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  expectedPart: number;
  expectedTorsoPush: "pushed" | "left alone";
  expectedTurn: { y: -1 | 0 | 1; x: -1 | 0 | 1 };
}[] = [
  { it: "when the chest is pushed from the front, then the torso is sent back and he is barely turned", at: { x: 0, y: 1.15, z: 0.1 }, direction: FROM_FRONT, expectedPart: TORSO, expectedTorsoPush: "pushed", expectedTurn: { y: 0, x: 0 } },
  { it: "when the right shoulder is pushed from the front, then the torso is sent back, turned one way about the vertical and tipped back", at: { x: -0.24, y: 1.3, z: 0.1 }, direction: FROM_FRONT, expectedPart: TORSO, expectedTorsoPush: "pushed", expectedTurn: { y: -1, x: -1 } },
  { it: "when the left shoulder is pushed from the front, then the torso is sent back, turned the other way about the vertical and tipped back", at: { x: 0.24, y: 1.3, z: 0.1 }, direction: FROM_FRONT, expectedPart: TORSO, expectedTorsoPush: "pushed", expectedTurn: { y: 1, x: -1 } },
  { it: "when the right forearm is pushed, then the arm is the part that is sent, and the torso is left to be turned by it", at: { x: -0.24, y: 0.93, z: 0.05 }, direction: FROM_FRONT, expectedPart: RIGHT_FOREARM, expectedTorsoPush: "left alone", expectedTurn: { y: -1, x: 1 } },
  { it: "when the right hand is pushed, then the forearm that carries it is the part that is sent", at: { x: -0.24, y: 0.8, z: 0.05 }, direction: FROM_FRONT, expectedPart: RIGHT_FOREARM, expectedTorsoPush: "left alone", expectedTurn: { y: -1, x: 1 } },
  { it: "when the head is pushed from the front, then the head is sent back and the torso is left to be dragged", at: { x: 0, y: 1.65, z: 0.1 }, direction: FROM_FRONT, expectedPart: HEAD, expectedTorsoPush: "left alone", expectedTurn: { y: 0, x: -1 } },
  { it: "when the left thigh is pushed from the front, then the leg is swept back and the torso pitches over it", at: { x: 0.09, y: 0.55, z: 0.08 }, direction: FROM_FRONT, expectedPart: LEFT_THIGH, expectedTorsoPush: "left alone", expectedTurn: { y: 0, x: 1 } },
  { it: "when the left thigh is pushed from behind, then the leg is swept forward and the torso pitches the other way", at: { x: 0.09, y: 0.55, z: -0.08 }, direction: FROM_BEHIND, expectedPart: LEFT_THIGH, expectedTorsoPush: "left alone", expectedTurn: { y: 0, x: -1 } },
];

/** A spin under 1 rad/s is no turn at all. */
const sign = (n: number): number => (Math.abs(n) < 1 ? 0 : Math.sign(n));

let system: RagdollSystem;

beforeEach(async () => {
  system = await flatSystem();
  assert.equal(system.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), WALKER, "the walker is placed in his slot");
});

afterEach(() => {
  system.dispose();
});

describe("given a figure standing facing +z that is pushed at a point", () => {
  for (const testCase of cases) {
    it(testCase.it, () => {
      const bodies = system["dolls"][WALKER]!.bodies;
      const point = new THREE.Vector3(testCase.at.x, testCase.at.y, testCase.at.z);
      const direction = new THREE.Vector3(testCase.direction.x, testCase.direction.y, testCase.direction.z);
      system.strikeWalker(WALKER, point, direction, SPEED);
      assert.equal(system.walker.state, "down", "limp at once");
      const along = (k: number): number => {
        const v = bodies[k]!.linvel();
        return v.x * direction.x + v.y * direction.y + v.z * direction.z;
      };
      assert.ok(along(testCase.expectedPart === TORSO ? TORSO : testCase.expectedPart) > SPEED * 0.9, `part ${testCase.expectedPart} sent at ${along(testCase.expectedPart).toFixed(1)} m/s`);
      assert.equal(along(TORSO) > SPEED * 0.9, testCase.expectedTorsoPush === "pushed", `the torso moves ${along(TORSO).toFixed(1)} m/s`);
      const spin = bodies[TORSO]!.angvel();
      assert.equal(sign(spin.y), testCase.expectedTurn.y, `turn about the vertical ${spin.y.toFixed(1)} rad/s`);
      assert.equal(sign(spin.x), testCase.expectedTurn.x, `pitch ${spin.x.toFixed(1)} rad/s`);
    });
  }
});
