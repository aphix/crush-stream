import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** A press picks a dummy where he is drawn: the triangles his slot draws, skinned from his part poses, not his rest shape carried by his torso. */

const FOREARM = 5;
/** The right forearm's elbow (the joint the raised arm turns about) and the end of the forearm where the hand hangs, standing. */
const ELBOW = new THREE.Vector3(0.24, 1.07, 0);
const HAND_STANDING = new THREE.Vector3(0.24, 0.8, 0.03);
const QUARTER = Math.PI / 2;

/** Slot 0 standing at rest, the forearm `raise` rad forward about the elbow. */
function dummy(raise: number): DummyMesh {
  const mesh = new DummyMesh(1);
  const none = new THREE.Quaternion();
  for (const [k, part] of PARTS.entries()) mesh.pose(0, k, new THREE.Vector3(part.c[0], part.c[1], part.c[2]), none);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -raise);
  const centre = new THREE.Vector3(PARTS[FOREARM]!.c[0], PARTS[FOREARM]!.c[1], PARTS[FOREARM]!.c[2]).sub(ELBOW).applyQuaternion(turn).add(ELBOW);
  mesh.pose(0, FOREARM, centre, turn);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Where a point of the standing body, carried by the forearm as posed, is now. */
function carried(mesh: DummyMesh, rest: THREE.Vector3): THREE.Vector3 {
  return mesh.partPoint(0, FOREARM, rest, new THREE.Vector3());
}

/** The first hit of a ray along -z from 3 m in front of (x, y), the slot it hit and how far it is from `at`. */
function shoot(mesh: DummyMesh, at: THREE.Vector3): { slot: number | undefined; off: number } {
  const ray = new THREE.Raycaster(new THREE.Vector3(at.x, at.y, at.z + 3), new THREE.Vector3(0, 0, -1));
  const hit = ray.intersectObject(mesh)[0];
  return { slot: hit?.instanceId, off: hit ? hit.point.distanceTo(at) : Infinity };
}

const hitCases = [
  { it: "when the forearm hangs and a press is aimed at the hand, then it lands on him", raise: 0 },
  { it: "when the forearm is raised and a press is aimed at the hand where it is now, then it lands on him", raise: QUARTER },
] as const;

describe("given a dummy with one forearm raised or hanging", () => {
  for (const testCase of hitCases) {
    it(testCase.it, () => {
      const mesh = dummy(testCase.raise);
      const { slot, off } = shoot(mesh, carried(mesh, HAND_STANDING));
      expect(slot, "slot hit").toBe(0);
      expect(off, `the first hit is ${off.toFixed(3)} m from the hand`).toBeLessThan(0.1);
    });
  }

  it("when the forearm is raised and a press is aimed where the hand hung before, then it misses: the arm is not there", () => {
    const { slot } = shoot(dummy(QUARTER), HAND_STANDING.clone());
    expect(slot, "slot hit").toBe(undefined);
  });
});
