import * as THREE from "three";
import { computeNormalsFast } from "../deform/fast-normals.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type { CarFrame } from "./car-rig.ts";
import type { PartSeat } from "./part-geometry.ts";

/** How far (m) a held skin point stands over the tyre: the triangles between held points sag under their chords (edges up to 25 cm over a tyre). */
const TYRE_GAP = 0.05;
/** How far (m) the body paint stands over the tyre: 95 % of its edges between points resting within 6 cm of a tyre are under 0.21 m (the coupe's longest, 0.31 m), and a chord of 0.21 m dips 1.6 cm over the arc (L²/8r, r 0.342); the bonnet's 25 cm and longer chords keep `TYRE_GAP`. */
const BODY_TYRE_GAP = 0.03;
/** How steeply (m/m) the tyre's surface is carried on past the tread's edges and the arc's ends: a point near an edge is held a little, never with a step. */
const FALL = 1;
/** From this share of the tyre's radius out along the road its surface is steeper than a lip can stand on: a body vertex there leaves along the road when that is shorter than going over. */
const ENDS_ZONE = 0.9;
/** How far (m) a body vertex leaving a tyre's steep end stands clear of it: its edges there are short, so the chord gap (`TYRE_GAP`, the bonnet's 25 cm edges) is not owed. */
const END_GAP = 0.01;
/** How far (m) over the tyre's surface a skin point may rest and still be held: the hood and fenders, not the roof. */
const REACH = 0.5;
/** How far (m) a triangle spanning a tyre's top must stand over it at the samples `SAG_AHEAD` x `SAG_ALONG`: twice the 5 mm the drawn skin keeps over a tyre, so a stretched triangle's chord is lifted before it dips through. */
const SAG_CLEAR = 0.01;
/** The tyre top's samples: along the road in steps of this share of the tyre's radius either side of the hub (a chord of the arc stands 3 mm under it across a step of 0.1 radius: finer than a stretched triangle is narrow), and across the tread in these shares of its half width. */
const SAG_STEP = 0.05;
const SAG_AHEAD_COUNT = 39;
const SAG_ALONG = [-1, -0.5, 0, 0.5, 1] as const;
const SAG_COUNT = SAG_AHEAD_COUNT * SAG_ALONG.length;
const _sampleX = new Float64Array(SAG_COUNT);
const _sampleZ = new Float64Array(SAG_COUNT);
const _sampleY = new Float64Array(SAG_COUNT);
const _sampleSkin = new Float64Array(SAG_COUNT);
const _sampleCorner = new Int32Array(SAG_COUNT);
const _sampleShare = new Float64Array(SAG_COUNT);
/** The least share of a sample's height that comes from points the hold can lift: below it the triangle sags on points the hold cannot move, and lifting the others would carry them a metre. */
const SAG_LIFTABLE = 0.5;
/** A lifted point moves the planes of every triangle it is a corner of, so the samples are read again until none is short: at most this many times. */
const SAG_PASSES = 4;
/** Rounding of the rest frame (m), rebuilt from matrices. */
const REST_SLACK = 1e-3;
/** The elements of a wheel's matrix that place its tyre: the axle (first column) and the hub (last). */
const HELD_ELEMENTS = [0, 1, 2, 12, 13, 14] as const;
/** How far (m, and in the axle's unit components) a wheel may move from where the last hold read it before the lift is found again: a millimetre of the tyre's 5 mm clearance under the skin. */
const WHEEL_SLACK = 1e-3;
/** How far (m) the skin stands over a part under it (`liftOverParts`): the 5 mm the drawn skin keeps over a tyre. */
const PART_CLEAR = 0.005;
/** A part's top is read at its highest vertex in each plan cell this wide (m): a skin over the part clears every vertex of the cell to within its tilt over 5 cm. */
const TOP_CELL = 0.05;
/** Per part geometry, its top samples in its own frame (`topSamples`). */
const topsOf = new WeakMap<THREE.BufferGeometry, Float32Array>();
/** The samples of the parts under the skin in the mesh's frame (x, y + `PART_CLEAR`, z), grown as needed. */
let _parts = new Float64Array(0);
let _partSkin = new Float64Array(0);
let _partCorner = new Int32Array(0);
const _seat = new THREE.Matrix4();
const _top = new THREE.Vector3();
const NO_PARTS: readonly PartSeat[] = [];

