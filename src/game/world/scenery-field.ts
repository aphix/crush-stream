import { hypot2 } from "../kernel/physics-core.js";
import { SURFACE_IDS } from "./catalog.ts";
import { defaultBiome, BIOME_INDEX } from "./scenery-biome.ts";
import { openNear, type Track, type TrackPath } from "./track.ts";

/**
 * What the scenery service reads of a course, built once: every road segment of every path in a coarse grid (distance to the road
 * and its wall line, which side's wall is down, bridge and tunnel, the stretch's biome) and the footprints already standing
 * (hand props, `along` rows, scatter, then what the service itself has placed).
 */

/** Edge (m) of a road-field cell: a query reads the 3 × 3 cells round a point, so every centreline within this of it is found. */
const FIELD_CELL = 96;
/** Edge (m) of an occupancy cell. */
const OCC_CELL = 8;
/** A footprint is entered into every cell within this far (m) of its bounding circle, so a circle of up to this radius (with its margin) finds it from its own cell alone. */
export const OCC_PAD = 6;
/** Offset keeping a cell's integer coordinates positive in its map key (±32768 cells either way). */
const CELL_BIAS = 32768;
/** Cell-key stride (the bias's two). */
const CELL_STRIDE = 65536;

/** Segment flag: on a bridge span (nothing stands beside it) or under a tunnel roof. */
export const SEG_COVERED = 1;
/** Segment flag bits: the left / right wall is down within `OPEN_SPAN` of the segment (a car can leave the road there). */
const SEG_OPEN_L = 2;
const SEG_OPEN_R = 4;

/** A 32-bit mix of two integers (murmur finaliser): every random number of the service is `unit(mix(...))`, so a point's value depends on its own key alone. */
export function mix(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b + 0x7f4a7c15, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `h` (a `mix`) as a number in [0, 1). */
export function unit(h: number): number {
  return h / 4294967296;
}

/** FNV-1a of a string, for the course id. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function cellKey(i: number, j: number): number {
  return (i + CELL_BIAS) * CELL_STRIDE + (j + CELL_BIAS);
}

export type RoadField = {
  /** Per path (`Track.paths()` order): index of its first segment. */
  readonly base: Int32Array;
  readonly paths: readonly TrackPath[];
  readonly ax: Float64Array;
  readonly az: Float64Array;
  readonly ex: Float64Array;
  readonly ez: Float64Array;
  readonly len: Float64Array;
  /** Half width + run-off on the left and on the right: the wall line's distance from the centreline. */
  readonly wl: Float64Array;
  readonly wr: Float64Array;
  /** Owning path and sample index of each segment. */
  readonly path: Uint16Array;
  readonly sample: Int32Array;
  readonly flags: Uint8Array;
  /** `BIOME_IDS` index the stretch's terrain and surfaces classify as. */
  readonly biome: Uint8Array;
  readonly cells: Map<number, number[]>;
};

/** Every segment of every path: the loop, the shortcuts and the traffic routes. */
export function buildField(track: Track): RoadField {
  const paths = track.paths();
  const base = new Int32Array(paths.length + 1);
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi]!;
    base[pi + 1] = base[pi]! + (p.closed ? p.count : p.count - 1);
  }
  const n = base[paths.length]!;
  const f = {
    base,
    paths,
    ax: new Float64Array(n),
    az: new Float64Array(n),
    ex: new Float64Array(n),
    ez: new Float64Array(n),
    len: new Float64Array(n),
    wl: new Float64Array(n),
    wr: new Float64Array(n),
    path: new Uint16Array(n),
    sample: new Int32Array(n),
    flags: new Uint8Array(n),
    biome: new Uint8Array(n),
    cells: new Map<number, number[]>(),
  };
  const terrain = track.json.environment.terrain;
  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi]!;
    for (let k = 0; k < base[pi + 1]! - base[pi]!; k++) {
      const s = base[pi]! + k;
      const b = (k + 1) % p.count;
      f.ax[s] = p.x[k]!;
      f.az[s] = p.z[k]!;
      f.ex[s] = p.x[b]! - p.x[k]!;
      f.ez[s] = p.z[b]! - p.z[k]!;
      f.len[s] = hypot2(f.ex[s]!, f.ez[s]!);
      f.wl[s] = p.half[k]! + p.runL[k]!;
      f.wr[s] = p.half[k]! + p.runR[k]!;
      f.path[s] = pi;
      f.sample[s] = k;
      f.flags[s] = (p.deck[k] || p.tunnel[k] ? SEG_COVERED : 0) | (openNear(p, p.wallL, k) ? SEG_OPEN_L : 0) | (openNear(p, p.wallR, k) ? SEG_OPEN_R : 0);
      f.biome[s] = BIOME_INDEX[defaultBiome(terrain, SURFACE_IDS[p.surface[k]]!, SURFACE_IDS[p.runSurface[k]]!)]!;
      const x0 = Math.min(f.ax[s]!, f.ax[s]! + f.ex[s]!);
      const x1 = Math.max(f.ax[s]!, f.ax[s]! + f.ex[s]!);
      const z0 = Math.min(f.az[s]!, f.az[s]! + f.ez[s]!);
      const z1 = Math.max(f.az[s]!, f.az[s]! + f.ez[s]!);
      for (let i = Math.floor(x0 / FIELD_CELL); i <= Math.floor(x1 / FIELD_CELL); i++) {
        for (let j = Math.floor(z0 / FIELD_CELL); j <= Math.floor(z1 / FIELD_CELL); j++) {
          const key = cellKey(i, j);
          const list = f.cells.get(key);
          if (list) list.push(s);
          else f.cells.set(key, [s]);
        }
      }
    }
  }
  return f;
}

