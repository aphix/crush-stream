/**
 * The drawn terrain's cells on the ground's node grid: a 2 m cell is two triangles, or, where the shape needs it, four 1 m cells of two
 * triangles each (a fine cell). The ground reads these triangles and the mesher draws them, so the surface a car drives on is the one on screen.
 */

/** Nodes along a side of a drawn cell (nodes are 1 m apart, cells 2 m). */
export const TERRAIN_SPAN = 2;

/** A cell on the road's crease is fine when its triangles miss a node by more than this (m), however high the course's `fineMiss`: a miss shows there as a step against the crease's own cells (course-intrusion's bar is 0.05 m) or a terrain edge over the ribbon laid ROAD_LIFT over it. */
const SEAM_MISS = 0.015;

export type TerrainCells = {
  /** First node of a row and of a column on the lattice (0 or 1): the cells' corners lie on even world metres. */
  fromU: number;
  fromV: number;
  /** Cells across and down whose nine nodes all lie in the grid: those that can be fine. */
  cols: number;
  rows: number;
  /** Per such cell: how far (m) its two triangles pass one of its other five nodes. */
  miss: Float32Array;
  /** Per such cell: 1 where it is fine. */
  fine: Uint8Array;
  /** Per unit cell (row-major, `nx - 1` wide): the side in nodes of the triangle pair it reads, 2 (its drawn cell) or 1 (itself, in a fine cell or where its drawn cell runs off the grid). */
  sides: Uint8Array;
  /** The nodes' heights as drawn: the ground's, but where a fine cell borders a coarse one its edge's middle node lies on the coarse cell's edge, so both draw the same line. */
  drawn: Float32Array;
};

/** How far (m) the 2 m cell whose first node is `n` has a node off its two triangles (split from the (+u, 0) corner to the (0, +v) one). */
function miss(h: Float32Array, n: number, nx: number): number {
  const far = n + 2 * nx;
  const h00 = h[n]!;
  const h20 = h[n + 2]!;
  const h02 = h[far]!;
  const h22 = h[far + 2]!;
  let worst = 0;
  for (let dv = 0; dv <= 2; dv++) {
    for (let du = 0; du <= 2; du++) {
      if ((du === 0 || du === 2) && (dv === 0 || dv === 2)) continue;
      const fu = du / 2;
      const fv = dv / 2;
      const plane = fu + fv <= 1 ? h00 + (h20 - h00) * fu + (h02 - h00) * fv : h22 + (h02 - h22) * (1 - fu) + (h20 - h22) * (1 - fv);
      worst = Math.max(worst, Math.abs(h[n + dv * nx + du]! - plane));
    }
  }
  return worst;
}

/** Whether any of the nine nodes from `n` is on the road's crease (its `lat` set). */
function touchesCrease(lat: Float32Array, n: number, nx: number): boolean {
  if (lat.length === 0) return false;
  for (let dv = 0; dv <= 2; dv++) {
    for (let du = 0; du <= 2; du++) if (lat[n + dv * nx + du] === lat[n + dv * nx + du]) return true;
  }
  return false;
}

/**
 * The cells of a node grid `nx` × `nz`: a cell is fine when its two triangles miss one of its other five nodes by more than `fineMiss` (m), or by more than
 * `SEAM_MISS` where it touches the road's crease (`lat`, empty off a road).
 */
export function bakeTerrainCells(heights: Float32Array, lat: Float32Array, nx: number, nz: number, fromU: number, fromV: number, fineMiss: number): TerrainCells {
  const cols = Math.max(0, Math.floor((nx - 1 - fromU) / TERRAIN_SPAN));
  const rows = Math.max(0, Math.floor((nz - 1 - fromV) / TERRAIN_SPAN));
  const missOf = new Float32Array(cols * rows);
  const fine = new Uint8Array(cols * rows);
  const firstNode = (ci: number, cj: number) => (fromV + cj * TERRAIN_SPAN) * nx + fromU + ci * TERRAIN_SPAN;
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      const n = firstNode(ci, cj);
      const c = cj * cols + ci;
      missOf[c] = miss(heights, n, nx);
      fine[c] = missOf[c]! > (touchesCrease(lat, n, nx) ? Math.min(SEAM_MISS, fineMiss) : fineMiss) ? 1 : 0;
    }
  }
  const sides = new Uint8Array((nx - 1) * (nz - 1)).fill(1);
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      if (fine[cj * cols + ci]) continue;
      const first = fromV + cj * TERRAIN_SPAN;
      for (let v = 0; v < TERRAIN_SPAN; v++) sides.fill(TERRAIN_SPAN, (first + v) * (nx - 1) + fromU + ci * TERRAIN_SPAN, (first + v) * (nx - 1) + fromU + ci * TERRAIN_SPAN + TERRAIN_SPAN);
    }
  }
  const drawn = Float32Array.from(heights);
  const isFine = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < cols && cj < rows && fine[cj * cols + ci] === 1;
  for (let cj = 0; cj < rows; cj++) {
    for (let ci = 0; ci < cols; ci++) {
      if (!fine[cj * cols + ci]) continue;
      const n = firstNode(ci, cj);
      // The middle node of each edge shared with a coarse cell (or the grid's end) lies on that cell's edge: the mean of the edge's corners.
      if (!isFine(ci, cj - 1)) drawn[n + 1] = (heights[n]! + heights[n + 2]!) / 2;
      if (!isFine(ci, cj + 1)) drawn[n + 2 * nx + 1] = (heights[n + 2 * nx]! + heights[n + 2 * nx + 2]!) / 2;
      if (!isFine(ci - 1, cj)) drawn[n + nx] = (heights[n]! + heights[n + 2 * nx]!) / 2;
      if (!isFine(ci + 1, cj)) drawn[n + nx + 2] = (heights[n + 2]! + heights[n + 2 * nx + 2]!) / 2;
    }
  }
  return { fromU, fromV, cols, rows, miss: missOf, fine, sides, drawn };
}
