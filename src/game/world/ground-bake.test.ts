import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Ground } from "./ground.ts";
import { activate, BAKE, C_ARG, C_H, C_NY, C_OWNER, HIT_SIZE, KNOCK, pointContact, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "./surfaces.ts";

/**
 * The ground bake answers every point query as the layered path it replaces does, to the bit: the index cell that lists prisms besides the one always-tested plain grid
 * (`PLAIN_LISTED`), and a far point's answer without its normal (`farOnPlain`, from the cell's baked bound on the normal's y). Both are held to the layered path (`BAKE.on` false)
 * over a sloped grid with a prism whose top ties the grid's height, a knockable prop, and prisms changed after the seal (disabled, moved).
 */

const N = 40;
const SLOPE = 0.9;
/** Grid cells (m) and the tie: the flat shelf at this height is a grid plateau, and the prism's top is exactly this height. */
const SHELF = 0.5;
const GAP = 0.0002;
/** A prop's top over the shelf (m): well above any height the lattice asks from, so a point over it is answered by the prism where it answers at all. */
const PROP_TOP = 3;

/** A grid whose left part is flat at `SHELF` and right part a steep ramp up (and a NaN node), a prism box on the shelf with its top at the shelf's height (an equal-height tie), a knockable prop, an ordinary one and a third that `moves` after the seal (or not), and 10 filler prisms so the store is cell-indexed. */
function ground(moves = false): { g: Ground; knock: number; ordinary: number; mover: number } {
  const g = new Ground();
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = i < 14 ? SHELF : SHELF + (i - 14) * SLOPE + 0.1 * Math.sin(j);
  heights[5 * N + 30] = NaN;
  g.addGrid({ nu: N, nv: N, step: 1, stepV: 1, u0: 0, v0: 0, heights, ox: 0, oy: 0, oz: 0, reach: Infinity, unbounded: true });
  g.addPrism({ x: 6, z: 6, yaw: 0.3, hx: 2, hz: 1.5, base: -5, top: SHELF, id: 0 });
  const knock = g.addPrism({ x: 10, z: 10, yaw: 0, hx: 1.5, hz: 1.5, base: -5, top: PROP_TOP, id: 11, role: KNOCK });
  const ordinary = g.addPrism({ x: 4, z: 12, yaw: 0, hx: 1.5, hz: 1.5, base: -5, top: PROP_TOP, id: 12 });
  const mover = g.addPrism({ x: 12, z: 4, yaw: 0, hx: 1.5, hz: 1.5, base: -5, top: PROP_TOP, id: 13, moves });
  for (let k = 1; k <= 10; k++) g.addPrism({ x: 20 + 3 * k, z: 30, yaw: 0, hx: 1, hz: 1, base: -5, top: 3, id: 20 + k });
  g.seal();
  return { g, knock, ordinary, mover };
}

function ask(q: Float64Array, travel2: number): { far: boolean; out: Float64Array } {
  const out = new Float64Array(HIT_SIZE);
  return { far: pointContact(q, -1, out, travel2, GAP), out };
}

/** Every point of a 1.13 m lattice at several heights and travels asked with the bake on and off: each answer the same bits, and a far one's travel under its height along the live normal. Returns the far and whole answers seen. */
function sweep(g: Ground): { far: number; whole: number; byProp: number } {
  let far = 0;
  let whole = 0;
  let byProp = 0;
  activate(g);
  try {
    const q = new Float64Array(PQ_SIZE);
    for (let x = -1; x < N + 1; x += 1.13) {
      for (let z = -1; z < N + 1; z += 1.13) {
        for (const dy of [-0.3, -0.0001, 0, 0.0001, 0.0003, 0.01, 0.05, 0.1, 0.2, 2]) {
          for (const travel2 of [NaN, -1, 0, 1e-6, 1e-3, 4e-4, 2.5e-3, 0.01, 0.0225, 0.04]) {
            q[PQ_X] = x;
            q[PQ_Z] = z;
            q[PQ_Y] = g.heightAt(x, z) + dy;
            BAKE.on = false;
            const live = ask(q, travel2);
            BAKE.on = true;
            const baked = ask(q, travel2);
            assert.equal(live.far, false, "the layered path never answers far");
            if (live.out[C_H]! >= PROP_TOP - 1e-9) byProp++;
            if (!baked.far) {
              whole++;
              for (let k = 0; k < HIT_SIZE; k++) assert.ok(Object.is(baked.out[k], live.out[k]), `entry ${k} at ${x}, ${z}, +${dy}: baked ${baked.out[k]} live ${live.out[k]}`);
              continue;
            }
            far++;
            for (const k of [C_H, C_OWNER, C_ARG]) assert.ok(Object.is(baked.out[k], live.out[k]), `far entry ${k} at ${x}, ${z}, +${dy}`);
            const height = live.out[C_H]! - q[PQ_Y]!;
            assert.ok(height < -GAP, "a far point is more than the gap above");
            if (travel2 >= 0) assert.ok(Math.sqrt(travel2) < -height * live.out[C_NY]!, `travel ${Math.sqrt(travel2)} reaches height ${-height} along the normal ${live.out[C_NY]}`);
          }
        }
      }
    }
  } finally {
    BAKE.on = true;
    activate(null);
  }
  return { far, whole, byProp };
}

describe("given a sloped grid with a tying prism, a knockable prop, a movable prop, filler prisms and a NaN node", () => {
  it("when every point of the lattice is asked with the bake on and off, then each answer is the same bits, and both far and whole answers occur", () => {
    const { far, whole, byProp } = sweep(ground().g);
    assert.ok(far > 1000 && whole > 1000, `both kinds of answer are exercised (far ${far}, whole ${whole})`);
    assert.ok(byProp > 100, `points are answered by an ordinary prop's top (${byProp})`);
  });

  it("when a knockable prop is in the cell, then a point over it is answered the grid's, as a knockable prop never answers a point query, baked and live alike", () => {
    const { g } = ground();
    activate(g);
    try {
      const q = new Float64Array(PQ_SIZE);
      q[PQ_X] = 10;
      q[PQ_Z] = 10;
      q[PQ_Y] = 5;
      BAKE.on = false;
      const live = ask(q, NaN);
      BAKE.on = true;
      const baked = ask(q, NaN);
      assert.ok(Object.is(baked.out[C_H], live.out[C_H]), "baked and live agree");
      assert.equal(baked.out[C_H], g.heightAt(10, 10), "the grid's height, not the prop's top");
    } finally {
      BAKE.on = true;
      activate(null);
    }
  });

  it("when a prop is disabled and another moved after the seal, then every answer is still the layered path's, the moved prop's new place included", () => {
    const { g, ordinary, mover } = ground(true);
    activate(g);
    g.disable(ordinary);
    g.movePrism(mover, 8, 20, 0, 0, 0);
    const { whole, byProp } = sweep(g);
    assert.ok(whole > 1000 && byProp > 100, `the moved prop is among the answers (whole ${whole}, by a prop ${byProp})`);
    activate(g);
    try {
      const q = new Float64Array(PQ_SIZE);
      q[PQ_X] = 8;
      q[PQ_Z] = 20;
      q[PQ_Y] = 5;
      assert.equal(ask(q, NaN).out[C_H], PROP_TOP, "a point over the moved prop's new place is answered its top");
      q[PQ_X] = 12;
      q[PQ_Z] = 4;
      assert.notEqual(ask(q, NaN).out[C_H], PROP_TOP, "and none over the old place");
    } finally {
      activate(null);
    }
  });
});
