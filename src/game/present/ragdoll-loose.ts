import * as THREE from "three";
import type { Collider, Cuboid, Cylinder, RigidBody, Shape, World } from "@dimforge/rapier3d-simd";
import type { DeformableCar } from "../vehicle/car.ts";
import { HIT_HOOD, HIT_MIRROR } from "../vehicle/car-core.ts";
import { LOOSE_BODIES } from "../vehicle/part-state.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { disable, type Rapier } from "../kernel/rapier.ts";
import { store3d, store4d } from "../kernel/store.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { knocksDown } from "../scenes/figure-strike.ts";
import { carGroups, looseSweepGroups, partGroups } from "./ragdoll-config.ts";
import type { Doll } from "./ragdoll-body.ts";
import { partAt, strikeAt } from "./ragdoll-hit.ts";
import { type PartHit, WANT_PARTS } from "./ragdoll-wire.ts";

/**
 * A body's record in a frame, floats: its id (car × `LOOSE_BODIES` + body), 1 for a wheel's disk else 0 for a box, half extents, its middle in the world, its turn,
 * its velocity (0 asleep), its mass (kg), and the `HIT_PARTS` code of a part still on its car (`strikeSlot`; -1 a loose body).
 */
const LOOSE_FLOATS = 17;
const LOOSE_ID = 0;
const LOOSE_DISK = 1;
const LOOSE_HALF = 2;
const LOOSE_AT = 5;
const LOOSE_TURN = 8;
const LOOSE_VEL = 12;
const LOOSE_KG = 15;
const LOOSE_PART = 16;
/** Every loose body of every car: a part lying still is one a dummy may fall on. */
const MAX_RECORDS = MAX_CARS * LOOSE_BODIES;
/** Most loose bodies the dummies' world holds at once: each is a kinematic body that costs every step it is in. */
const MAX_LOOSE = 48;
/** A loose body is put in the world while a dummy's torso is within its reach plus this (m), and kept until twice that: it moves faster than a frame's step. */
const LOOSE_NEAR = 2.5;
/** A body that moved farther than this (m) in a frame is put at its new place rather than walked there. */
const JUMP = 4;
/**
 * Slower than this (m/s) a body blocks the dummies, a solid that gives them no speed; faster, its first touch of a dummy is the showcase's
 * push sized by its momentum (`strike`), and it meets him no more until it is clear of him: one that slows while it still lies against
 * him stays swept, never a solid put inside him (a 5 kg cover at 1.6 m/s, slowing on his chest, threw him down).
 */
