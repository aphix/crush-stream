import { describe, expect, it } from "vitest";
import { cageOf } from "./car-cage-rig.ts";
import { carInState } from "./drawn-body.test-util.ts";
import { masksOf } from "./plan-field.test-util.ts";

/**
 * `planFieldOf` measures each node's squared distance to the nearest seed by a column pass of two sweeps and a row pass of
 * Felzenszwalb and Huttenlocher; the reference below is the full pass on both axes, which the sweeps must match bit for bit.
 */
const FAR2 = 1e12;

function transformLine(n: number, f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR2;
  z[1] = FAR2;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR2;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

function referencePlan(nu: number, nv: number, step: number, covered: Uint8Array): Float32Array {
  const n = nu * nv;
  const line = Math.max(nu, nv);
  const f = new Float64Array(line);
  const d = new Float64Array(line);
  const v = new Int32Array(line);
  const z = new Float64Array(line + 1);
  const grid = (g: Float64Array): void => {
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) f[j] = g[j * nu + i]!;
      transformLine(nv, f, d, v, z);
      for (let j = 0; j < nv; j++) g[j * nu + i] = d[j]!;
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) f[i] = g[j * nu + i]!;
      transformLine(nu, f, d, v, z);
      for (let i = 0; i < nu; i++) g[j * nu + i] = d[i]!;
    }
  };
  const toCovered = new Float64Array(n);
  const toUncovered = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const inside = covered[k] === 1;
    toCovered[k] = inside ? 0 : FAR2;
    toUncovered[k] = inside ? FAR2 : 0;
  }
  grid(toCovered);
  grid(toUncovered);
  const plan = new Float32Array(n);
  for (let k = 0; k < n; k++) plan[k] = covered[k] === 1 ? -(Math.sqrt(toUncovered[k]!) - 0.5) * step : (Math.sqrt(toCovered[k]!) - 0.5) * step;
  return plan;
}

describe("given a car's cage with its covered nodes set to each of many masks", () => {
  it("when the distance from each node to the nearest covered node is measured, then every node equals the full two-axis distance transform's to the bit", () => {
    const cage = cageOf(carInState("untouched", "sedan", "sedan"));
    const { nu, nv, step } = cage.style;
    const f = cage.fields;
    for (const { text, covered } of masksOf(nu, nv, step)) {
      f.covered.set(covered);
      f.planFresh = false;
      const plan = cage.planField();
      const want = referencePlan(nu, nv, step, covered);
      for (let k = 0; k < nu * nv; k++) expect(Object.is(plan[k], want[k]), `${text}: node ${k % nu},${Math.floor(k / nu)} is ${plan[k]}, not ${want[k]}`).toBeTruthy();
    }
  });
});
