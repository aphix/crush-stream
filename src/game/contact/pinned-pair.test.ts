import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { launch, makeCar } from "./crash-scenarios.test-util.ts";
import { makeBox, solidFace } from "./external-contact.ts";
import { resolveCarPair, wallBounce } from "./pair-contact.ts";
import { outlineOf, OUTLINE_REACH } from "./cage-outline.ts";
import { satPushCap } from "../deform/physics-util.ts";
import { PUSH_SPEED } from "../deform/push-budget.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "../vehicle/car.ts";

// The owner's clip 5T3X-7JX2: a cop drove 0.8 m into the tail of a monster pinned nose-first on a monument. The stroke the monster's
// earlier nose hit had left held off the pair's push on its tail, and half of each push went to the monster, which the monument put back.

const H = 1 / FINE_HZ;
/** How far (m) the wreck's nose stands in the wall, and the car's nose in the wreck's tail. */
const NOSE_IN_WALL = 0.05;
const NOSE_IN_TAIL = 0.12;
/** The car's closing speed (m/s): under `ARM_CLOSING`, so the touch arms no stroke of its own. */
const CREEP = 0.15;
/** The wreck's nose hit, just armed: its closing and equivalent barrier speed (m/s). */
const NOSE_HIT_MPS = 15;
/** Two wrecks' noses (m) into each other at rest, and their closing (m/s): a creep no crush takes anything at. */
const RESTING_IN = 0.04;
const RESTING_CLOSING = 0.001;

/** The drawn body's reach (m) along its frame's z: the nose (`sign` 1) or the tail (-1). */
function reach(car: DeformableCar, sign: number): number {
  const { pos, panelOn } = car.cage.fields;
  const { vertexCount, vertexGroup } = car.cage.style;
  let most = -Infinity;
  for (let k = 0; k < vertexCount; k++) {
    const group = vertexGroup[k]!;
    if (group > 0 && panelOn[group - 1] === 0) continue;
    most = Math.max(most, sign * pos[k * 3 + 2]!);
  }
  return most;
}

/** A sedan whose nose a wall has just struck at `NOSE_HIT_MPS`, at rest facing +z with its nose `NOSE_IN_WALL` in the wall the slice before held it out of, and a car creeping into its tail. */
function pinnedWreckAndCar(): { wreck: DeformableCar; car: DeformableCar } {
  const wreck = makeCar();
  launch(wreck, 0, 0, 0, 0, 0);
  wreck.applyImpact(new THREE.Vector3(0, 0.5, reach(wreck, 1)), new THREE.Vector3(0, 0, -1), NOSE_HIT_MPS, NOSE_HIT_MPS);
  const wall = solidFace(makeBox(), 0, -1, 0, reach(wreck, 1) - NOSE_IN_WALL, 0, 0, 2, 0.5);
  wreck.deform.beginSlice(H);
  wallBounce(wreck, wall, 0, -1, NOSE_IN_WALL, H, false);
  wreck.deform.beginSlice(H);
  const car = makeCar();
  launch(car, 0, wreck.group.position.z - reach(wreck, -1) - reach(car, 1) + NOSE_IN_TAIL, 0, 0, CREEP);
  car.deform.beginSlice(H);
  return { wreck, car };
}

/** `car` at rest but for `vz` (m/s) along z, every mass with it: the hit's own impulse taken back. */
function creep(car: DeformableCar, vz: number): void {
  for (const m of car.deform.masses) m.vel.set(0, 0, vz);
  car.velocity.set(0, 0, vz);
  car.angular.set(0, 0, 0);
}

/** Two sedans nose to nose, each with a nose hit armed at `NOSE_HIT_MPS` and its stroke unused, their cage outlines `RESTING_IN` into each other and closing at `RESTING_CLOSING`. */
function restingArmedPair(): { a: DeformableCar; b: DeformableCar } {
  const a = makeCar();
  const b = makeCar();
  const apart = outlineOf(a).zHi + outlineOf(b).zHi + OUTLINE_REACH - RESTING_IN;
  launch(a, 0, 0, 0, 0, 0);
  launch(b, 0, apart, Math.PI, 0, 0);
  a.applyImpact(new THREE.Vector3(0, 0.5, reach(a, 1)), new THREE.Vector3(0, 0, -1), NOSE_HIT_MPS, NOSE_HIT_MPS);
  b.applyImpact(new THREE.Vector3(0, 0.5, apart - reach(b, 1)), new THREE.Vector3(0, 0, 1), NOSE_HIT_MPS, NOSE_HIT_MPS);
  creep(a, RESTING_CLOSING / 2);
  creep(b, -RESTING_CLOSING / 2);
  a.deform.beginSlice(H);
  b.deform.beginSlice(H);
  return { a, b };
}

describe("given a wreck pinned nose-first on a wall, its nose hit's stroke not yet used, and a car creeping 0.12 m into its tail", () => {
  it("when the pair is solved, then the car takes the whole push out of the tail and the wreck none", () => {
    const { wreck, car } = pinnedWreckAndCar();
    const stroke = wreck.deform.hitStroke() * (1 - wreck.deform.strokeUsed());
    assert.ok(stroke > NOSE_IN_TAIL, `the nose hit has ${stroke.toFixed(3)} m of stroke left`);
    const wreckZ = wreck.group.position.z;
    const carZ = car.group.position.z;
    assert.ok(resolveCarPair(car, wreck, H) !== null, "no pair contact");
    // The nose's stroke is no room for a push on the tail, and the wall would put back any push the wreck took.
    assert.ok(Math.abs(wreck.group.position.z - wreckZ) < 1e-9, `the wreck moved ${(wreck.group.position.z - wreckZ).toExponential(3)} m`);
    assert.ok(Math.abs(carZ - car.group.position.z - satPushCap(H)) < 1e-9, `the car moved back ${(carZ - car.group.position.z).toFixed(5)} m, the push is ${satPushCap(H).toFixed(5)} m`);
  });
});

describe("given two wrecks at rest nose to nose, 4 cm into each other, their nose hits' stroke unused, closing at 1 mm/s", () => {
  it("when the pair is solved, then the slice's push takes them apart: a crush takes nothing at a creep, so the stroke is no room", () => {
    const { a, b } = restingArmedPair();
    const stroke = Math.min(a.deform.hitStroke() * (1 - a.deform.strokeUsed()), b.deform.hitStroke() * (1 - b.deform.strokeUsed()));
    assert.ok(stroke > RESTING_IN, `the nose hits have ${stroke.toFixed(3)} m of stroke left`);
    const apart = b.group.position.z - a.group.position.z;
    assert.ok(resolveCarPair(a, b, H) !== null, "no pair contact");
    const pushed = b.group.position.z - a.group.position.z - apart;
    // Each wreck's share of the push is within its slice's push-out budget (`takePush`).
    assert.ok(pushed >= PUSH_SPEED * H, `the pair moved apart ${pushed.toFixed(5)} m, the push-out speed's slice is ${(PUSH_SPEED * H).toFixed(5)} m`);
  });
});
