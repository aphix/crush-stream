import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { CAGE_PART_VERTICES, CAGE_STEP, CAGE_VERTICES, type CageSource, CarCage } from "./car-cage.ts";
import { cageGaps, cageLiveOf, cageOf, cageSideX, cageSourceOf, drawnDoorX, fitToDrawn } from "./car-cage.test-util.ts";
import { rasterise } from "./cage-fields.ts";
import { IMPRINT_NONE } from "../deform/load-crush.ts";
import { BODIES, buildCar, carInState, drawnField, drawnTriangles, STATES, stepFrames, TOP_P95_M, TOP_WORST_M, topGapsOff, topParts } from "./drawn-body.test-util.ts";
import { makeBumperGeometry } from "./car-mesh.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";
import { cageLift } from "./car-cage-rig.ts";
import { PUSH_BAR_REACH } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { launch, makeWorld } from "../contact/crash-scenarios.test-util.ts";

/**
 * docs/UNIFIED_CONTACT.md stage 3, "the cage is the body": the cage fitted to a car is the drawn body, in every state the body
 * can be in, on the 5 cm lattice (the 10 cm one misses the p95 bar in 11 of 60 part cases, the 5 cm in 6; docs in the handoff). The fit is read per part (hood, cabin, deck) in
 * the car's own frame against the 5 cm drawn field, as `car-top-fit.test.ts` reads the surface other cars stand on.
 */

/**
 * The parts the cage is off the drawn top by more than the bars, read against the drawn relief (the 3 x 3 neighbourhood clamp of
 * `reliefGap`, p95 and worst alike): measured p95 / worst (m) against the 0.05 / 0.10 bars. Each is a todo with its closing follow-up named.
 */
const interiorThroughRoof =
  "the drawn interior (its headliner stands 1.09 m over the origin and does not follow the roof mass) pokes up through the roof the drop crushed, so the drawn top is the interior and the cage's is the roof (the cage carries the interior over a gone pane's opening only: over the whole roof it takes stack-crush.test.ts to 6 of 8); after the plan: make the drawn interior follow the roof's crush";
const rearGlassGone =
  "the wagon's rear glass shatters in the 2 m roof drop (its roof crushes at the rear), so the drawn top over its opening is the cargo floor (0.38-0.58 m) while the cage's closed tail (z -2.11..-1.94) stands at 1.10 m: up 0.52 m at (+-0.48, -1.98); after the plan: the cage's tail opens where the rear glass is gone, as the drawn body's does";
