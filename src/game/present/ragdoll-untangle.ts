import type { Collider, EventQueue, Ray, RigidBody, SolverFlags, World } from "@dimforge/rapier3d-simd";
import { hypot3 } from "../kernel/physics-core.js";
import type { Rapier } from "../kernel/rapier.ts";
import { type Doll, PARTS } from "./ragdoll-body.ts";
import { SLOTS } from "./ragdoll-config.ts";

/**
 * A part whose middle or long axis has been inside another collider this long (s) is stuck there, not passing through a landing: at its mid-plane the
 * two sides' contacts cancel, and a leg threaded through another dummy's chest stayed there 2-18 s (a sinking landing is out within a few frames).
 */
const STUCK_FOR = 0.15;
/** A stuck part and what it is in are eased apart over this long (s): their closing speed along the way out is at least the depth over it. */
const EASE = 0.15;
/** How far (m) past an exit the way must be clear: a part's half thickness (a foot's 4 cm to a thigh's 7.5). */
const CLEAR = 0.06;
/** The clear test starts this far (m) back inside, so a face resting on the ground still meets it. */
const BACK = 0.01;
/** Parts are looked at in turns, every this many frames (each look's Rapier queries allocate; at every frame four thrown dummies took 85 KB a frame). A part stuck `STUCK_FOR` is looked at every frame until it is out. */
const SCAN_EVERY = 8;
/** How far (m) past where a limb's axis enters a collider its inside point is taken: past the contact's own few cm of give. */
const AXIS_IN = 0.03;
/** Below this (of 1) a way out across a limb's axis is mostly along it: the face's own normal is taken instead. */
const ACROSS_MIN = 0.3;

const ZERO = { x: 0, y: 0, z: 0 };
const _imp = { x: 0, y: 0, z: 0 };
const _n = { x: 0, y: 0, z: 0 };
const _at = { x: 0, y: 0, z: 0 };
/** The part's long axis: one end and its unit direction; and in a box's own frame its end, run, the box's half extents and the part's span. */
const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _v = { x: 0, y: 0, z: 0 };
const _from = [0, 0, 0];
const _run = [0, 0, 0];
const _half = [0, 0, 0];
const _lo = [0, 0, 0];
const _hi = [0, 0, 0];

/** Half the long axis (m) of part `k`: its local y, or z for a foot; each box spans its joints, so a shin's runs ankle to knee. */
const axisHalf = (k: number): number => {
  const h = PARTS[k]!.h;
  return h[2] > h[1] ? h[2] : h[1];
};

/** `v` turned by `q` (by its inverse when `inverse`). */
function rotate(v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }, inverse: boolean): void {
  const s = inverse ? -1 : 1;
  const qx = s * q.x;
  const qy = s * q.y;
  const qz = s * q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  v.x += q.w * tx + qy * tz - qz * ty;
  v.y += q.w * ty + qz * tx - qx * tz;
  v.z += q.w * tz + qx * ty - qy * tx;
}

/**
 * Untangles the dummies' world: a part whose middle or long axis stays inside another collider (another dummy, a car's proxy, the ground, a
 * prop) is pushed out of it, and that collider's body (when it moves) the other way. A limb threaded through a box leaves across its own axis
 * (`across`), else the way out is the nearest face; the far one when something lies against it (the ground under a lying dummy), the pair's
 * own contact set aside (`filterContactPair`) meanwhile. One rule for every collider the part may hit; his own parts are left to his joints.
 */
export class Untangle {
  private readonly held = new Float32Array(SLOTS * PARTS.length);
  /** Seconds since each part was last looked at, and whose turn it is (`SCAN_EVERY`). */
  private readonly since = new Float32Array(SLOTS * PARTS.length);
  private turn = 0;
  /** The collider (handle) part `i`'s contact with is set aside, NaN for none; and the slot of each such part's collider. */
  private readonly within = new Float64Array(SLOTS * PARTS.length).fill(NaN);
  private readonly slotOf = new Map<number, number>();
  private flags = 0;
  private filterHook = 0;
  private solver: Rapier["SolverFlags"] | null = null;
  private ray: Ray | null = null;
  /** Rapier runs the hooks only in a step that takes an event queue; no collider here raises events, so it stays empty. */
  private queue: EventQueue | null = null;
  private cuboid = 0;
  /** The part's axis length (m) and the share of it inside a box (`runIn`); whether it was found by its axis (its middle outside); whether its way out is not the pair's own contact's (`setAside`). */
  private length = 0;
  private s0 = 0;
  private s1 = 1;
  private byAxis = false;
  private aside = false;
  /** The box (handle; NaN: none yet) the dummy now being looked at is leaving, and by which face. */
  private shared = NaN;
  private sharedFace = -1;
  /** The collider `intersectionsWithPoint` found the part's middle in (`take`), null for none. */
  private found: Collider | null = null;
  private readonly take = (collider: Collider): boolean => {
    this.found = collider;
    return false;
  };

