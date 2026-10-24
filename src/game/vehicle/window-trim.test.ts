import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { runWall, type WallApproach } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "./car.ts";
import { paint } from "./test-support.ts";

/**
 * The coupe's chrome window trim follows what it frames: a pane's frame its pane, a strip the paint it stands on. A frame left rigid stood
 * out of the crushed body (a wreck's strip 4-8 cm in the road, `wreck-rest.test.ts`).
 */

/** A pane frame stays within this (m) of the move of its pane's nearest point: both are written from one cage, and the gap is the cage's fold. */
const FRAME_FOLLOW_M = 0.01;
/** A strip stays within this (m) of the move of the paint's nearest point: the paint's own 5 cm fit bar (`drawn-body.test-util`). */
const STRIP_FOLLOW_M = 0.05;
/**
 * A move (m) of the paint under a trim point that counts as a dent: one and a half times the frame's follow bar, so a trim that did not follow
 * its paint would miss it by more than the bar. The cracked windshield ends a front hit 2-4 cm back of where it stood at every speed from 35 to 52 km/h
 * (its frame hangs on the cabin, dc81e0f8, and the cabin's own offset is the pane's); a 3 cm control found it at 38-41 km/h and not at 45-52.
 */
const DENT_M = 0.015;
/** The wall hits that dent the front (the windshield, left whole, and its frame) and the side (the strips): approach, km/h, whether the frames or the strips are read, and the bar. */
const HITS: readonly (readonly [WallApproach, number, boolean, number])[] = [
  ["front", 52, true, FRAME_FOLLOW_M],
  ["side", 48, false, STRIP_FOLLOW_M],
];

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Points of every vertex of `meshes` in the car frame as the car stands, a door's in its hinge frame (the door's swing taken out: the panel's dent, not the door's turn). */
function carPoints(car: DeformableCar, meshes: readonly THREE.Mesh[]): Float32Array {
  car.group.updateMatrixWorld(true);
  const inverse = car.group.matrixWorld.clone().invert();
  const out: number[] = [];
  for (const mesh of meshes) {
    if (mesh.parent === car.group) _m.multiplyMatrices(inverse, mesh.matrixWorld);
    else _m.copy(mesh.matrix);
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) out.push(..._v.fromBufferAttribute(pos, i).applyMatrix4(_m).toArray());
  }
  return Float32Array.from(out);
}