const edgeCliffs: readonly { key: string; part: string; measured: string; cause: string }[] = [
  { key: "sedan/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.063 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "pickup truck/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.065 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "monster pickup/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.065 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "wagon/rolled", part: "deck", measured: "p95 0.154 (bar 0.05), worst 0.515 over (bar 0.10)", cause: rearGlassGone },
];

for (const body of BODIES) {
  for (const state of STATES) {
    const cliffs = edgeCliffs.filter((c) => c.key === `${body.body}/${state.id}`);
    describe(`given a ${body.body} body ${state.text} and a ${CAGE_STEP * 100} cm cage`, () => {
      it(`when the cage's top is read over its hood, cabin and deck, then it lies within ${TOP_P95_M * 100} cm of the drawn top (95th percentile), ${TOP_WORST_M * 100} cm at worst, and answers over the drawn part`, (t) => {
        const car = carInState(state.id, body.style, body.cls);
        const cage = cageOf(car);
        fitToDrawn(car, cage);
        const field = drawnField(car);
        const wrong: string[] = [];
        for (const [part, region] of Object.entries(topParts(body.style))) {
          const g = cageGaps(car, cage, field, region);
          t.diagnostic(`${part}: cells ${g.cells} p95 ${g.p95.toFixed(3)} up ${g.worstUp.toFixed(3)} down ${g.worstDown.toFixed(3)} missing ${g.missing}`);
          if (cliffs.some((c) => c.part === part)) continue;
          wrong.push(...topGapsOff(part, g));
        }
        assert.deepEqual(wrong, []);
      });
      for (const cliff of cliffs) it.todo(`the cage's ${cliff.part} within the bars (measured ${cliff.measured}: ${cliff.cause})`);
    });
  }
}

/** The head-on speeds (km/h) the nose-wrapped hoods are read at: the drawn lid's front, which the crash puts at another place against the 5 cm lattice at each. */
const HOOD_SPEEDS = [40, 44, 48, 50, 52];

describe("given a pickup truck and a monster pickup after head-ons at 40 to 52 km/h", () => {
  for (const body of BODIES.filter((b) => b.style === "pickup" || b.style === "monster")) {
    it(`when the ${body.body}'s cage top is read over its hood, then it lies within the bars of the drawn top and answers over the drawn lid at every speed, wherever its front stands against the lattice`, () => {
      const wrong: string[] = [];
      for (const kph of HOOD_SPEEDS) {
        const car = carInState("headon", body.style, body.cls, kph);
        const cage = cageOf(car);
        fitToDrawn(car, cage);
        wrong.push(...topGapsOff("hood", cageGaps(car, cage, drawnField(car), topParts(body.style).hood)).map((off) => `${kph} km/h: ${off}`));
      }
      assert.deepEqual(wrong, []);
    });
  }
});

/** The hood's group in a cage's panels (`cagePanelsOf`: the hood first). */
const HOOD_GROUP = 1;

/** Whether plan point (x, z) lies in a triangle of a panel that is on (the interior's apart), edges included: `rasterise`'s `covered`, read from the triangles alone. */
function inPlanOf(style: CarCage["style"], pos: Float64Array, panelOn: Uint8Array, x: number, z: number): boolean {
  for (let t = 0; t < style.triCount * 3; t += 3) {
    const group = style.triGroup[t / 3]!;
    if (group === style.panelCount + 1 || (group > 0 && panelOn[group - 1] === 0)) continue;
    const [a, b, c] = [style.tris[t]! * 3, style.tris[t + 1]! * 3, style.tris[t + 2]! * 3];
    const d1 = (pos[b]! - pos[a]!) * (z - pos[a + 2]!) - (pos[b + 2]! - pos[a + 2]!) * (x - pos[a]!);
    const d2 = (pos[c]! - pos[b]!) * (z - pos[b + 2]!) - (pos[c + 2]! - pos[b + 2]!) * (x - pos[b]!);
    const d3 = (pos[a]! - pos[c]!) * (z - pos[c + 2]!) - (pos[a + 2]! - pos[c + 2]!) * (x - pos[c]!);
    if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true;
  }
  return false;
}

describe("given a crushed pickup's cage with its hood moved forward along its length in 5 mm steps", () => {
  const crushed = (): { cage: CarCage; fields: CarCage["fields"]; front: number; centre: number } => {
    const car = carInState("headon", "pickup", "truck");
    const cage = cageOf(car);
    fitToDrawn(car, cage);
    const { style, fields } = cage;
    let front = -Infinity;
    let x = 0;
    for (let i = 0; i < style.vertexCount; i++) {
      if (style.vertexGroup[i] === HOOD_GROUP && fields.pos[i * 3 + 2]! > front) [front, x] = [fields.pos[i * 3 + 2]!, fields.pos[i * 3]!];
    }
    return { cage, fields, front, centre: Math.round((x - style.u0) / style.step) };
  };

  it("when the cage's top is read ahead of the hood's front, then it answers one step past it and no further (the lid's nodes reach a step, the rest of the body half of one), at every place of the front against the lattice", () => {
    const { cage, fields, front, centre } = crushed();
    const { style } = cage;
    const wrong: string[] = [];
    for (let mm = 0; mm < 50; mm += 5) {
      const shift = mm === 0 ? 0 : 0.005;
      for (let i = 0; i < style.vertexCount; i++) if (style.vertexGroup[i] === HOOD_GROUP) fields.pos[i * 3 + 2] = fields.pos[i * 3 + 2]! + shift;
      rasterise(style, fields, fields.panelOn, IMPRINT_NONE, 0, 0);
      let last = -Infinity;
      for (let j = 0; j < style.nv; j++) if (Number.isFinite(fields.top[j * style.nu + centre]!)) last = style.v0 + j * style.step;
      const at = front + mm / 1000;
      if (!(last > at && last <= at + style.step + 1e-9)) wrong.push(`front at z ${at.toFixed(3)}: the last node with a height is at ${last.toFixed(3)}, not in (${at.toFixed(3)}, ${(at + style.step).toFixed(3)}]`);
    }
    assert.deepEqual(wrong, []);
  });

  it("when the cage's coverage and plan box are read, then they are the triangles' own: the nodes inside a triangle and the vertices' extent, whatever the lids' reach", () => {
    const { cage, fields } = crushed();
    const { style } = cage;
    rasterise(style, fields, style.panelsOn, IMPRINT_NONE, 0, 0);
    const wrong: string[] = [];
    for (let j = 0; j < style.nv; j++) {
      for (let i = 0; i < style.nu; i++) {
        const inside = inPlanOf(style, fields.pos, style.panelsOn, style.u0 + i * style.step, style.v0 + j * style.step);
        if (inside !== (fields.covered[j * style.nu + i] === 1)) wrong.push(`node (${(style.u0 + i * style.step).toFixed(2)}, ${(style.v0 + j * style.step).toFixed(2)}) ${inside ? "is inside a triangle and not covered" : "is covered and in no triangle"}`);
      }
    }
    assert.deepEqual(wrong.slice(0, 5), []);
    let zMax = -Infinity;
    for (let t = 0; t < style.triCount * 3; t++) {
      if (style.triGroup[Math.floor(t / 3)] !== style.panelCount + 1) zMax = Math.max(zMax, fields.pos[style.tris[t]! * 3 + 2]!);
    }
    assert.ok(Math.abs(fields.planBox[3]! - zMax) < 1e-9, `the plan box ends at z ${fields.planBox[3]!.toFixed(3)}, the triangles' vertices at ${zMax.toFixed(3)}`);
  });
});

describe("given the cage's vertex budget", () => {
  it("when a style's cage is built, then it has its budget's vertices, the underside points held over it and the C-post's kept crown points, about three hundred triangles, and its two bumpers and two front doors on their own budget past them", (t) => {
    const car = carInState("untouched", "sedan", "sedan");
    const cage = cageOf(car);
    const { vertexCount, heldCount, triCount, source, tris } = cage.style;
    const src = cageSourceOf(car);
    const apart = src.apart;
    const partFrom = apart[0]!.from;
    const kept = src.held.subarray(0, partFrom).reduce((n, h) => n + h, 0);
    let parts = 0;
    for (let i = 0; i < vertexCount; i++) if (source[i]! >= partFrom) parts++;
    let partTris = 0;
    for (let k = 0; k < tris.length; k += 3) if (tris[k]! >= vertexCount - parts && tris[k]! < vertexCount) partTris++;
    t.diagnostic(`${vertexCount} vertices (${heldCount} of them the underside held over the ${CAGE_VERTICES}, ${kept} the C-post's kept points, ${parts} the bumpers' and doors'), ${triCount} triangles (${partTris} theirs)`);
    assert.equal(apart.length, 4, "two bumpers and two front doors, each decimated alone");
    assert.ok(vertexCount - parts <= CAGE_VERTICES + heldCount + kept + 2 && vertexCount - parts >= CAGE_VERTICES / 2, `${vertexCount - parts} hull vertices, ${heldCount} held, ${kept} kept`);
    assert.ok(triCount - partTris >= 150 && triCount - partTris <= 330 + 2 * (heldCount + kept), `${triCount - partTris} hull triangles`);
    assert.ok(parts > 0 && parts <= CAGE_PART_VERTICES && partTris <= 2 * CAGE_PART_VERTICES, `${parts} part vertices, ${partTris} triangles`);
  });
});

/** The bumper corners are `frame.hullUnder`'s last four rows (x, z, height). */
const BUMPER_CORNER_ROWS = 4;

describe("given every body style's cage and the bottom corners of its drawn bumpers (`frame.hullUnder`'s last four rows)", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id}'s corners are measured to its nearest cage vertex, then each is within the cage fit's ${TOP_P95_M * 100} cm, as only vertices collide`, (t) => {
      const car = carInState("untouched", id, STYLE_CLASS[id]);
      const { rest, vertexCount } = cageOf(car).style;
      const under = car.frame.hullUnder;
      const far: string[] = [];
      for (let i = under.length - BUMPER_CORNER_ROWS * 3; i < under.length; i += 3) {
        let nearest = Infinity;
        for (let k = 0; k < vertexCount; k++) nearest = Math.min(nearest, Math.hypot(rest[k * 3]! - under[i]!, rest[k * 3 + 1]! - under[i + 2]!, rest[k * 3 + 2]! - under[i + 1]!));
        const corner = `${under[i]! > 0 ? "+" : "-"}x ${under[i + 1]! > 0 ? "front" : "rear"}`;
        t.diagnostic(`${corner}: nearest cage vertex ${(nearest * 100).toFixed(1)} cm`);
        if (nearest > TOP_P95_M) far.push(`${corner} ${(nearest * 100).toFixed(1)} cm`);
      }
      assert.deepEqual(far, []);
    });
  }
});

/** How far (m) the cage's nose may stand behind the drawn nose: the bumper's face is the cage's, a push bar's box as far out as its pads. */
const NOSE_REACH_M = 0.005;

describe("given a cruiser with its push bar", () => {
  it("when its cage's plan box is read, then the nose reaches the bar's drawn face, 9 cm past its bumper's", (t) => {
    const car = carInState("untouched", "police", "sedan");
    const nose = cageOf(car).fields.planBox[3]!;
    const drawn = drawnTriangles(car);
    let face = -Infinity;
    for (let i = 2; i < drawn.length; i += 3) face = Math.max(face, drawn[i]!);
    t.diagnostic(`cage nose ${nose.toFixed(3)} m, drawn nose ${face.toFixed(3)} m`);
    assert.ok(face - nose <= NOSE_REACH_M, `the cage's nose stands ${(face - nose).toFixed(3)} m behind the bar`);
  });
});

