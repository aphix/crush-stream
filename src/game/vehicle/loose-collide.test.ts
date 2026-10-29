import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { QUIET_HZ } from "../kernel/constants.ts";
import { newWorld, stepWorld, type World } from "../engine/world-step.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { DeformableCar } from "./car.ts";
import type { LooseBody } from "./car-core.ts";
import { HULL_TOL, insideHull } from "./loose-hull.test-util.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { PUSH_SPEED } from "../deform/push-budget.ts";
import { paint } from "./test-support.ts";

const H = 1 / QUIET_HZ;
const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
const half = carFrame(CAR_STYLES.sedan).half;
/** Car B's plan x: parked beside car A (at the origin), a body width and a metre between their flanks. */
const B_X = 2 * half.x + 1;
/** A wheel thrown at a flank at this speed (m/s) comes off it moving away at least this fast. */
const THROWN_MPS = 10;
const REBOUND_MPS = 0.3;
/** The most (m) one step may carry a torn part at its own car's seat: nothing of the hull puts it out whole (0.27-0.8 m deep in a door). */
const SEAT_STEP_M = 0.1;
const SEAT_S = 0.4;
/** The seat is given this long (s) to run out: `SEAT_S` of `loose-step.ts` is 1 s. */
const SEAT_RUN_S = 1.2;

type Lot = { w: World; a: DeformableCar; b: DeformableCar };

/** Two sedans parked side by side, facing +z, settled a second. */
function lot(): Lot {
  const scene = new THREE.Scene();
  const a = new DeformableCar(paint(), scene);
  a.spawnFacing(0, 0, 0, 0);
  const b = new DeformableCar(paint(), scene);
  b.spawnFacing(B_X, 0, 0, 0);
  const w = newWorld([a, b]);
  for (let s = 0; s < QUIET_HZ; s++) stepWorld(w, H);
  return { w, a, b };
}

/** A wheel popped from car A's front left hub, put at `at` with `vel`, off its seat. */
function thrownWheel(l: Lot, at: THREE.Vector3, vel: THREE.Vector3): LooseBody {
  l.a["dropWheel"](0, HUBS[0]);
  const wheel = l.a["looseWheels"][0]!;
  wheel.object.position.copy(at);
  wheel.velocity.copy(vel);
  wheel.angular.set(0, 0, 0);
  wheel.shape.seatFor = 0;
  return wheel;
}

/** Both cars' whole sim state: pose, velocities, each mass, the drivetrain. */
function simState(cars: readonly DeformableCar[]): number[] {
  return cars.flatMap((c) => [...c.group.position.toArray(), ...c.group.quaternion.toArray(), ...c.velocity.toArray(), ...c.angular.toArray(), ...c.deform.masses.flatMap((m) => [...m.world.toArray(), ...m.vel.toArray()]), c.deform.engineTravel, c.crashed ? 1 : 0]);
}

/** The wheel thrown from `at` along `vel` for 2 s: its deepest point in B's side, and its fastest velocity away from it (+x); and both cars' state after. */
function throwAtB(at: THREE.Vector3, vel: THREE.Vector3): { deepest: number; away: number; state: number[] } {
  const l = lot();
  const wheel = thrownWheel(l, at, vel);
  let deepest = 0;
  let away = -Infinity;
  for (let s = 0; s < 2 * QUIET_HZ; s++) {
    stepWorld(l.w, H);
    deepest = Math.max(deepest, insideHull(l.b, wheel));
    away = Math.max(away, wheel.velocity.x);
  }
  return { deepest, away, state: simState([l.a, l.b]) };
}

const AT_B_DOOR = new THREE.Vector3(B_X + half.x + 3, 0.4, 0);
const ON_OPEN_ROAD = new THREE.Vector3(B_X + half.x + 30, 0.4, 0);

describe("given a wheel popped from a parked car and thrown at the door of a second car parked beside it at 10 m/s", () => {
  it(`when it meets the door, then no point of it ends more than ${HULL_TOL} m inside the car's side and it comes off it moving away at ${REBOUND_MPS} m/s or more`, () => {
    const hit = throwAtB(AT_B_DOOR, new THREE.Vector3(-THROWN_MPS, 0, 0));
    expect(hit.deepest, `its deepest point was ${hit.deepest.toFixed(3)} m inside B's side`).toBeLessThanOrEqual(HULL_TOL);
    expect(hit.away, `it came off the door at ${hit.away.toFixed(2)} m/s`).toBeGreaterThanOrEqual(REBOUND_MPS);
  });

  it("when it is thrown the same way with no car in its path, then both cars' sim state is bit for bit what it was in the hit (loose parts are cosmetic)", () => {
    const hit = throwAtB(AT_B_DOOR, new THREE.Vector3(-THROWN_MPS, 0, 0));
    const miss = throwAtB(ON_OPEN_ROAD, new THREE.Vector3(THROWN_MPS, 0, 0));
    const bad = firstMismatch(hit.state, miss.state);
    expect(bad, `the first differing number of the cars' state is #${bad?.index}`).toBeUndefined();
  });
});

