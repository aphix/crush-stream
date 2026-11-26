import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type { CarFrame } from "./car-rig.ts";

/** How steeply (m/m) the tyre's surface is carried on past the tread's edges and the arc's ends: a point near an edge is held a little, never with a step. */
export const FALL = 1;
/** How far (m) over the tyre's surface a skin point may rest and still be held: the hood and fenders, not the roof. */
export const REACH = 0.5;
/** The elements of a wheel's matrix that place its tyre: the axle (first column) and the hub (last). */
export const HELD_ELEMENTS = [0, 1, 2, 12, 13, 14] as const;
/** How far (m, summed over x, y and z) the crush must carry a skin vertex off its rest before the hold reads it as carried onto a tyre: the rest set holds what barely moved. */
const CARRIED_MIN = 0.01;
/** How far (m) over a tyre's surface a carried vertex must come to be held: the skin a lift there moves with a frame's crush to spare; all of `REACH` held every crushed nose point and doubled the hold. */
const CARRIED_REACH = 0.1;

/**
 * The share of two skin points' rest height apart that a lift under the lower one leaves between them: a held point lifts the skin resting above it, less
 * the rest of the way between. Each held point lifted to its own height alone, a crushed nose's side stacked into one band and crossed itself.
 */
export const ROW_KEEP = 0.1;

/** Bytes of a hold's `dirty` read at once to pass the clean ones: few of a hold's points are dirty. */
export const DIRTY_WORD = Uint32Array.BYTES_PER_ELEMENT;