  load(rapier: Rapier): void {
    this.flags = rapier.QueryFilterFlags.EXCLUDE_SENSORS;
    this.filterHook = rapier.ActiveHooks.FILTER_CONTACT_PAIRS;
    this.solver = rapier.SolverFlags;
    this.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    this.queue = new rapier.EventQueue(false);
    this.cuboid = rapier.ShapeType.Cuboid;
  }

  /** One `world.step()`, with the hooks while a part's contact is set aside. */
  step(world: World): void {
    if (this.slotOf.size === 0) world.step();
    else world.step(this.queue!, this);
  }

  /** One frame of `dt` s after the world's steps. */
  frame(world: World, dolls: readonly Doll[], dt: number): void {
    this.turn = (this.turn + 1) % SCAN_EVERY;
    for (let s = 0; s < dolls.length; s++) {
      const d = dolls[s]!;
      this.shared = NaN;
      for (let k = 0; k < PARTS.length; k++) {
        const i = s * PARTS.length + k;
        this.since[i] = this.since[i]! + dt;
        if (d.live && this.held[i]! < STUCK_FOR && i % SCAN_EVERY !== this.turn) continue;
        this.held[i] = d.live && this.stuck(world, d.bodies[k]!, i) ? this.held[i]! + this.since[i]! : 0;
        this.since[i] = 0;
        if (this.held[i] === 0) this.restore(d.bodies[k]!.collider(0), i);
      }
    }
  }

  /** Rapier asks this of a pair one of whose colliders has the hook on: no impulses between a part and the collider it is being pushed out of. */
  readonly filterContactPair = (collider1: number, collider2: number): SolverFlags => {
    const flags = this.solver!;
    const a = this.slotOf.get(collider1);
    if (a !== undefined && this.within[a] === collider2) return flags.EMPTY;
    const b = this.slotOf.get(collider2);
    if (b !== undefined && this.within[b] === collider1) return flags.EMPTY;
    return flags.COMPUTE_IMPULSE;
  };

  readonly filterIntersectionPair = (): boolean => true;

  /** Whether `part` (`held` slot `i`) has its middle or its long axis inside a collider it may hit; when it has been for `STUCK_FOR`, it is pushed out of it. */
  private stuck(world: World, part: RigidBody, i: number): boolean {
    const own = part.collider(0);
    const groups = own.collisionGroups();
    // Every collider the part hits but its own dummy's: the filter half without his own bit.
    const query = groups & ~(groups >>> 16);
    // A part that hits nothing (groups 0: the glass rows' torso-only dummy) is in nothing.
    if ((query & 0xffff) === 0 || query >>> 16 === 0) return false;
    const k = i % PARTS.length;
    const inside = this.inside(world, part, k, query);
    if (inside === null) return false;
    if (!Number.isNaN(this.within[i]!) && this.within[i] !== inside.handle) this.restore(own, i);
    if (this.held[i]! < STUCK_FOR) return true;
    this.axis(part, k);
    const depth = inside.shapeType() === this.cuboid ? this.boxWay(world, part, inside, query) : this.roundWay(world, inside, query);
    if (depth === 0) return true;
    if (this.aside) this.setAside(own, i, inside.handle);
    this.push(part, inside.parent(), depth);
    return true;
  }

