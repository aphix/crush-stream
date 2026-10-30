import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { QUIET_HZ } from "../kernel/constants.ts";
import { newWorld, stepWorld, type World } from "../engine/world-step.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { DeformableCar } from "./car.ts";
import type { DetachPart, LooseBody } from "./car-core.ts";
import { HULL_TOL, insideCar, insideHull } from "./loose-hull.test-util.ts";
import { armTops, C_H, C_OWNER, HIT_SIZE, pointContact, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "../world/surfaces.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { DT, paint } from "./test-support.ts";
import { launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";

const H = 1 / QUIET_HZ;
const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
const half = carFrame(CAR_STYLES.sedan).half;
/** Car B's plan x: parked beside car A (at the origin), a body width and a metre between their flanks. */
const B_X = 2 * half.x + 1;
/** A wheel thrown at a flank at this speed (m/s) comes off it moving away at least this fast. */
const THROWN_MPS = 10;
const REBOUND_MPS = 0.3;
/** The most (m) one step may carry a door torn at rest off its car in its first `TORN_S` (s): nothing snaps it out of its hull. */
const TORN_STEP_M = 0.1;
const TORN_S = 0.4;

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

describe("given a car whose right door has just been torn off at rest", () => {
  it(`when ${TORN_S} s have passed, then no step carried the door more than ${TORN_STEP_M} m: nothing snapped it out of its hull`, () => {
    const l = lot();
    const door = l.a["parts"].find((p) => p.name === "doorR")!;
    l.a["detachPart"](door, 12, new THREE.Vector3());
    let most = 0;
    for (let s = 0; s < TORN_S * QUIET_HZ; s++) {
      const was = door.object.position.clone();
      stepWorld(l.w, H);
      most = Math.max(most, door.object.position.distanceTo(was));
    }
    expect(most, `one step carried it ${most.toFixed(3)} m`).toBeLessThanOrEqual(TORN_STEP_M);
  });
});

/** How far (m) the front bumper is put back into its own car's nose after it is torn off at rest. */
const INTO_NOSE_M = 0.4;
/** A part inside a car rises no more than a contact's slack (m) and gains no more upward speed (m/s); it rests within `LEAVE_S` (s). */
const RISE_TOL = 0.005;
const RISE_V = 0.05;
const LEAVE_S = 3;
/** A part lying on the road stands its lowest point no higher than this (m). */
const ON_ROAD_M = 0.01;

/** The lowest point (m) of `b`. */
function lowestY(b: LooseBody): number {
  const v = new THREE.Vector3();
  let lo = Infinity;
  for (let k = 0; k < b.shape.count; k++) lo = Math.min(lo, v.fromArray(b.shape.points, 3 * k).add(b.shape.centre).applyQuaternion(b.object.quaternion).add(b.object.position).y);
  return lo;
}

/** Seconds run from the tear for the door to fall out of its hull and lie on the road. */
const OUT_S = 2.7;

describe("given a car whose left door was torn off at rest, in its own hull", () => {
  it(`when it has been let go, then it falls out of the hull and within ${OUT_S} s lies on the road beside the car: its side puts nothing out, gravity does`, () => {
    const l = lot();
    const door = l.a["parts"].find((p) => p.name === "doorL")!;
    l.a["detachPart"](door, 12, new THREE.Vector3());
    let start = -1;
    for (let s = 0; s < OUT_S * QUIET_HZ; s++) {
      stepWorld(l.w, H);
      if (start < 0) start = insideHull(l.a, door);
    }
    expect(start, `the control: one step after the tear it is ${start.toFixed(3)} m inside the hull`).toBeGreaterThan(HULL_TOL);
    const left = insideHull(l.a, door);
    const low = lowestY(door);
    expect(left <= HULL_TOL && low <= ON_ROAD_M, `${OUT_S} s after the tear it is ${left.toFixed(3)} m inside the hull, its lowest point ${low.toFixed(3)} m up`).toBeTruthy();
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

describe("given a parked car with a part inside its body: its front wheel popped at its hub, or its front bumper torn off at rest and put back into its nose", () => {
  for (const which of ["wheel", "bumper"] as const) {
    it(`when the ${which} is let go, then it is never lifted (no upward speed, no rise above where it started: not put out up through the bonnet) and within ${LEAVE_S} s gravity has it resting on the road, held up by nothing of its car`, () => {
      const { w, a } = lot();
      let part: LooseBody;
      if (which === "wheel") {
        a["dropWheel"](0, HUBS[0]);
        part = a["looseWheels"][0]!;
      } else {
        const bumper = a["parts"].find((p) => p.name === "bumperF")!;
        a["detachPart"](bumper, 0, new THREE.Vector3());
        bumper.object.position.z -= INTO_NOSE_M;
        part = bumper;
      }
      part.velocity.set(0, 0, 0);
      part.angular.set(0, 0, 0);
      const y0 = part.object.position.y;
      let start = -1;
      let rise = 0;
      let up = 0;
      let landed = false;
      for (let s = 0; s < LEAVE_S * QUIET_HZ; s++) {
        stepWorld(w, H);
        if (start < 0) start = insideHull(a, part);
        rise = Math.max(rise, part.object.position.y - y0);
        // Its car gives it no upward speed; the road's bounce once it lands is the road's.
        landed ||= lowestY(part) <= ON_ROAD_M;
        if (!landed) up = Math.max(up, part.velocity.y);
      }
      expect(start, `the control: one step after the let-go it is ${start.toFixed(3)} m inside its car`).toBeGreaterThan(HULL_TOL);
      expect(rise <= RISE_TOL && up <= RISE_V, `it rose ${rise.toFixed(3)} m, at up to ${up.toFixed(3)} m/s`).toBeTruthy();
      const low = lowestY(part);
      expect(part.shape.asleep && low <= ON_ROAD_M, `after ${LEAVE_S} s it moves ${part.velocity.length().toFixed(3)} m/s with its lowest point ${low.toFixed(3)} m up`).toBeTruthy();
    });
  }
});

/** Each car's speed (m/s) into the head-on, and how long (s) it is run from the start. */
const HEAD_ON_MPS = 56 / 3.6;
const HEAD_ON_S = 3;
/** The two cars start this far apart (m) on one line, nose to nose. */
const HEAD_ON_GAP = 12;

describe("given two sedans meeting head-on at 56 km/h each, tearing parts off between them", () => {
  it("when every torn part is followed from its tear, then none rises above where it tore: nothing throws or puts it out upward", () => {
    const a = makeCar();
    const b = makeCar();
    launch(a, 0, -HEAD_ON_GAP / 2, 0, 0, HEAD_ON_MPS);
    launch(b, 0, HEAD_ON_GAP / 2, Math.PI, 0, -HEAD_ON_MPS);
    const w = makeWorld([a, b], false, false);
    const tornAt = new Map<DetachPart, number>();
    let rise = 0;
    let worst = "";
    for (let t = 0; t < HEAD_ON_S; t += DT) {
      tickWorld(w);
      for (const car of [a, b]) {
        for (const p of car["parts"]) {
          if (!p.detached) continue;
          const y0 = tornAt.get(p);
          if (y0 === undefined) {
            tornAt.set(p, p.object.position.y);
            continue;
          }
          if (p.object.position.y - y0 > rise) {
            rise = p.object.position.y - y0;
            worst = p.name;
          }
        }
      }
    }
    expect(tornAt.size, "the control: the head-on tore parts off").toBeGreaterThan(0);
    expect(rise, `${worst} rose ${rise.toFixed(3)} m above where it tore`).toBeLessThanOrEqual(RISE_TOL);
  });
});

/** Plan z (m, car frame) over the bonnet, and how far under its top a point is in the car (deeper than `SKIN`, the engine bay). */
const BONNET_Z = 1.2;
const UNDER_BONNET_M = 0.4;

describe("given a parked car, asked by insideHull's reading of its own surfaces", () => {
  it("when a point is in the cabin under every top, then it is inside; when it rests on the bonnet's top, then it is on it; and when it is well under the bonnet, then it is inside", () => {
    const { a } = lot();
    const cabin = insideCar(a, 0, 0.6, 0);
    expect(cabin, `a point in the cabin read ${cabin.toFixed(3)} m inside`).toBeGreaterThan(0.5);
    const q = new Float64Array(PQ_SIZE);
    const hit = new Float64Array(HIT_SIZE);
    q[PQ_X] = 0;
    q[PQ_Y] = 3;
    q[PQ_Z] = BONNET_Z;
    armTops(a["surfaces"]!);
    pointContact(q, -1, hit);
    armTops(null);
    expect(hit[C_OWNER], "the control: the car's top answers over the bonnet").toBe(a.slot);
    const onIt = insideCar(a, 0, hit[C_H]! - 0.01, BONNET_Z);
    expect(onIt, `a point 1 cm under the bonnet's top read ${onIt.toFixed(3)} m inside`).toBe(0);
    const under = insideCar(a, 0, hit[C_H]! - UNDER_BONNET_M, BONNET_Z);
    expect(under, `a point ${UNDER_BONNET_M} m under the bonnet's top read ${under.toFixed(3)} m inside`).toBeGreaterThan(0);
  });
});
