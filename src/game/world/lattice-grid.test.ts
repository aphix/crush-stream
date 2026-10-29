import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Ground } from "./ground.ts";

/**
 * A grid on a lattice (`GridSpec.lattice`, the track's terrain) reads the two triangles of each drawn cell, `SPAN` nodes a side with its
 * corners on the nodes that are `LATTICE_FROM` plus multiples of `SPAN`, split from the cell's (+u, 0) corner to its (0, +v) one; in a fine
 * cell it reads the two triangles of each unit cell, and a drawn cell that runs off the grid is read as its unit cell. The bounds the surface
 * store bakes per cell (`cellTops`, `cellNy`) hold at every point.
 */

const NODES = 8;
const SPAN = 2;
/** The nodes along each axis the drawn lattice starts at: the grid's first node is odd on the lattice, so its first unit cells run off it. */
const LATTICE_FROM = 1;
/** Rough ground (m): neighbouring nodes differ by about this much, so a bilinear blend and a triangle plane disagree by centimetres at least. */
const ROUGHNESS = 1.5;
/** Spacing (m) of the points a row reads inside the grid: not a multiple of the cell, so no point sits on a node or a diagonal. */
const PROBE_STEP = 0.0731;
/** How far (m) the ground's reading may lie from the triangle's plane: float64 arithmetic on float32 nodes. */
const PLANE_TOLERANCE = 1e-9;

function roughHeights(): Float32Array {
  return Float32Array.from({ length: NODES * NODES }, (_, k) => ROUGHNESS * Math.sin(k * 12.9898 + (k % 3)));
}

/** The first node of the raised side of the cliff ground, and its height (m): the drawn cell on its far side takes a slope its unit cells do not show. */
const CLIFF_AT = 4;
const CLIFF_HEIGHT = 5;

function cliffHeights(): Float32Array {
  return Float32Array.from({ length: NODES * NODES }, (_, k) => (k % NODES >= CLIFF_AT ? CLIFF_HEIGHT : 0));
}

/** Drawn cells (by index along u and v from the lattice's first) read as their four unit cells. */
type FineCells = readonly (readonly [number, number])[];

/** The node where the drawn cell holding unit cell `c` starts along one axis, or -1 where it runs off the grid. */
function drawnStart(c: number): number {
  const first = c - ((c - LATTICE_FROM + SPAN) % SPAN);
  return first < 0 || first + SPAN > NODES - 1 ? -1 : first;
}

/** The side in nodes (2: its drawn cell, 1: itself) of the triangle pair unit cell (`cellX`, `cellZ`) reads, and the first node of that cell. */
function drawnCell(fine: FineCells, cellX: number, cellZ: number): { side: number; firstX: number; firstZ: number } {
  const [startX, startZ] = [drawnStart(cellX), drawnStart(cellZ)];
  const wide = startX >= 0 && startZ >= 0 && !fine.some(([u, v]) => u === (startX - LATTICE_FROM) / SPAN && v === (startZ - LATTICE_FROM) / SPAN);
  return wide ? { side: SPAN, firstX: startX, firstZ: startZ } : { side: 1, firstX: cellX, firstZ: cellZ };
}

function latticeGround(heights: Float32Array, fine: FineCells): Ground {
  const ground = new Ground();
  const sides = Uint8Array.from({ length: (NODES - 1) * (NODES - 1) }, (_, c) => drawnCell(fine, c % (NODES - 1), Math.floor(c / (NODES - 1))).side);
  ground.addGrid({ nu: NODES, nv: NODES, step: 1, stepV: 1, u0: 0, v0: 0, heights, ox: 0, oy: 0, oz: 0, reach: Infinity, unbounded: true, lattice: { fromU: LATTICE_FROM, fromV: LATTICE_FROM, sides } });
  return ground;
}

