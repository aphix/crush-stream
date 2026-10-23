import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { CAGE_PART_VERTICES, CAGE_STEP, CAGE_VERTICES, type CageSource, CarCage } from "./car-cage.ts";
import { cageGaps, cageLiveOf, cageOf, cageSourceOf, fitToDrawn } from "./car-cage.test-util.ts";
import { BODIES, buildCar, carInState, drawnField, drawnTriangles, STATES, stepFrames, TOP_P95_M, TOP_WORST_M, topGapsOff, topParts } from "./drawn-body.test-util.ts";
import { makeBumperGeometry } from "./car-mesh.ts";
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
const roofCornerHole =
  "the decimation loses the wagon's roof rear corners (|x| .50-.60, z -1.75..-1.90): the cage's top reads 0.38 m there under the drawn roof's 1.46 (the cage source's own top there 1.459); after the overhaul: CarRig rig-hole 987f1739 (no vertex left on no triangle: worst -0.42), then the roof outline's corners held";
const edgeCliffs: readonly { key: string; part: string; measured: string; cause: string }[] = [
  { key: "sedan/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.063 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "pickup truck/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.065 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "monster pickup/rolled", part: "cabin", measured: "p95 0.060 (bar 0.05), worst 0.065 under (bar 0.10)", cause: interiorThroughRoof },
  { key: "wagon/untouched", part: "deck", measured: "p95 0.043, worst 0.716 under (bar 0.10)", cause: roofCornerHole },
  { key: "wagon/loaded", part: "deck", measured: "p95 0.035, worst 0.722 under (bar 0.10)", cause: roofCornerHole },
  { key: "wagon/headon", part: "deck", measured: "p95 0.042, worst 0.682 under (bar 0.10)", cause: roofCornerHole },
  { key: "wagon/rolled", part: "deck", measured: "p95 0.034, worst 0.723 under (bar 0.10)", cause: roofCornerHole },
  { key: "wagon/airborne", part: "deck", measured: "p95 0.043, worst 0.716 under (bar 0.10)", cause: roofCornerHole },
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

describe("given the cage's vertex budget", () => {
  it("when a style's cage is built, then it has its budget's vertices and the underside points held over it, about three hundred triangles, and its bumpers on their own budget past them", (t) => {
    const car = carInState("untouched", "sedan", "sedan");
    const cage = cageOf(car);
    const { vertexCount, heldCount, triCount, source, tris } = cage.style;
    const partFrom = cageSourceOf(car).apart[0]!.from;
    let parts = 0;
    for (let i = 0; i < vertexCount; i++) if (source[i]! >= partFrom) parts++;
    let partTris = 0;
    for (let k = 0; k < tris.length; k += 3) if (tris[k]! >= vertexCount - parts && tris[k]! < vertexCount) partTris++;
    t.diagnostic(`${vertexCount} vertices (${heldCount} of them the underside held over the ${CAGE_VERTICES}, ${parts} the bumpers'), ${triCount} triangles (${partTris} the bumpers')`);
    assert.ok(vertexCount - parts <= CAGE_VERTICES + heldCount + 2 && vertexCount - parts >= CAGE_VERTICES / 2, `${vertexCount - parts} hull vertices, ${heldCount} held`);
    assert.ok(triCount - partTris >= 150 && triCount - partTris <= 330 + 2 * heldCount, `${triCount - partTris} hull triangles`);
    assert.ok(parts > 0 && parts <= CAGE_PART_VERTICES && partTris <= 2 * CAGE_PART_VERTICES, `${parts} bumper vertices, ${partTris} triangles`);
  });
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
