import * as THREE from "three";
import { computeNormalsFast } from "../deform/fast-normals.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type { CarFrame } from "./car-rig.ts";

/** How far (m) a held skin point stands over the tyre: the triangles between held points sag under their chords (edges up to 25 cm over a tyre). */
const TYRE_GAP = 0.05;
/** How steeply (m/m) the tyre's surface is carried on past the tread's edges and the arc's ends: a point near an edge is held a little, never with a step. */
const FALL = 1;
/** How far (m) over the tyre's surface a skin point may rest and still be held: the hood and fenders, not the roof. */
const REACH = 0.5;
/** Rounding of the rest frame (m), rebuilt from matrices. */
const REST_SLACK = 1e-3;
/** The elements of a wheel's matrix that place its tyre: the axle (first column) and the hub (last). */
const HELD_ELEMENTS = [0, 1, 2, 12, 13, 14] as const;

const _mesh = new THREE.Matrix4();
const _wheel = new THREE.Matrix4();
const _hub = new THREE.Vector3();

/** `obj`'s matrix in the frame of `root`, from the local matrices alone (the world matrices are a frame old until the render). */
function matrixIn(root: THREE.Object3D, obj: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let p: THREE.Object3D | null = obj; p && p !== root; p = p.parent) {
    p.updateMatrix();
    out.premultiply(p.matrix);
  }
  return out;
}

/** How far (m) point `i` of `pos` stands over the upper surface of tyre `tyre` of hub h, unit axle a and scale `scale`, less `gap`; the surface carried on past its edges at `FALL`. */
function clearOver(tyre: CarFrame["rig"]["tyre"], pos: ArrayLike<number>, i: number, h: ArrayLike<number>, a: ArrayLike<number>, scale: number, gap: number): number {
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

const _h = new Float64Array(3);
const _a = new Float64Array(3);

/**
 * The share of two skin points' rest height apart that a lift under the lower one leaves between them: a held point lifts the skin resting above it, less
 * the rest of the way between. Each held point lifted to its own height alone, a crushed nose's side stacked into one band and crossed itself.
 */
const ROW_KEEP = 0.1;
/** How fast (m per m of rest distance) a carried lift falls off along the skin at least: past the rows above a held point it spreads a hand's width, where a near-flat deck would carry it whole. */
const SPREAD = 0.5;

/** A mesh's edges between distinct rest points (a crease's copies welded into one), each from its lower end to its higher one, and the points lowest first. */
type RestEdges = { weld: Int32Array; order: Int32Array; start: Int32Array; to: Int32Array; drop: Float32Array };

/** The upward edges of the mesh over `rest` (`index` its triangles); `drop`: how much of a lift the higher end may stand short of it (`ROW_KEEP`, `SPREAD`). */
function restEdges(rest: Float32Array, index: THREE.BufferAttribute | null): RestEdges {
  const count = rest.length / 3;
  const weld = new Int32Array(count);
  const firstAt = new Map<string, number>();
  const points: number[] = [];
  for (let v = 0; v < count; v++) {
    const key = `${rest[v * 3]},${rest[v * 3 + 1]},${rest[v * 3 + 2]}`;
    const known = firstAt.get(key);
    if (known !== undefined) {
      weld[v] = known;
      continue;
    }
    weld[v] = points.length;
    firstAt.set(key, points.length);
    points.push(v);
  }
  const up: number[][] = points.map(() => []);
  const corners = index ? index.count : count;
  for (let t = 0; t + 2 < corners; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = weld[index ? index.getX(t + k) : t + k]!;
      const b = weld[index ? index.getX(t + ((k + 1) % 3)) : t + ((k + 1) % 3)]!;
      const ya = rest[points[a]! * 3 + 1]!;
      const yb = rest[points[b]! * 3 + 1]!;
      if (ya < yb) up[a]!.push(b);
      else if (yb < ya) up[b]!.push(a);
    }
  }
  const start = new Int32Array(points.length + 1);
  for (let p = 0; p < points.length; p++) start[p + 1] = start[p]! + up[p]!.length;
  const to = new Int32Array(start[points.length]!);
  const drop = new Float32Array(to.length);
  for (let p = 0; p < points.length; p++) {
    const from = points[p]! * 3;
    for (let e = 0; e < up[p]!.length; e++) {
      const q = up[p]![e]!;
      const at = points[q]! * 3;
      to[start[p]! + e] = q;
      const rise = rest[at + 1]! - rest[from + 1]!;
      drop[start[p]! + e] = Math.max((1 - ROW_KEEP) * rise, SPREAD * hypot3(rest[at]! - rest[from]!, rise, rest[at + 2]! - rest[from + 2]!));
    }
  }
  const order = Int32Array.from(points.keys()).sort((p, q) => rest[points[p]! * 3 + 1]! - rest[points[q]! * 3 + 1]!);
  return { weld, order, start, to, drop };
}