/** The plane the drawn triangle holding (x, z) lies on, independent of the store: its height at the point and its slopes per metre along x and z. */
function expectedPlane(heights: Float32Array, fine: FineCells, x: number, z: number): { height: number; slopeX: number; slopeZ: number } {
  const { side, firstX, firstZ } = drawnCell(fine, Math.floor(x), Math.floor(z));
  const at = (i: number, j: number) => heights[j * NODES + i]!;
  const h00 = at(firstX, firstZ);
  const h10 = at(firstX + side, firstZ);
  const h01 = at(firstX, firstZ + side);
  const h11 = at(firstX + side, firstZ + side);
  const fu = (x - firstX) / side;
  const fv = (z - firstZ) / side;
  if (fu + fv <= 1) return { height: h00 + (h10 - h00) * fu + (h01 - h00) * fv, slopeX: (h10 - h00) / side, slopeZ: (h01 - h00) / side };
  return { height: h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv), slopeX: (h11 - h01) / side, slopeZ: (h11 - h10) / side };
}

/** Every probe point inside the grid, a unit cell clear of its edge nodes' far side so none is read off the grid. */
function probePoints(): [number, number][] {
  const points: [number, number][] = [];
  for (let z = PROBE_STEP; z < NODES - 1; z += PROBE_STEP) {
    for (let x = PROBE_STEP; x < NODES - 1; x += PROBE_STEP) points.push([x, z]);
  }
  return points;
}

const fields = [
  { name: "a rough 8 × 8 grid", heights: roughHeights(), fine: [] },
  { name: "an 8 × 8 grid with a 5 m cliff across its fifth column", heights: cliffHeights(), fine: [] },
  { name: "a rough 8 × 8 grid with three of its nine drawn cells fine", heights: roughHeights(), fine: [[0, 0], [1, 1], [2, 1]] },
  { name: "an 8 × 8 grid with a 5 m cliff across its fifth column, the cells on it fine", heights: cliffHeights(), fine: [[1, 0], [1, 1], [1, 2]] },
] as const satisfies readonly { name: string; heights: Float32Array; fine: FineCells }[];

for (const { name, heights, fine } of fields) {
  describe(`given ${name} whose drawn 2-node cells start at its second node`, () => {
    const ground = latticeGround(heights, fine);
    it("when it is read at points across the grid, then every height is the plane of the drawn triangle the point lies in, on both sides of the diagonal and in the unit cells at its edges", () => {
      let worst = 0;
      const points = probePoints();
      for (const [x, z] of points) worst = Math.max(worst, Math.abs(ground.heightAt(x, z) - expectedPlane(heights, fine, x, z).height));
      assert.ok(worst <= PLANE_TOLERANCE, `${worst} m from the triangle's plane over ${points.length} points`);
    });

    it("when its normal is read at points across the grid, then it is the normal of that triangle's plane", () => {
      const normal = { x: 0, y: 0, z: 0 };
      let worst = 0;
      for (const [x, z] of probePoints()) {
        const { slopeX, slopeZ } = expectedPlane(heights, fine, x, z);
        const length = Math.hypot(slopeX, 1, slopeZ);
        ground.normalAt(x, z, normal);
        worst = Math.max(worst, Math.abs(normal.x + slopeX / length), Math.abs(normal.y - 1 / length), Math.abs(normal.z + slopeZ / length));
      }
      assert.ok(worst <= PLANE_TOLERANCE, `${worst} off the plane's normal`);
    });

    it("when the baked cell bounds are read against every point, then no point stands above its cell's top or has a normal flatter than its cell's bound", () => {
      const [tops] = ground.cellTops;
      const [bounds] = ground.cellNy;
      const normal = { x: 0, y: 0, z: 0 };
      let aboveTop = 0;
      let steeperThanBound = 0;
      for (const [x, z] of probePoints()) {
        const cell = Math.floor(z) * (NODES - 1) + Math.floor(x);
        if (ground.heightAt(x, z) > tops![cell]!) aboveTop++;
        ground.normalAt(x, z, normal);
        if (normal.y * 255 < bounds![cell]!) steeperThanBound++;
      }
      assert.deepEqual({ aboveTop, steeperThanBound }, { aboveTop: 0, steeperThanBound: 0 });
    });
  });
}
