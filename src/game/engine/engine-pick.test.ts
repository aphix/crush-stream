import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { driverLook } from "../present/driver-look.ts";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import { activeGround } from "../world/ground.ts";
import { WEAPONS } from "./engine-onfoot-arms.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";
import type { CarPick, DollPick } from "./engine-openworld.ts";

/** Seeded rays aimed at points scattered round the target: through its middle, its edges and the air beside it. */
const RAYS = 300;
const SCATTER_M = { car: 2.6, doll: 0.9 };
/** Car shots a read makes, and the read's bound: three's own raycast made about 270 KB a shot, a shot read raw about 10 KB (its wheels and lamps stay three's). */
const SHOTS = 20;
const SHOT_BOUND_BYTES = 32 * 1024;

let rig: OnFootRig;
let eye: THREE.Vector3;
let carMiddle: THREE.Vector3;
let dollMiddle: THREE.Vector3;

/** A seeded linear congruential stream in [0, 1). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** A ray from `from` toward `to` jittered up to `scatter` m on each axis. */
function rayToward(from: THREE.Vector3, to: THREE.Vector3, scatter: number, next: () => number): LookRay {
  const ray = new LookRay();
  const d = new THREE.Vector3(to.x + (next() * 2 - 1) * scatter, to.y + (next() * 2 - 1) * scatter, to.z + (next() * 2 - 1) * scatter).sub(from).normalize();
  ray.eyeX = from.x;
  ray.eyeY = from.y;
  ray.eyeZ = from.z;
  ray.dirX = d.x;
  ray.dirY = d.y;
  ray.dirZ = d.z;
  return ray;
}

/** The car pick as three's raycaster answers it: every hit sorted, the first under a live car's group. */
function carByThree(ray: LookRay, range: number): CarPick {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(ray.eyeX, ray.eyeY, ray.eyeZ), new THREE.Vector3(ray.dirX, ray.dirY, ray.dirZ), 0, range);
  const cars = rig.engine["live"]();
  for (const hit of raycaster.intersectObjects(cars.map((car) => car.group), true)) {
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      const index: unknown = o.userData.carIndex;
      if (typeof index !== "number" || index < 0 || index >= rig.engine["carCount"]) continue;
      const pane = cars[index]!.glassPanes.find((glass) => glass.mesh === hit.object)?.name ?? null;
      return { car: index, x: hit.point.x, y: hit.point.y, z: hit.point.z, along: hit.distance, pane };
    }
  }
  return { car: -1, x: 0, y: 0, z: 0, along: Infinity, pane: null };
}

/** The dummy pick as three's raycaster answers it: the first sorted hit not on the walker's slot. */
function dollByThree(ray: LookRay, range: number): DollPick {
  const raycaster = new THREE.Raycaster(new THREE.Vector3(ray.eyeX, ray.eyeY, ray.eyeZ), new THREE.Vector3(ray.dirX, ray.dirY, ray.dirZ), 0, range);
  const hit = raycaster.intersectObject(rig.engine["ragdolls"].pickMesh, false).find((each) => each.instanceId !== WALKER_SLOT);
  return hit === undefined ? { slot: -1, x: 0, y: 0, z: 0, along: Infinity } : { slot: hit.instanceId!, x: hit.point.x, y: hit.point.y, z: hit.point.z, along: hit.distance };
}

/** The two picks' points and distances are the same numbers. */
function expectSamePoint(ours: { x: number; y: number; z: number; along: number }, three: { x: number; y: number; z: number; along: number }, shot: number): void {
  expect(ours.x, `shot ${shot}: x`).toBe(three.x);
  expect(ours.y, `shot ${shot}: y`).toBe(three.y);
  expect(ours.z, `shot ${shot}: z`).toBe(three.z);
  expect(ours.along, `shot ${shot}: distance`).toBe(three.along);
}

