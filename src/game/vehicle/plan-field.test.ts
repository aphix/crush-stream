import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cageOf } from "./car-cage-rig.ts";
import { carInState } from "./drawn-body.test-util.ts";

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

function masksOf(nu: number, nv: number, step: number): { text: string; covered: Uint8Array }[] {
  const n = nu * nv;
  const masks: { text: string; covered: Uint8Array }[] = [
    { text: "empty", covered: new Uint8Array(n) },
    { text: "full", covered: new Uint8Array(n).fill(1) },
  ];
  const single = new Uint8Array(n);
  single[Math.floor(nv / 2) * nu + Math.floor(nu / 2)] = 1;
  masks.push({ text: "one node", covered: single });
  const hole = new Uint8Array(n).fill(1);
  hole[Math.floor(nv / 2) * nu + Math.floor(nu / 2)] = 0;
  masks.push({ text: "one hole", covered: hole });
  const corner = new Uint8Array(n);
  corner[n - 1] = 1;
  masks.push({ text: "last node", covered: corner });
  const column = new Uint8Array(n);
  for (let j = 0; j < nv; j++) column[j * nu + 3] = 1;
  masks.push({ text: "one column", covered: column });
  const rows = new Uint8Array(n);
  for (let j = 0; j < nv; j += 7) for (let i = 0; i < nu; i++) rows[j * nu + i] = 1;
  masks.push({ text: "every seventh row", covered: rows });
  const ends = new Uint8Array(n);
  for (let i = 0; i < nu; i++) {
    ends[i] = 1;
    ends[(nv - 1) * nu + i] = 1;
  }
  masks.push({ text: "first and last row", covered: ends });
  for (let seed = 1; seed <= 60; seed++) {
    let r = seed;
    const rnd = (): number => (r = (r * 1103515245 + 12345) >>> 0) / 4294967296;
    const covered = new Uint8Array(n);
    const hx = 0.7 + 0.25 * rnd();
    const hz = 1.8 + 0.35 * rnd();
    const cr = 0.1 + 0.3 * rnd();
    const notch = 0.6 * rnd() * 0.5;
    const notchWidth = 0.2 * rnd();
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const x = (i - (nu - 1) / 2) * step;
        const zz = (j - (nv - 1) / 2) * step;
        const qx = Math.max(0, Math.abs(x) - (hx - cr));
        const qz = Math.max(0, Math.abs(zz) - (hz - cr));
        if (Math.hypot(qx, qz) <= cr && !(zz > hz - notch && Math.abs(x) < notchWidth)) covered[j * nu + i] = 1;
      }
    }
    masks.push({ text: `car-like ${seed}`, covered });
  }
  for (let seed = 1; seed <= 40; seed++) {
    let r = seed * 7919;
    const p = (seed % 10) / 10;
    const covered = new Uint8Array(n);
    for (let k = 0; k < n; k++) covered[k] = (r = (r * 1103515245 + 12345) >>> 0) / 4294967296 < p ? 1 : 0;
    masks.push({ text: `random ${seed} at ${p}`, covered });
  }
  return masks;
}

describe("given a cage whose covered nodes are set to a mask", () => {
  it("when its plan field is read, then every node equals the full two-axis distance transform's to the bit", () => {
    const cage = cageOf(carInState("untouched", "sedan", "sedan"));
    const { nu, nv, step } = cage.style;
    const f = cage.fields;
    for (const { text, covered } of masksOf(nu, nv, step)) {
      f.covered.set(covered);
      f.planFresh = false;
      const plan = cage.planField();
      const want = referencePlan(nu, nv, step, covered);
      for (let k = 0; k < nu * nv; k++) assert.ok(Object.is(plan[k], want[k]), `${text}: node ${k % nu},${Math.floor(k / nu)} is ${plan[k]}, not ${want[k]}`);
    }
  });
});
