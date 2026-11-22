import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BODY_REACH_M } from "./dummy-rig.ts";
import { posture } from "./dummy-pose.test-util.ts";
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

/** Rays a flung dummy is shot with, aimed up to this far (m) round his middle on each axis. */
const FLUNG_RAYS = 300;
const FLUNG_SCATTER_M = 0.9;

/** A seeded linear congruential stream in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** Slot 0 dressed as `woman` or a man, each part turned at random and pulled up to 0.15 m off its place: blended vertices stretch between bones. */
function flung(woman: boolean, next: () => number): DummyMesh {
  const mesh = new DummyMesh(1);
  mesh.dress(0, false, { woman, shirt: 0x2b2d32, pants: 0x223355, hair: 0x2a1d15, hat: null, mustache: false });
  const pull = () => (next() * 2 - 1) * 0.15;
  for (const [k, part] of PARTS.entries()) {
    const turn = new THREE.Quaternion(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize();
    mesh.pose(0, k, new THREE.Vector3(part.c[0] + pull(), part.c[1] + pull(), part.c[2] + pull()), turn);
  }
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** The pick with every triangle the slot draws skinned whole, the ray carried into the mesh's frame and back as the pick does: the nearest hit's distance, Infinity for none. */
function wholePick(mesh: DummyMesh, ray: THREE.Ray): number {
  const local = ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  const index = mesh.geometry.index!;
  const count = mesh.geometry.getAttribute("position").count;
  const points = new Float32Array(count * 3);
  const drawn = new Uint8Array(count);
  const at = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    drawn[i] = mesh.posed(0, i, at) ? 1 : 0;
    at.toArray(points, 3 * i);
  }
  const corner = (i: number) => new THREE.Vector3().fromArray(points, 3 * i);
  let nearest = Infinity;
  for (let t = 0; t < index.count; t += 3) {
    if (drawn[index.getX(t)] === 0) continue;
    const hit = local.intersectTriangle(corner(index.getX(t)), corner(index.getX(t + 1)), corner(index.getX(t + 2)), mesh.material.side !== THREE.DoubleSide, at);
    if (hit !== null) nearest = Math.min(nearest, ray.origin.distanceTo(hit.applyMatrix4(mesh.matrixWorld)));
  }
  return nearest;
}

describe("given dummies flung into poses no joint holds, a man and a woman", () => {
  // mutation: sed -i 's/hit\[g\] = ray.distanceSqToSegment(_va, _vb) <= reach \* reach/hit[g] = ray.distanceSqToPoint(_va) <= reach * reach/' /home/aphix/worktrees/Perf/src/game/present/ragdoll-mesh.ts
  it("when 300 seeded rays are picked at each, then every pick's distance is the one his triangles skinned whole give, and some hit and some miss", () => {
    const next = seeded(7);
    let hits = 0;
    let misses = 0;
    for (const woman of [false, true]) {
      const mesh = flung(woman, next);
      const middle = new THREE.Vector3(PARTS[0].c[0], PARTS[0].c[1], PARTS[0].c[2]);
      const out = { slot: -1, x: 0, y: 0, z: 0, along: Infinity };
      for (let shot = 0; shot < FLUNG_RAYS; shot++) {
        const from = new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).setLength(4).add(middle);
        const to = new THREE.Vector3((next() * 2 - 1) * FLUNG_SCATTER_M, (next() * 2 - 1) * FLUNG_SCATTER_M, (next() * 2 - 1) * FLUNG_SCATTER_M).add(middle);
        const ray = new THREE.Ray(from, to.sub(from).normalize());
        mesh.nearestHit(ray, 0, Infinity, -1, out);
        const whole = wholePick(mesh, ray);
        expect(out.along, `${woman ? "woman" : "man"}, shot ${shot}`).toBe(whole);
        if (whole === Infinity) misses++;
        else hits++;
      }
    }
    expect(hits, "shots that hit (93 of the 600)").toBeGreaterThan(50);
    expect(misses, "shots that missed").toBeGreaterThan(20);
  });
});

describe("given a man, a woman and a portly man posed with every joint swung a quarter turn, joints closed", () => {
  // mutation: sed -i 's/^export const BODY_REACH_M = 1.3;/export const BODY_REACH_M = 1.1;/' /home/aphix/worktrees/Perf/src/game/present/dummy-rig.ts
  it("when every vertex he draws is read, then it lies within the body's reach of his torso's middle: what the shadow pass's cut and the pick's sphere both rely on", () => {
    const swings = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)].map((axis) => Object.fromEntries(PARTS.map((_, k) => [k, new THREE.Quaternion().setFromAxisAngle(axis, QUARTER)])));
    const at = new THREE.Vector3();
    let read = 0;
    for (const build of [{ woman: false }, { woman: true }, { woman: false, portly: true }]) {
      for (const swing of [{}, ...swings]) {
        const mesh = new DummyMesh(1);
        mesh.dress(0, false, { ...build, shirt: 0x2b2d32, pants: 0x223355, hair: 0x2a1d15, hat: null, mustache: false });
        const poses = posture(swing);
        for (const [k, pose] of poses.entries()) mesh.pose(0, k, pose.p, pose.q);
        const middle = poses[0]!.p;
        let farthest = 0;
        for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
          if (!mesh.posed(0, i, at)) continue;
          farthest = Math.max(farthest, at.distanceTo(middle));
          read++;
        }
        expect(farthest, `${JSON.stringify(build)}, ${Object.keys(swing).length === 0 ? "standing" : "swung"}: farthest vertex (m)`).toBeLessThanOrEqual(BODY_REACH_M);
      }
    }
    expect(read, "vertices read").toBeGreaterThan(0);
  });
});
