import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { launch, makeCar } from "./crash-scenarios.test-util.ts";
import { carRow, makeBox, moveAsOneBody, solidFace, strikeCar } from "./external-contact.ts";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import { resolveCarPair } from "./pair-contact.ts";
import { outlineOf, OUTLINE_REACH } from "./cage-outline.ts";
import { BODY_SIZE, BODY_VX, BODY_W } from "./body-contact.ts";
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

/** The tumble (rad/s) of the truck-wreck capture's pickup as Titanium, Petrol and Ink met it in the air: roll and pitch, no yaw. */
const TUMBLE = new THREE.Vector3(4, 0, -5);
/** The pickup's lean (rad) at the time: on its side, 43° over. */
const LEAN = 0.75;
/** How far (rad/s) a rigid wreck's yaw reading may be from its rigid motion's: the float noise of the sums. */
const RIGID = 1e-6;

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

/** A sedan wreck leaning `lean` rad about its length (`axis` z) or nose up (`axis` x) and moving at `speed` m/s along +z, every mass at the rigid motion of `spin` about the masses' centroid; the row `carRow` reads off it at a face along +x. */
function tumblingWreck(lean: number, spin: THREE.Vector3, speed = 0, axis: "x" | "z" = "z"): { car: DeformableCar; centre: THREE.Vector3; rows: Float64Array } {
  const car = makeCar();
  launch(car, 0, 0, 0, 0, 0);
  car.group.rotation[axis] = lean;
  car.group.updateMatrixWorld(true);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.crashed = true;
  car.velocity.set(0, 0, speed);
  car.angular.copy(spin);
  const masses = car.deform.masses.filter((m) => m.dynamic);
  const centre = masses.reduce((s, m) => s.addScaledVector(m.world, m.mass), new THREE.Vector3()).divideScalar(masses.reduce((s, m) => s + m.mass, 0));
  for (const m of masses) m.vel.copy(car.velocity).add(new THREE.Vector3().crossVectors(car.angular, m.world.clone().sub(centre)));
  const rows = new Float64Array(2 * BODY_SIZE);
  carRow(rows, 0, car, 1, 0, Infinity);
  return { car, centre, rows };
}

describe("given a sedan wreck tumbling in roll and pitch as one rigid body", () => {
  it("when a rigid contact leaves it one body, then every mass moves with the body's whole spin, its roll and pitch too", () => {
    const { car, centre, rows } = tumblingWreck(0, TUMBLE);
    moveAsOneBody(car, rows, 0);
    let worst = 0;
    let at = "";
    for (const m of car.deform.masses.filter((q) => q.dynamic)) {
      const rigid = new THREE.Vector3().crossVectors(car.angular, m.world.clone().sub(centre)).add(car.velocity);
      const off = Math.hypot(m.vel.x - rigid.x, m.vel.z - rigid.z);
      if (off > worst) [worst, at] = [off, m.name];
    }
    expect(worst, `${at} moves ${worst.toFixed(3)} m/s in plan against the body's rigid motion (spin ${car.angular.toArray().map((v) => v.toFixed(2)).join(", ")} rad/s)`).toBeLessThanOrEqual(RIGID);
  });

  it("when it leans on its side and a pair reads it as one body, then the row's yaw spin is the body's own, none of its roll and pitch", () => {
    const { rows } = tumblingWreck(LEAN, TUMBLE);
    expect(Math.abs(rows[BODY_W]! - TUMBLE.y), `the row spins at ${rows[BODY_W]!.toFixed(3)} rad/s about the vertical, the body at ${TUMBLE.y}`).toBeLessThanOrEqual(RIGID);
  });

  it("when only its masses moving one way across a face are driving, then the row closes on the face at their own mean plan speed, their roll and pitch speed kept", () => {
    const { car } = tumblingWreck(0, TUMBLE);
    const rows = new Float64Array(2 * BODY_SIZE);
    carRow(rows, 0, car, 1, 0, 0);
    const driving = car.deform.masses.filter((m) => m.dynamic && m.vel.x < 0);
    const closing = driving.reduce((s, m) => s + m.mass * m.vel.x, 0) / driving.reduce((s, m) => s + m.mass, 0);
    expect(Math.abs(rows[BODY_VX]! - closing), `the row closes at ${rows[BODY_VX]!.toFixed(3)} m/s, its ${driving.length} driving masses at ${closing.toFixed(3)}`).toBeLessThanOrEqual(RIGID);
  });

  it("when a leaning wreck pitched, yawing and rolling at 1 rad/s is read and written back as one body with no exchange between, then its linear and angular momentum on all three axes and its kinetic energy are kept", () => {
    const { car, centre, rows } = tumblingWreck(LEAN, new THREE.Vector3(1, 1, 1));
    const masses = car.deform.masses.filter((m) => m.dynamic);
    const read = (): { p: THREE.Vector3; l: THREE.Vector3; ke: number } => {
      const p = new THREE.Vector3();
      const l = new THREE.Vector3();
      let ke = 0;
      for (const m of masses) {
        p.addScaledVector(m.vel, m.mass);
        l.add(new THREE.Vector3().crossVectors(m.world.clone().sub(centre), m.vel).multiplyScalar(m.mass));
        ke += 0.5 * m.mass * m.vel.lengthSq();
      }
      return { p, l, ke };
    };
    const before = read();
    moveAsOneBody(car, rows, 0);
    const after = read();
    const moved = (a: THREE.Vector3, b: THREE.Vector3): string => `${a.toArray().map((v, k) => (v - b.getComponent(k)).toFixed(3)).join(", ")}`;
    expect(after.p.distanceTo(before.p), `linear momentum moved (${moved(after.p, before.p)}) N·s`).toBeLessThanOrEqual(KEPT);
    expect(after.l.distanceTo(before.l), `angular momentum about the centroid moved (${moved(after.l, before.l)}) N·m·s`).toBeLessThanOrEqual(KEPT);
    expect(after.ke - before.ke, `the masses' kinetic energy changed by ${(after.ke - before.ke).toFixed(3)} J`).toBeLessThanOrEqual(KEPT);
  });
});