/**
 * The road nearest a point: the least wall-line gap (< 0 on a road or its run-off) and the segment and side it is on, the least
 * gap to an edge whose wall is down (`openGap`: where a car can leave the road), and the least centreline distance.
 */
export type Near = { gap: number; seg: number; dc: number; openGap: number };

export function blankNear(): Near {
  return { gap: Infinity, seg: -1, dc: Infinity, openGap: Infinity };
}

/** Fill `out` for (x, z); `seg` is -1 when no road lies within `FIELD_CELL`. */
export function nearest(f: RoadField, x: number, z: number, out: Near): Near {
  out.gap = Infinity;
  out.openGap = Infinity;
  out.dc = Infinity;
  out.seg = -1;
  const ci = Math.floor(x / FIELD_CELL);
  const cj = Math.floor(z / FIELD_CELL);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const list = f.cells.get(cellKey(i, j));
      if (!list) continue;
      for (let n = 0; n < list.length; n++) {
        const s = list[n]!;
        const ex = f.ex[s]!;
        const ez = f.ez[s]!;
        const dx = x - f.ax[s]!;
        const dz = z - f.az[s]!;
        const t = Math.max(0, Math.min(1, (dx * ex + dz * ez) / (f.len[s]! * f.len[s]! || 1e-12)));
        const d = hypot2(dx - ex * t, dz - ez * t);
        const left = dx * ez - dz * ex > 0;
        const gap = d - (left ? f.wl[s]! : f.wr[s]!);
        if (gap < out.openGap && (f.flags[s]! & (left ? SEG_OPEN_L : SEG_OPEN_R)) !== 0) out.openGap = gap;
        if (d < out.dc) out.dc = d;
        if (gap < out.gap) {
          out.gap = gap;
          out.seg = s;
        }
      }
    }
  }
  return out;
}

/** Footprints (oriented boxes: centre, yaw's cosine and sine, half extents) in a cell grid: a candidate circle is clear when it overlaps none. */
export class Occupancy {
  private readonly cells = new Map<number, number[]>();
  private readonly x: number[] = [];
  private readonly z: number[] = [];
  private readonly c: number[] = [];
  private readonly s: number[] = [];
  private readonly hx: number[] = [];
  private readonly hz: number[] = [];

  /** A box of half extents (hx on its local x, hz on local z) turned `yaw` (cosine `c`, sine `s`) at (x, z). */
  add(x: number, z: number, c: number, s: number, hx: number, hz: number): void {
    const idx = this.x.length;
    this.x.push(x);
    this.z.push(z);
    this.c.push(c);
    this.s.push(s);
    this.hx.push(hx);
    this.hz.push(hz);
    const r = hypot2(hx, hz) + OCC_PAD;
    for (let i = Math.floor((x - r) / OCC_CELL); i <= Math.floor((x + r) / OCC_CELL); i++) {
      for (let j = Math.floor((z - r) / OCC_CELL); j <= Math.floor((z + r) / OCC_CELL); j++) {
        const key = cellKey(i, j);
        const list = this.cells.get(key);
        if (list) list.push(idx);
        else this.cells.set(key, [idx]);
      }
    }
  }

  /** Whether the circle (x, z, r) comes within `margin` of any footprint. */
  hits(x: number, z: number, r: number, margin: number): boolean {
    const reach = r + margin;
    const ci = Math.floor(x / OCC_CELL);
    const cj = Math.floor(z / OCC_CELL);
    const list = this.cells.get(cellKey(ci, cj));
    if (!list) return false;
    for (let n = 0; n < list.length; n++) {
      const i = list[n]!;
      const dx = x - this.x[i]!;
      const dz = z - this.z[i]!;
      const u = dx * this.c[i]! - dz * this.s[i]!;
      const v = dx * this.s[i]! + dz * this.c[i]!;
      if (hypot2(Math.max(Math.abs(u) - this.hx[i]!, 0), Math.max(Math.abs(v) - this.hz[i]!, 0)) < reach) return true;
    }
    return false;
  }
}
