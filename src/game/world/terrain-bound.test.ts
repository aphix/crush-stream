import { describe, expect, it } from "vitest";
import { Ground } from "./ground.ts";
import { BAKE, staticTop } from "./surfaces.ts";

/**
 * The static bound over a plan box (`staticTop`) off the baked grid is the base terrain's gaussian hills at the box's nearest point to each hill's centre (`hillsTop`), never under the terrain's
 * height anywhere in the box, and far under the old bound (every hill's whole height) for a box far from every hill.
 */

const N = 8;
/** Hills (x, z, height, radius each): one at the grid's corner, one 300 m off it, one a pit (a negative height adds nothing to a bound). */
const HILLS = Float64Array.from([2, 2, 4, 30, 300, -200, 9, 50, -40, 10, -5, 20]);
const FAR = 2000;

function terrain(): Ground {
  const g = new Ground();
  g.addGrid({ nu: N, nv: N, step: 1, stepV: 1, u0: 0, v0: 0, heights: new Float32Array(N * N), ox: 0, oy: 0, oz: 0, reach: Infinity, surface: 0, outside: { surface: 0, hills: HILLS }, unbounded: true });
  g.seal();
  return g;
}

describe("given a grid with gaussian hills past its edge", () => {
  it("when boxes of several sizes are bounded all over and past the grid, then each bound is no lower than the terrain at any sampled point of the box, however far the hills", () => {
    const g = terrain();
    let worst = Infinity;
    for (let x = -400; x < 500; x += 13.7) {
      for (let z = -400; z < 500; z += 11.3) {
        for (const half of [0, 0.05, 0.5, 3, 40]) {
          const top = staticTop(g, x - half, x + half, z - half, z + half);
          for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0], [0.5, -0.3]] as const) {
            const h = g.heightAt(x + dx * half, z + dz * half);
            worst = Math.min(worst, top - h);
            expect(top, `bound ${top} under the terrain ${h} at ${x + dx * half}, ${z + dz * half} (box half ${half})`).toBeGreaterThanOrEqual(h);
          }
        }
      }
    }
    expect(worst >= 0 && worst < 1e-3, `the bound is tight somewhere (least slack ${worst})`).toBeTruthy();
  });

  it("when a box lies far from every hill, then the bound is far under the sum of the hills' heights, and with the bake off it is that sum", () => {
    const g = terrain();
    const sum = 4 + 9;
    expect(staticTop(g, FAR, FAR + 1, FAR, FAR + 1), "the terrain 2 km from every hill is flat to a micrometre").toBeLessThan(1e-6);
    BAKE.on = false;
    try {
      const g2 = terrain();
      expect(staticTop(g2, FAR, FAR + 1, FAR, FAR + 1), "with the bake off the bound is the hills' whole height").toBeGreaterThanOrEqual(sum);
    } finally {
      BAKE.on = true;
    }
  });
});