/** The index (of the x) of the point of `points` nearest (x, y, z). */
function nearest(points: Float32Array, x: number, y: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const d = (points[i]! - x) ** 2 + (points[i + 1]! - y) ** 2 + (points[i + 2]! - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A trim's record on the car (`CarCore.trims`), as these rows read it. */
type Trim = { mesh: THREE.Mesh; cage: string; door: 0 | 1 | null };

/** The mesh a trim stands on: a pane's frame its pane, a door's strip its door's skin, a body strip the body. */
function stoodOn(car: DeformableCar, t: Trim): THREE.Mesh {
  if (t.door !== null) return t.door === 0 ? car["doorMeshL"] : car["doorMeshR"];
  const pane = t.cage === "glassFront" ? "windshield" : t.cage === "glassRear" ? "rear" : null;
  return pane ? car.glassPanes.find((g) => g.name === pane)!.mesh : car.body;
}

describe("given a coupe whose chrome window trim frames its glass and runs along its sides", () => {
  for (const [approach, kph, frames, bar] of HITS) {
    it(`when it is crushed ${approach} on at ${kph} km/h, then each ${frames ? "pane frame" : "strip"} point moves with the drawn point it stood nearest at rest, to within ${bar * 100} cm`, () => {
      const crushed = new DeformableCar(paint(), new THREE.Scene(), null, "coupe");
      crushed.deform.setMode("shape");
      const pristine = new DeformableCar(paint(), new THREE.Scene(), null, "coupe");
      const atRest = pristine["trims"].map((t) => ({ trim: carPoints(pristine, [t.mesh]), on: carPoints(pristine, [stoodOn(pristine, t)]) }));
      runWall(kph, 1, approach, { car: crushed });
      crushed.flushDeferredSkin();
      crushed.updateSkin();
      let worst = 0;
      let dented = 0;
      for (const [n, t] of crushed["trims"].entries()) {
        const pane = t.cage === "glassFront" ? "windshield" : t.cage === "glassRear" ? "rear" : null;
        if ((pane !== null) !== frames) continue;
        // A shattered pane is no longer written (its fragments fly): there is nothing left for its frame to stand on.
        if (pane && crushed.glassPanes.find((g) => g.name === pane)!.state === "shattered") continue;
        const { trim: trimRest, on: onRest } = atRest[n]!;
        const trimNow = carPoints(crushed, [t.mesh]);
        const onNow = carPoints(crushed, [stoodOn(crushed, t)]);
        for (let i = 0; i < trimNow.length; i += 3) {
          const s = nearest(onRest, trimRest[i]!, trimRest[i + 1]!, trimRest[i + 2]!);
          const paintMove = [onNow[s]! - onRest[s]!, onNow[s + 1]! - onRest[s + 1]!, onNow[s + 2]! - onRest[s + 2]!] as const;
          if (Math.hypot(...paintMove) > DENT_M) dented++;
          worst = Math.max(worst, Math.hypot(trimNow[i]! - trimRest[i]! - paintMove[0], trimNow[i + 1]! - trimRest[i + 1]! - paintMove[1], trimNow[i + 2]! - trimRest[i + 2]! - paintMove[2]));
        }
      }
      assert.ok(dented > 0, `the control: some trim point stood on paint that moved ${DENT_M * 100} cm or more`);
      assert.ok(worst <= bar, `a trim point ${(worst * 100).toFixed(1)} cm off the move of the paint it stands on`);
    });
  }
});

/**
 * Where the windshield stands when a front hit has played out must not step with the speed by more than the hit's own change does. The pane rides the
 * cabin's roof mass, and the roof rests at its permanent set (`clampMass`: sheet metal keeps its set, and the roof stands on it once the contact lets
 * go), wherever the clusters' pull would have taken it. With no set it ended wherever the contact window cut its return: 2.4 cm back of its seat at
 * 41 km/h and at its seat at 42, a step of the pane's offset of its own.
 */
const LATCH_STEP_M = 0.01;

describe("given a coupe's windshield after a front wall hit", () => {
  it(`when it is crushed front on at each km/h from 38 to 44, then the pane's mean offset when the hit has played out changes no more than ${LATCH_STEP_M * 100} cm from one speed to the next`, () => {
    const pristine = new DeformableCar(paint(), new THREE.Scene(), null, "coupe");
    const rest = carPoints(pristine, [pristine.glassPanes.find((g) => g.name === "windshield")!.mesh]);
    let before = NaN;
    for (let kph = 38; kph <= 44; kph++) {
      const crushed = new DeformableCar(paint(), new THREE.Scene(), null, "coupe");
      crushed.deform.setMode("shape");
      runWall(kph, 1, "front", { car: crushed });
      crushed.flushDeferredSkin();
      crushed.updateSkin();
      const now = carPoints(crushed, [crushed.glassPanes.find((g) => g.name === "windshield")!.mesh]);
      let sum = 0;
      for (let i = 0; i < now.length; i += 3) sum += Math.hypot(now[i]! - rest[i]!, now[i + 1]! - rest[i + 1]!, now[i + 2]! - rest[i + 2]!);
      const mean = sum / (now.length / 3);
      assert.ok(!(Math.abs(mean - before) > LATCH_STEP_M), `${kph} km/h: the pane stands ${(mean * 100).toFixed(1)} cm off its seat, ${((mean - before) * 100).toFixed(1)} cm from the speed below`);
      before = mean;
    }
  });
});
