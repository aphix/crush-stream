import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { launch, makeCar, relaunchDamaged, runWall } from "./crash-scenarios.test-util.ts";
import { faceDepth, faceExit, makeBox, solidFace, type ContactBox } from "./external-contact.ts";
import { wallBounce } from "./pair-contact.ts";
import { FINE_HZ, QUIET_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { wreckCentre } from "../vehicle/car-air.ts";

// A light touch of a running car on a fixed face pushes it out and, where the face and the tyres hold it, back along the face the way it
// came in: never further along the face than the car itself moved along it in the slice.

const H = 1 / FINE_HZ;
/** The wall: its face on z = 0, facing +z toward the car. */
const NX = 0;
const NZ = 1;

/** A sedan at (0, z) facing +z, moving at (vx, vz), its tyres' sideways grip `hold` left, pushed out of a `pen` deep overlap; returns how far it moved along the face (x). */
function bounce(z: number, vx: number, vz: number, hold: number, pen: number): number {
  const car = makeCar();
  launch(car, 0, z, 0, vx, vz);
  car.drive.hold = hold;
  const face = solidFace(makeBox(), NX, NZ, 0, 0, 0, z, 10, 1);
  const x0 = car.group.position.x;
  wallBounce(car, face, NX, NZ, pen, H, false);
  return car.group.position.x - x0;
}

describe("given a running sedan touching a wall face lightly, its tyres holding its sideways speed", () => {
  it("when it is all but stopped and turned a corner 1.5 cm into the face (closing 1e-5 m/s, 3e-4 m/s along it), then the push out moves it along the face no further than it moved along it in the slice", () => {
    const along = 3e-4;
    const moved = bounce(2.3, -along, -1e-5, 1, 0.015);
    // `along0 · pen / closing` put a stopped cop 0.45 m a frame along a wall into its stakeout partner (Dam Spine seed 1).
    assert.ok(Math.abs(moved) <= along * H * (1 + 1e-9), `moved ${moved.toExponential(3)} m along the face; it moved ${(along * H).toExponential(3)} m along it in the slice`);
  });

  it("when it drove into the face at 30° and 10 m/s this slice, then it is put back along the face by exactly the slice's move along it", () => {
    const vx = -10 * Math.sin(Math.PI / 3);
    const vz = -10 * Math.cos(Math.PI / 3);
    const moved = bounce(2.3, vx, vz, 20, -vz * H);
    assert.ok(Math.abs(moved - -vx * H) < 1e-9, `moved ${moved.toExponential(4)} m back along the face, the slice moved it ${(vx * H).toExponential(4)}`);
  });
});

/** The solid's open end faces +x; the wreck stands beyond it and drives -x into it. */
const END_NX = 1;
const INTO_END_MPS = 15;
/** How far (m) the wreck's drawn door stands past the end plane: deeper than a wreck's skin on a face (`WALL_SKIN`), short of its masses' face spheres. */
const PAST_END = 0.04;
/** Turns a side-hit wreck's door 75° off its nose (where its drawn body stands 7.5 cm past its masses' face spheres) onto the end. */
const DOOR_ON_END = (-11 * Math.PI) / 12;
const SOLID_HALF_SPAN = 2;
const SOLID_HALF_THICK = 1;

/** The turn on the spot (rad/s) that sweeps the door into a face: the derby wreck's while its nose swept a tyre stack's face (3.6-4.5 rad/s). */
const TURN_RAD_S = 4;
/** The most of the deepest vertex's closing on the face that one slice's plastic impulse may leave: it stops the vertex dead (the centre takes the rest as recoil). */
const SWEEP_LEFT = 0.2;

/** The body's lead vertex toward -x (plan point, world axes from the car's origin), over the cage's drawn vertices. */
function doorLead(car: DeformableCar): { leadX: number; leadZ: number } {
  const { pos, panelOn } = car.cage.fields;
  const { vertexCount, vertexGroup } = car.cage.style;
  const r = car.rightFlat;
  const f = car.fwdFlat;
  let leadX = Infinity;
  let leadZ = 0;
  for (let k = 0; k < vertexCount; k++) {
    const group = vertexGroup[k]!;
    if (group > 0 && panelOn[group - 1] === 0) continue;
    const x = r.x * pos[k * 3]! + f.x * pos[k * 3 + 2]!;
    if (x >= leadX) continue;
    leadX = x;
    leadZ = r.z * pos[k * 3]! + f.z * pos[k * 3 + 2]!;
  }
  return { leadX, leadZ };
}

/** A side-hit sedan wreck at the origin moving at `vx` m/s along x, its drawn door the body's lead toward -x: the wreck and the door's plan point. */
function sideHitWreck(vx: number): { car: DeformableCar; leadX: number; leadZ: number } {
  const car = makeCar();
  runWall(30, 1, "side", { car });
  relaunchDamaged(car, 0, 0, DOOR_ON_END, vx, 0);
  return { car, ...doorLead(car) };
}

/** A side-hit sedan wreck at the origin driving into the open end of a solid, its drawn body `PAST_END` round the end at its middle. */
function wreckAtOpenEnd(): { car: DeformableCar; face: ContactBox } {
  const { car, leadX, leadZ } = sideHitWreck(-INTO_END_MPS * END_NX);
  const endX = leadX + PAST_END;
  const face = solidFace(makeBox(), 0, 1, endX - SOLID_HALF_SPAN, leadZ + SOLID_HALF_THICK, endX - SOLID_HALF_SPAN, 0, SOLID_HALF_SPAN, SOLID_HALF_THICK);
  face.openEnds = true;
  return { car, face };
}

/** Turns `car` on the spot at `TURN_RAD_S` about its masses' centre, toward the -x side where the lead vertex (plan z `leadZ`) stands. */
function turnOnTheSpot(car: DeformableCar, leadZ: number): void {
  const centre = wreckCentre(car).clone().applyQuaternion(car.group.quaternion).add(car.group.position);
  const turn = leadZ > centre.z ? -TURN_RAD_S : TURN_RAD_S;
  for (const m of car.deform.masses) if (m.dynamic) m.vel.set(turn * (m.world.z - centre.z), 0, -turn * (m.world.x - centre.x));
  car.angular.set(0, turn, 0);
}

/** The side-hit wreck at rest turning at `TURN_RAD_S` about its masses' centre, the turn sweeping its door into the face of a solid on its -x side that the door stands `PAST_END` through. */
function turningWreckAtFace(): { car: DeformableCar; face: ContactBox } {
  const { car, leadX, leadZ } = sideHitWreck(0);
  turnOnTheSpot(car, leadZ);
  const faceX = leadX + PAST_END;
  return { car, face: solidFace(makeBox(), END_NX, 0, faceX, 0, faceX, 0, SOLID_HALF_SPAN, SOLID_HALF_THICK) };
}

/** How far (m) the lead mass's face sphere stands inside the face of `turningSedanOnFace`. */
const MASS_IN = 0.02;
/** A quiet step's: the 1/80 s step a car at 55 m/s crosses a panel's thickness in. */
const BIG_STEP = 1 / QUIET_HZ;

/** An undamaged armed sedan at rest, its door toward -x, turning at `TURN_RAD_S`; the face on its -x side has its lead mass `MASS_IN` m inside it, so the drawn door stands through it by more. */
function turningSedanOnFace(): { car: DeformableCar; face: ContactBox } {
  const car = makeCar();
  launch(car, 0, 0, DOOR_ON_END, 0, 0);
  car.deform.armMasses(car.group, car.velocity, car.angular);
  car.crashed = true;
  turnOnTheSpot(car, doorLead(car).leadZ);
  const massLead = Math.min(...car.deform.masses.filter((m) => m.dynamic).map((m) => m.world.x - m.radius * 0.5));
  const faceX = massLead + MASS_IN;
  return { car, face: solidFace(makeBox(), END_NX, 0, faceX, 0, faceX, 0, SOLID_HALF_SPAN, SOLID_HALF_THICK) };
}

/** The speed (m/s) of the drawn body's deepest vertex (the last `faceDepth`'s, `faceExit`) along the unit (nx, nz): the centre's and the turn's. Negative closes on the face. */
function vertexAlong(car: DeformableCar, nx: number, nz: number): number {
  const centre = wreckCentre(car).clone().applyQuaternion(car.group.quaternion);
  const turn = car.angular.y * ((faceExit.offZ - centre.z) * nx - (faceExit.offX - centre.x) * nz);
  return car.velocity.x * nx + car.velocity.z * nz + turn;
}

describe("given a side-hit sedan wreck driving at 15 m/s into the open end of a 2 m thick solid (a monument's arm), its drawn door 4 cm round the end and no mass on the solid", () => {
  it("when the slice shoves it out round the end, then neither its body nor any of its masses keeps speed into the end", () => {
    const { car, face } = wreckAtOpenEnd();
    const endX = face.x + SOLID_HALF_SPAN;
    const massLead = Math.min(...car.deform.masses.filter((m) => m.dynamic).map((m) => m.world.x - m.radius * 0.5));
    assert.ok(massLead > endX, `a mass's face sphere reaches ${(endX - massLead).toFixed(3)} m past the end`);
    const depth = faceDepth(car, face);
    assert.ok(Math.abs(depth - PAST_END) < 1e-6 && Math.abs(faceExit.nx - END_NX) < 1e-9, `drawn body ${depth.toFixed(3)} m in, out along (${faceExit.nx.toFixed(2)}, ${faceExit.nz.toFixed(2)})`);
    const x0 = car.group.position.x;
    wallBounce(car, face, END_NX, 0, PAST_END, H, false);
    assert.equal(car.deform.faceContacts, 0, "a mass met the solid: its exchange held the wreck");
    assert.ok(car.group.position.x > x0, "the slice shoved the wreck out round the end");
    // `strikeCar` reads no closing on the end (square to the face's normal): the shove alone holds the wreck.
    const worstMass = Math.min(...car.deform.masses.filter((m) => m.dynamic).map((m) => m.vel.x * END_NX));
    assert.ok(car.velocity.x * END_NX >= -1e-9, `body ${car.velocity.x.toFixed(2)} m/s into the end`);
    assert.ok(worstMass >= -1e-9, `a mass ${worstMass.toFixed(2)} m/s into the end`);
  });
});

describe(`given a side-hit sedan wreck turning on the spot at ${TURN_RAD_S} rad/s, the turn sweeping its drawn door 4 cm through a solid's face (a tyre stack) with no mass on the solid`, () => {
  it("when the slice shoves it out through the face, then the face takes the turn's sweep of the door into it", () => {
    const { car, face } = turningWreckAtFace();
    const massLead = Math.min(...car.deform.masses.filter((m) => m.dynamic).map((m) => m.world.x - m.radius * 0.5));
    assert.ok(massLead > face.x + SOLID_HALF_THICK, `a mass's face sphere reaches ${(face.x + SOLID_HALF_THICK - massLead).toFixed(3)} m into the solid`);
    const depth = faceDepth(car, face);
    assert.ok(Math.abs(depth - PAST_END) < 1e-6 && !faceExit.atEnd, `drawn body ${depth.toFixed(3)} m in, ${faceExit.atEnd ? "round the end" : "through the face"}`);
    const closingBefore = vertexAlong(car, END_NX, 0);
    assert.ok(closingBefore < 0, `the turn moves the door out of the face at ${closingBefore.toFixed(2)} m/s`);
    const x0 = car.group.position.x;
    wallBounce(car, face, END_NX, 0, PAST_END, H, false);
    assert.equal(car.deform.faceContacts, 0, "a mass met the solid: its exchange held the wreck");
    assert.ok(car.group.position.x > x0, "the slice shoved the wreck out through the face");
    const closingAfter = vertexAlong(car, END_NX, 0);
    assert.ok(closingAfter >= SWEEP_LEFT * closingBefore, `the door's deepest vertex still closes on the face at ${(-closingAfter).toFixed(2)} m/s (${(-closingBefore).toFixed(2)} before the slice)`);
  });
});

describe(`given an undamaged sedan turning on the spot at ${TURN_RAD_S} rad/s, its lead mass ${MASS_IN * 100} cm inside a solid's face and the turn swinging its drawn door through that face, at a 1/80 s step`, () => {
  it("when the slice shoves it out, then the face takes the turn's sweep of the door whole, the masses on the face notwithstanding", () => {
    const { car, face } = turningSedanOnFace();
    const depth = faceDepth(car, face);
    const closingBefore = vertexAlong(car, END_NX, 0);
    wallBounce(car, face, END_NX, 0, depth, BIG_STEP, false);
    assert.ok(car.deform.faceContacts > 0, "no mass met the solid: the staging has none on the face");
    const closingAfter = vertexAlong(car, END_NX, 0);
    assert.ok(depth > MASS_IN && closingBefore < 0 && !faceExit.atEnd, `the door is ${depth.toFixed(3)} m through the face, closing at ${(-closingBefore).toFixed(2)} m/s`);
    assert.ok(closingAfter >= SWEEP_LEFT * closingBefore, `the door's deepest vertex still closes on the face at ${(-closingAfter).toFixed(2)} m/s (${(-closingBefore).toFixed(2)} before the slice)`);
  });
});

/** How far (m) the one body point a ramp's side meets stands in it: a tail a few cm in the back face, under the ramp's top. */
const SIDE_POINT_IN = 0.02;

/** How far (m) the slice shoves the turning wreck of `turningWreckAtFace` out of the face, the shove counting the drawn body at most `sunkCap` m in it. */
function shovedBy(sunkCap: number): number {
  const { car, face } = turningWreckAtFace();
  const x0 = car.group.position.x;
  wallBounce(car, face, END_NX, 0, PAST_END, H, false, false, Infinity, sunkCap);
  return car.group.position.x - x0;
}

describe(`given the side-hit wreck turning at ${TURN_RAD_S} rad/s with its drawn door ${PAST_END * 100} cm through a solid's face, where the solid's side meets only a body point ${SIDE_POINT_IN * 100} cm in it (a ramp's back face: its plan box counts the whole drawn body, though the ramp's top is under the rest of it)`, () => {
  it("when the slice shoves it out, then it moves no further than that point is in, where the plan box's whole depth moves it further", () => {
    const whole = shovedBy(Infinity);
    const capped = shovedBy(SIDE_POINT_IN);
    assert.ok(whole > SIDE_POINT_IN, `the plan box's depth shoves it only ${whole.toFixed(4)} m: the staging cannot tell the cap from none`);
    assert.ok(capped > 0 && capped <= SIDE_POINT_IN, `shoved ${capped.toFixed(4)} m for a point ${SIDE_POINT_IN} m in the face`);
  });
});
