import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { hypot3 } from "../kernel/physics-core.js";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { buildCar } from "./drawn-body.test-util.ts";
import { restEdges, type RestEdges } from "./car-tyre-skin-edges.ts";
import { ROW_KEEP } from "./tyre-carried.ts";

const SPREAD = 0.5;

/** The rest edges as they were built before the hash and CSR rewrite: a string-keyed Map and an array per point. The reference the fast one must equal bit for bit. */
function referenceEdges(rest: Float32Array, index: THREE.BufferAttribute | null): RestEdges {
  const count = rest.length / 3;
  const weld = new Int32Array(count);
  const firstAt = new Map<string, number>();
  const points: number[] = [];
  for (let v = 0; v < count; v++) {
    const key = `${rest[v * 3]},${rest[v * 3 + 1]},${rest[v * 3 + 2]}`;
    const known = firstAt.get(key);
    if (known !== undefined) {
      weld[v] = known;
      continue;
    }
    weld[v] = points.length;
    firstAt.set(key, points.length);
    points.push(v);
  }
  const up: number[][] = points.map(() => []);
  const corners = index ? index.count : count;
  for (let t = 0; t + 2 < corners; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[index ? index.getX(t + k) : t + k]!;
      const b = weld[index ? index.getX(t + ((k + 1) % 3)) : t + ((k + 1) % 3)]!;
      const ya = rest[points[a]! * 3 + 1]!;
      const yb = rest[points[b]! * 3 + 1]!;
      if (ya < yb) up[a]!.push(b);
      else if (yb < ya) up[b]!.push(a);
    }
  }
  const order = Int32Array.from(points.keys()).sort((p, q) => rest[points[p]! * 3 + 1]! - rest[points[q]! * 3 + 1]!);
  const rank = new Int32Array(points.length);
  for (let k = 0; k < order.length; k++) rank[order[k]!] = k;
  for (let v = 0; v < count; v++) weld[v] = rank[weld[v]!]!;
  const start = new Int32Array(points.length + 1);
  for (let k = 0; k < order.length; k++) start[k + 1] = start[k]! + up[order[k]!]!.length;
  const to = new Int32Array(start[points.length]!);
  const drop = new Float32Array(to.length);
  for (let k = 0; k < order.length; k++) {
    const p = order[k]!;
    const from = points[p]! * 3;
    for (let e = 0; e < up[p]!.length; e++) {
      const q = up[p]![e]!;
      const at = points[q]! * 3;
      to[start[k]! + e] = rank[q]!;
      const rise = rest[at + 1]! - rest[from + 1]!;
      drop[start[k]! + e] = Math.max((1 - ROW_KEEP) * rise, SPREAD * hypot3(rest[at]! - rest[from]!, rise, rest[at + 2]! - rest[from + 2]!));
    }
  }
  return { weld, start, to, drop };
}

/** Each array of `got` against `want`, bit for bit (`Object.is`, so -0 is not 0). */
function expectSameEdges(got: RestEdges, want: RestEdges, label: string): void {
  for (const name of ["weld", "start", "to", "drop"] as const) {
    expect(got[name].length, `${label}: ${name} length`).toBe(want[name].length);
    expect(firstMismatch(Array.from(got[name], (x) => Object.is(x, -0) ? "-0" : x), Array.from(want[name], (x) => Object.is(x, -0) ? "-0" : x)), `${label}: ${name}`).toBeUndefined();
  }
}

describe("given the rest skin of a pickup's body", () => {
  // mutation: sed -i 's/^      } else if (yb < ya) {/      } else if (false) {/' src/game/vehicle/car-tyre-skin-edges.ts
  it("when its rest edges are built, then they equal the string-keyed reference's: weld, start, to and drop", () => {
    const car = buildCar("pickup", "truck");
    const mesh = car["body"] as THREE.Mesh;
    expectSameEdges(restEdges(car.deform.restSkin, mesh.geometry.index), referenceEdges(car.deform.restSkin, mesh.geometry.index), "pickup body");
  });
});

describe("given a small mesh with a point listed as 0 and as -0, copies of one position, and x-mirrored twins", () => {
  // mutation: sed -i 's/(x === 0 ? 0 : bits\[o\]!/(bits[o]!/' src/game/vehicle/car-tyre-skin-edges.ts
  it("when its rest edges are built, then they equal the reference's, and 0 and -0 are one point", () => {
    // Positions: [0, 0, 0] twice, [-0, 0, 0] (the same point), [1, 0.5, 2] and its mirror [-1, 0.5, 2], a level pair [1, 0.5, -2] / [-1, 0.5, -2], and a high point.
    const rest = Float32Array.of(0, 0, 0, 0, 0, 0, -0, 0, 0, 1, 0.5, 2, -1, 0.5, 2, 1, 0.5, -2, -1, 0.5, -2, 0, 1, 0, 1, 0.5, 2, 0, 0, -0);
    const index = new THREE.BufferAttribute(Uint16Array.of(0, 3, 7, 1, 4, 7, 2, 5, 6, 0, 3, 4, 8, 7, 4, 9, 3, 5, 3, 4, 5), 1);
    const got = restEdges(rest, index);
    expectSameEdges(got, referenceEdges(rest, index), "small mesh");
    expect(got.weld[0], "[0, 0, 0] and [-0, 0, 0] are one point").toBe(got.weld[2]);
    expect(got.weld[0], "[0, 0, 0] listed twice is one point").toBe(got.weld[1]);
    expect(got.weld[9], "[0, 0, -0] is that point too").toBe(got.weld[0]);
    expect(got.weld[3], "a point and its x-mirror are two").not.toBe(got.weld[4]);
    expect(got.weld[3], "a position listed twice is one point").toBe(got.weld[8]);
    expect(got.start.length - 1, "points").toBe(6);
  });
});