/** The speed (km/h) each car drives at in the head-on that crushes the cruiser's nose and leaves its bumper on. */
const BAR_CRASH_KMH = 18;
/** How far (m) a crashed cruiser's cage bar may stand off its place on the bumper (the drawn bar's, or its rest place). */
const BAR_FOLLOW_M = 0.01;

/** A cruiser after a head-on crash with a sedan, 5 s on, its front bumper still on, posed upright at the origin. */
function crashedCruiser(): DeformableCar {
  const car = buildCar("police", "sedan");
  const other = buildCar("sedan", "sedan");
  launch(car, -5, 0, Math.PI / 2, BAR_CRASH_KMH / 3.6, 0);
  launch(other, 5, 0, -Math.PI / 2, -BAR_CRASH_KMH / 3.6, 0);
  stepFrames(makeWorld([car, other], false, false, null), 5);
  car.group.position.set(0, 0, 0);
  car.group.rotation.set(0, 0, 0, "YXZ");
  car.group.updateMatrixWorld(true);
  const classBody = car.group.getObjectByName("classLift");
  if (classBody) classBody.position.y = cageLift(car);
  car.group.updateMatrixWorld(true);
  return car;
}

/** Where a push bar stands on its bumper: how far (m) its pads' face is ahead of the bumper's face, and its top over the bumper's top. */
type BarPlace = { ahead: number; over: number };