/**
 * A crushed hood or fender drawn over a standing tyre is held on it: every skin point that rests over the tyre's upper surface stands at least `TYRE_GAP` over it
 * (its rest clearance if less: the uncrushed skin never moves), and lifts the skin resting above it with it (`ROW_KEEP`), so the skin keeps the order it rested in.
 * Each hold starts from the skin as last written, so the hold is a function of that skin and the wheels: no history, and it moves smoothly with the tyre.
 */
export class TyreSkin {
  private readonly frame: CarFrame;
  private readonly mesh: THREE.Mesh;
  private readonly rest: Float32Array;
  private readonly edges: RestEdges;
  /** Per welded rest point (`RestEdges.weld`), the lift (m, up the mesh) this hold gives it. */
  private readonly lift: Float32Array;
  /** Per wheel and vertex, how far (m) it rests over the tyre's surface; NaN for one that does not rest over it. */
  private readonly over: Float32Array[] = [];
  /** The class lift, hub shift and wheel scale `over` was found for. */
  private readonly overFor = new Float64Array(3).fill(NaN);
  /** Per wheel, its axle and hub in the mesh's frame at the last hold. */
  private readonly heldAt = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** The skin as last written, which every hold starts from. */
  private readonly written: Float32Array;
  private hasWritten = false;

  /** `rest`: the mesh's rest positions in its own frame. */
  constructor(frame: CarFrame, mesh: THREE.Mesh, rest: Float32Array) {
    this.frame = frame;
    this.mesh = mesh;
    this.rest = rest;
    this.edges = restEdges(rest, mesh.geometry.index);
    this.lift = new Float32Array(this.edges.order.length);
    this.written = new Float32Array(rest.length);
  }

  /** The vertices resting over each tyre: the class's lift, hub shift and wheel scale change what that is. */
  private findOver(group: THREE.Object3D, wheels: readonly THREE.Object3D[], lift: number): void {
    const hubs = wheels[0]!.parent!;
    const hubShift = hubs === group ? 0 : hubs.position.y;
    const scale = wheels[0]!.scale.x;
    const f = this.overFor;
    if (f[0] === lift && f[1] === hubShift && f[2] === scale) return;
    f[0] = lift;
    f[1] = hubShift;
    f[2] = scale;
    this.mesh.updateMatrix();
    _mesh.makeTranslation(0, this.mesh.parent === group ? 0 : lift, 0).multiply(this.mesh.matrix).invert();
    _a[0] = 1;
    _a[1] = 0;
    _a[2] = 0;
    for (let w = 0; w < wheels.length; w++) {
      const hub = this.frame.wheels[w]!;
      _hub.set(hub[0], hub[1] + hubShift, hub[2]).applyMatrix4(_mesh);
      _h[0] = _hub.x;
      _h[1] = _hub.y;
      _h[2] = _hub.z;
      const over = (this.over[w] ??= new Float32Array(this.rest.length / 3));
      for (let i = 0; i < this.rest.length; i += 3) {
        const c = clearOver(this.frame.rig.tyre, this.rest, i, _h, _a, scale, 0);
        over[i / 3] = c >= -REST_SLACK && c < REACH ? c : NaN;
      }
    }
  }