/** The player out of his car, a kerb car 6 m east of him and a dummy standing 8 m north. */
async function stage(): Promise<void> {
  rig = await OnFootRig.boot("#scene=openworld&seed=beef");
  rig.run(3);
  rig.getOut();
  const torso = rig.torso();
  rig.place(1, torso.x + 6, torso.z);
  const spot = new THREE.Vector3(torso.x, 0, torso.z + 8);
  spot.y = activeGround().heightAt(spot.x, spot.z);
  rig.engine["ragdolls"].startWalker(spot, 0, { cop: false, look: driverLook(1, 0) }, 0);
  rig.run(1);
  eye = new THREE.Vector3(torso.x, activeGround().heightAt(torso.x, torso.z) + 1.3, torso.z);
  // The rig draws no frame, so the world matrices a pick reads are brought up to date here, as a frame's render does.
  for (const car of rig.engine["live"]()) car.group.updateMatrixWorld(true);
  carMiddle = rig.cars()[1]!.group.position.clone().setY(eye.y - 0.4);
  dollMiddle = spot.clone().setY(spot.y + 1);
}

beforeAll(stage);
afterAll(() => rig.dispose());

describe("given the open world, the player on foot with a kerb car 6 m off and a dummy standing 8 m off", () => {
  it("when 300 seeded shots are picked against the cars, then each pick (car, pane, point, distance) is the one three's raycaster sorts first, and some hit the car, its glass and nothing", () => {
    const next = seeded(7);
    const seen = { car: 0, glass: 0, none: 0 };
    const out: CarPick = { car: -1, x: 0, y: 0, z: 0, along: Infinity, pane: null };
    for (let shot = 0; shot < RAYS; shot++) {
      const ray = rayToward(eye, carMiddle, SCATTER_M.car, next);
      rig.engine["pickCar"](ray, WEAPONS.shotgun.range, out);
      const three = carByThree(ray, WEAPONS.shotgun.range);
      expect(out.car, `shot ${shot}: car`).toBe(three.car);
      expect(out.pane, `shot ${shot}: pane`).toBe(three.pane);
      if (three.car >= 0) expectSamePoint(out, three, shot);
      if (out.car < 0) seen.none++;
      else if (out.pane !== null) seen.glass++;
      else seen.car++;
    }
    expect(seen.car && seen.glass && seen.none, `control: body, glass and miss shots ${JSON.stringify(seen)}`).toBeGreaterThan(0);
  });

  it("when 300 seeded shots are picked against the dummies, then each pick (slot, point, distance) is the one three's raycaster sorts first, and some hit him and some miss", () => {
    const next = seeded(11);
    const seen = { hit: 0, none: 0 };
    const out: DollPick = { slot: -1, x: 0, y: 0, z: 0, along: Infinity };
    for (let shot = 0; shot < RAYS; shot++) {
      const ray = rayToward(eye, dollMiddle, SCATTER_M.doll, next);
      rig.engine["pickDoll"](rig.engine["drivenCar"](), ray, WEAPONS.pistol.range, out);
      const three = dollByThree(ray, WEAPONS.pistol.range);
      expect(out.slot, `shot ${shot}: slot`).toBe(three.slot);
      if (three.slot < 0) seen.none++;
      else {
        seen.hit++;
        expectSamePoint(out, three, shot);
      }
    }
    expect(seen.hit && seen.none, `control: hits and misses ${JSON.stringify(seen)}`).toBeGreaterThan(0);
  });

  it("when 20 shots are picked at the car's middle, then all of them together allocate under 32 KB a shot", () => {
    const ray = rayToward(eye, carMiddle, 0, seeded(1));
    const out: CarPick = { car: -1, x: 0, y: 0, z: 0, along: Infinity, pane: null };
    const shoot = (): void => {
      for (let shot = 0; shot < SHOTS; shot++) rig.engine["pickCar"](ray, WEAPONS.shotgun.range, out);
    };
    const bytes = untilQuiet(() => allocatedBytes(shoot), SHOT_BOUND_BYTES * SHOTS);
    expect(out.car, "control: the car is hit").toBe(1);
    expect(bytes / SHOTS, "bytes a shot").toBeLessThanOrEqual(SHOT_BOUND_BYTES);
  });
});