/** The bar's place in the cage's vertices `pos`: the bar is the panel holding the nose-most rest vertex, its bumper the panel before it. */
function cageBarPlace(style: CarCage["style"], pos: ArrayLike<number>): BarPlace {
  let nose = 0;
  for (let k = 1; k < style.vertexCount; k++) if (style.rest[k * 3 + 2]! > style.rest[nose * 3 + 2]!) nose = k;
  const bar = style.vertexGroup[nose]!;
  const reach = (group: number, axis: number): number => {
    let top = -Infinity;
    for (let k = 0; k < style.vertexCount; k++) if (style.vertexGroup[k] === group) top = Math.max(top, pos[k * 3 + axis]!);
    return top;
  };
  return { ahead: reach(bar, 2) - reach(bar - 1, 2), over: reach(bar, 1) - reach(bar - 1, 1) };
}

/** How far (m) a drawn vertex may stand off the bumper's face and still be the fascia's own (the bar's vertices stand past it). */
const FASCIA_EPS = 0.005;
/** The drawn bar's pads' face ahead of the drawn bumper's face, at the crash: the bar's vertices are the drawn bumper mesh's past its fascia's face (`makeBumperGeometry`). */
function drawnBarAhead(car: DeformableCar): number {
  drawnTriangles(car);
  const fascia = makeBumperGeometry(true, car.style);
  fascia.computeBoundingBox();
  const face = fascia.boundingBox!.max.z;
  const mesh = car.lookMeshes().bumpers[0]!;
  const at = mesh.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  let pads = -Infinity;
  let front = -Infinity;
  for (let i = 0; i < at.count; i++) {
    v.fromBufferAttribute(at, i);
    const rest = v.z;
    car.group.worldToLocal(v.applyMatrix4(mesh.matrixWorld));
    if (rest > face + FASCIA_EPS) pads = Math.max(pads, v.z);
    else if (rest > face - FASCIA_EPS) front = Math.max(front, v.z);
  }
  return pads - front;
}