/** `v` to the nearest multiple of `step`. */
export function onGrid(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Whether poses `a` and `b` (wheels' axles and hubs, NaN for a wheel gone) are each within `step` of one another, and the same wheels are gone in both. */
export function poseWithin(a: Float64Array, b: Float64Array, step: number): boolean {
  for (let k = 0; k < a.length; k++) {
    if (Number.isNaN(a[k]!) !== Number.isNaN(b[k]!)) return false;
    if (Math.abs(a[k]! - b[k]!) > step) return false;
  }
  return true;
}

/** How far (m) point `i` of `pos` stands over the upper surface of tyre `tyre` of hub h, unit axle a and scale `scale`, less `gap`; the surface carried on past its edges at `FALL`. */
export function clearOver(tyre: CarFrame["rig"]["tyre"], pos: ArrayLike<number>, i: number, h: ArrayLike<number>, a: ArrayLike<number>, scale: number, gap: number): number {
  const dx = pos[i]! - h[0]!;
  const dy = pos[i + 1]! - h[1]!;
  const dz = pos[i + 2]! - h[2]!;
  const flat = hypot2(a[0]!, a[2]!);
  const fx = -a[2]! / flat;
  const fz = a[0]! / flat;
  const up = -fz * a[1]! * dx + (fz * a[0]! - fx * a[2]!) * dy + fx * a[1]! * dz;
  const ahead = dx * fx + dz * fz;
  const along = dx * a[0]! + dy * a[1]! + dz * a[2]!;
  const r = tyre.r * scale;
  const top = Math.sqrt(Math.max(0, r * r - ahead * ahead)) - FALL * (Math.max(0, Math.abs(ahead) - r) + Math.max(0, Math.abs(along) - tyre.halfW * scale));
  return up - top - gap;
}

/** The tyre hold's carried set and caps: its own buffers, and the hold's tables they read and write (the same arrays, held here). */
export type Carried = {
  /** Per vertex, bit w: it rests inside wheel w's tyre (the wheel well behind it): never held, wherever the crush carries it. */
  restInside: Uint8Array;
  /** Per wheel, the vertices added to `over` (the first `n` entries, ascending): buffers made with `over`, written in place. */
  at: Int32Array[];
  n: Int32Array;
  /** The scratch a wheel's carried set is listed into. */
  scratch: Int32Array;
  /** Per welded rest point, the most lift `capAtRest` lets it keep this hold (`findCaps`). */
  cap: Float64Array;
  /** The vertices written `CARRIED_MIN` off their rest (the first `movedN`, ascending), listed each time the skin is written: the only ones a tyre can carry. */
  moved: Int32Array;
  movedN: number;
  written: Float32Array;
  rest: Float32Array;
  liftable: Uint8Array;
  over: Float32Array[];
  wheelNow: Float64Array;
  heldAt: Float64Array;
  ownLift: Float32Array;
  lift: Float32Array;
  rep: Int32Array;
  push: Float32Array;
  pushDir: Float32Array;
  dirty: Uint8Array;
  dirtyWords: Uint32Array;
  start: Int32Array;
  to: Int32Array;
  drop: Float32Array;
  /** The points `carryLift` processed or raised since the last cap (the first `touchedN`, each once by `mark`): the only ones a cap can lower. */
  touched: Int32Array;
  touchedN: number;
  mark: Uint8Array;
};

/** The carried set's buffers for a skin of `vertices` vertices and `points` welded points, over the hold's tables `tables`. */
export function newCarried(vertices: number, points: number, tables: Omit<Carried, "restInside" | "at" | "n" | "scratch" | "cap" | "moved" | "movedN" | "touched" | "touchedN" | "mark">): Carried {
  return { restInside: new Uint8Array(vertices), at: [], n: new Int32Array(4), scratch: new Int32Array(vertices), cap: new Float64Array(points), moved: new Int32Array(vertices), movedN: 0, touched: new Int32Array(points), touchedN: 0, mark: new Uint8Array(points), ...tables };
}

/** Lists into `c.moved` the vertices written `CARRIED_MIN` off their rest, ascending; how many. */
function listMoved(c: Carried): number {
  const { written, rest, moved } = c;
  let n = 0;
  for (let v = 0, i = 0; i < written.length; v++, i += 3) {
    if (Math.abs(written[i]! - rest[i]!) + Math.abs(written[i + 1]! - rest[i + 1]!) + Math.abs(written[i + 2]! - rest[i + 2]!) >= CARRIED_MIN) moved[n++] = v;
  }
  return n;
}

/**
 * Each standing tyre's carried set, from the skin as last written and the wheels now (`wheelNow`): the vertices the crush carried to within `CARRIED_REACH` over the tyre's top half
 * (a fender resting farther ahead, carried back onto the tyre, stood through it unheld), held at `REACH` so they keep the full gap; only a vertex written `CARRIED_MIN` off its rest
 * counts, and none while the skin is uncrushed. The last set is put back first, so the set never depends on what earlier holds read. Returns the wheels (bit w) whose set changed. `skinWritten`: the skin was written since the last call, so the vertices it moved are listed again.
 */
export function admitCarried(c: Carried, tyre: { r: number; halfW: number }, count: number, gone: number, crushed: boolean, skinWritten: boolean): number {
  const { written, restInside, liftable, scratch: next, moved } = c;
  if (crushed && skinWritten) c.movedN = listMoved(c);
  const e = c.wheelNow;
  let changed = 0;
  for (let w = 0; w < count; w++) {
    const over = c.over[w];
    if (over === undefined) continue;
    const wasN = c.n[w]!;
    const was = c.at[w]!;
    for (let k = 0; k < wasN; k++) {
      over[was[k]!] = NaN;
      liftable[was[k]!]! &= ~(1 << w);
    }
    let n = 0;
    const o = w * HELD_ELEMENTS.length;
    const scale = hypot3(e[o]!, e[o + 1]!, e[o + 2]!);
    if (crushed && !((gone >> w) & 1) && scale > 0) {
      const ax = e[o]! / scale;
      const ay = e[o + 1]! / scale;
      const az = e[o + 2]! / scale;
      const flat = hypot2(ax, az);
      const fx = -az / flat;
      const fz = ax / flat;
      const ux = -fz * ay;
      const uy = fz * ax - fx * az;
      const uz = fx * ay;
      const r = tyre.r * scale;
      const halfW = tyre.halfW * scale;
      const reach = halfW + CARRIED_REACH;
      const hx = e[o + 3]!;
      const hy = e[o + 4]!;
      const hz = e[o + 5]!;
      // Plan test first: `FALL` carries the tyre's surface on past the tread, where most of a crushed nose stands under it.
      for (let m = 0; m < c.movedN; m++) {
        const v = moved[m]!;
        const i = v * 3;
        const dx = written[i]! - hx;
        const dz = written[i + 2]! - hz;
        const ahead = dx * fx + dz * fz;
        if (Math.abs(ahead) >= r) continue;
        const dy = written[i + 1]! - hy;
        const along = dx * ax + dy * ay + dz * az;
        if (Math.abs(along) >= reach || !Number.isNaN(over[v]!) || (restInside[v]! >> w) & 1) continue;
        const up = ux * dx + uy * dy + uz * dz;
        if (up > 0 && up - Math.sqrt(r * r - ahead * ahead) + FALL * Math.max(0, Math.abs(along) - halfW) < CARRIED_REACH) next[n++] = v;
      }
    }
    let same = n === wasN;
    for (let k = 0; same && k < n; k++) same = next[k] === was[k];
    for (let k = 0; k < n; k++) {
      was[k] = next[k]!;
      over[next[k]!] = REACH;
      liftable[next[k]!]! |= 1 << w;
    }
    c.n[w] = n;
    if (!same) changed |= 1 << w;
  }
  return changed;
}

/**
 * Each point's cap (`cap`): no carried, sag or levelled lift raises it over the higher of where it rested and the standing tyres' top plus `gap` over them; its own tyre lift stays whole. Each lift is lowered to its cap as it is found.
 * One top for every point keeps the cap rising with rest height, so it keeps the rest order `carryLift` holds: a per-point tyre folded rows the crush moved over a tyre.
 */
export function findCaps(c: Carried, tyre: { r: number; halfW: number }, gap: number, wheels: number, gone: number): void {
  const { cap, ownLift, rest, written, heldAt, rep, lift } = c;
  let tyreTop = -Infinity;
  for (let w = 0; w < wheels; w++) {
    if ((gone >> w) & 1) continue;
    const e = heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
    // The axle's columns carry the wheel's scale.
    tyreTop = Math.max(tyreTop, e[4]! + Math.abs(e[1]!) * tyre.halfW + hypot2(e[0]!, e[2]!) * tyre.r + gap);
  }
  for (let p = 0; p < cap.length; p++) {
    const y = rep[p]! * 3 + 1;
    cap[p] = Math.max(ownLift[p]!, Math.max(rest[y]!, tyreTop) - written[y]!);
    if (lift[p]! > cap[p]!) lowerToCap(c, p);
  }
  forgetTouched(c);
  recarry(c);
}

/** Point `p`'s lift is cut to its cap, and it is owed a carry: the points above it stand over it by their kept share, not over the lift it had (`recarry`). */
function lowerToCap(c: Carried, p: number): void {
  c.lift[p] = c.cap[p]!;
  c.dirty[p] = 1;
}

/** Every point is capped: none is owed one. */
function forgetTouched(c: Carried): void {
  for (let k = 0; k < c.touchedN; k++) c.mark[c.touched[k]!] = 0;
  c.touchedN = 0;
}

/**
 * Lowers to its `cap` the lift of each point `carryLift` touched since the last cap (every other lift is as `findCaps` left it, under its cap), then carries again over the columns it lowered a point of (`recarry`).
 * The cap cuts what a carry raised a point by, never the order the carry keeps: rows the crush wrote stacked at one spot under a tyre's top stay over one another by their kept share, not all on the cap.
 */
export function capAtRest(c: Carried): void {
  const { lift, cap, touched } = c;
  for (let k = 0; k < c.touchedN; k++) {
    const p = touched[k]!;
    if (lift[p]! > cap[p]!) lowerToCap(c, p);
  }
  forgetTouched(c);
  recarry(c);
}

/** Every lift and push carried up the mesh's edges, lowest point first: the higher end of an edge stands at most its `drop` short of the lower end's. It lists the points it processes or raises (`touched`) for the next cap. Only from points `dirty` (raised since they last carried): lifts only rise within a hold, so a point that has not risen has nothing new to carry. */
export function carryLift(c: Carried): void {
  const { start, to, drop, lift, push, pushDir, dirty, dirtyWords, mark, touched } = c;
  for (let word = 0; word < dirtyWords.length; word++) {
    if (dirtyWords[word] === 0) continue;
    // A byte set below by an earlier point of this word is read here, after it.
    for (let p = word * DIRTY_WORD; p < (word + 1) * DIRTY_WORD; p++) {
      if (dirty[p] === 0) continue;
      dirty[p] = 0;
      const up = lift[p]!;
      const out = push[p]!;
      if (up <= 0 && out <= 0) continue;
      if (mark[p] === 0) {
        mark[p] = 1;
        touched[c.touchedN++] = p;
      }
      for (let e = start[p]!; e < start[p + 1]!; e++) {
        const q = to[e]!;
        const carried = up - drop[e]!;
        if (carried > lift[q]!) {
          lift[q] = carried;
          dirty[q] = 1;
          if (mark[q] === 0) {
            mark[q] = 1;
            touched[c.touchedN++] = q;
          }
        }
        const carriedOut = out - drop[e]!;
        if (carriedOut > push[q]!) {
          push[q] = carriedOut;
          dirty[q] = 1;
          for (let a = 0; a < 3; a++) pushDir[q * 3 + a] = pushDir[p * 3 + a]!;
        }
      }
    }
  }
}

/**
 * The carry again after the cap, from the capped points: a point above one stands over it by at most the kept share (`ROW_KEEP`) of their rest rise (or on its cap, if
 * that is higher), counted in drawn height. In lift space the carry would stretch with the crush: a point written far over the one below it stood that far over the tyre's top. It raises
 * lifts only up to what the carry before the cap gave, and lists nothing: what it raises is not capped again.
 */
function recarry(c: Carried): void {
  const { start, to, drop, lift, cap, rest, written, rep, dirty, dirtyWords } = c;
  for (let word = 0; word < dirtyWords.length; word++) {
    if (dirtyWords[word] === 0) continue;
    for (let p = word * DIRTY_WORD; p < (word + 1) * DIRTY_WORD; p++) {
      if (dirty[p] === 0) continue;
      dirty[p] = 0;
      const up = lift[p]!;
      if (up <= 0) continue;
      const yp = rep[p]! * 3 + 1;
      const drawn = written[yp]! + up;
      for (let e = start[p]!; e < start[p + 1]!; e++) {
        const q = to[e]!;
        let carried = up - drop[e]!;
        if (carried <= lift[q]!) continue;
        const yq = rep[q]! * 3 + 1;
        carried = Math.min(carried, Math.max(cap[q]!, drawn + ROW_KEEP * (rest[yq]! - rest[yp]!) - written[yq]!));
        if (carried <= lift[q]!) continue;
        lift[q] = carried;
        dirty[q] = 1;
      }
    }
  }
}
