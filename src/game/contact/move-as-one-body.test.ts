import { describe, expect, it } from "vitest";
import { launch, makeCar } from "./crash-scenarios.test-util.ts";
import { makeBox, solidFace, strikeCar } from "./external-contact.ts";
import { resolveCarPair } from "./pair-contact.ts";
import { outlineOf, OUTLINE_REACH } from "./cage-outline.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "../vehicle/car.ts";

// A rigid exchange (a graze, a spent or stiff pair, a rig's rigid strike) reads a wreck as its whole body and leaves every mass at that body's motion.

/** The truck-wreck capture's slosh: a wreck's nose masses still running on into what it touches (m/s along its length) while its tail ones spring back, its body at a graze's closing. */
const NOSE_MPS = 2;
const TAIL_MPS = -2;
/** How far (m) the wreck's nose stands in what it touches. */
const NOSE_IN = 0.05;
/** How far off line (m) the other wreck of the pair stands: an off-centre touch, so the exchange turns both. */
const OFF_LINE = 0.5;
/** How far a kept momentum (N·s) or angular momentum (N·m·s) may move: the float noise of the sums. */
const KEPT = 1e-6;

const H = 1 / FINE_HZ;

/** The dynamic masses' momentum (N·s) along z. */
function momentumZ(car: DeformableCar): number {
  return car.deform.masses.filter((m) => m.dynamic).reduce((s, m) => s + m.mass * m.vel.z, 0);
}

/** The dynamic masses' angular momentum (N·m·s) about the world's vertical axis. */
function spinMomentum(car: DeformableCar): number {
  return car.deform.masses.filter((m) => m.dynamic).reduce((s, m) => s + m.mass * (m.world.z * m.vel.x - m.world.x * m.vel.z), 0);
}

/** A sedan wreck at (x, z) facing `yaw`, its masses armed at rest. */
function wreckAt(x: number, z: number, yaw: number): DeformableCar {
  const car = makeCar();
  launch(car, x, z, yaw, 0, 0);
  car.group.updateMatrixWorld(true);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.crashed = true;
  return car;
}

/** `car`'s nose masses (ahead of its centre, facing +z) at `NOSE_MPS`, the rest at `TAIL_MPS`, and its body at their mean. */
function slosh(car: DeformableCar): void {
  const masses = car.deform.masses.filter((m) => m.dynamic);
  for (const m of masses) m.vel.set(0, 0, m.world.z > car.group.position.z ? NOSE_MPS : TAIL_MPS);
  car.velocity.set(0, 0, momentumZ(car) / masses.reduce((s, m) => s + m.mass, 0));
  car.deform.beginSlice(H);
}

describe("given a sedan wreck at a graze, its nose masses still running on into what they touch while its tail springs back", () => {
  it("when a fixed face's rigid strike leaves it one body, then its masses change their momentum by the impulse the face gave, no more", () => {
    const car = wreckAt(0, 0, 0);
    slosh(car);
    const nose = Math.max(...car.deform.masses.map((m) => m.world.z));
    const wall = solidFace(makeBox(), 0, -1, 0, nose - NOSE_IN, 0, 0, 2, 0.5);
    const before = momentumZ(car);
    const taken = strikeCar(car, wall, H, true, false, true);
    const gained = momentumZ(car) - before;
    expect(Math.abs(gained + taken), `the masses' momentum changed ${gained.toFixed(2)} N·s, the face gave ${(-taken).toFixed(2)} N·s`).toBeLessThanOrEqual(KEPT);
  });

  it("when a rigid pair contact with another wreck, off line, leaves both one body, then the pair keeps its angular momentum", () => {
    const a = wreckAt(0, 0, 0);
    const b = wreckAt(OFF_LINE, 2 * outlineOf(a).zHi + OUTLINE_REACH - NOSE_IN, Math.PI);
    slosh(a);
    b.deform.beginSlice(H);
    const before = spinMomentum(a) + spinMomentum(b);
    expect(resolveCarPair(a, b, H), "no pair contact").not.toBe(null);
    const change = spinMomentum(a) + spinMomentum(b) - before;
    expect(Math.abs(change), `the pair's angular momentum changed by ${change.toFixed(2)} N·m·s`).toBeLessThanOrEqual(KEPT);
  });
});
