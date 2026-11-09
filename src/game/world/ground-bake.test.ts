import { describe, expect, it } from "vitest";
import { Ground } from "./ground.ts";
import { activate, BAKE, C_ARG, C_H, C_NY, C_OWNER, HIT_SIZE, KNOCK, pointContact, PQ_SIZE, PQ_X, PQ_Y, PQ_Z } from "./surfaces.ts";
import { Misses } from "../kernel/misses.test-util.ts";

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

const HEIGHTS_OVER_GROUND = [-0.3, -0.0001, 0, 0.0001, 0.0003, 0.01, 0.05, 0.1, 0.2, 2];
const TRAVELS_SQUARED = [NaN, -1, 0, 1e-6, 1e-3, 4e-4, 2.5e-3, 0.01, 0.0225, 0.04];
/** The entries a far answer carries. */
const FAR_ENTRIES = [C_H, C_OWNER, C_ARG];

/** Every point of a 1.13 m lattice at several heights and travels asked with the bake on and off: each answer the same bits, and a far one's travel under its height along the live normal. Returns the far and whole answers seen. */
function sweep(g: Ground): { far: number; whole: number; byProp: number } {
  let far = 0;
  let whole = 0;
  let byProp = 0;
  const misses = new Misses();
  activate(g);
  try {
    const q = new Float64Array(PQ_SIZE);
    for (let x = -1; x < N + 1; x += 1.13) {
      for (let z = -1; z < N + 1; z += 1.13) {
        for (const dy of HEIGHTS_OVER_GROUND) {
          for (const travel2 of TRAVELS_SQUARED) {
            q[PQ_X] = x;
            q[PQ_Z] = z;
            q[PQ_Y] = g.heightAt(x, z) + dy;
            BAKE.on = false;
            const live = ask(q, travel2);
            BAKE.on = true;
            const baked = ask(q, travel2);
            if (live.far) misses.note(`the layered path answers far at ${x}, ${z}, +${dy}, travel² ${travel2}`);
            if (live.out[C_H]! >= PROP_TOP - 1e-9) byProp++;
            if (!baked.far) {
              whole++;
              for (let k = 0; k < HIT_SIZE; k++) {
                if (!Object.is(baked.out[k], live.out[k])) misses.note(`entry ${k} at ${x}, ${z}, +${dy}: baked ${baked.out[k]} live ${live.out[k]}`);
              }
              continue;
            }
            far++;
            for (const k of FAR_ENTRIES) {
              if (!Object.is(baked.out[k], live.out[k])) misses.note(`far entry ${k} at ${x}, ${z}, +${dy}: baked ${baked.out[k]} live ${live.out[k]}`);
            }
            const height = live.out[C_H]! - q[PQ_Y]!;
            if (!(height < -GAP)) misses.note(`a far point at ${x}, ${z}, +${dy} is ${-height} above the cell, not more than the gap ${GAP}`);
            if (travel2 >= 0 && !(Math.sqrt(travel2) < -height * live.out[C_NY]!)) {
              misses.note(`travel ${Math.sqrt(travel2)} at ${x}, ${z}, +${dy} reaches height ${-height} along the normal ${live.out[C_NY]}`);
            }
          }
        }
      }
    }
  } finally {
    BAKE.on = true;
    activate(null);
  }
  expect(misses.count, misses.report("every lattice answer is the layered path's, bit for bit, and a far one is out of its travel's reach along the normal")).toBe(0);
  return { far, whole, byProp };
}

describe("given a sloped grid with a tying prism, a knockable prop, a movable prop, filler prisms and a NaN node", () => {
  // mutation: sed -i 's/out\[C_OWNER\] = -1;/out[C_OWNER] = -2;/' src/game/world/surfaces.ts  (a far answer's owner differs from the layered path's)
  // mutation: sed -i 's/if (!(travel2 \* (1 + NY_MARGIN) < pen \* pen \* ny \* ny)) return false;/if (false) return false;/' src/game/world/surfaces.ts  (a far answer's travel reaches its height along the normal)
  it("when every point of the lattice is asked with the bake on and off, then each answer is the same bits, and both far and whole answers occur", () => {
    const { far, whole, byProp } = sweep(ground().g);
    expect(far > 1000 && whole > 1000, `both kinds of answer are exercised (far ${far}, whole ${whole})`).toBeTruthy();
    expect(byProp, `points are answered by an ordinary prop's top (${byProp})`).toBeGreaterThan(100);
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
      expect(Object.is(baked.out[C_H], live.out[C_H]), "baked and live agree").toBeTruthy();
      expect(baked.out[C_H], "the grid's height, not the prop's top").toBe(g.heightAt(10, 10));
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
    expect(whole > 1000 && byProp > 100, `the moved prop is among the answers (whole ${whole}, by a prop ${byProp})`).toBeTruthy();
    activate(g);
    try {
      const q = new Float64Array(PQ_SIZE);
      q[PQ_X] = 8;
      q[PQ_Z] = 20;
      q[PQ_Y] = 5;
      expect(ask(q, NaN).out[C_H], "a point over the moved prop's new place is answered its top").toBe(PROP_TOP);
      q[PQ_X] = 12;
      q[PQ_Z] = 4;
      expect(ask(q, NaN).out[C_H], "and none over the old place").not.toBe(PROP_TOP);
    } finally {
      activate(null);
    }
  });
});