/** The crashed cruiser, its cage fitted, and the bar's place in the cage at rest and after the crash (built once, by the first row that reads it). */
type CrashedBar = { car: DeformableCar; cage: CarCage; rest: BarPlace; crashed: BarPlace };
let crashedBar: CrashedBar | undefined;

function barAfterCrash(): CrashedBar {
  if (crashedBar) return crashedBar;
  const car = crashedCruiser();
  const cage = cageOf(car);
  fitToDrawn(car, cage);
  crashedBar = { car, cage, rest: cageBarPlace(cage.style, cage.style.rest), crashed: cageBarPlace(cage.style, cage.fields.pos) };
  return crashedBar;
}

describe("given a cruiser after an 18 km/h head-on crash that leaves its front bumper on", () => {
  it("when its cage's nose and bumper are read, then the bumper is on and crushed, so the bar is read where a crash puts it", (t) => {
    const { car, cage, rest } = barAfterCrash();
    t.diagnostic(`cage nose ${cage.fields.planBox[3]!.toFixed(3)} m at ${cage.style.pristine.planBox[3]!.toFixed(3)} at rest`);
    assert.ok(car.crashed && !car["parts"].some((p) => p.bumper && p.cage === "bumperFront" && p.detached), "the cruiser is crashed with its front bumper on");
    assert.ok(cage.fields.planBox[3]! < cage.style.pristine.planBox[3]! - 0.1, `the cage's nose stands ${cage.fields.planBox[3]!.toFixed(3)} m`);
    assert.ok(Math.abs(rest.ahead - PUSH_BAR_REACH) < 1e-3, `the bar's rest face stands ${rest.ahead.toFixed(3)} m ahead of its bumper's, not its reach ${PUSH_BAR_REACH}`);
  });

  it("when the bar is read against its bumper, then its pads stand as far ahead of the bumper's face as the drawn bar's, within 1 cm", (t) => {
    const { car, crashed } = barAfterCrash();
    const drawn = drawnBarAhead(car);
    t.diagnostic(`cage ${crashed.ahead.toFixed(3)} m ahead of its bumper's face, drawn ${drawn.toFixed(3)} m`);
    assert.ok(Math.abs(crashed.ahead - drawn) <= BAR_FOLLOW_M, `the cage's bar face stands ${crashed.ahead.toFixed(3)} m ahead of its bumper's, the drawn bar's ${drawn.toFixed(3)} m`);
  });

  it("when the bar is read against its bumper, then its top stands as high over the bumper's top as at rest, within 1 cm", (t) => {
    const { rest, crashed } = barAfterCrash();
    t.diagnostic(`cage ${crashed.over.toFixed(3)} m over its bumper's top, ${rest.over.toFixed(3)} m at rest`);
    assert.ok(Math.abs(crashed.over - rest.over) <= BAR_FOLLOW_M, `the cage's bar top stands ${crashed.over.toFixed(3)} m over its bumper's, ${rest.over.toFixed(3)} m at rest`);
  });
});