  /** The collider `part`'s middle is in, or else one its long axis runs through (its middle outside), with `_at` a point of the part inside it; null for none. */
  private inside(world: World, part: RigidBody, k: number, query: number): Collider | null {
    const c = part.translation();
    _at.x = c.x;
    _at.y = c.y;
    _at.z = c.z;
    // Not `projectPoint`: Rapier 0.19's traps (wasm unreachable) when no collider passes its filter; these two return nothing.
    this.found = null;
    world.intersectionsWithPoint(c, this.take, this.flags, query);
    this.byAxis = this.found === null;
    if (this.found !== null) return this.found;
    this.axis(part, k);
    const ray = this.ray!;
    ray.origin.x = _o.x;
    ray.origin.y = _o.y;
    ray.origin.z = _o.z;
    ray.dir.x = _d.x;
    ray.dir.y = _d.y;
    ray.dir.z = _d.z;
    const through = world.castRay(ray, 2 * axisHalf(k), true, this.flags, query);
    if (through === null) return null;
    const along = Math.min(2 * axisHalf(k), through.timeOfImpact + AXIS_IN);
    _at.x = _o.x + _d.x * along;
    _at.y = _o.y + _d.y * along;
    _at.z = _o.z + _d.z * along;
    return through.collider.containsPoint(_at) ? through.collider : null;
  }

  /** `part`'s long axis (part `k`'s local y, or z for a foot) into `_o` (one end), `_d` (unit) and `this.length`. */
  private axis(part: RigidBody, k: number): void {
    const h = PARTS[k]!.h;
    const c = part.translation();
    const q = part.rotation();
    if (h[2] > h[1]) {
      _d.x = 2 * (q.x * q.z + q.w * q.y);
      _d.y = 2 * (q.y * q.z - q.w * q.x);
      _d.z = 1 - 2 * (q.x * q.x + q.y * q.y);
    } else {
      _d.x = 2 * (q.x * q.y - q.w * q.z);
      _d.y = 1 - 2 * (q.x * q.x + q.z * q.z);
      _d.z = 2 * (q.y * q.z + q.w * q.x);
    }
    const half = axisHalf(k);
    _o.x = c.x - _d.x * half;
    _o.y = c.y - _d.y * half;
    _o.z = c.z - _d.z * half;
    this.length = 2 * half;
  }

  /**
   * The way out of cuboid `inside`: its shallowest face, no deeper than the part is long, whose way is clear for the part (`blocked`) and, when
   * `inside`'s body moves, for that body the other way (`pinned`: a dummy lying on the ground is not pushed into it); else the shallowest face. A
   * limb found by its axis, or threaded, leaves across that axis (along it, it only slides). One dummy's parts in one box leave by the face the
   * first of them took (`shared`), or they push it opposite ways. Sets `_n`, `_at` and `this.aside`; returns the depth (0 for none).
   */
  private boxWay(world: World, part: RigidBody, inside: Collider, query: number): number {
    if (!this.runIn(inside)) return 0;
    const across = this.byAxis || (this.s0 > 0 && this.s1 < 1);
    this.spans(inside, across);
    let pierced = -1;
    if (across) {
      pierced = 0;
      for (let j = 1; j < 3; j++) if (Math.abs(_run[j]!) > Math.abs(_run[pierced]!)) pierced = j;
    }
    if (inside.handle === this.shared && this.sharedFace >> 1 !== pierced) {
      this.aside = this.sharedFace !== this.shallowest(0, pierced, Infinity);
      return this.face(inside, this.sharedFace, across);
    }
    let tried = 0;
    let first = -1;
    let way = -1;
    for (let f = this.shallowest(tried, pierced, this.length); f >= 0 && way < 0; f = this.shallowest(tried, pierced, this.length)) {
      tried |= 1 << f;
      if (first < 0) first = f;
      if (!this.blocked(world, inside, _at, this.face(inside, f, across), query) && !this.pinned(world, part, inside, f)) way = f;
    }
    if (way < 0) way = this.shallowest(0, -1, Infinity);
    this.aside = way !== first && first >= 0;
    this.shared = inside.handle;
    this.sharedFace = way;
    return this.face(inside, way, across && way >> 1 !== pierced);
  }

  /** The part's span in `inside`'s own frame, per axis (`_lo`, `_hi`): its run inside when `across` (`_at` its middle), else the point `_at`. */
  private spans(inside: Collider, across: boolean): void {
    if (across) {
      for (let j = 0; j < 3; j++) {
        _lo[j] = _from[j]! + _run[j]! * this.s0;
        _hi[j] = _from[j]! + _run[j]! * this.s1;
      }
      const mid = ((this.s0 + this.s1) / 2) * this.length;
      _at.x = _o.x + _d.x * mid;
      _at.y = _o.y + _d.y * mid;
      _at.z = _o.z + _d.z * mid;
      return;
    }
    const t = inside.translation();
    _v.x = _at.x - t.x;
    _v.y = _at.y - t.y;
    _v.z = _at.z - t.z;
    rotate(_v, inside.rotation(), true);
    _lo[0] = _hi[0] = _v.x;
    _lo[1] = _hi[1] = _v.y;
    _lo[2] = _hi[2] = _v.z;
  }

