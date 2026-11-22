import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { Place } from "./walk-graph.ts";

/** Grid cell side (m): about a rowhome lot's width, so a point's cell lists the few footprints round it (measured on the city: 3.3 on average, 8 at most, of 310). */
const CELL_M = 8;
/** Floats per footprint in `frame`: x, z, cos and sin of its yaw, half its depth and half its width, each grown by the margin. */
const STRIDE = 6;

/**
 * The footprints of the places inside the walls (`doorNode` >= 0), each grown by `margin` m, binned into a grid: `inside` tests only the
 * footprints whose cell holds the point, with the same arithmetic as a scan of every place, so it answers the same. Allocates nothing.
 */
export class PlaceFootprints {
  private readonly frame: Float64Array;
  private readonly cellStart: Int32Array;
  private readonly cellFootprint: Int32Array;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly columns: number;
  private readonly rows: number;

  constructor(places: readonly Place[], margin: number) {
    const inside = places.filter((place) => place.doorNode >= 0);
    this.frame = new Float64Array(inside.length * STRIDE);
    const reach = new Float64Array(inside.length);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let at = 0; at < inside.length; at++) {
      const place = inside[at]!;
      const o = at * STRIDE;
      this.frame[o] = place.x;
      this.frame[o + 1] = place.z;
      this.frame[o + 2] = detCos(place.yaw);
      this.frame[o + 3] = detSin(place.yaw);
      this.frame[o + 4] = place.depth / 2 + margin;
      this.frame[o + 5] = place.width / 2 + margin;
      reach[at] = hypot2(this.frame[o + 4]!, this.frame[o + 5]!);
      minX = Math.min(minX, place.x - reach[at]!);
      minZ = Math.min(minZ, place.z - reach[at]!);
      maxX = Math.max(maxX, place.x + reach[at]!);
      maxZ = Math.max(maxZ, place.z + reach[at]!);
    }
    this.minX = inside.length > 0 ? minX : 0;
    this.minZ = inside.length > 0 ? minZ : 0;
    this.columns = inside.length > 0 ? Math.floor((maxX - minX) / CELL_M) + 1 : 0;
    this.rows = inside.length > 0 ? Math.floor((maxZ - minZ) / CELL_M) + 1 : 0;
    const cells: number[][] = Array.from({ length: this.columns * this.rows }, () => []);
    for (let at = 0; at < inside.length; at++) {
      const x = this.frame[at * STRIDE]!;
      const z = this.frame[at * STRIDE + 1]!;
      const c0 = cellOf(x - reach[at]!, minX);
      const c1 = cellOf(x + reach[at]!, minX);
      const r0 = cellOf(z - reach[at]!, minZ);
      const r1 = cellOf(z + reach[at]!, minZ);
      for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) cells[row * this.columns + column]!.push(at);
    }
    this.cellStart = new Int32Array(cells.length + 1);
    for (let cell = 0; cell < cells.length; cell++) this.cellStart[cell + 1] = this.cellStart[cell]! + cells[cell]!.length;
    this.cellFootprint = Int32Array.from(cells.flat());
  }

  /** Whether point `at` of (`xs`, `zs`) lies within a grown footprint. The point is read here: a double handed to a call that is not inlined is boxed. */
  inside(xs: Float32Array, zs: Float32Array, at: number): boolean {
    const x = xs[at]!;
    const z = zs[at]!;
    if (x < this.minX || z < this.minZ) return false;
    // `cellOf`, written out: a call's double argument would be boxed.
    const column = ((x - this.minX) / CELL_M) | 0;
    const row = ((z - this.minZ) / CELL_M) | 0;
    if (column >= this.columns || row >= this.rows) return false;
    const cell = row * this.columns + column;
    const frame = this.frame;
    for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
      const o = this.cellFootprint[k]! * STRIDE;
      const dx = x - frame[o]!;
      const dz = z - frame[o + 1]!;
      const cos = frame[o + 2]!;
      const sin = frame[o + 3]!;
      if (Math.abs(dx * cos - dz * sin) < frame[o + 4]! && Math.abs(dx * sin + dz * cos) < frame[o + 5]!) return true;
    }
    return false;
  }
}

/** The grid cell along one axis of a coordinate at or past the grid's `min` (a truncation is its floor there). */
function cellOf(value: number, min: number): number {
  return ((value - min) / CELL_M) | 0;
}
