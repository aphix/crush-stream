import { describe, expect, it } from "vitest";
import { bakeTerrainCells } from "./terrain-cells.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * `bakeTerrainCells` on a flat 9 × 9 node grid (four drawn cells a side, their corners on the even nodes) with a few nodes raised: which cells are fine,
 * which triangle pair each unit cell reads, and where a fine cell's edge middle lies against a coarse cell and against a fine one.
 */

const NODES = 9;
const FINE_MISS = 0.1;
/** A miss over a cell's centre that the course's `fineMiss` catches, and one under it. */
const BUMP = 0.2;
const SMALL_BUMP = 0.09;
/** A miss over `SEAM_MISS` (0.015) and under `FINE_MISS`: a cell on the road's crease is fine for it, one off the road is not. */
const CREASE_BUMP = 0.03;

const node = (u: number, v: number) => v * NODES + u;

function flatWith(raised: readonly (readonly [number, number, number])[]): Float32Array {
  const h = new Float32Array(NODES * NODES);
  for (const [u, v, y] of raised) h[node(u, v)] = y;
  return h;
}

const noRoad = new Float32Array(0);
const bake = (heights: Float32Array, lat = noRoad) => bakeTerrainCells(heights, lat, NODES, NODES, 0, 0, FINE_MISS);

describe("given a flat grid with the centre node of its first drawn cell raised over the course's fineMiss", () => {
  const cells = bake(flatWith([[1, 1, BUMP]]));

  it("when its cells are baked, then only that cell is fine", () => {
    expect(firstMismatch(Array.from(cells.fine), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeUndefined();
  });

  it("when its unit cells are baked, then the four in the fine cell read themselves (side 1) and every other reads its drawn cell (side 2)", () => {
    const sides = Array.from({ length: NODES - 1 }, (_, v) => Array.from({ length: NODES - 1 }, (_, u) => cells.sides[v * (NODES - 1) + u]));
    expect(firstMismatch(sides.map((row) => row.join("")), ["11222222", "11222222", "22222222", "22222222", "22222222", "22222222", "22222222", "22222222"])).toBeUndefined();
  });
});

describe("given a fine drawn cell beside a coarse one whose shared edge's middle node is raised under fineMiss", () => {
  const heights = flatWith([[1, 1, BUMP], [2, 1, SMALL_BUMP]]);
  const cells = bake(heights);

  it("when it is baked, then the edge's middle node is drawn on the coarse cell's edge, the mean of the edge's corners, and the fine cell's centre as it is", () => {
    expect(cells.fine[1], "the neighbour is coarse").toBe(0);
    expect(cells.drawn[node(2, 1)]).toBe(0);
    expect(cells.drawn[node(1, 1)]).toBe(Math.fround(BUMP));
  });

  it("when the neighbour is fine too, then the edge's middle node keeps its own height", () => {
    const both = bake(flatWith([[1, 1, BUMP], [3, 1, BUMP], [2, 1, SMALL_BUMP]]));
    expect(firstMismatch(Array.from(both.fine.slice(0, 2)), [1, 1])).toBeUndefined();
    expect(both.drawn[node(2, 1)]).toBe(Math.fround(SMALL_BUMP));
  });
});

describe("given a cell with a miss over the seam's limit and under fineMiss", () => {
  const heights = flatWith([[5, 1, CREASE_BUMP]]);

  it("when it is off the road, then it is coarse", () => {
    expect(bake(heights).fine[2]).toBe(0);
  });

  it("when one of its nodes is on the road's crease, then it is fine", () => {
    const lat = new Float32Array(NODES * NODES).fill(NaN);
    lat[node(4, 0)] = 0.9;
    expect(bake(heights, lat).fine[2]).toBe(1);
  });
});