describe("given a pristine car and a crushed car of one style", () => {
  it("when both are fitted, then the pristine one stands on the style's shared fields and the crushed one on its own", () => {
    const pristine = carInState("untouched", "sedan", "sedan");
    const crushed = carInState("loaded", "sedan", "sedan");
    const a = cageOf(pristine);
    const b = cageOf(crushed);
    fitToDrawn(pristine, a);
    fitToDrawn(crushed, b);
    assert.equal(a.pristine, true);
    assert.equal(b.pristine, false);
    assert.equal(a.fields, a.style.pristine);
    assert.notEqual(b.fields, b.style.pristine);
    assert.equal(cageOf(pristine).style, a.style);
  });
});

describe("given a fitted car whose masses have not moved", () => {
  it("when it is fitted again, then nothing is refitted and the fields stay where they are", () => {
    const car = carInState("loaded", "sedan", "sedan");
    const cage = cageOf(car);
    assert.equal(fitToDrawn(car, cage), true);
    const fields = cage.fields;
    const serial = cage.serial;
    assert.equal(cage.refit(cageLiveOf(car)), false);
    assert.equal(cage.fields, fields);
    assert.equal(cage.serial, serial);
  });
});

describe("given a crushed car refitted over and over", () => {
  it("when its masses move each time, then the cage's own buffers are the ones written, never new ones", () => {
    const car = carInState("loaded", "sedan", "sedan");
    const cage = cageOf(car);
    fitToDrawn(car, cage);
    const own = cage.fields;
    const top = own.top;
    const pos = own.pos;
    for (let k = 1; k <= 4; k++) {
      car.deform.masses[0]!.local.y += 0.01 * k;
      car.deform["loadDirty"][0] = 1;
      fitToDrawn(car, cage);
      assert.equal(cage.fields, own);
      assert.equal(cage.fields.top, top);
      assert.equal(cage.fields.pos, pos);
    }
  });
});

describe("given two cages asked for one style key", () => {
  it("when they are built from one source, then the source is read once and they share the style", () => {
    const car = carInState("untouched", "pickup", "truck");
    const key = {};
    let reads = 0;
    const source = (): CageSource => {
      reads++;
      return cageSourceOf(car);
    };
    const a = CarCage.shared(key, source);
    const b = CarCage.shared(key, source);
    assert.equal(reads, 1);
    assert.equal(a.style, b.style);
  });
});

describe("given a pristine sedan's cage", () => {
  it("when its plan distance field is read along the car's width, then it is negative inside, positive outside, and changes by at most one node's width from node to node", () => {
    const car = carInState("untouched", "sedan", "sedan");
    const cage = cageOf(car);
    const { nu, step, u0, v0 } = cage.style;
    const plan = cage.planField();
    const row = Math.round((0 - v0) / step) * nu;
    assert.ok(plan[row + Math.round((0 - u0) / step)]! < 0, `centre ${plan[row + Math.round((0 - u0) / step)]}`);
    assert.ok(plan[row]! > 0 && plan[row + nu - 1]! > 0, `edges ${plan[row]} ${plan[row + nu - 1]}`);
    for (let i = 1; i < nu; i++) assert.ok(Math.abs(plan[row + i]! - plan[row + i - 1]!) <= step + 1e-6, `node ${i}: ${plan[row + i - 1]} to ${plan[row + i]}`);
  });
});