  /** Holds the skin over each tyre of `wheels` not in `gone` (bit i: wheel i is the world's). `skinWritten`: the mesh's positions were just written from the cage. */
  hold(group: THREE.Object3D, wheels: readonly THREE.Object3D[], gone: number, lift: number, skinWritten: boolean): void {
    this.findOver(group, wheels, lift);
    matrixIn(group, this.mesh, _mesh).invert();
    let wheelMoved = false;
    for (let w = 0; w < wheels.length; w++) {
      _wheel.multiplyMatrices(_mesh, matrixIn(group, wheels[w]!, _wheel));
      if (this.noteWheel(w, (gone >> w) & 1 ? null : _wheel.elements)) wheelMoved = true;
    }
    if (!skinWritten && !wheelMoved && this.hasWritten) return;
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    if (skinWritten || !this.hasWritten) {
      this.written.set(pos);
      this.hasWritten = true;
    } else pos.set(this.written);
    this.lift.fill(0);
    for (let w = 0; w < wheels.length; w++) {
      if ((gone >> w) & 1) continue;
      const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
      const scale = hypot3(e[0]!, e[1]!, e[2]!);
      for (let k = 0; k < 3; k++) {
        _a[k] = e[k]! / scale;
        _h[k] = e[3 + k]!;
      }
      this.needOver(pos, this.over[w]!, scale);
    }
    this.carryLift();
    const { weld } = this.edges;
    for (let v = 0; v < weld.length; v++) {
      const up = this.lift[weld[v]!]!;
      if (up > 0) pos[v * 3 + 1] = pos[v * 3 + 1]! + up;
    }
    attr.needsUpdate = true;
    computeNormalsFast(this.mesh.geometry);
  }

  /** Records wheel `w`'s axle and hub (`e`, null for a wheel gone, NaN); true when they changed since the last hold. */
  private noteWheel(w: number, e: ArrayLike<number> | null): boolean {
    let moved = false;
    for (let k = 0; k < HELD_ELEMENTS.length; k++) {
      const v = e ? e[HELD_ELEMENTS[k]!]! : NaN;
      const at = w * HELD_ELEMENTS.length + k;
      if (!Object.is(this.heldAt[at], v)) moved = true;
      this.heldAt[at] = v;
    }
    return moved;
  }

  /** Each vertex of `over` standing under the tyre's surface plus its gap (`TYRE_GAP`, or its rest clearance if less: the uncrushed skin never moves): the lift up the mesh onto it, into `lift`. */
  private needOver(pos: Float32Array, over: Float32Array, scale: number): void {
    const uy = hypot2(_a[0]!, _a[2]!);
    const { weld } = this.edges;
    for (let v = 0; v < over.length; v++) {
      const rested = over[v]!;
      if (Number.isNaN(rested)) continue;
      const c = clearOver(this.frame.rig.tyre, pos, v * 3, _h, _a, scale, Math.min(TYRE_GAP, rested));
      if (c >= 0) continue;
      const p = weld[v]!;
      this.lift[p] = Math.max(this.lift[p]!, -c / uy);
    }
  }

  /** Every lift carried up the mesh's edges, lowest point first: the higher end of an edge stands at most its `drop` short of the lower end's lift. */
  private carryLift(): void {
    const { order, start, to, drop } = this.edges;
    const lift = this.lift;
    for (let k = 0; k < order.length; k++) {
      const p = order[k]!;
      const up = lift[p]!;
      if (up <= 0) continue;
      for (let e = start[p]!; e < start[p + 1]!; e++) {
        const carried = up - drop[e]!;
        if (carried > lift[to[e]!]!) lift[to[e]!] = carried;
      }
    }
  }
}
