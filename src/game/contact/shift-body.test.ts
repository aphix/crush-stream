import { describe, expect, it } from "vitest";
import { launch, makeCar } from "./crash-scenarios.test-util.ts";
import { carRow, takeRow } from "./external-contact.ts";
import { BODY_HARD, BODY_I, BODY_M, BODY_SIZE, BODY_VX, BODY_VZ, BODY_W, BODY_X, BODY_Z, bodyContact, CT_DEPTH, CT_E, CT_JMAX, CT_MU, CT_NX, CT_NZ, CT_SIZE, CT_X, CT_Z, OUT_SIZE } from "./body-contact.ts";

// A face's exchange lands on a car's masses (`takeRow`, `shiftBody`): the car's momentum and spin change by the impulse the masses took, at the
// contact's lever arm, whatever share of the kernel's request the masses on the face could take.

/** The face's speed (m/s) along +x into the car's near flank. */
const FACE_MPS = 4;
/** The contact's lever arm (m): it stands this far ahead of the car's middle. */
const LEVER_M = 1;
/** Masses nearer the face than this (m, along x from the car's middle) already stand on it. */
const NEAR_FLANK_M = 0.3;
/** How far the car's spin may be from the textbook's, as a share of it. */
const TEXTBOOK_TOLERANCE = 0.05;

type Landed = { kernelJ: number; taken: number; textbook: number; spin: number; spinOfMasses: number };

/** A resting sedan whose masses `held` names (by x, z from the middle) already stand on the face, struck by it at `LEVER_M` ahead of the middle. */
function landExchange(held: (dx: number, dz: number) => boolean): Landed {
  const car = makeCar();
  launch(car, 0, 0, 0, 0, 0);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.crashed = true;
  const masses = car.deform.masses.filter((m) => m.dynamic);
  const mass = masses.reduce((s, m) => s + m.mass, 0);
  const cx = masses.reduce((s, m) => s + m.mass * m.world.x, 0) / mass;
  const cz = masses.reduce((s, m) => s + m.mass * m.world.z, 0) / mass;
  const inertia = masses.reduce((s, m) => s + m.mass * ((m.world.x - cx) ** 2 + (m.world.z - cz) ** 2), 0);
  for (const m of masses) if (held(m.world.x - cx, m.world.z - cz)) m.vel.x = FACE_MPS;
  const momentumBefore = masses.reduce((s, m) => s + m.mass * m.vel.x, 0);
  const spinBefore = masses.reduce((s, m) => s + m.mass * ((m.world.z - cz) * m.vel.x - (m.world.x - cx) * m.vel.z), 0);
  const rows = new Float64Array(2 * BODY_SIZE);
  carRow(rows, 0, car, 1, 0, FACE_MPS);
  rows[BODY_SIZE + BODY_M] = Infinity;
  rows[BODY_SIZE + BODY_I] = Infinity;
  rows[BODY_SIZE + BODY_X] = cx - 1;
  rows[BODY_SIZE + BODY_Z] = cz + LEVER_M;
  rows[BODY_SIZE + BODY_VX] = FACE_MPS;
  rows[BODY_SIZE + BODY_VZ] = 0;
  rows[BODY_SIZE + BODY_W] = 0;
  rows[BODY_SIZE + BODY_HARD] = 1;
  const contact = new Float64Array(CT_SIZE);
  contact[CT_X] = cx - 1;
  contact[CT_Z] = cz + LEVER_M;
  contact[CT_NX] = 1;
  contact[CT_NZ] = 0;
  contact[CT_DEPTH] = 0;
  contact[CT_E] = 0;
  contact[CT_MU] = 0;
  contact[CT_JMAX] = Infinity;
  const vx = rows[BODY_VX]!;
  const vz = rows[BODY_VZ]!;
  const w = rows[BODY_W]!;
  const kernelJ = bodyContact(rows, 0, BODY_SIZE, contact, new Float64Array(OUT_SIZE));
  const spinOfBody = car.angular.y;
  const taken = takeRow(car, rows, 0, vx, vz, w, 1, 0, FACE_MPS);
  const momentum = masses.reduce((s, m) => s + m.mass * m.vel.x, 0) - momentumBefore;
  const spinOfMasses = (masses.reduce((s, m) => s + m.mass * ((m.world.z - cz) * m.vel.x - (m.world.x - cx) * m.vel.z), 0) - spinBefore) / inertia;
  return { kernelJ, taken, textbook: (LEVER_M * momentum) / inertia, spin: car.angular.y - spinOfBody, spinOfMasses };
}

function spinMessage(l: Landed): string {
  return `spin ${l.spin.toFixed(3)} rad/s (its masses' ${l.spinOfMasses.toFixed(3)}) for ${l.taken.toFixed(0)} of the kernel's ${l.kernelJ.toFixed(0)} N·s; the textbook's ${l.textbook.toFixed(3)} rad/s`;
}

function assertTextbook(l: Landed): void {
  expect(Math.abs(l.spin - l.textbook), `the body turns ${spinMessage(l)}`).toBeLessThanOrEqual(TEXTBOOK_TOLERANCE * l.textbook);
  expect(Math.abs(l.spinOfMasses - l.textbook), `the masses turn ${spinMessage(l)}`).toBeLessThanOrEqual(TEXTBOOK_TOLERANCE * l.textbook);
}

describe("given a resting sedan struck by a face at a lever of 1 m ahead of its middle", () => {
  it("when no mass is on the face yet (all of it takes the impulse), then it spins as the impulse at that lever turns a body of its inertia", () => {
    const l = landExchange(() => false);
    expect(l.taken, `the masses took ${l.taken.toFixed(0)} of the kernel's ${l.kernelJ.toFixed(0)} N·s`).toBeGreaterThan(0.99 * l.kernelJ);
    assertTextbook(l);
  });

  it("when the masses along its near flank (most of its mass) already stand on the face, then it spins as the impulse its masses took turns it, not the kernel's whole", () => {
    const l = landExchange((dx) => dx < NEAR_FLANK_M);
    expect(l.taken, `the masses took ${l.taken.toFixed(0)} of the kernel's ${l.kernelJ.toFixed(0)} N·s: the cut no longer binds`).toBeLessThan(0.5 * l.kernelJ);
    assertTextbook(l);
  });

  it("when the masses of its front half already stand on the face, then the spin is still the moment of the impulse the rear half took", () => {
    assertTextbook(landExchange((_dx, dz) => dz > 0));
  });
});
