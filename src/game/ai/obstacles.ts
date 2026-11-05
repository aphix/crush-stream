import { detCos, detSin } from "../kernel/physics-core.js";
import type { PropCollider } from "../world/placements.ts";

/** Half width (m) of the swath a hunter keeps clear of solids, and the room a probe keeps from a solid's face. */
const SWATH = 1.6;
/** Metres between the probes along a heading (a palm is 3.8 m across with the swath). */
const PROBE_STEP = 2;
/** The compass step (rad) `way` tries headings at: a gap a car can drive out through is wider than this as seen from the target. */
const WAY_STEP = Math.PI / 12;

/** Obstacle grid cell (m). */
const CELL = 16;
/** A piece of a prop that starts higher than this (m) over the prop's foot is driven under (a tree's crown, a billboard's panel): a car's roofline is 1.36 m. */
const CLEARANCE = 1.38;

/** The course's solid props (`body: "solid"`) on a grid, the pieces of them a car meets (not a crown over its roof): is a point inside one, grown by the swath. */
export class Obstacles {
  private readonly cells = new Map<number, number[]>();
  private readonly x: Float64Array;
  private readonly z: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly hx: Float64Array;
  private readonly hz: Float64Array;
  private readonly circle: Uint8Array;

  constructor(colliders: readonly PropCollider[]) {
    const all = colliders.filter((c) => c.body === "solid");
    // A prop's foot is the lowest base among its pieces (they share an index).
    const foot = new Map<number, number>();
    for (const c of all) foot.set(c.index, Math.min(foot.get(c.index) ?? Infinity, c.base));
    const solid = all.filter((c) => c.base - foot.get(c.index)! < CLEARANCE);
    this.x = Float64Array.from(solid, (c) => c.x);
    this.z = Float64Array.from(solid, (c) => c.z);
    this.cos = Float64Array.from(solid, (c) => detCos(c.yaw));
    this.sin = Float64Array.from(solid, (c) => detSin(c.yaw));
    this.hx = Float64Array.from(solid, (c) => c.hx + SWATH);
    this.hz = Float64Array.from(solid, (c) => c.hz + SWATH);
    this.circle = Uint8Array.from(solid, (c) => (c.kind === "circle" ? 1 : 0));
    for (const [i, c] of solid.entries()) {
      const r = c.r + SWATH;
      for (let gx = Math.floor((c.x - r) / CELL); gx <= Math.floor((c.x + r) / CELL); gx++) {
        for (let gz = Math.floor((c.z - r) / CELL); gz <= Math.floor((c.z + r) / CELL); gz++) {
          const key = cellKey(gx, gz);
          const list = this.cells.get(key);
          if (list) list.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const i of list) {
      const ex = x - this.x[i]!;
      const ez = z - this.z[i]!;
      if (this.circle[i]) {
        if (ex * ex + ez * ez < this.hx[i]! * this.hx[i]!) return true;
        continue;
      }
      // The prop's frame: local x = (cos, −sin), local z = (sin, cos).
      const lx = ex * this.cos[i]! - ez * this.sin[i]!;
      const lz = ex * this.sin[i]! + ez * this.cos[i]!;
      if (Math.abs(lx) < this.hx[i]! && Math.abs(lz) < this.hz[i]!) return true;
    }
    return false;
  }

  /** Metres from (x, z) along heading `h` to the first solid (`len` when the way is clear that far). */
  run(x: number, z: number, h: number, len: number): number {
    const dx = detSin(h);
    const dz = detCos(h);
    for (let d = PROBE_STEP; d <= len; d += PROBE_STEP) if (this.blocked(x + dx * d, z + dz * d)) return d - PROBE_STEP;
    return len;
  }

  /** The middle of the arc of headings (steps of `WAY_STEP`) with `len` m clear of solids from (x, z), of the arc nearest `want`: the way out of a pocket, down its middle. With none clear, the longest run's heading. */
  way(x: number, z: number, want: number, len: number): number {
    const base = Math.round(want / WAY_STEP) * WAY_STEP;
    const half = Math.round(Math.PI / WAY_STEP);
    let best = 0;
    let longest = this.run(x, z, base, len);
    let found = longest >= len ? 0 : NaN;
    for (let k = 1; found !== found && k <= half; k++) {
      for (let s = -1; s <= 1; s += 2) {
        const run = this.run(x, z, base + s * k * WAY_STEP, len);
        if (run >= len) {
          found = s * k;
          break;
        }
        if (run > longest) {
          longest = run;
          best = s * k;
        }
      }
    }
    if (found !== found) return base + best * WAY_STEP;
    let lo = found;
    let hi = found;
    while (hi - lo + 1 < 2 * half && this.run(x, z, base + (lo - 1) * WAY_STEP, len) >= len) lo--;
    while (hi - lo + 1 < 2 * half && this.run(x, z, base + (hi + 1) * WAY_STEP, len) >= len) hi++;
    return hi - lo + 1 >= 2 * half ? base : base + ((lo + hi) / 2) * WAY_STEP;
  }
}

function cellKey(gx: number, gz: number): number {
  return (gx + 4096) * 8192 + (gz + 4096);
}