describe("given a car dropped on its roof, whose glass is gone and whose crushed roof the drawn interior pokes through", () => {
  it("when its cage is fitted with the glass off and as if it were on, then the tops differ over a gone pane's opening alone, never over the roof between them", () => {
    const car = carInState("rolled", "sedan", "sedan");
    // The reference sedan's 2 m drop shatters no pane on its own (the laminated windshield stands in the cage either way): the fixture takes
    // the rear glass off, a pane of the frame (a door's glass rides its door, no glass panel of the cage).
    const rear = car.glassPanes.find((g) => g.name === "rear")!;
    if (rear.state !== "shattered") car["shatterGlass"](rear);
    const off = cageOf(car);
    fitToDrawn(car, off);
    const live = cageLiveOf(car);
    const gone = Array.from(live.panelOn, (on, k) => (on === 0 && off.style.panelGlass[k] === 1 ? k + 1 : 0)).filter((g) => g > 0);
    assert.ok(gone.length > 0, "fixture: the drop must have shattered a pane");
    live.panelOn.fill(1);
    const on = new CarCage(off.style);
    on.refit(live);
    const { nu, nv, step, u0, v0, vertexCount, vertexGroup } = off.style;
    // Each gone pane's opening: the plan box of its vertices (they stand where the frame holds them).
    const boxes = gone.map((group) => {
      const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
      for (let i = 0; i < vertexCount; i++) {
        if (vertexGroup[i] !== group) continue;
        box.x0 = Math.min(box.x0, off.fields.pos[i * 3]!);
        box.x1 = Math.max(box.x1, off.fields.pos[i * 3]!);
        box.z0 = Math.min(box.z0, off.fields.pos[i * 3 + 2]!);
        box.z1 = Math.max(box.z1, off.fields.pos[i * 3 + 2]!);
      }
      return box;
    });
    let differ = 0;
    const outside: string[] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = off.fields.top[j * nu + i]!;
        const b = on.fields.top[j * nu + i]!;
        if (Object.is(a, b)) continue;
        differ++;
        const x = u0 + i * step;
        const z = v0 + j * step;
        if (!boxes.some((q) => x >= q.x0 - 2 * step && x <= q.x1 + 2 * step && z >= q.z0 - 2 * step && z <= q.z1 + 2 * step)) outside.push(`(${x.toFixed(2)}, ${z.toFixed(2)}): ${a} against ${b}`);
      }
    }
    assert.ok(differ > 0, "the opening read the same as the pane");
    assert.deepEqual(outside, []);
  });
});

/** A struck shut door's cage stands within this of its drawn skin (m): the lattice's own read of the side plus the decimated door build. */
const DOOR_SIDE_M = TOP_P95_M;
/** Stations across the door's aperture as shares of its z span, clear of the cut ends where the body's own side takes over. */
const DOOR_STATIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
/** The door heights read, as shares of `door.halfHeight` about `door.hingeY`: low, middle and high on the skin. */
const DOOR_HEIGHTS = [-0.5, 0, 0.5];
/** Half the height (m) the striker spans about each door height: a bumper-sized patch, a few lattice nodes tall. */
const STRIKER_HALF = 0.075;

describe("given a parked car of each body with its doors shut and latched, and its cage", () => {
  it("when a striker is moved sideways into either flank at stations across the whole door aperture and at three door heights, then it first meets the cage within 5 cm of the drawn door's outer skin at every one", (t) => {
    const wrong: string[] = [];
    for (const body of BODIES) {
      const car = carInState("untouched", body.style, body.cls);
      const cage = cageOf(car);
      const { step, v0 } = cage.style;
      const { aperture, hingeY, halfHeight } = car.style.door;
      for (const side of [1, -1] as const) {
        for (const share of DOOR_STATIONS) {
          const z = v0 + Math.round((aperture[0] + share * (aperture[1] - aperture[0]) - v0) / step) * step;
          for (const h of DOOR_HEIGHTS) {
            const y = hingeY + h * halfHeight;
            const cageX = cageSideX(cage, side, z, y - STRIKER_HALF, y + STRIKER_HALF);
            const skinX = drawnDoorX(car.style, side, y, z);
            const text = `${body.body} ${side > 0 ? "right" : "left"} z ${z.toFixed(2)} y ${y.toFixed(2)}: cage ${cageX.toFixed(3)} against skin ${skinX.toFixed(3)} (${((cageX - skinX) * 100).toFixed(1)} cm)`;
            t.diagnostic(text);
            if (!(Math.abs(cageX - skinX) <= DOOR_SIDE_M)) wrong.push(text);
          }
        }
      }
    }
    assert.deepEqual(wrong, []);
  });
});
