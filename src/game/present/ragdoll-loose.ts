import * as THREE from "three";
import type { Collider, Cuboid, Cylinder, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { DeformableCar } from "../vehicle/car.ts";
import { LOOSE_BODIES } from "../vehicle/part-state.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { disable, type Rapier } from "../kernel/rapier.ts";
import { store3d, store4d } from "../kernel/store.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { carGroups } from "./ragdoll-config.ts";
import type { Doll } from "./ragdoll-body.ts";

/** A loose body's record in a frame, floats: its id (car × `LOOSE_BODIES` + body), 1 for a wheel's disk else 0 for a box, half extents, its middle in the world, its turn. */
const LOOSE_FLOATS = 12;
const LOOSE_ID = 0;
const LOOSE_DISK = 1;
const LOOSE_HALF = 2;
const LOOSE_AT = 5;
const LOOSE_TURN = 8;
/** Most loose bodies the dummies' world holds at once: each is a kinematic body that costs every step it is in. */
const MAX_LOOSE = 48;
/** A loose body is put in the world while a dummy's torso is within its reach plus this (m), and kept until twice that: it moves faster than a frame's step. */
const LOOSE_NEAR = 2.5;
/** A body that moved farther than this (m) in a frame is put at its new place rather than walked there. */
const JUMP = 4;
/** A wheel's collider turned so a cylinder's axis (y) lies along the wheel's own x. */
const DISK_TURN = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
const SCRATCH = new Float64Array(MAX_LOOSE * LOOSE_FLOATS);
/** No loose bodies: the frame of a world with no dummy out has no use for them. */
export const NO_LOOSE = new Float64Array(0);
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _c = new THREE.Vector3();
const _at = { x: 0, y: 0, z: 0 };
const _rot = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Every awake loose body of `cars` (torn parts, popped wheels) as a frame record, up to `MAX_LOOSE`: the sim's own bodies, as they stand.
 * A body asleep is not sent: a dummy walks through one lying on the road.
 */
export function recordLoose(cars: readonly DeformableCar[]): Float64Array {
  let n = 0;
  for (let i = 0; i < cars.length && i < MAX_CARS && n < MAX_LOOSE; i++) {
    const car = cars[i]!;
    for (let b = 0; b < LOOSE_BODIES && n < MAX_LOOSE; b++) {
      const body = car.looseBody(b);
      if (body === null || body.shape.asleep) continue;
      const o = n * LOOSE_FLOATS;
      const s = body.shape;
      SCRATCH[o + LOOSE_ID] = i * LOOSE_BODIES + b;
      SCRATCH[o + LOOSE_DISK] = s.box || s.shell ? 0 : 1;
      SCRATCH[o + LOOSE_HALF] = s.half.x;
      SCRATCH[o + LOOSE_HALF + 1] = s.half.y;
      SCRATCH[o + LOOSE_HALF + 2] = s.half.z;
      _c.copy(s.centre).applyQuaternion(body.object.quaternion).add(body.object.position);
      store3d(SCRATCH, o + LOOSE_AT, _c);
      store4d(SCRATCH, o + LOOSE_TURN, body.object.quaternion);
      n++;
    }
  }
  return SCRATCH.slice(0, n * LOOSE_FLOATS);
}

/**
 * The loose bodies as the dummies' world sees them: kinematic boxes and disks (`recordLoose`), walked to each frame's pose a step at a
 * time like the cars' proxies, so a dummy they hit is shoved by what they carry and they are never moved by him. Only those a live dummy is near are in the world.
 */
export class LooseProxies {
  private readonly bodies: RigidBody[] = [];
  private readonly colliders: Collider[] = [];
  private cuboid: Cuboid | null = null;
  private cylinder: Cylinder | null = null;
  /** Per slot: the id of the loose body it holds (-1: free), whether it is in the world, the shape it was last set to (disk, half extents), and the pose last frame then this frame (middle, turn). */
  private readonly ids = new Int32Array(MAX_LOOSE).fill(-1);
  private readonly on = new Uint8Array(MAX_LOOSE);
  private readonly shaped = new Float64Array(MAX_LOOSE * 4).fill(-1);
  private readonly seen = new Uint8Array(MAX_LOOSE);
  private readonly aim = new Float32Array(MAX_LOOSE * 14);
  /** How many bodies were in the world after the last `follow`. */
  count = 0;

  load(R: Rapier, world: World): void {
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
    this.count = 0;
  }

  /** Slot `s` out of the world and free. */
  private release(s: number): void {
    this.ids[s] = -1;
    if (!this.on[s]) return;
    disable(this.bodies[s]!);
    this.on[s] = 0;
  }

  /**
   * The frame's records `loose` (`recordLoose`) that a live dummy's torso is near, each put on its slot (the one it held, else a free one),
   * its pose this frame the end of the path `move` walks; the slots of bodies no longer near are freed. `teleport`: the world sat still, so
   * every body is put where it is.
   */
  follow(loose: Float64Array, dolls: readonly Doll[], teleport: boolean): void {
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
    }
    let n = 0;
    for (let s = 0; s < MAX_LOOSE; s++) {
      if (this.seen[s] === 0) this.release(s);
      else n++;
    }
    this.count = n;
  }

  /** Whether a live dummy's torso is within `reach` and `LOOSE_NEAR` (and the travel of the body since last frame, twice) of the body's middle. */
  private near(loose: Float64Array, o: number, reach: number, held: boolean, dolls: readonly Doll[]): boolean {
    const x = loose[o + LOOSE_AT]!;
    const y = loose[o + LOOSE_AT + 1]!;
    const z = loose[o + LOOSE_AT + 2]!;
    const r = reach + LOOSE_NEAR + (held ? LOOSE_NEAR : 0);
    for (const d of dolls) {
      if (!d.live) continue;
      if (hypot3(d.cur[0]! - x, d.cur[1]! - y, d.cur[2]! - z) < r) return true;
    }
    return false;
  }

  /** Slot `s` holds loose body `id` of record `o` of `loose`: shaped, put in the world and aimed at its pose. */
  private place(s: number, id: number, loose: Float64Array, o: number, teleport: boolean): void {
    const body = this.bodies[s]!;
    const collider = this.colliders[s]!;
    const a = this.aim;
    const p = 14 * s;
    const disk = loose[o + LOOSE_DISK]!;
    const hx = loose[o + LOOSE_HALF]!;
    const hy = loose[o + LOOSE_HALF + 1]!;
    const hz = loose[o + LOOSE_HALF + 2]!;
    const fresh = this.ids[s] !== id || !this.on[s];
    if (fresh || this.shaped[4 * s] !== disk || this.shaped[4 * s + 1] !== hx || this.shaped[4 * s + 2] !== hy || this.shaped[4 * s + 3] !== hz) this.shape(collider, disk, hx, hy, hz);
    this.shaped[4 * s] = disk;
    this.shaped[4 * s + 1] = hx;
    this.shaped[4 * s + 2] = hy;
    this.shaped[4 * s + 3] = hz;
    this.ids[s] = id;
    if (!this.on[s]) {
      body.setEnabled(true);
      collider.setCollisionGroups(carGroups(Math.floor(id / LOOSE_BODIES)));
      this.on[s] = 1;
    }
    const jump = teleport || fresh || hypot3(a[p + 7]! - loose[o + LOOSE_AT]!, a[p + 8]! - loose[o + LOOSE_AT + 1]!, a[p + 9]! - loose[o + LOOSE_AT + 2]!) > JUMP;
    if (!jump) a.copyWithin(p, p + 7, p + 14);
    for (let k = 0; k < 3; k++) a[p + 7 + k] = loose[o + LOOSE_AT + k]!;
    for (let k = 0; k < 4; k++) a[p + 10 + k] = loose[o + LOOSE_TURN + k]!;
    if (!jump) return;
    a.copyWithin(p, p + 7, p + 14);
    _at.x = a[p + 7]!;
    _at.y = a[p + 8]!;
    _at.z = a[p + 9]!;
    body.setTranslation(_at, false);
    _rot.x = a[p + 10]!;
    _rot.y = a[p + 11]!;
    _rot.z = a[p + 12]!;
    _rot.w = a[p + 13]!;
    body.setRotation(_rot, false);
  }

  /** `collider` as a box of half extents (`hx`, `hy`, `hz`), or (`disk`) the wheel's disk: radius `hy`, half width `hx`, axle along the body's x. */
  private shape(collider: Collider, disk: number, hx: number, hy: number, hz: number): void {
    if (disk === 1) {
      this.cylinder!.halfHeight = hx;
      this.cylinder!.radius = hy;
      collider.setShape(this.cylinder!);
    } else {
      const he = this.cuboid!.halfExtents;
      he.x = hx;
      he.y = hy;
      he.z = hz;
      collider.setShape(this.cuboid!);
    }
    collider.setRotationWrtParent(disk === 1 ? DISK_TURN : NO_TURN);
  }

  /** Every body in the world `f` of the way along its frame's path (middle lerped, turn slerped). */
  move(f: number): void {
    const a = this.aim;
    for (let s = 0; s < MAX_LOOSE; s++) {
      if (!this.on[s]) continue;
      const p = 14 * s;
      _at.x = a[p]! + (a[p + 7]! - a[p]!) * f;
      _at.y = a[p + 1]! + (a[p + 8]! - a[p + 1]!) * f;
      _at.z = a[p + 2]! + (a[p + 9]! - a[p + 2]!) * f;
      _q.set(a[p + 3]!, a[p + 4]!, a[p + 5]!, a[p + 6]!).slerp(_qb.set(a[p + 10]!, a[p + 11]!, a[p + 12]!, a[p + 13]!), f);
      _rot.x = _q.x;
      _rot.y = _q.y;
      _rot.z = _q.z;
      _rot.w = _q.w;
      this.bodies[s]!.setNextKinematicTranslation(_at);
      this.bodies[s]!.setNextKinematicRotation(_rot);
    }
  }
}
