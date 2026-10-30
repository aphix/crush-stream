/** Face order in a layout's `faces` and in the shader's `sprayFaces`. */
export const SPRAY_FACE = { left: 0, right: 1, top: 2, front: 3, back: 4 } as const;

/** A face's texels: x, y (from the bitmap's first row), width, height. */
type Face = readonly [number, number, number, number];
/** A bitmap's size, the rest-frame box it wraps (m) and its five faces (in `SPRAY_FACE` order). */
export type SprayLayout = { readonly w: number; readonly h: number; readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number]; readonly faces: readonly Face[] };

/** The faces are packed on a square grid this many cells a side; a bitmap of any side scales the grid, so every size wraps the box alike. */
const GRID = 128;
/** Bitmap side (texels): two a grid cell, 256 x 256. A save from when it was one a cell loads doubled (`PlayerLooks`). */
export const SPRAY_SIDE = 2 * GRID;

/** A layout `side` texels square round the box `min`..`max`, its `faces` given in grid cells. */
export function gridLayout(side: number, min: SprayLayout["min"], max: SprayLayout["max"], faces: readonly Face[]): SprayLayout {
  const k = side / GRID;
  return { w: side, h: side, min, max, faces: faces.map(([x, y, w, h]) => [x * k, y * k, w * k, h * k] as const) };
}

/** A car in its own frame (+z forward, y up from the tyre plane), `side` texels square: in grid cells, sides 128 x 30, roof 128 x 40, nose and tail 64 x 28. */
export function carSprayLayout(side: number): SprayLayout {
  const half = GRID / 2;
  return gridLayout(side, [-0.95, 0, -2.35], [0.95, 1.6, 2.35], [
    [0, 0, GRID, 30],
    [0, 30, GRID, 30],
    [0, 60, GRID, 40],
    [0, 100, half, 28],
    [half, 100, half, 28],
  ]);
}

export const CAR_SPRAY = carSprayLayout(SPRAY_SIDE);

/**
 * The face (`SPRAY_FACE`) rest point (px, py, pz) with normal (nx, ny, nz) is painted on, and its place across that face
 * (0..1 each) into `uv`; -1 for the underside, which takes no paint. The shader's `sprayTexel` is this, line for line.
 */
export function sprayFace(layout: SprayLayout, px: number, py: number, pz: number, nx: number, ny: number, nz: number, uv: Float64Array): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const face = ax >= ay && ax >= az ? (nx < 0 ? SPRAY_FACE.left : SPRAY_FACE.right) : ay >= az ? (ny < 0 ? -1 : SPRAY_FACE.top) : nz > 0 ? SPRAY_FACE.front : SPRAY_FACE.back;
  if (face >= 0) sprayPlace(layout, face, px, py, pz, uv);
  return face;
}

/**
 * The rest point (px, py, pz)'s place across `face` (0..1 each) into `uv`, and its depth: how far out along the face's axis it
 * lies in the layout's box (0..1, the face's own side being 1). The shader's `sprayTexel` is this, line for line.
 */
export function sprayPlace(layout: SprayLayout, face: number, px: number, py: number, pz: number, uv: Float64Array): number {
  const tx = across(px, layout.min[0], layout.max[0]);
  const ty = across(py, layout.min[1], layout.max[1]);
  const tz = across(pz, layout.min[2], layout.max[2]);
  if (face === SPRAY_FACE.left || face === SPRAY_FACE.right) {
    uv[0] = tz;
    uv[1] = ty;
    return face === SPRAY_FACE.left ? 1 - tx : tx;
  }
  if (face === SPRAY_FACE.top) {
    uv[0] = tz;
    uv[1] = tx;
    return ty;
  }
  uv[0] = tx;
  uv[1] = ty;
  return face === SPRAY_FACE.front ? tz : 1 - tz;
}

function across(v: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}