const BLOCK_MPS = 1;
/** A body struck a dummy is clear of him once his torso is farther than its reach plus this (m) from its middle. */
const CLEAR_M = 1;
/** A prop resting or rocking on a part strikes nothing: a hit is a touch closing at this (m/s) or faster. */
const PART_FLOOR = 0.5;
/** How far out (m) a stand-in looks at a coming touch, the gap past which a touch has ended, and the near (m) that counts as on it: as a pane's (`GLASS_SEE`, `GLASS_SEP`, `GLASS_SKIN`). */
const PART_SEE = 0.15;
const PART_SEP = 0.03;
const PART_SKIN = 0.005;
/** A wheel's collider turned so a cylinder's axis (y) lies along the wheel's own x. */
const DISK_TURN = new THREE.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
const SCRATCH = new Float64Array(MAX_RECORDS * LOOSE_FLOATS);
/** No loose bodies: the frame of a world with no dummy out has no use for them. */
export const NO_LOOSE = new Float64Array(0);
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _point = new THREE.Vector3();
const _n = new THREE.Vector3();
const _at = { x: 0, y: 0, z: 0 };
const _from = { x: 0, y: 0, z: 0 };
const _move = { x: 0, y: 0, z: 0 };
const _rot = { x: 0, y: 0, z: 0, w: 1 };
const _s = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Every loose body of `cars` (torn parts, popped wheels) as a frame record, up to `MAX_RECORDS`: the sim's own bodies, as they stand, each
 * with the velocity and mass it strikes a dummy with; then, of each car a knocked prop or awake carton may reach (`wanted` is `WANT_PARTS`), the parts that stand out of its body as
 * they are drawn (a still box, its slot's id: a part that tears keeps its slot).
 */
export function recordLoose(cars: readonly DeformableCar[], wanted: Uint8Array): Float64Array {
  let n = 0;
  for (let i = 0; i < cars.length && i < MAX_CARS; i++) {
    const car = cars[i]!;
    for (let b = 0; b < LOOSE_BODIES; b++) {
      const body = car.looseBody(b);
      if (body === null) continue;
      const o = n * LOOSE_FLOATS;
      const s = body.shape;
      SCRATCH[o + LOOSE_ID] = i * LOOSE_BODIES + b;
      SCRATCH[o + LOOSE_DISK] = s.box || s.shell ? 0 : 1;
      store3d(SCRATCH, o + LOOSE_HALF, s.half);
      _c.copy(s.centre).applyQuaternion(body.object.quaternion).add(body.object.position);
      store3d(SCRATCH, o + LOOSE_AT, _c);
      store4d(SCRATCH, o + LOOSE_TURN, body.object.quaternion);
      if (s.asleep) SCRATCH.fill(0, o + LOOSE_VEL, o + LOOSE_VEL + 3);
      else store3d(SCRATCH, o + LOOSE_VEL, body.velocity);
      SCRATCH[o + LOOSE_KG] = car.looseKg(b);
      SCRATCH[o + LOOSE_PART] = -1;
      n++;
    }
    for (let code = HIT_MIRROR; code <= HIT_HOOD && wanted[i] === WANT_PARTS; code++) {
      const slot = car.strikeSlot(code);
      if (slot < 0) continue;
      const object = car.partBox(slot, _box);
      if (_box.isEmpty()) continue;
      const o = n * LOOSE_FLOATS;
      object.matrixWorld.decompose(_c, _q, _s);
      SCRATCH[o + LOOSE_ID] = i * LOOSE_BODIES + slot;
      SCRATCH[o + LOOSE_DISK] = 0;
      // To the millimetre: re-read on a moving car its size changes in the last bits, and each change rebuilds the collider.
      _box.getSize(_n).multiply(_s).multiplyScalar(500).round().multiplyScalar(0.001);
      store3d(SCRATCH, o + LOOSE_HALF, _n);
      store3d(SCRATCH, o + LOOSE_AT, _box.getCenter(_c).applyMatrix4(object.matrixWorld));
      store4d(SCRATCH, o + LOOSE_TURN, _q);
      SCRATCH.fill(0, o + LOOSE_VEL, o + LOOSE_KG + 1);
      SCRATCH[o + LOOSE_PART] = code;
      n++;
    }
  }
  return SCRATCH.slice(0, n * LOOSE_FLOATS);
}

/**
 * The loose bodies as the dummies' world sees them (`recordLoose`), those a live dummy is near. One slower than `BLOCK_MPS` is a kinematic box
 * or disk put at its pose each step: a dummy cannot pass through it and it gives him no speed. A faster one is swept along its path each step
 * and its first touch of a dummy is the showcase press (`strikeAt`) at the point it lands, its push the body's momentum on the part it meets;
 * a walker it knocks down (`knocksDown`, the one law for every striker) goes limp (`knock`, his pool slot), as the press makes him. One way:
 * nothing a dummy does reaches the sim.
 */
export class LooseProxies {
  private readonly bodies: RigidBody[] = [];
  private readonly colliders: Collider[] = [];
  private cuboid: Cuboid | null = null;
  private cylinder: Cylinder | null = null;
  private world: World | null = null;
  private dolls: readonly Doll[] = [];
  /**
   * Per slot: the id of the loose body it holds (-1: free), whether it is in the world, the shape it was last set to (disk, half extents),
   * the pose last frame then this frame (middle, turn), its velocity and mass, whether it is fast (swept, colliding with nothing), where the
   * last step's sweep ended (middle, turn), and the dummies it struck and is not yet clear of (a bit per pool slot).
   */
  private readonly ids = new Int32Array(MAX_LOOSE).fill(-1);
  private readonly on = new Uint8Array(MAX_LOOSE);
  private readonly shaped = new Float64Array(MAX_LOOSE * 4).fill(-1);
  private readonly seen = new Uint8Array(MAX_LOOSE);
  private readonly aim = new Float32Array(MAX_LOOSE * 14);
  private readonly vel = new Float32Array(MAX_LOOSE * 3);
  private readonly kg = new Float32Array(MAX_LOOSE);
  private readonly fast = new Uint8Array(MAX_LOOSE);
  private readonly swept = new Float32Array(MAX_LOOSE * 7);
  private readonly struck = new Uint8Array(MAX_LOOSE);
  /** Per slot, the `HIT_PARTS` code of the part on its car it stands in for (-1: a loose body). */
  private readonly part = new Int8Array(MAX_LOOSE).fill(-1);
  /** Slot × other body touching a stand-in as of the last step, and this step: a touch strikes once (`partTouch`). */
  private touching = new Set<number>();
  private touchNow = new Set<number>();
  /** Stand-ins in the world after the last `follow`. */
  private parts = 0;
  /** The dummies a sweep looks past (`struck` of the slot sweeping). */
  private passed = 0;
  private readonly unstruck = (c: Collider): boolean => (this.passed & (1 << this.dollOf(c))) === 0;
  /** How many bodies were in the world after the last `follow`, and how many of those are fast. */
  count = 0;
  moving = 0;

  private readonly knock: (slot: number) => void;
  private readonly hits: PartHit[];
  private readonly nearProp: (x: number, y: number, z: number, r: number) => boolean;

  /** `knock(slot)`: a walker struck limp; `hits`: where a part's strikes go (`CarProxies.strikes`); `nearProp(x, y, z, r)`: a knocked prop or carton within `r` of the point. */
  constructor(knock: (slot: number) => void, hits: PartHit[], nearProp: (x: number, y: number, z: number, r: number) => boolean) {
    this.knock = knock;
    this.hits = hits;
    this.nearProp = nearProp;
  }

  load(R: Rapier, world: World): void {
    this.world = world;
    this.cuboid = new R.Cuboid(1, 1, 1);
    this.cylinder = new R.Cylinder(1, 1);
    for (let s = 0; s < MAX_LOOSE; s++) {
      const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
      this.colliders.push(world.createCollider(R.ColliderDesc.cuboid(1, 1, 1), body));
      this.bodies.push(body);
      disable(body);
    }
  }

  /** Every body out of the world (a new run). */
  clear(): void {
    for (let s = 0; s < MAX_LOOSE; s++) this.release(s);
    this.count = this.moving = this.parts = 0;
    this.touching.clear();
  }

  /** Slot `s` out of the world and free. */
  private release(s: number): void {
    this.ids[s] = -1;
    this.struck[s] = 0;
    this.part[s] = -1;
    if (!this.on[s]) return;
    disable(this.bodies[s]!);
    this.on[s] = 0;
  }

  /**
   * The frame's records `loose` (`recordLoose`) near a live dummy's torso or a knocked prop or carton (a part still on its car: near a prop or
   * carton only), each put on its slot (the one it held, else a free one), its pose this frame the end of the path `move` walks; the slots of
   * bodies no longer near are freed. `teleport`: the world sat still, so every body is put where it is.
   */
  follow(loose: Float64Array, dolls: readonly Doll[], teleport: boolean): void {
    this.dolls = dolls;
    this.seen.fill(0);
    for (let o = 0; o + LOOSE_FLOATS <= loose.length; o += LOOSE_FLOATS) {
      const id = loose[o + LOOSE_ID]!;
      const reach = hypot3(loose[o + LOOSE_HALF]!, loose[o + LOOSE_HALF + 1]!, loose[o + LOOSE_HALF + 2]!);
      let s = this.ids.indexOf(id);
      if (!this.near(loose, o, reach, s >= 0, dolls)) continue;
      if (s < 0) s = this.ids.indexOf(-1);
      if (s < 0) continue;
      this.seen[s] = 1;
      this.place(s, id, loose, o, teleport);
      this.clearOf(s, reach, dolls);
    }
    let n = 0;
    let fast = 0;
    let parts = 0;
    for (let s = 0; s < MAX_LOOSE; s++) {
      if (this.seen[s] === 0) this.release(s);
      else {
        n++;
        fast += this.fast[s]!;
        if (this.part[s]! >= 0) parts++;
      }
    }
    this.count = n;
    this.moving = fast;
    this.parts = parts;
  }

  /** Whether a knocked prop or carton, or (a loose body) a live dummy's torso, is within `reach` and `LOOSE_NEAR` (and the travel of the body since last frame, twice) of the body's middle. */
  private near(loose: Float64Array, o: number, reach: number, held: boolean, dolls: readonly Doll[]): boolean {
    const x = loose[o + LOOSE_AT]!;
    const y = loose[o + LOOSE_AT + 1]!;
    const z = loose[o + LOOSE_AT + 2]!;
    const r = reach + LOOSE_NEAR + (held ? LOOSE_NEAR : 0);
    if (this.nearProp(x, y, z, r)) return true;
    if (loose[o + LOOSE_PART]! >= 0) return false;
    for (const d of dolls) {
      if (!d.live) continue;
      if (hypot3(d.cur[0]! - x, d.cur[1]! - y, d.cur[2]! - z) < r) return true;
    }
    return false;
  }

  /**
   * Before a step of `step` s: each stand-in against the props, cartons and purse things it meets that are within `PART_SEE` of it. A touch
   * closing at `PART_FLOOR` or faster strikes the part once (this peer's only, `authority`), with the striker's energy over its closing speed and
   * its push along the contact normal (`PartHit`); the stand-in stays, so Rapier bounces the striker off it. A touch lasts until it is `PART_SEP`
   * off again. Asked before the step that touches (the world's own contact pairs come after Rapier has bounced it), and by the stand-in, as a
   * pane asks (`CarProxies.glassTouch`).
   */
  partTouch(step: number, authority: boolean): void {
    this.touchNow.clear();
    this.touchStep = step;
    this.touchAuthority = authority;
    const a = this.aim;
    for (let s = 0; s < MAX_LOOSE && this.parts > 0; s++) {
      if (this.part[s]! < 0 || !this.on[s]) continue;
      this.touchSlot = s;
      const reach = hypot3(this.shaped[4 * s + 1]!, this.shaped[4 * s + 2]!, this.shaped[4 * s + 3]!) + PART_SEE;
      _at.x = a[14 * s + 7]!;
      _at.y = a[14 * s + 8]!;
      _at.z = a[14 * s + 9]!;
      _move.x = _move.y = _move.z = reach;
      this.world!.collidersWithAabbIntersectingAabb(_at, _move, this.touchOther);
    }
    const was = this.touching;
    this.touching = this.touchNow;
    this.touchNow = was;
  }

  /** `partTouch`'s slot, step and authority, read by its query's callback (`touchOther`, made once: a closure a stand-in a step allocates). */
  private touchSlot = 0;
  private touchStep = 0;
  private touchAuthority = false;
  private readonly touchOther = (other: Collider): boolean => {
    const s = this.touchSlot;
    const c = this.colliders[s]!;
    const groups = c.collisionGroups();
    const body = other.parent();
    const its = other.collisionGroups();
    if (body === null || !body.isDynamic() || ((its >>> 16) & groups) === 0 || ((groups >>> 16) & its) === 0) return true;
    const hit = c.contactCollider(other, PART_SEE);
    const key = other.handle * MAX_LOOSE + s;
    const held = this.touching.has(key);
    if (hit === null || (held && hit.distance > PART_SEP)) return true;
    if (held) {
      this.touchNow.add(key);
      return true;
    }
    const v = body.linvel();
    const n = hit.normal2;
    const closing = v.x * n.x + v.y * n.y + v.z * n.z;
    // Not on the part within this step yet.
    if (hit.distance > Math.max(0, closing) * this.touchStep + PART_SKIN) return true;
    this.touchNow.add(key);
    if (closing >= PART_FLOOR && this.touchAuthority) this.hits.push({ car: Math.floor(this.ids[s]! / LOOSE_BODIES), part: this.part[s]!, energy: 0.5 * body.mass() * closing * closing, x: n.x * closing, y: n.y * closing, z: n.z * closing });
    return true;
  };

  /** Slot `s`'s struck dummies that are dead or whose torso is `CLEAR_M` past its `reach`: it may strike them again. */
  private clearOf(s: number, reach: number, dolls: readonly Doll[]): void {
    const a = this.aim;
    const p = 14 * s + 7;
    for (let k = 0; k < dolls.length; k++) {
      if ((this.struck[s]! & (1 << k)) === 0) continue;
      const d = dolls[k]!;
      if (d.live && hypot3(d.cur[0]! - a[p]!, d.cur[1]! - a[p + 1]!, d.cur[2]! - a[p + 2]!) < reach + CLEAR_M) continue;
      this.struck[s]! &= ~(1 << k);
    }
  }

  /** Slot `s` holds loose body `id` of record `o` of `loose`: shaped, put in the world, set blocking or fast, and aimed at its pose. */
  private place(s: number, id: number, loose: Float64Array, o: number, teleport: boolean): void {
    const body = this.bodies[s]!;
    const collider = this.colliders[s]!;
    const a = this.aim;
    const p = 14 * s;
    const disk = loose[o + LOOSE_DISK]!;
    const hx = loose[o + LOOSE_HALF]!;
    const hy = loose[o + LOOSE_HALF + 1]!;
    const hz = loose[o + LOOSE_HALF + 2]!;
    const part = loose[o + LOOSE_PART]!;
    const fresh = this.ids[s] !== id || !this.on[s] || this.part[s] !== part;
    if (fresh || this.shaped[4 * s] !== disk || this.shaped[4 * s + 1] !== hx || this.shaped[4 * s + 2] !== hy || this.shaped[4 * s + 3] !== hz) this.shape(collider, disk, hx, hy, hz);
    this.shaped[4 * s] = disk;
    this.shaped[4 * s + 1] = hx;
    this.shaped[4 * s + 2] = hy;
    this.shaped[4 * s + 3] = hz;
    if (this.ids[s] !== id) this.struck[s] = 0;
    this.ids[s] = id;
    for (let k = 0; k < 3; k++) this.vel[3 * s + k] = loose[o + LOOSE_VEL + k]!;
    this.kg[s] = loose[o + LOOSE_KG]!;
    const fast = this.struck[s] !== 0 || hypot3(loose[o + LOOSE_VEL]!, loose[o + LOOSE_VEL + 1]!, loose[o + LOOSE_VEL + 2]!) >= BLOCK_MPS ? 1 : 0;
    const car = Math.floor(id / LOOSE_BODIES);
    if (fresh || fast !== this.fast[s]) collider.setCollisionGroups(part >= 0 || fast ? partGroups(car) : carGroups(car));
    this.part[s] = part;
    this.fast[s] = fast;
    if (!this.on[s]) {
      body.setEnabled(true);
      this.on[s] = 1;
    }
    const jump = teleport || fresh || hypot3(a[p + 7]! - loose[o + LOOSE_AT]!, a[p + 8]! - loose[o + LOOSE_AT + 1]!, a[p + 9]! - loose[o + LOOSE_AT + 2]!) > JUMP;
    if (!jump) a.copyWithin(p, p + 7, p + 14);
    for (let k = 0; k < 3; k++) a[p + 7 + k] = loose[o + LOOSE_AT + k]!;
    for (let k = 0; k < 4; k++) a[p + 10 + k] = loose[o + LOOSE_TURN + k]!;
    if (!jump) return;
    // Put where it is: its path starts here, no sweep crosses the jump, and no walk to it flings a prop.
    a.copyWithin(p, p + 7, p + 14);
    this.swept.set(a.subarray(p + 7, p + 14), 7 * s);
    _at.x = a[p]!;
    _at.y = a[p + 1]!;
    _at.z = a[p + 2]!;
    body.setTranslation(_at, false);
  }

  /** `collider` as a box of half extents (`hx`, `hy`, `hz`), or (`disk`) the wheel's disk: radius `hy`, half width `hx`, axle along the body's x. */
  private shape(collider: Collider, disk: number, hx: number, hy: number, hz: number): void {
    collider.setShape(this.sized(disk, hx, hy, hz));
    collider.setRotationWrtParent(disk === 1 ? DISK_TURN : NO_TURN);
  }

  /** The shared box or disk shape set to the given size (`shape`). */
  private sized(disk: number, hx: number, hy: number, hz: number): Shape {
    if (disk === 1) {
      this.cylinder!.halfHeight = hx;
      this.cylinder!.radius = hy;
      return this.cylinder!;
    }
    const he = this.cuboid!.halfExtents;
    he.x = hx;
    he.y = hy;
    he.z = hz;
    return this.cuboid!;
  }

  /**
   * Every body in the world `f` of the way along its frame's path (middle lerped, turn slerped), before a step: a blocking one is put there
   * (no speed of its own to give), a fast one is swept there from where the last step left it (`sweep`).
   */
  move(f: number): void {
    const a = this.aim;
    for (let s = 0; s < MAX_LOOSE; s++) {
      if (!this.on[s]) continue;
      const p = 14 * s;
      _at.x = a[p]! + (a[p + 7]! - a[p]!) * f;
      _at.y = a[p + 1]! + (a[p + 8]! - a[p + 1]!) * f;
      _at.z = a[p + 2]! + (a[p + 9]! - a[p + 2]!) * f;
      _q.set(a[p + 3]!, a[p + 4]!, a[p + 5]!, a[p + 6]!).slerp(_qb.set(a[p + 10]!, a[p + 11]!, a[p + 12]!, a[p + 13]!), f);
      if (this.fast[s]) this.sweep(s);
      _rot.x = _q.x;
      _rot.y = _q.y;
      _rot.z = _q.z;
      _rot.w = _q.w;
      if (this.fast[s] || this.part[s]! >= 0) {
        // Walked, not put: the props it meets take its speed (the dummies meet a fast one's sweep alone).
        this.bodies[s]!.setNextKinematicTranslation(_at);
        this.bodies[s]!.setNextKinematicRotation(_rot);
      } else {
        this.bodies[s]!.setTranslation(_at, false);
        this.bodies[s]!.setRotation(_rot, false);
      }
      const w = 7 * s;
      this.swept[w] = _at.x;
      this.swept[w + 1] = _at.y;
      this.swept[w + 2] = _at.z;
      this.swept[w + 3] = _q.x;
      this.swept[w + 4] = _q.y;
      this.swept[w + 5] = _q.z;
      this.swept[w + 6] = _q.w;
    }
  }

  /** Slot `s`'s shape swept from where the last step left it to `_at` (turned as it was): the first dummy it touches that it has not struck is struck. */
  private sweep(s: number): void {
    const w = 7 * s;
    const sw = this.swept;
    _from.x = sw[w]!;
    _from.y = sw[w + 1]!;
    _from.z = sw[w + 2]!;
    _move.x = _at.x - _from.x;
    _move.y = _at.y - _from.y;
    _move.z = _at.z - _from.z;
    const disk = this.shaped[4 * s]!;
    _qb.set(sw[w + 3]!, sw[w + 4]!, sw[w + 5]!, sw[w + 6]!);
    if (disk === 1) _qb.multiply(DISK_TURN);
    _rot.x = _qb.x;
    _rot.y = _qb.y;
    _rot.z = _qb.z;
    _rot.w = _qb.w;
    const shape = this.sized(disk, this.shaped[4 * s + 1]!, this.shaped[4 * s + 2]!, this.shaped[4 * s + 3]!);
    this.passed = this.struck[s]!;
    const groups = looseSweepGroups(Math.floor(this.ids[s]! / LOOSE_BODIES));
    const hit = this.world!.castShape(_from, _rot, _move, shape, 0, 1, true, undefined, groups, undefined, undefined, this.unstruck);
    if (hit === null) return;
    _c.set(_from.x + _move.x * hit.time_of_impact, _from.y + _move.y * hit.time_of_impact, _from.z + _move.z * hit.time_of_impact);
    this.strike(s, hit.collider, _c);
  }

  /** The pool slot of the dummy whose part `collider` is (the sweep's groups meet nothing else). */
  private dollOf(collider: Collider): number {
    const handle = collider.parent()!.handle;
    for (let k = 0; k < this.dolls.length; k++) for (const b of this.dolls[k]!.bodies) if (b.handle === handle) return k;
    throw new Error("a loose body's sweep met no dummy's part");
  }

  /**
   * Slot `s`'s body, its middle at `centre`, touches the dummy part `collider`: the showcase press (`strikeAt`) lands where it touches, along
   * the line from its middle to there, at the body's momentum along that line over the mass of the part it lands on. He is struck once; a
   * walker it knocks down (`knocksDown`, at its own velocity along that line) goes limp.
   */
  private strike(s: number, collider: Collider, centre: THREE.Vector3): void {
    const k = this.dollOf(collider);
    this.struck[s]! |= 1 << k;
    const doll = this.dolls[k]!;
    const near = collider.projectPoint(centre, false)!;
    _point.set(near.point.x, near.point.y, near.point.z);
    _n.subVectors(_point, centre);
    // Its middle already in him (stepped in whole): along its way.
    if (near.isInside || _n.lengthSq() < 1e-8) _n.set(this.vel[3 * s]!, this.vel[3 * s + 1]!, this.vel[3 * s + 2]!);
    _n.normalize();
    const landed = doll.bodies[partAt(doll.bodies, _point)]!;
    const v = landed.linvel();
    const closing = (this.vel[3 * s]! - v.x) * _n.x + (this.vel[3 * s + 1]! - v.y) * _n.y + (this.vel[3 * s + 2]! - v.z) * _n.z;
    if (closing <= 0) return;
    const momentum = this.kg[s]! * closing;
    strikeAt(doll.bodies, _point, _n, momentum / landed.mass());
    if (doll.driven && knocksDown(this.kg[s]!, this.vel[3 * s]! * _n.x + this.vel[3 * s + 1]! * _n.y + this.vel[3 * s + 2]! * _n.z)) this.knock(k);
  }
}
