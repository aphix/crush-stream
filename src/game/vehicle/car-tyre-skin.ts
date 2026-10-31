import * as THREE from "three";
import { computeNormalsNear } from "../deform/fast-normals.ts";
import { skinKernel, type SkinKernel } from "../deform/skin-kernel.ts";
import type { SagSkin } from "../deform/tyre-sag-kernel.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type { CarFrame } from "./car-rig.ts";
import type { PartSeat } from "./part-geometry.ts";
import { INNER_PANEL, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";

/** How far (m) a held skin point stands over the tyre: the triangles between held points sag under their chords (edges up to 25 cm over a tyre). */
const TYRE_GAP = 0.05;
/** How far (m) the body paint stands over the tyre: 95 % of its edges between points resting within 6 cm of a tyre are under 0.21 m (the coupe's longest, 0.31 m), and a chord of 0.21 m dips 1.6 cm over the arc (L²/8r, r 0.342); the bonnet's 25 cm and longer chords keep `TYRE_GAP`. */
const BODY_TYRE_GAP = 0.03;
/** How steeply (m/m) the tyre's surface is carried on past the tread's edges and the arc's ends: a point near an edge is held a little, never with a step. */
const FALL = 1;
/** From this share of the tyre's radius out along the road its surface is steeper than a lip can stand on: a body vertex there leaves along the road when that is shorter than going over. */
const ENDS_ZONE = 0.9;
/** The band (share of the tyre's radius, inside `ENDS_ZONE`) across which a body vertex's leaving along the road takes over from its lift: a switch at one line moved a crushed fascia point from a 44 mm push to a 193 mm lift in one step, and back. */
const END_BLEND = 0.1;
/** How far (m) a body vertex leaving a tyre's steep end stands clear of it: its edges there are short, so the chord gap (`TYRE_GAP`, the bonnet's 25 cm edges) is not owed. */
const END_GAP = 0.01;
/** How much shorter (m) leaving along the road must be than going over before a vertex leaves whole; between, it does both in shares: a choice with a step flipped a vertex 3 cm between the two on a hub move of a tenth of a mm. */
const LEAVE_BLEND = 0.03;
/** The steepest (m of lift per m of written skin) the hold's lift may change between two neighbouring skin points: a crushed row inside a tyre drags its neighbours up to a slope, never leaves a cliff of stretched triangles. */
const LEVEL_SLOPE = 1;
/** The band (share of the tyre's radius) over the hub across which the hold takes up a point under the tyre's surface: under the hub it is the tyre's lower half, whose top no crushed bumper can reach. */
const UPPER_FADE = 0.1;
/** How many tyre radii off its seat a torn-off wheel's hub has gone when the hold over it has let go: it fades out as the wheel leaves, no one-frame drop. */
const LEAVE_FADE = 2;
/** How far (m) over the tyre's surface a skin point may rest and still be held: the hood and fenders, not the roof. */
const REACH = 0.5;
/** How far (m) a triangle spanning a tyre's top must stand over it: twice the 5 mm the drawn skin keeps over a tyre, so a stretched triangle's chord is lifted before it dips through. */
const SAG_CLEAR = 0.01;
/** The most (m) a triangle's points read for sag lie apart along its longest edge: a chord of the arc stands 0.9 mm under it across 5 cm (L²/8r, r 0.342); at 10 cm the drawn skin stood 2.2 mm off a hold found every frame (bar 2 mm). */
const SAG_STEP = 0.05;
/** How far (m) over `SAG_CLEAR` a triangle's clearance floor (`sagFloor`) must stand for its lattice to go unread: the rounding between the floor and a point's own read (some 1e-16 m), with room. */
const SAG_FLOOR_SLACK = 1e-9;
/** The tyre's top a sagging triangle is read over: out along the road to this share of the radius, its read fading in over `SAG_EDGE_FADE` inside it, and across the tread to its edges, fading out over `SAG_EDGE_FADE` past them. */
const SAG_TOP_AHEAD = 0.95;
const SAG_EDGE_FADE = 0.1;
/** From this share of a point's height that comes from points the hold can lift, it clears the point whole: below it the triangle sags on points the hold cannot move, and lifting the others clear would carry them a metre. */
const SAG_LIFTABLE = 0.5;
/** Under this share the hold lifts nothing for the point; between it and `SAG_LIFTABLE` it clears that much of it (`sagLift`), so the lift follows the share and never stands past twice the shortfall. */
const SAG_LIFT_FROM = 0.25;
/** A lifted point moves the planes of every triangle it is a corner of, so the triangles are read again until none is short: at most this many times. */
const SAG_PASSES = 4;
/** Rounding of the rest frame (m), rebuilt from matrices. */
const REST_SLACK = 1e-3;
/** The elements of a wheel's matrix that place its tyre: the axle (first column) and the hub (last). */
const HELD_ELEMENTS = [0, 1, 2, 12, 13, 14] as const;
/** How far (m, and in unit rotation components) a wheel or a part under the skin may move from where the last lift read it before the lift is found again: the sag pass lifts up to twice a shortfall, so a millimetre drew the skin 3.3 mm off a hold found every frame (bar 2 mm). */
const WHEEL_SLACK = 5e-4;
/** How far (m) the skin stands over a part under it (`liftOverParts`): the 5 mm the drawn skin keeps over a tyre. */
const PART_CLEAR = 0.005;
/** A part's top is read at its highest vertex in each plan cell this wide (m): a skin over the part clears every vertex of the cell to within its tilt over 5 cm. */
const TOP_CELL = 0.05;
/** Per part geometry, its top samples in its own frame (`topSamples`). */
const topsOf = new WeakMap<THREE.BufferGeometry, Float32Array>();
/** The samples of the parts under the skin in the mesh's frame (x, y + `PART_CLEAR`, z), and the parts' poses read this hold (16 elements a part), grown as needed. */
const _part = { samples: new Float64Array(0), skin: new Float64Array(0), corner: new Int32Array(0), poses: new Float64Array(0) };
const _seat = new THREE.Matrix4();
const _top = new THREE.Vector3();
const NO_PARTS: readonly PartSeat[] = [];

/** Whether any point of `skin` stands more than `PART_CLEAR` off `rest`: a crush that may have folded the skin onto what is under it. */
function movedOffRest(skin: Float32Array, rest: Float32Array): boolean {
  for (let i = 0; i < skin.length; i++) if (Math.abs(skin[i]! - rest[i]!) > PART_CLEAR) return true;
  return false;
}

/**
 * How far (m) a sagging triangle's liftable corners are lifted for a point `short` under the tyre, `share` of whose height they carry: the
 * whole shortfall over the share from `SAG_LIFTABLE` up, fading to none at `SAG_LIFT_FROM`, so the lift follows the share without a step.
 */
function sagLift(short: number, share: number): number {
  const ramp = Math.min(1, (share - SAG_LIFT_FROM) / (SAG_LIFTABLE - SAG_LIFT_FROM));
  return ramp > 0 ? (short * ramp) / share : 0;
}

/** The first corner (index in `tris`) of each distinct welded point among `tris`' corners, ascending. */
function firstCorners(tris: Int32Array, weld: Int32Array, points: number): Int32Array {
  const seen = new Uint8Array(points);
  const firsts: number[] = [];
  for (let k = 0; k < tris.length; k++) {
    const p = weld[tris[k]!]!;
    if (seen[p] === 0) {
      seen[p] = 1;
      firsts.push(k);
    }
  }
  return Int32Array.from(firsts);
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
const _root = new THREE.Matrix4();
const _hub = new THREE.Vector3();

/** `obj`'s matrix in the frame of `root` (null: the world), from the local matrices alone (the world matrices are a frame old until the render). */
function matrixIn(root: THREE.Object3D | null, obj: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
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
/** The sag pass's wheel (`readSagWheel`, with `_h` and `_a`), a lattice point as held and as it rested, and the rest frame's hub and axle. */
const _sag = { scale: 0, restScale: 0, r: 0, halfW: 0, flat: 0, fx: 0, fz: 0 };
const _pt = new Float64Array(3);
const _restPt = new Float64Array(3);
const _restHub = new Float64Array(3);
const AXLE_X = Float64Array.of(1, 0, 0);
/** The run (first and last `j`) of a sag lattice row still read (`narrowRow`); `to` under `from`: none. */
const _row = { from: 0, to: 0 };
/** The least change (m, or of share) a value read along a lattice row must make a point for `narrowRow` to bound the row by it: under it, rounding could move the bound by points. */
const ROW_SLOPE_MIN = 1e-9;
/** How far (m) past the tyre's top plus `SAG_CLEAR` a row's run keeps its points: the top's square root turns a rounding of the least reach into up to 1e-8 m. */
const ROW_TOP_SLACK = 1e-6;

/**
 * Narrows `_row` to the points `j` whose `q0 + j·qd` (a value linear along a sag lattice row of `n + 1` points) may lie strictly between `lo` and
 * `hi`, a point wider either side: the points read pointwise there give the same values up to rounding.
 */
function narrowRow(q0: number, qd: number, lo: number, hi: number, n: number): void {
  if (Math.abs(qd) < ROW_SLOPE_MIN) {
    const spread = (n + 1) * ROW_SLOPE_MIN;
    if (q0 + spread <= lo || q0 - spread >= hi) _row.to = -1;
    return;
  }
  const j1 = (lo - q0) / qd;
  const j2 = (hi - q0) / qd;
  _row.from = Math.max(_row.from, Math.floor(Math.min(j1, j2)) - 1);
  _row.to = Math.min(_row.to, Math.ceil(Math.max(j1, j2)) + 1);
}

/** Which of the sag read's four bounds point `p` of `pos` (height `y`) lies past, as bits: ahead of `reach` (1), behind it (2), past `edge` along the axle (4), before it (8). Corners sharing a bit hold the whole triangle past that bound. */
function sidesPast(pos: Float32Array, p: number, y: number, reach: number, edge: number): number {
  const dx = pos[p]! - _h[0]!;
  const dz = pos[p + 2]! - _h[2]!;
  const ahead = dx * _sag.fx + dz * _sag.fz;
  const along = dx * _a[0]! + (y - _h[1]!) * _a[1]! + dz * _a[2]!;
  return (ahead > reach ? 1 : 0) | (ahead < -reach ? 2 : 0) | (along > edge ? 4 : 0) | (along < -edge ? 8 : 0);
}
/**
 * A floor (m) under the tyre clearance (`clearOver`, no gap) of every point within the tyre's radius out along the road of the triangle of corners
 * `a`, `b`, `c` of `pos` (heights `ya`, `yb`, `yc`): there the clearance is convex, so its tangent plane at the centroid stays under it. -Infinity
 * for a centroid past the radius. The sag read takes nothing past it (`sagTop` ends inside the radius).
 */
function sagFloor(pos: Float32Array, a: number, b: number, c: number, ya: number, yb: number, yc: number): number {
  const cx = (pos[a]! + pos[b]! + pos[c]!) / 3;
  const cy = (ya + yb + yc) / 3;
  const cz = (pos[a + 2]! + pos[b + 2]! + pos[c + 2]!) / 3;
  const dx = cx - _h[0]!;
  const dy = cy - _h[1]!;
  const dz = cz - _h[2]!;
  const { fx, fz, r, halfW } = _sag;
  const ahead = dx * fx + dz * fz;
  if (Math.abs(ahead) >= r) return -Infinity;
  const along = dx * _a[0]! + dy * _a[1]! + dz * _a[2]!;
  const ux = -fz * _a[1]!;
  const uy = fz * _a[0]! - fx * _a[2]!;
  const uz = fx * _a[1]!;
  const root = Math.sqrt(r * r - ahead * ahead);
  const clear = ux * dx + uy * dy + uz * dz - root + FALL * Math.max(0, Math.abs(along) - halfW);
  // The clearance's slope: the arc's (`ahead / root` along the road) and the fall past the tread's edge.
  const slope = ahead / root;
  const fall = Math.abs(along) > halfW ? (along > 0 ? FALL : -FALL) : 0;
  const gx = ux + slope * fx + fall * _a[0]!;
  const gy = uy + fall * _a[1]!;
  const gz = uz + slope * fz + fall * _a[2]!;
  const toA = gx * (pos[a]! - cx) + gy * (ya - cy) + gz * (pos[a + 2]! - cz);
  const toB = gx * (pos[b]! - cx) + gy * (yb - cy) + gz * (pos[b + 2]! - cz);
  const toC = gx * (pos[c]! - cx) + gy * (yc - cy) + gz * (pos[c + 2]! - cz);
  return clear + Math.min(toA, toB, toC);
}
/** Bytes of `TyreSkin.dirty` read at once to pass the clean ones: few of a hold's points are dirty. */
const DIRTY_WORD = Uint32Array.BYTES_PER_ELEMENT;

/**
 * The share of two skin points' rest height apart that a lift under the lower one leaves between them: a held point lifts the skin resting above it, less
 * the rest of the way between. Each held point lifted to its own height alone, a crushed nose's side stacked into one band and crossed itself.
 */
const ROW_KEEP = 0.1;
/** How fast (m per m of rest distance) a carried lift falls off along the skin at least: past the rows above a held point it spreads a hand's width, where a near-flat deck would carry it whole. */
const SPREAD = 0.5;

/** A mesh's edges between distinct rest points (a crease's copies welded into one), each from its lower end to its higher one. The points are numbered lowest first, so an edge always leads to a higher number. */
type RestEdges = { weld: Int32Array; start: Int32Array; to: Int32Array; drop: Float32Array };

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
  const order = Int32Array.from(points.keys()).sort((p, q) => rest[points[p]! * 3 + 1]! - rest[points[q]! * 3 + 1]!);
  const rank = new Int32Array(points.length);
  for (let k = 0; k < order.length; k++) rank[order[k]!] = k;
  for (let v = 0; v < count; v++) weld[v] = rank[weld[v]!]!;
  const start = new Int32Array(points.length + 1);
  for (let k = 0; k < order.length; k++) start[k + 1] = start[k]! + up[order[k]!]!.length;
  const to = new Int32Array(start[points.length]!);
  const drop = new Float32Array(to.length);
  for (let k = 0; k < order.length; k++) {
    const p = order[k]!;
    const from = points[p]! * 3;
    for (let e = 0; e < up[p]!.length; e++) {
      const q = up[p]![e]!;
      const at = points[q]! * 3;
      to[start[k]! + e] = rank[q]!;
      const rise = rest[at + 1]! - rest[from + 1]!;
      drop[start[k]! + e] = Math.max((1 - ROW_KEEP) * rise, SPREAD * hypot3(rest[at]! - rest[from]!, rise, rest[at + 2]! - rest[from + 2]!));
    }
  }
  return { weld, start, to, drop };
}

/** Each welded point's neighbours over every edge of the mesh (CSR, `start`/`to`), and `rep`, a vertex standing for each point. */
type SkinNeighbours = { start: Int32Array; to: Int32Array; rep: Int32Array };

function skinNeighbours(weld: Int32Array, points: number, index: THREE.BufferAttribute | null): SkinNeighbours {
  const rep = new Int32Array(points).fill(-1);
  for (let v = 0; v < weld.length; v++) if (rep[weld[v]!]! < 0) rep[weld[v]!] = v;
  const corners = index ? index.count : weld.length;
  const corner = (k: number): number => weld[index ? index.getX(k) : k]!;
  const raw = new Int32Array(points + 1);
  for (let t = 0; t + 2 < corners; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = corner(t + k);
      const b = corner(t + ((k + 1) % 3));
      if (a === b) continue;
      raw[a + 1]!++;
      raw[b + 1]!++;
    }
  }
  for (let p = 0; p < points; p++) raw[p + 1] = raw[p + 1]! + raw[p]!;
  const filled = raw.slice(0, points);
  const all = new Int32Array(raw[points]!);
  for (let t = 0; t + 2 < corners; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = corner(t + k);
      const b = corner(t + ((k + 1) % 3));
      if (a === b) continue;
      all[filled[a]!++] = b;
      all[filled[b]!++] = a;
    }
  }
  // An edge shared by two triangles was listed twice: keep each neighbour once per point.
  const start = new Int32Array(points + 1);
  const seen = new Int32Array(points).fill(-1);
  let n = 0;
  for (let p = 0; p < points; p++) {
    for (let e = raw[p]!; e < raw[p + 1]!; e++) {
      const q = all[e]!;
      if (seen[q] === p) continue;
      seen[q] = p;
      all[n++] = q;
    }
    start[p + 1] = n;
  }
  const to = all.slice(0, n);
  return { start, to, rep };
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
  private readonly neighbours: SkinNeighbours;
  /** `levelLift`'s worklist (a ring: a point is queued once at a time) and whether each point is in it. */
  private readonly levelQueue: Int32Array;
  private readonly levelQueued: Uint8Array;
  /** Per welded rest point (`RestEdges.weld`), the lift (m, up the mesh) this hold gives it. */
  private readonly lift: Float32Array;
  /** Per welded rest point, the push (m, along `pushDir`, the axle turned outward) this hold gives it instead of a lift. */
  private readonly push: Float32Array;
  /** Per welded rest point, the most (m) the points of one `liftSaggingTriangles` read ask it lifted further. */
  private readonly bump: Float32Array;
  private readonly pushDir: Float32Array;
  /** Per wheel and vertex, how far (m) it rests over the tyre's surface; NaN for one that does not rest over it. */
  private readonly over: Float32Array[] = [];
  /** Per wheel, the vertices with a point in `over` (not NaN), ascending. */
  private readonly overAt: Int32Array[] = [];
  /** Per vertex, bit w: it rests over wheel w's tyre (`over[w]` is not NaN). */
  private readonly liftable: Uint8Array;
  /** Per wheel, the corners (vertex ids, three a triangle) of the triangles with a point resting over its tyre. */
  private readonly overTris: Int32Array[] = [];
  /** Per wheel, the lift of each corner of its `overTris` when the sag passes last read it this hold (`cornersRose`). */
  private readonly sagRead: Float32Array[] = [];
  /** Per wheel, the first corner (an index in its `overTris`) of each distinct welded point among them, ascending. */
  private readonly sagFirst: Int32Array[] = [];
  /** What the kernel's sag pass reads and writes of this skin (`TyreSagArena.sagPass`). */
  private readonly sagSkin: SagSkin;
  /** The class lift, hub shift and wheel scale `over` was found for. */
  private readonly overFor = new Float64Array(3).fill(NaN);
  /** Per wheel, its axle and hub in the mesh's frame at the last hold. */
  private readonly heldAt = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** The skin as last written, which every hold starts from. */
  private readonly written: Float32Array;
  private hasWritten = false;
  /** Whether the last hold moved any drawn point: until one does, the drawn skin is `written` as it stands, and nothing need be put back, re-shaded or re-uploaded. */
  private held = false;
  /** Each shown part's pose in the mesh's frame when the floor was last found (16 elements a part), and how many were shown. */
  private partPoseAt = new Float64Array(0);
  private partsShown = 0;
  /** Per welded rest point, the lift (m) that keeps the skin as last written over the parts under it (`liftOverParts`): every hold's tyre lift starts from it. */
  private readonly partFloor: Float32Array;
  /** Per welded rest point, the lift its own tyres and the parts under it ask (`needOver` over `partFloor`): what `capAtRest` never cuts. */
  private readonly ownLift: Float32Array;
  /** Per welded rest point, whether it rose since it last carried its lift and push up the mesh (`carryLift`). */
  private readonly dirty: Uint8Array;
  /** `dirty`'s bytes a `DIRTY_WORD` at a time (the bytes past the last point stay zero): a word with none dirty is passed in one read. */
  private readonly dirtyWords: Uint32Array;
  /** Per wheel, its axle and hub as this hold read them; `heldAt` takes them when the lift is found again. */
  private readonly wheelNow = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** Per wheel, its matrix in the mesh's frame while it was last on the car: where a torn-off wheel's fading hold stands (`leaveShare`). */
  private readonly seat = new Float64Array(4 * 16).fill(NaN);
  /** Per wheel, the share of its hold it keeps (`leaveShare`): 1 on the car. */
  private readonly fade = new Float64Array(4).fill(1);
  /** Whether the skin as last written stands off its rest anywhere (`movedOffRest`): only then may anything under it stand through it. */
  private crushed = false;
  /** The skin was rewritten outside the writer since the last hold (`rewritten`): the next hold starts from it. */
  private skinRewritten = false;
  /** The vertices the last `applyLift` moved (`liftedCount` of them), the hold's before (`liftedBefore`), and the scratch `changedSince` lists into. */
  private lifted: Int32Array;
  private liftedCount = 0;
  private liftedBefore: Int32Array;
  private liftedBeforeCount = 0;
  private readonly near: Int32Array;

  /** Whether a vertex beside a tyre's end leaves by the tyre's side (the body paint) rather than over its top (a bonnet's chords need the top). */
  private readonly pushSide: boolean;
  /** Per vertex, 1 for a wheel well's liner: it rests close round its tyre, so a sag lift of its own drew the arch's lip with it (levelLift) when a wheel moved up into it. */
  private readonly sagFree: Uint8Array;
  /** The out-along-the-road shares of the tyre's radius the sag pass reads a triangle whole to and not past: the body's lift fades out where its push fades in (`END_BLEND`). */
  private readonly sagTop: Float64Array;
  /** Per wheel, its hub in the mesh's frame when `over` was found: what the rest skin's own clearance is read against. */
  private readonly restHub = new Float64Array(4 * 3);

  /** `rest`: the mesh's rest positions in its own frame. */
  constructor(frame: CarFrame, mesh: THREE.Mesh, rest: Float32Array, pushSide: boolean) {
    this.pushSide = pushSide;
    this.sagTop = Float64Array.of(pushSide ? ENDS_ZONE - END_BLEND : SAG_TOP_AHEAD - SAG_EDGE_FADE, pushSide ? ENDS_ZONE : SAG_TOP_AHEAD);
    this.sagFree = new Uint8Array(rest.length / 3);
    const tone = mesh.geometry.getAttribute(PRIMER_ATTRIBUTE);
    // A tone nearer the liner's than the bay panel's: the bay's arch edges blend from one to the other.
    if (tone) for (let v = 0; v < this.sagFree.length; v++) this.sagFree[v] = tone.getX(v) >= (INNER_PANEL + WELL_PANEL) / 2 ? 1 : 0;
    this.frame = frame;
    this.mesh = mesh;
    this.rest = rest;
    this.edges = restEdges(rest, mesh.geometry.index);
    const points = this.edges.start.length - 1;
    this.neighbours = skinNeighbours(this.edges.weld, points, mesh.geometry.index);
    this.levelQueue = new Int32Array(points);
    this.levelQueued = new Uint8Array(points);
    this.lift = new Float32Array(points);
    this.push = new Float32Array(points);
    this.bump = new Float32Array(points);
    this.partFloor = new Float32Array(points);
    this.ownLift = new Float32Array(points);
    const dirtyBytes = new ArrayBuffer(Math.ceil(points / DIRTY_WORD) * DIRTY_WORD);
    this.dirty = new Uint8Array(dirtyBytes);
    this.dirtyWords = new Uint32Array(dirtyBytes);
    this.pushDir = new Float32Array(points * 3);
    this.written = new Float32Array(rest.length);
    this.liftable = new Uint8Array(rest.length / 3);
    this.lifted = new Int32Array(rest.length / 3);
    this.liftedBefore = new Int32Array(rest.length / 3);
    this.near = new Int32Array((2 * rest.length) / 3);
    this.sagSkin = { serial: 0, weld: this.edges.weld, liftable: this.liftable, sagFree: this.sagFree, rest, lift: this.lift, dirty: this.dirty, overTris: this.overTris, sagRead: this.sagRead, heldAt: this.heldAt, restHub: this.restHub, restScale: this.overFor, sagTop: this.sagTop, fade: this.fade };
  }

  /** The skin as last written, before this hold lifted any of it; null until a hold has read one. */
  get unheld(): Float32Array | null {
    return this.hasWritten ? this.written : null;
  }

  /** The mesh's positions were rewritten outside the writer (a reset, a net or replay state): the next hold starts from them, not from the skin it kept. */
  rewritten(): void {
    this.skinRewritten = true;
  }

  /** The kernel the sag pass runs in once it is loaded; null: the JS below, which is its reference. */
  private get kernel(): SkinKernel | null {
    return skinKernel();
  }

  /** The vertices resting over each tyre: the class's lift, hub shift and wheel scale change what that is. True when they were found again. */
  private findOver(group: THREE.Object3D, wheels: readonly THREE.Object3D[], lift: number): boolean {
    const hubs = wheels[0]!.parent!;
    const hubShift = hubs === group ? 0 : hubs.position.y;
    const scale = wheels[0]!.scale.x;
    const f = this.overFor;
    if (f[0] === lift && f[1] === hubShift && f[2] === scale) return false;
    f[0] = lift;
    f[1] = hubShift;
    f[2] = scale;
    this.liftable.fill(0);
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
      const resting: number[] = [];
      for (let i = 0; i < this.rest.length; i += 3) {
        const c = clearOver(this.frame.rig.tyre, this.rest, i, _h, _a, scale, 0);
        const restsOver = c >= -REST_SLACK && c < REACH;
        over[i / 3] = restsOver ? c : NaN;
        if (restsOver) {
          this.liftable[i / 3]! |= 1 << w;
          resting.push(i / 3);
        }
      }
      this.overAt[w] = Int32Array.from(resting);
      this.overTris[w] = this.trianglesOver(over);
      this.restHub.set(_h, w * 3);
      this.sagRead[w] = new Float32Array(this.overTris[w].length);
      this.sagFirst[w] = firstCorners(this.overTris[w], this.edges.weld, this.lift.length);
    }
    return true;
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

  /** Holds the skin over each tyre of `wheels` not in `gone` (bit i: wheel i is the world's) and, fading as it leaves (`leaveShare`), over a gone one at its last seat; and over `under` (parts drawn under it, those whose `showIf` holds). `skinWritten`: the mesh's positions were just written from the cage. */
  hold(group: THREE.Object3D, wheels: readonly THREE.Object3D[], gone: number, lift: number, skinWritten: boolean, under: readonly PartSeat[] = []): void {
    const overFound = this.findOver(group, wheels, lift);
    matrixIn(group, this.mesh, _mesh).invert();
    let wheelMoved = false;
    // Bit w: wheel w's hold has ended (gone and left its seat).
    let out = 0;
    for (let w = 0; w < wheels.length; w++) {
      const seat = this.seat.subarray(w * 16, w * 16 + 16);
      let fade = 1;
      if ((gone >> w) & 1) {
        fade = this.leaveShare(group, wheels[w]!, seat);
        if (fade <= 0) out |= 1 << w;
        if (this.noteWheel(w, fade > 0 ? seat : null)) wheelMoved = true;
      } else {
        _wheel.multiplyMatrices(_mesh, matrixIn(group, wheels[w]!, _wheel));
        seat.set(_wheel.elements);
        if (this.noteWheel(w, _wheel.elements)) wheelMoved = true;
      }
      if (fade !== this.fade[w]) wheelMoved = true;
      this.fade[w] = fade;
    }

    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const rewritten = this.skinRewritten && !skinWritten;
    const fresh = skinWritten || rewritten || !this.hasWritten;
    this.skinRewritten = false;
    if (fresh) {
      this.written.set(pos);
      this.hasWritten = true;
      this.crushed = movedOffRest(this.written, this.rest);
    }
    // An uncrushed skin has nothing crushed under it to stand over.
    const partsMoved = this.notePartPoses(group, this.crushed ? under : NO_PARTS);
    // The lift is a function of the skin, the points resting over the tyres, the wheels and the parts: none changed, the drawn skin already carries it.
    if (!fresh && !overFound && !wheelMoved && !partsMoved) return;
    // A skin rewritten under wheels within the slack (a held reset) is held where the drawn lift read them: it draws the same body.
    if (!rewritten || wheelMoved) this.heldAt.set(this.wheelNow);
    const reset = !fresh && this.held;
    if (reset) pos.set(this.written);
    if (fresh || partsMoved) this.findPartFloor(pos, this.partsShown > 0 ? this.partSamples(group, under) : 0);
    this.lift.set(this.partFloor);
    this.push.fill(0);
    for (let w = 0; w < wheels.length; w++) {
      if ((out >> w) & 1) continue;
      const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
      const scale = hypot3(e[0]!, e[1]!, e[2]!);
      for (let k = 0; k < 3; k++) {
        _a[k] = e[k]! / scale;
        _h[k] = e[3 + k]!;
      }
      this.needOver(pos, w, scale);
    }
    this.ownLift.set(this.lift);
    this.carryLift();
    // Bit w: wheel w's last read lifted nothing; until a corner of its triangles rises, reading it again finds the same.
    let quiet = 0;
    this.sagSkin.serial++;
    for (let pass = 0; pass < SAG_PASSES; pass++) {
      let sagged = false;
      for (let w = 0; w < wheels.length; w++) {
        if ((out >> w) & 1 || ((quiet >> w) & 1 && !this.cornersRose(w))) continue;
        if (this.liftSaggingTriangles(pos, w, pass > 0)) {
          sagged = true;
          quiet &= ~(1 << w);
        } else quiet |= 1 << w;
      }
      if (!sagged) break;
      this.carryLift();
    }
    this.capAtRest(wheels.length, out);
    this.levelLift(pos);
    const held = this.applyLift(pos);
    const changed = this.changedSince(reset);
    const wasHeld = this.held;
    this.held = held;
    // Unheld, the positions are the writer's (fresh) or as they stood: its normals still match.
    if (!held && (fresh || !wasHeld)) return;
    attr.needsUpdate = true;
    computeNormalsNear(this.mesh.geometry, this.near, changed);
  }

  /** How much of its hold a gone wheel keeps at its last `seat` (mesh frame): whole in its arch, none once its hub is `LEAVE_FADE` tyre radii off it. */
  private leaveShare(group: THREE.Object3D, wheel: THREE.Object3D, seat: Float64Array): number {
    _root.copy(matrixIn(null, group, _root)).invert();
    _wheel.multiplyMatrices(_mesh, _root.multiply(matrixIn(null, wheel, _wheel)));
    const e = _wheel.elements;
    const off = hypot3(e[12]! - seat[12]!, e[13]! - seat[13]!, e[14]! - seat[14]!);
    const fade = 1 - off / (LEAVE_FADE * this.frame.rig.tyre.r * hypot3(seat[0]!, seat[1]!, seat[2]!));
    return Number.isNaN(fade) ? 0 : Math.min(1, Math.max(0, fade));
  }

  /** Raises each point's lift to at least its neighbours' less `LEVEL_SLOPE` of written edge, until none is short (lifts only rise, so it ends): the skin between a held row and its neighbours stays a slope. */
  private levelLift(pos: Float32Array): void {
    const { start, to, rep } = this.neighbours;
    const { lift, levelQueue: queue, levelQueued: queued } = this;
    const points = lift.length;
    let head = 0;
    let size = 0;
    for (let p = 0; p < points; p++) {
      if (lift[p]! <= REST_SLACK) continue;
      queue[size++] = p;
      queued[p] = 1;
    }
    while (size > 0) {
      const p = queue[head]!;
      head = head + 1 === points ? 0 : head + 1;
      size--;
      queued[p] = 0;
      const a = rep[p]! * 3;
      for (let e = start[p]!; e < start[p + 1]!; e++) {
        const q = to[e]!;
        const b = rep[q]! * 3;
        const carried = lift[p]! - LEVEL_SLOPE * hypot3(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!);
        if (carried <= lift[q]!) continue;
        lift[q] = carried;
        if (queued[q] === 1) continue;
        queued[q] = 1;
        queue[(head + size) % points] = q;
        size++;
      }
    }
  }

  /**
   * No carried, sag or levelled lift raises a point over the higher of where it rested and the standing tyres' top plus the gap `needOver` holds over them; its own tyre lift stays whole.
   * One top for every point keeps the cap rising with rest height, so it keeps the rest order `carryLift` holds: a per-point tyre folded rows the crush moved over a tyre.
   */
  private capAtRest(wheels: number, gone: number): void {
    const { lift, ownLift, rest, written, heldAt } = this;
    const { rep } = this.neighbours;
    const { r, halfW } = this.frame.rig.tyre;
    const gap = this.pushSide ? BODY_TYRE_GAP : TYRE_GAP;
    let tyreTop = -Infinity;
    for (let w = 0; w < wheels; w++) {
      if ((gone >> w) & 1) continue;
      const e = heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
      // The axle's columns carry the wheel's scale.
      tyreTop = Math.max(tyreTop, e[4]! + Math.abs(e[1]!) * halfW + hypot2(e[0]!, e[2]!) * r + gap);
    }
    for (let p = 0; p < lift.length; p++) {
      const y = rep[p]! * 3 + 1;
      const cap = Math.max(ownLift[p]!, Math.max(rest[y]!, tyreTop) - written[y]!);
      if (lift[p]! > cap) lift[p] = cap;
    }
  }

  /** Adds each welded point's lift and push to its vertices in `pos`, listing those vertices (`lifted`); true when a drawn position changed (a resting skin's points read lifts of a nanometre, the rest clearance's rounding, under a float's step). */
  private applyLift(pos: Float32Array): boolean {
    let held = false;
    let n = 0;
    const { weld } = this.edges;
    for (let v = 0; v < weld.length; v++) {
      const p = weld[v]!;
      const up = this.lift[p]!;
      const out = this.push[p]!;
      if (up > 0 || out > 0) this.lifted[n++] = v;
      if (up > 0) {
        const y = pos[v * 3 + 1]!;
        pos[v * 3 + 1] = y + up;
        if (pos[v * 3 + 1] !== y) held = true;
      }
      if (out > 0)
        for (let k = 0; k < 3; k++) {
          const x = pos[v * 3 + k]!;
          pos[v * 3 + k] = x + out * this.pushDir[p * 3 + k]!;
          if (pos[v * 3 + k] !== x) held = true;
        }
    }
    this.liftedCount = n;
    return held;
  }

  /** Lists in `near` the vertices whose positions may differ from those the normals were last made for: this hold's lifted ones, and the last hold's when `reset` put the written skin back under them; returns how many. This hold's become the last's. */
  private changedSince(reset: boolean): number {
    let n = 0;
    for (let k = 0; k < this.liftedCount; k++) this.near[n++] = this.lifted[k]!;
    if (reset) for (let k = 0; k < this.liftedBeforeCount; k++) this.near[n++] = this.liftedBefore[k]!;
    const before = this.liftedBefore;
    this.liftedBefore = this.lifted;
    this.lifted = before;
    this.liftedBeforeCount = this.liftedCount;
    return n;
  }

  /** Reads the poses of the shown parts of `under` in the mesh's frame (`partsShown` of them); true when any moved past `WHEEL_SLACK` from `partPoseAt`, or one came or went, and then keeps them there. */
  private notePartPoses(group: THREE.Object3D, under: readonly PartSeat[]): boolean {
    let n = 0;
    for (const seat of under) {
      if (seat.showIf && !seat.showIf()) continue;
      if (_part.poses.length < (n + 1) * 16) {
        const grown = new Float64Array(2 * (n + 1) * 16);
        grown.set(_part.poses);
        _part.poses = grown;
      }
      _part.poses.set(_seat.multiplyMatrices(_mesh, matrixIn(group, seat, _seat)).elements, n * 16);
      n++;
    }
    let moved = n !== this.partsShown;
    for (let k = 0; k < n * 16 && !moved; k++) if (Math.abs(_part.poses[k]! - this.partPoseAt[k]!) > WHEEL_SLACK) moved = true;
    this.partsShown = n;
    if (moved) this.partPoseAt = _part.poses.slice(0, n * 16);
    return moved;
  }

  /** The part lift of the skin as last written (`pos`) over the `count` part samples, carried up the mesh and read again until none is short, into `partFloor`. */
  private findPartFloor(pos: Float32Array, count: number): void {
    this.lift.fill(0);
    this.dirty.fill(0);
    for (let pass = 0; pass < SAG_PASSES && count > 0; pass++) {
      if (!this.liftOverParts(pos, count)) break;
      this.carryLift();
    }
    this.partFloor.set(this.lift);
  }

  /** Fills `_part.samples` with the top samples (`topSamples`) of the shown parts of `under` in the mesh's frame, each raised by `PART_CLEAR`; returns their count. */
  private partSamples(group: THREE.Object3D, under: readonly PartSeat[]): number {
    let n = 0;
    for (const seat of under) {
      if (seat.showIf && !seat.showIf()) continue;
      const top = topSamples(seat.drawn);
      if (_part.samples.length < (n + top.length / 3) * 3) {
        const grown = new Float64Array(2 * (_part.samples.length + top.length));
        grown.set(_part.samples);
        _part.samples = grown;
      }
      _seat.multiplyMatrices(_mesh, matrixIn(group, seat, _seat));
      for (let i = 0; i < top.length; i += 3, n++) {
        _top.set(top[i]!, top[i + 1]!, top[i + 2]!).applyMatrix4(_seat);
        _part.samples[n * 3] = _top.x;
        _part.samples[n * 3 + 1] = _top.y + PART_CLEAR;
        _part.samples[n * 3 + 2] = _top.z;
      }
    }
    if (_part.skin.length < n) {
      _part.skin = new Float64Array(_part.samples.length / 3);
      _part.corner = new Int32Array(_part.samples.length / 3);
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
      const t = _part.corner[n]!;
      const short = _part.samples[n * 3 + 1]! - _part.skin[n]!;
      if (t < 0 || short <= 0) continue;
      for (let corner = 0; corner < 3; corner++) {
        const p = weld[this.corner(t + corner)]!;
        if (short > this.bump[p]!) this.bump[p] = short;
      }
      raised = true;
    }
    if (!raised) return false;
    for (let p = 0; p < this.bump.length; p++) {
      if (this.bump[p]! > 0) this.dirty[p] = 1;
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

  /** Per part sample, the height (`_part.skin`) of the highest up-facing triangle of the skin (lifts included) over it in plan and that triangle's first corner (`_part.corner`, -1: none). */
  private readPartSkin(pos: Float32Array, count: number): void {
    _part.skin.fill(-Infinity, 0, count);
    _part.corner.fill(-1, 0, count);
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
        const x = _part.samples[n * 3]!;
        const z = _part.samples[n * 3 + 2]!;
        if (x < xLow || x > xHigh || z < zLow || z > zHigh) continue;
        const l1 = ((pos[b + 2]! - pos[c + 2]!) * (x - pos[c]!) + (pos[c]! - pos[b]!) * (z - pos[c + 2]!)) / den;
        const l2 = ((pos[c + 2]! - pos[a + 2]!) * (x - pos[c]!) + (pos[a]! - pos[c]!) * (z - pos[c + 2]!)) / den;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const y = l1 * ya + l2 * yb + (1 - l1 - l2) * yc;
        if (y <= _part.skin[n]!) continue;
        _part.skin[n] = y;
        _part.corner[n] = t;
      }
    }
  }

  /**
   * A skin point held over a tyre is no tyre-top clearance for the triangle it shares with points the crush left away from it: a nose's
   * edge stretched across the tyre sags under the arc between its lifted corner and its low ones. Each triangle with a point resting over
   * wheel `w`'s tyre is read at points fixed on it (`sagTriangle`), wherever it lies: read only where the tyre's top samples met the topmost
   * triangle, the lift jumped with the crush's folds sliding over one another (a fascia layer 0.13 m every other frame). `again`: an earlier
   * pass of this hold read them. True when any is lifted.
   */
  private liftSaggingTriangles(pos: Float32Array, w: number, again: boolean): boolean {
    const kernel = this.kernel;
    if (kernel) return kernel.tyre.sagPass(this.sagSkin, pos, w, again, this.frame.rig.tyre);
    this.readSagWheel(w);
    const tris = this.overTris[w]!;
    const { weld } = this.edges;
    const read = this.sagRead[w]!;
    let lowest = Infinity;
    for (let k = 0; k < tris.length; k++) lowest = Math.min(lowest, pos[tris[k]! * 3 + 1]! + this.lift[weld[tris[k]!]!]!);
    // A triangle's point is a blend of its corners': with every corner over the tyre's top and the clearance, none can stand short.
    const overTop = lowest > _h[1]! + Math.abs(_a[1]!) * _sag.halfW + _sag.flat * _sag.r + SAG_CLEAR;
    let raised = false;
    for (let t = 0; t < tris.length; t += 3) {
      // Read again, a triangle whose corners kept the lifts of its last read asks what it asked then: nothing, or a corner would have risen.
      let rose = !again;
      for (let k = t; k < t + 3; k++) {
        const lift = this.lift[weld[tris[k]!]!]!;
        if (lift !== read[k]) rose = true;
        read[k] = lift;
      }
      if (rose && !overTop && this.sagTriangle(pos, w, t)) raised = true;
    }
    if (!raised) return false;
    for (let k = 0; k < tris.length; k++) {
      const p = weld[tris[k]!]!;
      if (this.bump[p]! > 0) this.dirty[p] = 1;
      this.lift[p] = this.lift[p]! + this.bump[p]!;
      this.bump[p] = 0;
    }
    return true;
  }

  /** Wheel `w`'s tyre as the sag pass reads it, into `_h`, `_a` and `_sag`: its hub, unit axle and size at the last hold, and its hub and scale when `over` was found. */
  private readSagWheel(w: number): void {
    const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
    const scale = hypot3(e[0]!, e[1]!, e[2]!);
    for (let k = 0; k < 3; k++) {
      _a[k] = e[k]! / scale;
      _h[k] = e[3 + k]!;
      _restHub[k] = this.restHub[w * 3 + k]!;
    }
    _sag.scale = scale;
    _sag.restScale = this.overFor[2]!;
    _sag.r = this.frame.rig.tyre.r * scale;
    _sag.halfW = this.frame.rig.tyre.halfW * scale;
    _sag.flat = hypot2(_a[0]!, _a[2]!);
    _sag.fx = -_a[2]! / _sag.flat;
    _sag.fz = _a[0]! / _sag.flat;
  }

  /**
   * Triangle `t` (its first corner in wheel `w`'s `overTris`) read at points of a lattice fixed on it, `SAG_STEP` apart along its longest edge:
   * a point under the tyre's surface plus `SAG_CLEAR` (or its rest clearance, if less: the uncrushed skin never moves), over the tyre's top
   * (`sagTop`, `SAG_EDGE_FADE`), asks the triangle's liftable corners up by `sagLift`, into `bump`. True when it asked any.
   */
  private sagTriangle(pos: Float32Array, w: number, t: number): boolean {
    const tris = this.overTris[w]!;
    const over = this.over[w]!;
    const { weld } = this.edges;
    const { lift, bump, rest } = this;
    const tyre = this.frame.rig.tyre;
    const va = tris[t]!;
    const vb = tris[t + 1]!;
    const vc = tris[t + 2]!;
    if (this.sagFree[va]! + this.sagFree[vb]! + this.sagFree[vc]! > 0) return false;
    const a = va * 3;
    const b = vb * 3;
    const c = vc * 3;
    const ya = pos[a + 1]! + lift[weld[va]!]!;
    const yb = pos[b + 1]! + lift[weld[vb]!]!;
    const yc = pos[c + 1]! + lift[weld[vc]!]!;
    const la = !Number.isNaN(over[va]!);
    const lb = !Number.isNaN(over[vb]!);
    const lc = !Number.isNaN(over[vc]!);
    if (this.sagOffTop(pos, a, b, c, ya, yb, yc) || sagFloor(pos, a, b, c, ya, yb, yc) >= SAG_CLEAR + SAG_FLOOR_SLACK) return false;
    const longest = Math.max(hypot3(pos[a]! - pos[b]!, ya - yb, pos[a + 2]! - pos[b + 2]!), hypot3(pos[b]! - pos[c]!, yb - yc, pos[b + 2]! - pos[c + 2]!), hypot3(pos[c]! - pos[a]!, yc - ya, pos[c + 2]! - pos[a + 2]!));
    const order = Math.max(2, Math.ceil(longest / SAG_STEP));
    const full = this.sagTop[0]!;
    const none = this.sagTop[1]!;
    let asked = false;
    const reach = none * _sag.r;
    const edge = _sag.halfW * (1 + SAG_EDGE_FADE);
    // Along a row (`i`) the points step by (b - c) / order: the share, the reach along the road and across the tread change linearly, so only
    // the run of points inside all three is read (`narrowRow`).
    const sx = (pos[b]! - pos[c]!) / order;
    const sy = (yb - yc) / order;
    const sz = (pos[b + 2]! - pos[c + 2]!) / order;
    const aheadStep = sx * _sag.fx + sz * _sag.fz;
    const alongStep = sx * _a[0]! + sy * _a[1]! + sz * _a[2]!;
    const shareStep = ((lb ? 1 : 0) - (lc ? 1 : 0)) / order;
    // `clearOver`'s up, linear along a row too: a point stands over the tyre's top plus `SAG_CLEAR` when up is past the top at the run's least reach.
    const ux = -_sag.fz * _a[1]!;
    const uy = _sag.fz * _a[0]! - _sag.fx * _a[2]!;
    const uz = _sag.fx * _a[1]!;
    const upStep = sx * ux + sy * uy + sz * uz;
    for (let i = 0; i <= order; i++) {
      const n = order - i;
      const u1 = i / order;
      const u3 = n / order;
      const x0 = u1 * pos[a]! + u3 * pos[c]! - _h[0]!;
      const y0 = u1 * ya + u3 * yc - _h[1]!;
      const z0 = u1 * pos[a + 2]! + u3 * pos[c + 2]! - _h[2]!;
      _row.from = 0;
      _row.to = n;
      narrowRow((la ? u1 : 0) + (lc ? u3 : 0), shareStep, SAG_LIFT_FROM, Infinity, n);
      const ahead0 = x0 * _sag.fx + z0 * _sag.fz;
      narrowRow(ahead0, aheadStep, -reach, reach, n);
      narrowRow(x0 * _a[0]! + y0 * _a[1]! + z0 * _a[2]!, alongStep, -edge, edge, n);
      if (_row.from > _row.to) continue;
      const aheadFrom = ahead0 + _row.from * aheadStep;
      const aheadTo = ahead0 + _row.to * aheadStep;
      const least = aheadFrom * aheadTo <= 0 ? 0 : Math.min(Math.abs(aheadFrom), Math.abs(aheadTo));
      narrowRow(x0 * ux + y0 * uy + z0 * uz, upStep, -Infinity, Math.sqrt(Math.max(0, _sag.r * _sag.r - least * least)) + SAG_CLEAR + ROW_TOP_SLACK, n);
      for (let j = _row.from; j <= _row.to; j++) {
        const l1 = i / order;
        const l2 = j / order;
        const l3 = (order - i - j) / order;
        // A point asks nothing off the top or under `SAG_LIFT_FROM` of liftable share (`sagLift`): its clearances are read only past both.
        const share = (la ? l1 : 0) + (lb ? l2 : 0) + (lc ? l3 : 0);
        if (share <= SAG_LIFT_FROM) continue;
        _pt[0] = l1 * pos[a]! + l2 * pos[b]! + l3 * pos[c]!;
        _pt[1] = l1 * ya + l2 * yb + l3 * yc;
        _pt[2] = l1 * pos[a + 2]! + l2 * pos[b + 2]! + l3 * pos[c + 2]!;
        const dx = _pt[0] - _h[0]!;
        const dz = _pt[2] - _h[2]!;
        const ahead = Math.abs(dx * _sag.fx + dz * _sag.fz);
        const along = Math.abs(dx * _a[0]! + (_pt[1] - _h[1]!) * _a[1]! + dz * _a[2]!);
        const onTop = Math.min(1, Math.max(0, (none * _sag.r - ahead) / ((none - full) * _sag.r))) * Math.min(1, Math.max(0, (_sag.halfW * (1 + SAG_EDGE_FADE) - along) / (SAG_EDGE_FADE * _sag.halfW))) * this.fade[w]!;
        if (onTop <= 0) continue;
        // Its clearance with no gap first: the rest skin's own (the gap, never over `SAG_CLEAR`) is read only for a point that may be short.
        const bare = clearOver(tyre, _pt, 0, _h, _a, _sag.scale, 0);
        if (bare >= SAG_CLEAR) continue;
        for (let k = 0; k < 3; k++) _restPt[k] = l1 * rest[a + k]! + l2 * rest[b + k]! + l3 * rest[c + k]!;
        const clear = bare - Math.min(SAG_CLEAR, clearOver(tyre, _restPt, 0, _restHub, AXLE_X, _sag.restScale, 0));
        if (clear >= 0) continue;
        const by = onTop * sagLift(-clear / _sag.flat, share);
        if (by <= 0) continue;
        if (la && by > bump[weld[va]!]!) bump[weld[va]!] = by;
        if (lb && by > bump[weld[vb]!]!) bump[weld[vb]!] = by;
        if (lc && by > bump[weld[vc]!]!) bump[weld[vc]!] = by;
        asked = true;
      }
    }
    return asked;
  }

  /**
   * Whether the triangle of corners `a`, `b`, `c` (indices into `pos`, heights with their lift `ya`, `yb`, `yc`) lies wholly where
   * `sagTriangle` reads nothing: over the tyre's top and the clearance, past one read end along the road, or past one read tread edge.
   */
  private sagOffTop(pos: Float32Array, a: number, b: number, c: number, ya: number, yb: number, yc: number): boolean {
    if (Math.min(ya, yb, yc) > _h[1]! + Math.abs(_a[1]!) * _sag.halfW + _sag.flat * _sag.r + SAG_CLEAR) return true;
    const reach = this.sagTop[1]! * _sag.r;
    const edge = _sag.halfW * (1 + SAG_EDGE_FADE);
    return (sidesPast(pos, a, ya, reach, edge) & sidesPast(pos, b, yb, reach, edge) & sidesPast(pos, c, yc, reach, edge)) !== 0;
  }

  /** Whether a corner of wheel `w`'s triangles rose since the sag passes last read it (`sagRead`): a point's corners all read one lift, so one of them stands for the rest. */
  private cornersRose(w: number): boolean {
    const tris = this.overTris[w]!;
    const read = this.sagRead[w]!;
    const firsts = this.sagFirst[w]!;
    const { weld } = this.edges;
    for (let i = 0; i < firsts.length; i++) {
      const k = firsts[i]!;
      if (this.lift[weld[tris[k]!]!] !== read[k]) return true;
    }
    return false;
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

  /** Each vertex resting over wheel `w`'s tyre standing under its surface plus its gap (`TYRE_GAP`, or its rest clearance if less: the uncrushed skin never moves): the lift up the mesh onto it, into `lift`, but never to above where it rested over the hub. */
  private needOver(pos: Float32Array, w: number, scale: number): void {
    const over = this.over[w]!;
    const resting = this.overAt[w]!;
    const { weld } = this.edges;
    const { lift, push, pushDir, dirty } = this;
    const tyre = this.frame.rig.tyre;
    const gapCap = this.pushSide ? BODY_TYRE_GAP : TYRE_GAP;
    const a0 = _a[0]!;
    const a1 = _a[1]!;
    const a2 = _a[2]!;
    const h0 = _h[0]!;
    const h1 = _h[1]!;
    const h2 = _h[2]!;
    const flat = hypot2(a0, a2);
    const fx = -a2 / flat;
    const fz = a0 / flat;
    const upX = -fz * a1;
    const upY = fz * a0 - fx * a2;
    const upZ = fx * a1;
    const r = tyre.r * scale;
    const halfW = tyre.halfW * scale;
    const endsAhead = ENDS_ZONE * tyre.r * scale;
    for (let k = 0; k < resting.length; k++) {
      const v = resting[k]!;
      const dx = pos[v * 3]! - h0;
      const dy = pos[v * 3 + 1]! - h1;
      const dz = pos[v * 3 + 2]! - h2;
      const ahead = dx * fx + dz * fz;
      const along = dx * a0 + dy * a1 + dz * a2;
      const top = Math.sqrt(Math.max(0, r * r - ahead * ahead)) - FALL * (Math.max(0, Math.abs(ahead) - r) + Math.max(0, Math.abs(along) - halfW));
      const height = upX * dx + upY * dy + upZ * dz;
      const c = height - top - Math.min(gapCap, over[v]!);
      if (c >= 0) continue;
      const p = weld[v]!;
      const rise = -c / flat;
      // A vertex just inside the tyre's end (a lip beside it) leaves along the road, the few mm that clear the steep end, not over the whole tyre (7 mm in took 18 cm of lift): the body skin only.
      // The push takes over from the lift across `END_BLEND` into the end zone and `LEAVE_BLEND` of going over against leaving, so neither crossing moves a step.
      const out = r - Math.abs(ahead) + END_GAP;
      const leave = this.pushSide ? Math.min(1, Math.max(0, (rise - out) / LEAVE_BLEND)) * Math.min(1, Math.max(0, (Math.abs(ahead) - endsAhead) / (END_BLEND * r) + 1)) : 0;
      if (leave * out * this.fade[w]! > push[p]!) {
        push[p] = leave * out * this.fade[w]!;
        const sign = Math.sign(ahead);
        pushDir[p * 3] = sign * fx;
        pushDir[p * 3 + 1] = 0;
        pushDir[p * 3 + 2] = sign * fz;
      }
      // Under the hub a point cannot reach the top: a bumper the crush drove into the tyre's front was lifted 0.45 m over it for a frame.
      lift[p] = Math.max(lift[p]!, Math.min(1, Math.max(0, height / (UPPER_FADE * r))) * (1 - leave) * rise * this.fade[w]!);
      dirty[p] = 1;
    }
  }

  /** Every lift and push carried up the mesh's edges, lowest point first: the higher end of an edge stands at most its `drop` short of the lower end's. Only from points `dirty` (raised since they last carried): lifts only rise within a hold, so a point that has not risen has nothing new to carry. */
  private carryLift(): void {
    const { start, to, drop } = this.edges;
    const { lift, push, pushDir, dirty, dirtyWords } = this;
    for (let word = 0; word < dirtyWords.length; word++) {
      if (dirtyWords[word] === 0) continue;
      // A byte set below by an earlier point of this word is read here, after it.
      for (let p = word * DIRTY_WORD; p < (word + 1) * DIRTY_WORD; p++) {
        if (dirty[p] === 0) continue;
        dirty[p] = 0;
        const up = lift[p]!;
        const out = push[p]!;
        if (up <= 0 && out <= 0) continue;
        for (let e = start[p]!; e < start[p + 1]!; e++) {
          const q = to[e]!;
          const carried = up - drop[e]!;
          if (carried > lift[q]!) {
            lift[q] = carried;
            dirty[q] = 1;
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
}
