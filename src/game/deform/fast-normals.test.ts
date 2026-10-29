import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeNormalsFast, computeNormalsNear } from "./fast-normals.ts";
import { makeHoodGeometry } from "../vehicle/car-mesh.ts";
import { makeChassisGeometry } from "../vehicle/car-chassis-mesh.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";

/** Deterministic dent-like noise so faces tilt the way a crushed body's do. */
function crumple(geo: THREE.BufferGeometry, amp: number): void {
  const a = geo.getAttribute("position").array as Float32Array;
  for (let i = 0; i < a.length; i++) a[i]! += Math.sin(i * 12.9898 + a[i]! * 78.233) * amp;
}

/** Largest angle (rad) between the two normal sets; a zero normal must stay zero in both. */
function maxAngle(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 3) {
    const la = Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!);
    const lb = Math.hypot(b[i]!, b[i + 1]!, b[i + 2]!);
    if (la === 0 || lb === 0) {
      expect(la, `vertex ${i / 3}: one side has a zero normal`).toBe(lb);
      continue;
    }
    const dot = (a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]!) / (la * lb);
    worst = Math.max(worst, Math.acos(Math.min(1, dot)));
  }
  return worst;
}

function compare(geo: THREE.BufferGeometry): number {
  const ref = geo.clone();
  ref.computeVertexNormals();
  computeNormalsFast(geo);
  const fast = geo.getAttribute("normal").array as Float32Array;
  const want = ref.getAttribute("normal").array as Float32Array;
  expect(fast.length).toBe(want.length);
  return maxAngle(fast, want);
}

describe("given computeNormalsFast (vertex normals computed faster than the stock method, to the same result)", () => {
  for (const id of ["sedan", "pickup"] as const) {
    it(`when a ${id} body is crushed by dent-like noise, then its normals match THREE's computeVertexNormals to within 1e-6 rad`, () => {
      const geo = makeChassisGeometry(CAR_STYLES[id]);
      crumple(geo, 0.04);
      expect(compare(geo)).toBeLessThan(1e-6);
    });
  }

  it("when a skinned hood panel with stale normals is crumpled and its normals are computed again, then they match computeVertexNormals to within 1e-6 rad", () => {
    const geo = makeHoodGeometry();
    computeNormalsFast(geo);
    crumple(geo, 0.02);
    expect(compare(geo)).toBeLessThan(1e-6);
  });

  it("when a non-indexed box with a collapsed triangle is crumpled, then its normals match computeVertexNormals to within 1e-6 rad and the collapsed triangle's zero normals stay zero in both", () => {
    const geo = new THREE.BoxGeometry(1, 0.5, 2, 3, 2, 4).toNonIndexed();
    crumple(geo, 0.05);
    const a = geo.getAttribute("position").array as Float32Array;
    // Collapse the first triangle to a point: three leaves its normals at exactly zero.
    for (let k = 3; k < 9; k++) a[k] = a[k % 3]!;
    geo.deleteAttribute("normal");
    expect(compare(geo)).toBeLessThan(1e-6);
  });

  it("when a few of a crushed body's vertices move after its normals were computed and only the normals near them are computed again, then every normal equals a full pass's to the bit", () => {
    const geo = makeChassisGeometry(CAR_STYLES.sedan);
    crumple(geo, 0.04);
    computeNormalsFast(geo);
    const pos = geo.getAttribute("position").array as Float32Array;
    // Lift a scattered few, as the tyre hold lifts a crushed arch's points.
    const moved: number[] = [];
    for (let v = 7; v < pos.length / 3; v += 53) {
      pos[v * 3 + 1]! += 0.013 + (v % 5) * 0.001;
      moved.push(v);
    }
    computeNormalsNear(geo, moved, moved.length);
    const near = Float32Array.from(geo.getAttribute("normal").array);
    computeNormalsFast(geo);
    const full = geo.getAttribute("normal").array as Float32Array;
    let differ = 0;
    for (let i = 0; i < full.length; i++) if (!Object.is(near[i], full[i])) differ++;
    expect(moved.length, "the control: vertices were moved").toBeGreaterThan(20);
    expect(geo.index, "the control: the body is indexed, so the partial pass runs (an unindexed one takes the full pass)").toBeTruthy();
    expect(differ, `${differ} normal components differ from the full pass`).toBe(0);
  });
});