describe("given a sedan wreck leaning and rolling as one body that meets a fixed face off centre", () => {
  /** The wreck's translational kinetic energy (J) over its dynamic masses. */
  const energy = (car: DeformableCar): number => car.deform.masses.filter((m) => m.dynamic).reduce((s, m) => s + 0.5 * m.mass * m.vel.lengthSq(), 0);

  todoRow(
    "when a rigid strike changes its yaw, then its kinetic energy is at most what it was: a fixed face adds none",
    "a law question for the owner: through strikeCar's rigid exchange a wreck pitched 45 or 75 degrees nose up and rolling at 3 rad/s against a fixed face at 0.3 or 0.5 m/s gains 1.7 to 36.3 J of kinetic energy in 6 of 192 cases probed (45 degrees: 2223 to 2247 J at 0.3 m/s, 2291 to 2296 J at 0.5 m/s; 75 degrees: 3562 to 3598 J at 0.3 m/s, 3631 to 3667 J at 0.5 m/s; its yaw changed 0.06 to 0.18 rad/s): the yaw spin changes while roll and pitch stay, and on a tilted body that adds energy on top of the kernel's own non-positive change (+/-585 J against the planar rows at 3 m/s)",
    () => {
      const rises: string[] = [];
      for (const axis of ["z", "x"] as const) {
        for (const lean of [15, 45, 75]) {
          for (const roll of [1, 3]) {
            for (const speed of [0.3, 0.5, 3]) {
              for (const side of [-0.8, 0.8]) {
                const { car } = tumblingWreck((lean * Math.PI) / 180, new THREE.Vector3(0, 0, roll), speed, axis);
                car.deform.beginSlice(H);
                const nose = Math.max(...car.deform.masses.map((m) => m.world.z));
                const face = solidFace(makeBox(), 0, -1, side, nose - NOSE_IN, side, 0, 0.5, 0.5);
                const before = energy(car);
                strikeCar(car, face, H, true, false, true);
                const gained = energy(car) - before;
                if (gained > KEPT) rises.push(`lean ${axis}${lean} roll ${roll} at ${speed} m/s, face at x ${side}: +${gained.toFixed(1)} J`);
              }
            }
          }
        }
      }
      expect(rises.length, `cases that gain kinetic energy against a fixed face: ${rises.join("; ")}`).toBe(0);
    },
  );
});