  /** Face `f`'s depth (m): how far its span must move along the face's normal to be out of it. Face `f` is axis `f >> 1`, the + side when odd. */
  private depthOf(f: number): number {
    const j = f >> 1;
    const s = f & 1 ? 1 : -1;
    return _half[j]! - Math.min(s * _lo[j]!, s * _hi[j]!);
  }

  /** The shallowest face not in `tried`, nor on axis `pierced`, nor deeper than `cap` m; -1 for none. */
  private shallowest(tried: number, pierced: number, cap: number): number {
    let best = -1;
    for (let f = 0; f < 6; f++) {
      if ((tried & (1 << f)) !== 0 || f >> 1 === pierced || this.depthOf(f) > cap) continue;
      if (best < 0 || this.depthOf(f) < this.depthOf(best)) best = f;
    }
    return best;
  }

  /** Face `f`'s way out into `_n` (world; off the part's axis when `across`); returns its depth. */
  private face(inside: Collider, f: number, across: boolean): number {
    const j = f >> 1;
    const s = f & 1 ? 1 : -1;
    _n.x = j === 0 ? s : 0;
    _n.y = j === 1 ? s : 0;
    _n.z = j === 2 ? s : 0;
    rotate(_n, inside.rotation(), false);
    if (across) this.offAxis();
    return this.depthOf(f);
  }

  /** Whether `inside`'s body, when it moves, has something within `CLEAR` m past its own face opposite face `f` (`_n`): it cannot be pushed that way. */
  private pinned(world: World, part: RigidBody, inside: Collider, f: number): boolean {
    if (!(inside.parent()?.isDynamic() ?? false)) return false;
    const groups = inside.collisionGroups();
    // What it hits but its own dummy and the part's.
    const query = groups & ~(groups >>> 16) & ~(part.collider(0).collisionGroups() >>> 16);
    const t = inside.translation();
    const ray = this.ray!;
    ray.origin.x = t.x;
    ray.origin.y = t.y;
    ray.origin.z = t.z;
    ray.dir.x = -_n.x;
    ray.dir.y = -_n.y;
    ray.dir.z = -_n.z;
    return world.castRay(ray, _half[f >> 1]! + CLEAR, true, this.flags, query, inside) !== null;
  }

  /** The way out of a collider of another shape: its nearest face from `_at`, or the far one when something lies past the nearest. */
  private roundWay(world: World, inside: Collider, query: number): number {
    this.aside = false;
    const depth = this.nearest(inside);
    if (depth === 0 || !this.blocked(world, inside, _at, depth, query)) return depth;
    const far = this.exit(inside, _at);
    if (far <= 0) return depth;
    _n.x = -_n.x;
    _n.y = -_n.y;
    _n.z = -_n.z;
    this.aside = true;
    return far;
  }

  /** The axis (`_o`, `_d`, `this.length`) in `inside`'s own frame (`_from`, `_run`, `_half`), and the share of it inside its box, `s0`..`s1`; false for none. */
  private runIn(inside: Collider): boolean {
    const t = inside.translation();
    const q = inside.rotation();
    const h = inside.halfExtents();
    _v.x = _o.x - t.x;
    _v.y = _o.y - t.y;
    _v.z = _o.z - t.z;
    rotate(_v, q, true);
    _from[0] = _v.x;
    _from[1] = _v.y;
    _from[2] = _v.z;
    _v.x = _d.x * this.length;
    _v.y = _d.y * this.length;
    _v.z = _d.z * this.length;
    rotate(_v, q, true);
    _run[0] = _v.x;
    _run[1] = _v.y;
    _run[2] = _v.z;
    _half[0] = h.x;
    _half[1] = h.y;
    _half[2] = h.z;
    this.s0 = 0;
    this.s1 = 1;
    for (let j = 0; j < 3; j++) {
      const p = _from[j]!;
      const r = _run[j]!;
      const e = _half[j]!;
      if (Math.abs(r) < 1e-9) {
        if (Math.abs(p) > e) return false;
        continue;
      }
      const a = (-e - p) / r;
      const b = (e - p) / r;
      this.s0 = Math.max(this.s0, Math.min(a, b));
      this.s1 = Math.min(this.s1, Math.max(a, b));
    }
    return this.s0 < this.s1;
  }

