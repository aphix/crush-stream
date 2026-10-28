import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "./car.ts";
import { CONTOUR_SMOOTHING, SMOOTHING_TIER, smoothNormals } from "./normal-smooth.ts";
import { paint } from "./test-support.ts";

const CRUSH_SPEED_KPH = 64;
/** Degrees. A soft edge is a facet step the pass is meant to round (between these), a hard edge one it must leave. */
const SOFT_FROM = 10;
const SOFT_TO = 55;
const HARD_FROM = 70;

/** The angle (degrees) between the two vertex normals of every distinct edge of an indexed mesh, in first-seen order. */
function edgeAngles(geometry: THREE.BufferGeometry): number[] {
  const index = geometry.index!.array;
  const nor = geometry.getAttribute("normal").array;
  const count = geometry.getAttribute("normal").count;
  const seen = new Set<number>();
  const angles: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[t + k]!;
      const b = index[t + ((k + 1) % 3)]!;
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      const dot = nor[a * 3]! * nor[b * 3]! + nor[a * 3 + 1]! * nor[b * 3 + 1]! + nor[a * 3 + 2]! * nor[b * 3 + 2]!;
      angles.push((Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
    }
  }
  return angles;
}

/** The mean angle after, over the edges whose angle before lies in [from, to). */
function meanOver(before: number[], after: number[], from: number, to: number): { edges: number; before: number; after: number } {
  let edges = 0;
  let sumBefore = 0;
  let sumAfter = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i]! < from || before[i]! >= to) continue;
    edges++;
    sumBefore += before[i]!;
    sumAfter += after[i]!;
  }
  return { edges, before: sumBefore / edges, after: sumAfter / edges };
}

function crushedSedan(strength: number): DeformableCar {
  CONTOUR_SMOOTHING.value = strength;
  SMOOTHING_TIER.value = 1;
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.deform.setMode("shape");
  runWall(CRUSH_SPEED_KPH, 1, "front", { car });
  car.flushDeferredSkin();
  car.updateSkin();
  return car;
}

const simHash = (car: DeformableCar): string => createHash("sha256").update(JSON.stringify(car.deform.snapshot())).digest("hex");

describe("given a sedan crushed by a 64 km/h wall hit, drawn at three Car contour strengths", () => {
  const off = crushedSedan(0);
  const normal = crushedSedan(1);
  const twice = crushedSedan(2);
  CONTOUR_SMOOTHING.value = 1;
  const angles = { off: edgeAngles(off.body.geometry), normal: edgeAngles(normal.body.geometry), twice: edgeAngles(twice.body.geometry) };

  it("when the soft facet steps are measured, then the default's mean angle across them is under 80% of the off value and strength 2's lower still", () => {
    const soft = meanOver(angles.off, angles.normal, SOFT_FROM, SOFT_TO);
    const softTwice = meanOver(angles.off, angles.twice, SOFT_FROM, SOFT_TO);
    assert.ok(soft.edges > 500, `the crush leaves ${soft.edges} soft edges to round`);
    assert.ok(soft.after < soft.before * 0.8, `strength 1: ${soft.after.toFixed(1)} against ${soft.before.toFixed(1)} degrees`);
    assert.ok(softTwice.after < soft.after, `strength 2: ${softTwice.after.toFixed(1)} against ${soft.after.toFixed(1)} degrees`);
  });

  it("when the hard edges are measured, then the default keeps at least 70% of their mean angle", () => {
    const hard = meanOver(angles.off, angles.normal, HARD_FROM, 181);
    assert.ok(hard.edges > 100, `the body has ${hard.edges} hard edges`);
    assert.ok(hard.after > hard.before * 0.7, `hard edges ${hard.after.toFixed(1)} against ${hard.before.toFixed(1)} degrees`);
  });

  it("when every smoothed normal is read, then it is finite and unit length", () => {
    const nor = normal.body.geometry.getAttribute("normal");
    for (let v = 0; v < nor.count; v++) {
      const length = Math.hypot(nor.getX(v), nor.getY(v), nor.getZ(v));
      assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-4, `vertex ${v}: length ${length}`);
    }
  });

  it("when the sim's state is hashed at each strength, then it is the same: smoothing only touches what is drawn", () => {
    assert.equal(simHash(normal), simHash(off), "strength 1 against off");
    assert.equal(simHash(twice), simHash(off), "strength 2 against off");
  });

  it("when the slider moves after the crash, then the crashed car's normals follow it on the next skin", () => {
    CONTOUR_SMOOTHING.value = 0;
    off.updateSkin();
    off.flushDeferredSkin();
    const flat = meanOver(angles.off, edgeAngles(off.body.geometry), SOFT_FROM, SOFT_TO);
    CONTOUR_SMOOTHING.value = 1;
    off.updateSkin();
    off.flushDeferredSkin();
    const followed = meanOver(angles.off, edgeAngles(off.body.geometry), SOFT_FROM, SOFT_TO);
    assert.ok(followed.after < flat.after * 0.85, `after the slider went to 1: ${followed.after.toFixed(1)} against ${flat.after.toFixed(1)} degrees`);
  });
});

describe("given two flat faces meeting at a right angle with noisy normals", () => {
  it("when the pass runs, then the noise on a face is pulled together and the edge between the faces keeps its step", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
    const up = [0, 0, 1];
    const tilted = [0.342, 0, 0.94];
    const side = [1, 0, 0];
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([...up, ...tilted, ...side, ...up, ...tilted, ...side]), 3));
    const before = geometry.getAttribute("normal").array.slice();
    smoothNormals(geometry, positions.map((value) => value + 1), 1);
    const after = geometry.getAttribute("normal").array;
    const dot = (a: ArrayLike<number>, i: number, j: number) => a[i * 3]! * a[j * 3]! + a[i * 3 + 1]! * a[j * 3 + 1]! + a[i * 3 + 2]! * a[j * 3 + 2]!;
    assert.ok(dot(after, 0, 1) > dot(before, 0, 1), "the tilted vertex moves toward its flat neighbour");
    assert.ok(dot(after, 1, 2) <= dot(before, 1, 2) + 1e-6, "the step across the 70 degree edge never closes");
    assert.ok(dot(after, 2, 2) > 0.9999 && Math.abs(after[6]! - 1) < 1e-6, "the side face's normal, with no neighbour inside the angle but its own face, is untouched");
  });
});
