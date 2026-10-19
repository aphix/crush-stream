import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { launch, makeCar, relaunchDamaged, runWall } from "./crash-scenarios.test-util.ts";
import { faceDepth, faceExit, makeBox, solidFace, type ContactBox } from "./external-contact.ts";
import { wallBounce } from "./pair-contact.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import type { DeformableCar } from "../vehicle/car.ts";

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

/** A side-hit sedan wreck at the origin driving into the open end of a solid, its drawn body `PAST_END` round the end at its middle. */
function wreckAtOpenEnd(): { car: DeformableCar; face: ContactBox } {
  const car = makeCar();
  runWall(30, 1, "side", { car });
  relaunchDamaged(car, 0, 0, DOOR_ON_END, -INTO_END_MPS * END_NX, 0);
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
  const endX = leadX + PAST_END;
  const face = solidFace(makeBox(), 0, 1, endX - SOLID_HALF_SPAN, leadZ + SOLID_HALF_THICK, endX - SOLID_HALF_SPAN, 0, SOLID_HALF_SPAN, SOLID_HALF_THICK);
  face.openEnds = true;
  return { car, face };
}

describe("given a side-hit sedan wreck driving at 15 m/s into the open end of a 2 m thick solid (a monument's arm), its drawn door 4 cm round the end and no mass on the solid", () => {
  // Todo: REPLAY 138's fix (a plastic shove for a wreck the face's exchange didn't hold) stopped a sedan at 55 m/s on the monument with 1 mm of crush (slab: 0.50 m, dead), so it was withdrawn (REPLAY 139).
  it.todo("when the slice shoves it out round the end, then neither its body nor any of its masses keeps speed into the end", () => {
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