/** Whether any point of `skin` stands more than `PART_CLEAR` off `rest`: a crush that may have folded the skin onto what is under it. */
function movedOffRest(skin: Float32Array, rest: Float32Array): boolean {
  for (let i = 0; i < skin.length; i++) if (Math.abs(skin[i]! - rest[i]!) > PART_CLEAR) return true;
  return false;
}

/** `geometry`'s highest vertex (own frame, x y z each) in each `TOP_CELL` plan cell: what a skin over it must clear. */
function topSamples(geometry: THREE.BufferGeometry): Float32Array {
  const known = topsOf.get(geometry);
  if (known) return known;
  const pos = geometry.getAttribute("position");
  const best = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.floor(pos.getX(i) / TOP_CELL)},${Math.floor(pos.getZ(i) / TOP_CELL)}`;
    const at = best.get(key);
    if (at === undefined || pos.getY(i) > pos.getY(at)) best.set(key, i);
  }
  const out = new Float32Array(best.size * 3);
  let n = 0;
  for (const i of best.values()) {
    out[n++] = pos.getX(i);
    out[n++] = pos.getY(i);
    out[n++] = pos.getZ(i);
  }
  topsOf.set(geometry, out);
  return out;
}

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
  _read.up = up;
  _read.ahead = ahead;
  _read.fx = fx;
  _read.fz = fz;
  return up - top - gap;
}

/** What `clearOver` read last, for its caller: the point's height over the hub (m, up the tyre's frame), its distance along the road from the hub (m) and the road's direction in x and z. */
const _read = { up: 0, ahead: 0, fx: 0, fz: 0 };

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
  /** Per welded rest point, the push (m, along `pushDir`, the axle turned outward) this hold gives it instead of a lift. */
  private readonly push: Float32Array;
  /** Per welded rest point, the most (m) the samples of one `liftSaggingTriangles` read ask it lifted further. */
  private readonly bump: Float32Array;
  private readonly pushDir: Float32Array;
  /** Per wheel and vertex, how far (m) it rests over the tyre's surface; NaN for one that does not rest over it. */
  private readonly over: Float32Array[] = [];
  /** Per wheel and vertex, its height over the hub (m, up the tyre's frame) at rest. */
  private readonly restUp: Float32Array[] = [];
  /** Per wheel, the corners (vertex ids, three a triangle) of the triangles with a point resting over its tyre. */
  private readonly overTris: Int32Array[] = [];
  /** The class lift, hub shift and wheel scale `over` was found for. */
  private readonly overFor = new Float64Array(3).fill(NaN);
  /** Per wheel, its axle and hub in the mesh's frame at the last hold. */
  private readonly heldAt = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** The skin as last written, which every hold starts from. */
  private readonly written: Float32Array;
  private hasWritten = false;
  /** Whether the last hold moved any drawn point: until one does, the drawn skin is `written` as it stands, and nothing need be put back, re-shaded or re-uploaded. */
  private held = false;
  /** Each shown part's pose in the mesh's frame at the last hold (16 elements a part), and how many were shown. */
  private partPoseAt = new Float64Array(0);
  private partsShown = 0;
  /** Per welded rest point, the lift (m) that keeps the skin as last written over the parts under it (`liftOverParts`): every hold's tyre lift starts from it. */
  private readonly partFloor: Float32Array;
  /** Per wheel, its axle and hub as this hold read them; `heldAt` takes them when the lift is found again. */
  private readonly wheelNow = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** Whether the skin as last written stands off its rest anywhere (`movedOffRest`): only then may anything under it stand through it. */
  private crushed = false;

  /** Whether a vertex beside a tyre's end leaves by the tyre's side (the body paint) rather than over its top (a bonnet's chords need the top). */
  private readonly pushSide: boolean;

  /** `rest`: the mesh's rest positions in its own frame. */
  constructor(frame: CarFrame, mesh: THREE.Mesh, rest: Float32Array, pushSide: boolean) {
    this.pushSide = pushSide;
    this.frame = frame;
    this.mesh = mesh;
    this.rest = rest;
    this.edges = restEdges(rest, mesh.geometry.index);
    this.lift = new Float32Array(this.edges.order.length);
    this.push = new Float32Array(this.edges.order.length);
    this.bump = new Float32Array(this.edges.order.length);
    this.partFloor = new Float32Array(this.edges.order.length);
    this.pushDir = new Float32Array(this.edges.order.length * 3);
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
      const restUp = (this.restUp[w] ??= new Float32Array(this.rest.length / 3));
      for (let i = 0; i < this.rest.length; i += 3) {
        const c = clearOver(this.frame.rig.tyre, this.rest, i, _h, _a, scale, 0);
        restUp[i / 3] = _read.up;
        over[i / 3] = c >= -REST_SLACK && c < REACH ? c : NaN;
      }
      this.overTris[w] = this.trianglesOver(over);
    }
  }

  /** The corners of the mesh's triangles that have a point in `over` (not NaN). */
  private trianglesOver(over: Float32Array): Int32Array {
    const index = this.mesh.geometry.index;
    const corners = index ? index.count : over.length;
    const found: number[] = [];
    for (let t = 0; t + 2 < corners; t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      if (!Number.isNaN(over[a]!) || !Number.isNaN(over[b]!) || !Number.isNaN(over[c]!)) found.push(a, b, c);
    }
    return Int32Array.from(found);
  }

  /** Holds the skin over each tyre of `wheels` not in `gone` (bit i: wheel i is the world's), and over `under` (parts drawn under it, those whose `showIf` holds). `skinWritten`: the mesh's positions were just written from the cage. */
  hold(group: THREE.Object3D, wheels: readonly THREE.Object3D[], gone: number, lift: number, skinWritten: boolean, under: readonly PartSeat[] = []): void {
    this.findOver(group, wheels, lift);
    matrixIn(group, this.mesh, _mesh).invert();
    let wheelMoved = false;
    for (let w = 0; w < wheels.length; w++) {
      _wheel.multiplyMatrices(_mesh, matrixIn(group, wheels[w]!, _wheel));
      if (this.noteWheel(w, (gone >> w) & 1 ? null : _wheel.elements)) wheelMoved = true;
    }
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const fresh = skinWritten || !this.hasWritten;
    if (fresh) {
      this.written.set(pos);
      this.hasWritten = true;
      this.crushed = movedOffRest(this.written, this.rest);
    }
    // An uncrushed skin has nothing crushed under it to stand over.
    const partsMoved = this.notePartPoses(group, this.crushed ? under : NO_PARTS);
    // The lift is a function of the skin, the wheels and the parts: none changed, the drawn skin already carries it.
    if (!fresh && !wheelMoved && !partsMoved) return;
    this.heldAt.set(this.wheelNow);
    if (!fresh && this.held) pos.set(this.written);
    if (fresh || partsMoved) this.findPartFloor(pos, this.partsShown > 0 ? this.partSamples(group, under) : 0);
    this.lift.set(this.partFloor);
    this.push.fill(0);
    for (let w = 0; w < wheels.length; w++) {
      if ((gone >> w) & 1) continue;
      const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
      const scale = hypot3(e[0]!, e[1]!, e[2]!);
      for (let k = 0; k < 3; k++) {
        _a[k] = e[k]! / scale;
        _h[k] = e[3 + k]!;
      }
      this.needOver(pos, this.over[w]!, this.restUp[w]!, scale);
    }
    this.carryLift();
    for (let pass = 0; pass < SAG_PASSES; pass++) {
      let sagged = false;
      for (let w = 0; w < wheels.length; w++) {
        if ((gone >> w) & 1) continue;
        if (this.liftSaggingTriangles(pos, w)) sagged = true;
      }
      if (!sagged) break;
      this.carryLift();
    }
    // A resting skin's points read lifts of a nanometre (the rest clearance's rounding), under a float's step: held is a drawn position changed.
    let held = false;
    const { weld } = this.edges;
    for (let v = 0; v < weld.length; v++) {
      const p = weld[v]!;
      const up = this.lift[p]!;
      if (up > 0) {
        const y = pos[v * 3 + 1]!;
        pos[v * 3 + 1] = y + up;
        if (pos[v * 3 + 1] !== y) held = true;
      }
      const out = this.push[p]!;
      if (out > 0)
        for (let k = 0; k < 3; k++) {
          const x = pos[v * 3 + k]!;
          pos[v * 3 + k] = x + out * this.pushDir[p * 3 + k]!;
          if (pos[v * 3 + k] !== x) held = true;
        }
    }
    const wasHeld = this.held;
    this.held = held;
    if (!held && !wasHeld && !fresh) return;
    attr.needsUpdate = true;
    computeNormalsFast(this.mesh.geometry);
  }

  /** Records the poses of the shown parts of `under` in the mesh's frame (`partsShown` of them); true when any moved, or one came or went, since the last hold. */
  private notePartPoses(group: THREE.Object3D, under: readonly PartSeat[]): boolean {
    let n = 0;
    let moved = false;
    for (const seat of under) {
      if (seat.showIf && !seat.showIf()) continue;
      if (this.partPoseAt.length < (n + 1) * 16) {
        const grown = new Float64Array(2 * (n + 1) * 16);
        grown.set(this.partPoseAt);
        this.partPoseAt = grown;
        moved = true;
      }
      const e = _seat.multiplyMatrices(_mesh, matrixIn(group, seat, _seat)).elements;
      for (let k = 0; k < 16; k++) {
        if (this.partPoseAt[n * 16 + k] !== e[k]) moved = true;
        this.partPoseAt[n * 16 + k] = e[k]!;
      }
      n++;
    }
    if (n !== this.partsShown) moved = true;
    this.partsShown = n;
    return moved;
  }

  /** The part lift of the skin as last written (`pos`) over the `count` part samples, carried up the mesh and read again until none is short, into `partFloor`. */
  private findPartFloor(pos: Float32Array, count: number): void {
    this.lift.fill(0);
    for (let pass = 0; pass < SAG_PASSES && count > 0; pass++) {
      if (!this.liftOverParts(pos, count)) break;
      this.carryLift();
    }
    this.partFloor.set(this.lift);
  }

  /** Fills `_parts` with the top samples (`topSamples`) of the shown parts of `under` in the mesh's frame, each raised by `PART_CLEAR`; returns their count. */
  private partSamples(group: THREE.Object3D, under: readonly PartSeat[]): number {
    let n = 0;
    for (const seat of under) {
      if (seat.showIf && !seat.showIf()) continue;
      const top = topSamples(seat.drawn);
      if (_parts.length < (n + top.length / 3) * 3) {
        const grown = new Float64Array(2 * (_parts.length + top.length));
        grown.set(_parts);
        _parts = grown;
      }
      _seat.multiplyMatrices(_mesh, matrixIn(group, seat, _seat));
      for (let i = 0; i < top.length; i += 3, n++) {
        _top.set(top[i]!, top[i + 1]!, top[i + 2]!).applyMatrix4(_seat);
        _parts[n * 3] = _top.x;
        _parts[n * 3 + 1] = _top.y + PART_CLEAR;
        _parts[n * 3 + 2] = _top.z;
      }
    }
    if (_partSkin.length < n) {
      _partSkin = new Float64Array(_parts.length / 3);
      _partCorner = new Int32Array(_parts.length / 3);
    }
    return n;
  }

  /**
   * A crushed bonnet folds down onto the engine bay and the cabin's dash under it: each of the `count` part samples (`partSamples`) is read under the highest up-facing
   * triangle over it, and where that triangle's plane stands under the sample, its three corners are lifted by the shortfall. True when any is.
   */
  private liftOverParts(pos: Float32Array, count: number): boolean {
    this.readPartSkin(pos, count);
    const { weld } = this.edges;
    let raised = false;
    for (let n = 0; n < count; n++) {
      const t = _partCorner[n]!;
      const short = _parts[n * 3 + 1]! - _partSkin[n]!;
      if (t < 0 || short <= 0) continue;
      for (let corner = 0; corner < 3; corner++) {
        const p = weld[this.corner(t + corner)]!;
        if (short > this.bump[p]!) this.bump[p] = short;
      }
      raised = true;
    }
    if (!raised) return false;
    for (let p = 0; p < this.bump.length; p++) {
      this.lift[p] = this.lift[p]! + this.bump[p]!;
      this.bump[p] = 0;
    }
    return true;
  }

  /** Vertex id of triangle corner `k` of the mesh. */
  private corner(k: number): number {
    const index = this.mesh.geometry.index;
    return index ? index.getX(k) : k;
  }

  /** Per part sample, the height (`_partSkin`) of the highest up-facing triangle of the skin (lifts included) over it in plan and that triangle's first corner (`_partCorner`, -1: none). */
  private readPartSkin(pos: Float32Array, count: number): void {
    _partSkin.fill(-Infinity, 0, count);
    _partCorner.fill(-1, 0, count);
    const index = this.mesh.geometry.index;
    const corners = index ? index.count : pos.length / 3;
    const { weld } = this.edges;
    for (let t = 0; t + 2 < corners; t += 3) {
      const va = this.corner(t);
      const vb = this.corner(t + 1);
      const vc = this.corner(t + 2);
      const a = va * 3;
      const b = vb * 3;
      const c = vc * 3;
      if ((pos[b + 2]! - pos[a + 2]!) * (pos[c]! - pos[a]!) - (pos[b]! - pos[a]!) * (pos[c + 2]! - pos[a + 2]!) <= 0) continue;
      const den = (pos[b + 2]! - pos[c + 2]!) * (pos[a]! - pos[c]!) + (pos[c]! - pos[b]!) * (pos[a + 2]! - pos[c + 2]!);
      const xLow = Math.min(pos[a]!, pos[b]!, pos[c]!);
      const xHigh = Math.max(pos[a]!, pos[b]!, pos[c]!);
      const zLow = Math.min(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
      const zHigh = Math.max(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
      const ya = pos[a + 1]! + this.lift[weld[va]!]!;
      const yb = pos[b + 1]! + this.lift[weld[vb]!]!;
      const yc = pos[c + 1]! + this.lift[weld[vc]!]!;
      for (let n = 0; n < count; n++) {
        const x = _parts[n * 3]!;
        const z = _parts[n * 3 + 2]!;
        if (x < xLow || x > xHigh || z < zLow || z > zHigh) continue;
        const l1 = ((pos[b + 2]! - pos[c + 2]!) * (x - pos[c]!) + (pos[c]! - pos[b]!) * (z - pos[c + 2]!)) / den;
        const l2 = ((pos[c + 2]! - pos[a + 2]!) * (x - pos[c]!) + (pos[a]! - pos[c]!) * (z - pos[c + 2]!)) / den;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const y = l1 * ya + l2 * yb + (1 - l1 - l2) * yc;
        if (y <= _partSkin[n]!) continue;
        _partSkin[n] = y;
        _partCorner[n] = t;
      }
    }
  }

  /**
   * A skin point held over a tyre is no tyre-top clearance for the triangle it shares with points the crush left away from it: a nose's
   * edge stretched across the tyre sags under the arc between its lifted corner and its low ones. Each triangle with a point resting over
   * wheel `w`'s tyre is read at the tyre's top samples (`SAG_AHEAD`, `SAG_ALONG`): where its plane stands under the tyre plus `SAG_CLEAR`,
   * the points the hold can lift (those resting over the tyre) are lifted by the shortfall over their share of the plane there. True when any is.
   */
  private liftSaggingTriangles(pos: Float32Array, w: number): boolean {
    const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
    const scale = hypot3(e[0]!, e[1]!, e[2]!);
    for (let k = 0; k < 3; k++) _h[k] = e[3 + k]!;
    const ax = e[0]! / scale;
    const ay = e[1]! / scale;
    const az = e[2]! / scale;
    const flat = hypot2(ax, az);
    const fx = -az / flat;
    const fz = ax / flat;
    const ux = fz * ay;
    const uy = fz * ax - fx * az;
    const uz = -fx * ay;
    const r = this.frame.rig.tyre.r * scale;
    const halfW = this.frame.rig.tyre.halfW * scale;
    const over = this.over[w]!;
    const tris = this.overTris[w]!;
    const { weld } = this.edges;
    for (let i = 0, n = 0; i < SAG_AHEAD_COUNT; i++) {
      const ahead = (i - (SAG_AHEAD_COUNT - 1) / 2) * SAG_STEP;
      const top = Math.sqrt(1 - ahead * ahead) * r;
      for (let k = 0; k < SAG_ALONG.length; k++, n++) {
        const across = SAG_ALONG[k]! * halfW;
        _sampleX[n] = _h[0]! + fx * ahead * r + ax * across + ux * top;
        _sampleZ[n] = _h[2]! + fz * ahead * r + az * across + uz * top;
        _sampleY[n] = _h[1]! + ay * across + uy * top + SAG_CLEAR;
      }
    }
    _sampleSkin.fill(-Infinity);
    _sampleCorner.fill(-1);
    for (let t = 0; t < tris.length; t += 3) {
      const va = tris[t]!;
      const vb = tris[t + 1]!;
      const vc = tris[t + 2]!;
      const a = va * 3;
      const b = vb * 3;
      const c = vc * 3;
      const den = (pos[b + 2]! - pos[c + 2]!) * (pos[a]! - pos[c]!) + (pos[c]! - pos[b]!) * (pos[a + 2]! - pos[c + 2]!);
      if (Math.abs(den) < 1e-12) continue;
      const xLow = Math.min(pos[a]!, pos[b]!, pos[c]!);
      const xHigh = Math.max(pos[a]!, pos[b]!, pos[c]!);
      const zLow = Math.min(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
      const zHigh = Math.max(pos[a + 2]!, pos[b + 2]!, pos[c + 2]!);
      const liftA = !Number.isNaN(over[va]!);
      const liftB = !Number.isNaN(over[vb]!);
      const liftC = !Number.isNaN(over[vc]!);
      const ya = pos[a + 1]! + this.lift[weld[va]!]!;
      const yb = pos[b + 1]! + this.lift[weld[vb]!]!;
      const yc = pos[c + 1]! + this.lift[weld[vc]!]!;
      for (let n = 0; n < SAG_COUNT; n++) {
        const x = _sampleX[n]!;
        const z = _sampleZ[n]!;
        if (x < xLow || x > xHigh || z < zLow || z > zHigh) continue;
        const l1 = ((pos[b + 2]! - pos[c + 2]!) * (x - pos[c]!) + (pos[c]! - pos[b]!) * (z - pos[c + 2]!)) / den;
        const l2 = ((pos[c + 2]! - pos[a + 2]!) * (x - pos[c]!) + (pos[a]! - pos[c]!) * (z - pos[c + 2]!)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * ya + l2 * yb + l3 * yc;
        if (y <= _sampleSkin[n]!) continue;
        _sampleSkin[n] = y;
        _sampleCorner[n] = t;
        _sampleShare[n] = (liftA ? l1 : 0) + (liftB ? l2 : 0) + (liftC ? l3 : 0);
      }
    }
    let raised = false;
    for (let n = 0; n < SAG_COUNT; n++) {
      const t = _sampleCorner[n]!;
      if (t < 0 || _sampleShare[n]! < SAG_LIFTABLE) continue;
      const short = _sampleY[n]! - _sampleSkin[n]!;
      if (short <= 0) continue;
      const by = short / _sampleShare[n]!;
      for (let corner = 0; corner < 3; corner++) {
        const v = tris[t + corner]!;
        if (!Number.isNaN(over[v]!) && by > this.bump[weld[v]!]!) this.bump[weld[v]!] = by;
      }
      raised = true;
    }
    if (!raised) return false;
    for (let k = 0; k < tris.length; k++) {
      const p = weld[tris[k]!]!;
      this.lift[p] = this.lift[p]! + this.bump[p]!;
      this.bump[p] = 0;
    }
    return true;
  }

  /** Records wheel `w`'s axle and hub (`e`, null for a wheel gone, NaN) in `wheelNow`; true when they moved past `WHEEL_SLACK` (or came or went) since the hold that last read them (`heldAt`). */
  private noteWheel(w: number, e: ArrayLike<number> | null): boolean {
    let moved = false;
    for (let k = 0; k < HELD_ELEMENTS.length; k++) {
      const v = e ? e[HELD_ELEMENTS[k]!]! : NaN;
      const at = w * HELD_ELEMENTS.length + k;
      const was = this.heldAt[at]!;
      if (Number.isNaN(v) !== Number.isNaN(was) || Math.abs(v - was) > WHEEL_SLACK) moved = true;
      this.wheelNow[at] = v;
    }
    return moved;
  }

  /** Each vertex of `over` standing under the tyre's surface plus its gap (`TYRE_GAP`, or its rest clearance if less: the uncrushed skin never moves): the lift up the mesh onto it, into `lift`, but never to above where it rested over the hub. */
  private needOver(pos: Float32Array, over: Float32Array, restUp: Float32Array, scale: number): void {
    const uy = hypot2(_a[0]!, _a[2]!);
    const { weld } = this.edges;
    for (let v = 0; v < over.length; v++) {
      const rested = over[v]!;
      if (Number.isNaN(rested)) continue;
      const c = clearOver(this.frame.rig.tyre, pos, v * 3, _h, _a, scale, Math.min(this.pushSide ? BODY_TYRE_GAP : TYRE_GAP, rested));
      if (c >= 0) continue;
      const p = weld[v]!;
      const up = -c / uy;
      // A vertex just inside the tyre's end (a lip beside it) leaves along the road, the few mm that clear the steep end, not over the whole tyre (7 mm in took 18 cm of lift): the body skin only.
      const out = this.frame.rig.tyre.r * scale - Math.abs(_read.ahead) + END_GAP;
      if (this.pushSide && Math.abs(_read.ahead) > ENDS_ZONE * this.frame.rig.tyre.r * scale && out < up) {
        if (out > this.push[p]!) {
          this.push[p] = out;
          const sign = Math.sign(_read.ahead);
          this.pushDir[p * 3] = sign * _read.fx;
          this.pushDir[p * 3 + 1] = 0;
          this.pushDir[p * 3 + 2] = sign * _read.fz;
        }
      } else this.lift[p] = Math.max(this.lift[p]!, up);
    }
  }

  /** Every lift and push carried up the mesh's edges, lowest point first: the higher end of an edge stands at most its `drop` short of the lower end's. */
  private carryLift(): void {
    const { order, start, to, drop } = this.edges;
    const { lift, push, pushDir } = this;
    for (let k = 0; k < order.length; k++) {
      const p = order[k]!;
      const up = lift[p]!;
      const out = push[p]!;
      if (up <= 0 && out <= 0) continue;
      for (let e = start[p]!; e < start[p + 1]!; e++) {
        const q = to[e]!;
        const carried = up - drop[e]!;
        if (carried > lift[q]!) lift[q] = carried;
        const carriedOut = out - drop[e]!;
        if (carriedOut > push[q]!) {
          push[q] = carriedOut;
          for (let a = 0; a < 3; a++) pushDir[q * 3 + a] = pushDir[p * 3 + a]!;
        }
      }
    }
  }
}