describe("given a car whose door has just been torn off at its seat", () => {
  it(`when ${SEAT_S} s have passed, then no step carried the door more than ${SEAT_STEP_M} m: its own hull did not put it out of its seat`, () => {
    const l = lot();
    const door = l.a["parts"].find((p) => p.name === "doorR")!;
    l.a["detachPart"](door, 12, new THREE.Vector3());
    let most = 0;
    for (let s = 0; s < SEAT_S * QUIET_HZ; s++) {
      const was = door.object.position.clone();
      stepWorld(l.w, H);
      most = Math.max(most, door.object.position.distanceTo(was));
    }
    expect(most, `one step carried it ${most.toFixed(3)} m`).toBeLessThanOrEqual(SEAT_STEP_M);
  });
});

/** A door torn at rest on car A's left side is still this deep (m) or more in its hull at the last step its seat holds (measured 0.14). */
const DEEP_AT_SEAT_END_M = 0.1;
/** Once its seat has run out, no step carries the door more than this (m) out of its side (x): the solver's push-out speed over a step and the door's own outward speed (0.6 m/s) each take up to half of it; put out whole, the step is 0.14. */
const EASED_STEP_M = 2 * PUSH_SPEED * H;
/** Seconds run after the seat ends for the door to come out of the hull. */
const OUT_S = 1.5;

describe("given a car whose left door was torn off at rest and still sits deep in its hull when its seat runs out", () => {
  it(`when the seat has run out, then no step carries the door more than ${EASED_STEP_M.toFixed(3)} m out of its side for ${OUT_S} s, and it is out of the hull by the end: eased out at the solver's push-out speed, not snapped`, () => {
    const l = lot();
    const door = l.a["parts"].find((p) => p.name === "doorL")!;
    l.a["detachPart"](door, 12, new THREE.Vector3());
    let deepSeated = 0;
    let most = 0;
    for (let s = 0; s < (SEAT_RUN_S + OUT_S) * QUIET_HZ; s++) {
      const was = door.object.position.x;
      stepWorld(l.w, H);
      // A step that ends with the seat held was seated throughout; the step that ends it is counted with the unseated.
      if (door.shape.seatFor > 0) deepSeated = Math.max(deepSeated, insideHull(l.a, door));
      else most = Math.max(most, Math.abs(door.object.position.x - was));
    }
    expect(deepSeated, `the control: it was ${deepSeated.toFixed(3)} m inside the hull while its seat held`).toBeGreaterThanOrEqual(DEEP_AT_SEAT_END_M);
    expect(most, `one step carried it ${most.toFixed(3)} m out of its side`).toBeLessThanOrEqual(EASED_STEP_M);
    const left = insideHull(l.a, door);
    expect(left, `it was still ${left.toFixed(3)} m inside the hull ${OUT_S} s later`).toBeLessThanOrEqual(HULL_TOL);
  });
});

describe("given a wheel popped from a parked car and rolled back at its flank at 6 m/s", () => {
  it(`when it meets the flank, then no point of it ends more than ${HULL_TOL} m inside and it comes off moving away at ${REBOUND_MPS} m/s or more`, () => {
    const l = lot();
    const wheel = thrownWheel(l, new THREE.Vector3(-half.x - 3, 0.4, 0), new THREE.Vector3(6, 0, 0));
    let deepest = 0;
    let away = Infinity;
    for (let s = 0; s < 2 * QUIET_HZ; s++) {
      stepWorld(l.w, H);
      deepest = Math.max(deepest, insideHull(l.a, wheel));
      away = Math.min(away, wheel.velocity.x);
    }
    expect(deepest, `its deepest point was ${deepest.toFixed(3)} m inside its own car's side`).toBeLessThanOrEqual(HULL_TOL);
    expect(away, `its fastest velocity into the flank was ${away.toFixed(2)} m/s: it must have come back out at ${(-REBOUND_MPS).toFixed(1)} m/s or less`).toBeLessThanOrEqual(-REBOUND_MPS);
  });
});