  /** `_n` less its share along the part's axis `_d` (unless that leaves too little of it). */
  private offAxis(): void {
    const along = _n.x * _d.x + _n.y * _d.y + _n.z * _d.z;
    const x = _n.x - along * _d.x;
    const y = _n.y - along * _d.y;
    const z = _n.z - along * _d.z;
    const left = hypot3(x, y, z);
    if (left < ACROSS_MIN) return;
    _n.x = x / left;
    _n.y = y / left;
    _n.z = z / left;
  }

  /** The way out of `inside` from `_at` by its nearest face, `_n`; returns the depth (0 for none). */
  private nearest(inside: Collider): number {
    const out = inside.projectPoint(_at, false);
    if (out === null) return 0;
    _n.x = out.point.x - _at.x;
    _n.y = out.point.y - _at.y;
    _n.z = out.point.z - _at.z;
    const depth = hypot3(_n.x, _n.y, _n.z);
    if (depth < 1e-4) return 0;
    _n.x /= depth;
    _n.y /= depth;
    _n.z /= depth;
    return depth;
  }

  /** Part `i`'s (collider `own`) contact with collider `other` is set aside while it is pushed out the far way. */
  private setAside(own: Collider, i: number, other: number): void {
    if (this.within[i] === other) return;
    this.within[i] = other;
    this.slotOf.set(own.handle, i);
    own.setActiveHooks(this.filterHook);
  }

  /** Part `i`'s contacts are its own again. */
  private restore(own: Collider, i: number): void {
    if (Number.isNaN(this.within[i]!)) return;
    this.within[i] = NaN;
    this.slotOf.delete(own.handle);
    own.setActiveHooks(0);
  }

  /** Whether something but `inside` lies within `CLEAR` m past the exit `depth` m from `centre` along `_n`. */
  private blocked(world: World, inside: Collider, centre: { x: number; y: number; z: number }, depth: number, query: number): boolean {
    const ray = this.ray!;
    const from = depth - BACK;
    ray.origin.x = centre.x + _n.x * from;
    ray.origin.y = centre.y + _n.y * from;
    ray.origin.z = centre.z + _n.z * from;
    ray.dir.x = _n.x;
    ray.dir.y = _n.y;
    ray.dir.z = _n.z;
    return world.castRay(ray, BACK + CLEAR, true, this.flags, query, inside) !== null;
  }

  /** How far (m) from `centre` the way opposite `_n` leaves `inside`; 0 when it does not. */
  private exit(inside: Collider, centre: { x: number; y: number; z: number }): number {
    const ray = this.ray!;
    ray.origin.x = centre.x;
    ray.origin.y = centre.y;
    ray.origin.z = centre.z;
    ray.dir.x = -_n.x;
    ray.dir.y = -_n.y;
    ray.dir.z = -_n.z;
    return Math.max(0, inside.castRay(ray, 10, false));
  }

  /**
   * `part` and `other` (when it moves) are pushed apart along `_n` until they part at `depth` / `EASE` m/s, each taking half that speed with its
   * own mass: a walker's foot lock or hold keeps his part where it is, and a push shared by their masses then hardly moves the dummy it is in.
   */
  private push(part: RigidBody, other: RigidBody | null, depth: number): void {
    const moves = other !== null && other.isDynamic();
    const v = part.linvel();
    const w = moves ? other.linvel() : ZERO;
    const closing = (v.x - w.x) * _n.x + (v.y - w.y) * _n.y + (v.z - w.z) * _n.z;
    const want = depth / EASE;
    if (closing >= want) return;
    const each = moves ? (want - closing) / 2 : want - closing;
    this.shove(part, each);
    if (moves) this.shove(other, -each);
  }

  /** `body` sped up by `dv` m/s along `_n`. */
  private shove(body: RigidBody, dv: number): void {
    const j = body.mass() * dv;
    _imp.x = _n.x * j;
    _imp.y = _n.y * j;
    _imp.z = _n.z * j;
    body.applyImpulse(_imp, true);
  }
}
