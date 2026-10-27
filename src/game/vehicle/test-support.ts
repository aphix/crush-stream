import { describe } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { CarPaint } from "./car-core.ts";
import type { DriveInput } from "./car-drive.ts";
import { DeformableCar } from "./car.ts";
import type { CarStyleId } from "./car-variants.ts";
import { CarDetail } from "../present/car-detail.ts";
import { blankAiCar, type AiCar, type DerbyBrain } from "../ai/derby-ai.ts";
import type { DeformMode } from "../deform/deform-rig.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** Shared fixtures for the physics/deform suites; not a test file itself. */

export const DT = 1 / FRAME_HZ;
export const MODES: DeformMode[] = ["lattice", "shape"];

export function forModes(title: string, fn: (mode: DeformMode) => void): void {
  for (const mode of MODES) describe(`${title}, in ${mode} deform mode`, () => fn(mode));
}

/** Low-poly sedan-sized box standing in for the body mesh. */
export function dummyGeom(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1.7, 1.3, 4.3, 3, 2, 6);
}

export function paint(): CarPaint {
  return { name: "Test", body: 0xffffff, accent: 0x444444 };
}

/** Named control particle; fails the test when the rig lacks it. */
export function mass<M extends { name: string }>(d: { masses: readonly M[] }, name: string): M {
  const m = d.masses.find((n) => n.name === name);
  assert.ok(m, name);
  return m;
}

type Placed = { local: THREE.Vector3; rest: THREE.Vector3 };

/** How much nearer (m) mass `m` stands to `cell` along `axis` than at rest: the crush between them, read against the car's own rest gap. */
export function closedOn(m: Placed, cell: Placed, axis: "x" | "y" | "z"): number {
  const restGap = m.rest[axis] - cell.rest[axis];
  return Math.sign(restGap) * (restGap - (m.local[axis] - cell.local[axis]));
}

/** Mass-weighted centroid (x, z) of `masses`: with a car's masses live, where the car actually is. */
export function massCentroid(masses: readonly { world: THREE.Vector3; mass: number }[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let m = 0;
  for (const p of masses) {
    x += p.world.x * p.mass;
    z += p.world.z * p.mass;
    m += p.mass;
  }
  return { x: x / m, z: z / m };
}

// node:assert deep-diffs both sides on failure (Myers, O((N+M)·D)); two big float arrays once took 14.7 GB.
// These report one mismatch instead of a diff (ARCHITECTURE C9).

/** Element-wise equality within `tol`: length, then the first mismatching index and the max |diff| (NaN mismatches). */
export function assertSameNumbers(actual: ArrayLike<number>, expected: ArrayLike<number>, label: string, tol = 0): void {
  assert.equal(actual.length, expected.length, `${label}: length`);
  let first = -1;
  let max = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs(actual[i]! - expected[i]!);
    if (actual[i] === expected[i] || d <= tol) continue;
    if (first < 0) first = i;
    max = Number.isNaN(d) || d > max ? d : max;
  }
  if (first >= 0) assert.fail(`${label}: first mismatch at [${first}] ${actual[first]} vs ${expected[first]}, max |diff| ${max}`);
}

/** Same sha-256 of `JSON.stringify`; on mismatch names the first differing top-level index or key. */
export function assertSameDigest(a: unknown, b: unknown, label: string): void {
  const json = (v: unknown) => JSON.stringify(v) ?? "undefined";
  const [ha, hb] = [a, b].map((v) => createHash("sha256").update(json(v)).digest("hex"));
  if (ha === hb) return;
  const at = (o: unknown) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>) : {});
  const keys = [...new Set([...Object.keys(at(a)), ...Object.keys(at(b))])];
  const first = keys.find((k) => json(at(a)[k]) !== json(at(b)[k]));
  assert.fail(`${label}: sha-256 ${ha!.slice(0, 12)} vs ${hb!.slice(0, 12)}, first difference at [${first ?? "top level"}]`);
}

/** A derby AI snapshot for the brain suites: blank car `id` rolling at 8 m/s, then `extra`. */
export function aiCar(id: number, extra: Partial<AiCar> = {}): AiCar {
  return { ...blankAiCar(id), vz: 8, ...extra };
}

/** One derby decision with the opening hold already behind us (first call ages the car 2 s), copied out of the scratch. */
export function decide(brain: DerbyBrain, self: AiCar, others: AiCar[], dt = 2): DriveInput {
  return { ...brain.think(self, others, dt) };
}

/**
 * A 50 degree lens at the origin looking down +z, a `CarDetail` and the batch `makeBatch` builds; `car(at)` stands a car on the axis at
 * `at` m (turned to `yaw` when given), `draw` runs the detail pick and `sync` for those cars.
 */
export function stageBatch<B>(makeBatch: (detail: CarDetail) => B, sync: (batch: B, cars: DeformableCar[]) => void, yaw?: number) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  const detail = new CarDetail();
  const batch = makeBatch(detail);
  const car = (at: number, style: CarStyleId = "sedan") => {
    const made = new DeformableCar(paint(), scene, null, style);
    made.spawn(0, at, 0);
    if (yaw !== undefined) made.group.rotation.y = yaw;
    made.group.updateMatrixWorld(true);
    return made;
  };
  const draw = (cars: DeformableCar[]) => {
    detail.update(cars, camera, null, null);
    for (const c of cars) c.group.updateMatrixWorld(true);
    sync(batch, cars);
  };
  return { batch, car, draw };
}
