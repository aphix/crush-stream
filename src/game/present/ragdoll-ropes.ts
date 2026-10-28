import * as THREE from "three";
import type { ImpulseJoint, RigidBody, World } from "@dimforge/rapier3d-simd";
import { MAX_TETHERS, WINCH_MIN_LENGTH, WINCH_SPEED } from "../kernel/constants.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { disable, type Rapier } from "../kernel/rapier.ts";
import type { BoxPile } from "./ragdoll-boxes.ts";
import { type Doll, PARTS } from "./ragdoll-body.ts";
import type { RagCar } from "./ragdoll-car-view.ts";
import type { PropBodies } from "./ragdoll-props.ts";
import { ROPE_A, ROPE_B, ROPE_FLOATS, ROPE_JOINED, ROPE_LENGTH, ROPE_PENDING, ROPE_STATE, type RopeEnd } from "./ragdoll-wire.ts";

/** A rope shorter than this (m) has no direction to pull along: a cable fitted between two points this close is made this long. */
const MIN_ROPE = 0.1;
/** Where a rope's kinematic end waits while no rope uses it: the dummies' pool parks its bodies 200 m down too. */
const PARKED_Y = -200;
/** The rope joint's axis in Rapier's raw joint set: its length is the limit of that axis. */
const ROPE_AXIS = 0;
const ORIGIN = { x: 0, y: 0, z: 0 };

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _world = new THREE.Vector3();
const _next = { x: 0, y: 0, z: 0 };

type Thing = "doll" | "prop" | "box";

/**
 * One end of a rope: a body of the dummies' world with the point of it the rope is tied at (`held`: its frame), or a kinematic point the rope is
 * drawn to (a car's point, in the car's frame, or a world point), moved a step at a time like a car's proxy.
 */
class Side {
  held = false;
  kind: Thing | "car" | "world" = "world";
  id = 0;
  body: RigidBody | null = null;
  handle = -1;
  readonly local = new THREE.Vector3();
  readonly from = new THREE.Vector3();
  readonly to = new THREE.Vector3();
}

class Link {
  live = false;
  /** The joint is made: both ends' places are known (a car's end waits for the car's first pose). */
  armed = false;
  joint: ImpulseJoint | null = null;
  length = 0;
  readonly sides = [new Side(), new Side()] as const;
}

/** The distance (m) from `p`, a point in a box's own frame, to the box of half extents `h`. */
function boxGap(p: THREE.Vector3, h: readonly [number, number, number]): number {
  return hypot3(Math.max(Math.abs(p.x) - h[0], 0), Math.max(Math.abs(p.y) - h[1], 0), Math.max(Math.abs(p.z) - h[2], 0));
}

/** `at` (world) in `body`'s own frame into `out`. */
function inFrame(body: RigidBody, at: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const t = body.translation();
  const r = body.rotation();
  return out.copy(at).sub(_p.set(t.x, t.y, t.z)).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
}

/**
 * The tether's cables that have an end in the dummies' world: each a Rapier rope joint between a body there (a dummy's part, a knocked prop, a box) and
 * another body or a kinematic point that follows a car's point or a world point. The sim's cables hold cars; these hold what is cosmetic, so a dummy
 * dangles from a car and nothing pushes back at the car. A rope is at most `MAX_TETHERS` and its slot is its cable's slot in `TetherSet`.
 */
export class Ropes {
  /** Ropes alive (told of, joined or not). */
  count = 0;
  /** The winch is held: every rope reels in at `WINCH_SPEED`. */
  reeling = false;
  private R: Rapier | null = null;
  private world: World | null = null;
  private cars: readonly RagCar[] = [];
  private readonly links = Array.from({ length: MAX_TETHERS }, () => new Link());
  private readonly points: RigidBody[] = [];
  private readonly dolls: readonly Doll[];
  private readonly props: PropBodies;
  private readonly boxes: BoxPile;

  constructor(dolls: readonly Doll[], props: PropBodies, boxes: BoxPile) {
    this.dolls = dolls;
    this.props = props;
    this.boxes = boxes;
  }

  /** Rapier is in: the kinematic points the ropes' free ends are, two to a rope, away and disabled until one is tied. */
  load(R: Rapier, world: World): void {
    this.R = R;
    this.world = world;
    for (let i = 0; i < 2 * MAX_TETHERS; i++) this.points.push(world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PARKED_Y, 0).setEnabled(false)));
  }

  /** Rope `slot` ties `a` to `b`: it is joined at the next `follow`, once the cars it follows have a pose. A rope already in the slot is cut; one with no end in this world, or an end that is gone, leaves the slot empty. */
  attach(slot: number, a: RopeEnd, b: RopeEnd): void {
    this.cut(slot);
    const link = this.links[slot]!;
    const [first, second] = link.sides;
    const fits = this.bind(first, 2 * slot, a) && this.bind(second, 2 * slot + 1, b) && (first.held || second.held);
    if (!fits) {
      this.cut(slot);
      return;
    }
    link.live = true;
    this.count++;
  }

  /** Rope `slot` is cut and what it held is let go; `slot` -1: every rope, and the winch stops. */
  cut(slot: number): void {
    if (slot < 0) {
      for (let i = 0; i < MAX_TETHERS; i++) this.cut(i);
      this.reeling = false;
      return;
    }
    const link = this.links[slot]!;
    if (link.joint !== null) this.world?.removeImpulseJoint(link.joint, true);
    link.joint = null;
    for (const side of link.sides) {
      if (side.held) this.untie(side);
      else if (link.armed && side.body !== null) disable(side.body);
      side.body = null;
      side.held = false;
    }
    if (link.live) this.count--;
    link.live = false;
    link.armed = false;
  }

  /** The thing `kind` `id` is gone (a dummy put away): every rope on it is cut. */
  drop(kind: Thing, id: number): void {
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      if (this.links[slot]!.sides.some((side) => side.held && side.kind === kind && side.id === id)) this.cut(slot);
    }
  }

  /** Once a frame, before the steps: ropes whose body has left the world are cut, a body held is kept awake, a rope waiting for its cars is joined, and the kinematic ends are aimed at where the cars' points are now. */
  follow(cars: readonly RagCar[]): void {
    this.cars = cars;
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      const link = this.links[slot]!;
      if (!link.live) continue;
      if (link.sides.some((side) => side.held && !this.world!.bodies.contains(side.handle))) {
        this.cut(slot);
        continue;
      }
      for (const side of link.sides) if (side.held) side.body!.wakeUp();
      if (!link.armed) {
        this.join(slot);
        continue;
      }
      for (const side of link.sides) {
        if (side.held) continue;
        side.from.copy(side.to);
        this.driven(side, side.to);
      }
    }
  }

  /** The kinematic ends `f` (0 to 1) of the way along this frame's path: each step of the frame is one stride further, as the cars' proxies are. */
  move(f: number): void {
    for (const link of this.links) {
      if (!link.armed) continue;
      for (const side of link.sides) {
        if (side.held) continue;
        _next.x = side.from.x + (side.to.x - side.from.x) * f;
        _next.y = side.from.y + (side.to.y - side.from.y) * f;
        _next.z = side.from.z + (side.to.z - side.from.z) * f;
        side.body!.setNextKinematicTranslation(_next);
      }
    }
  }

  /** After the frame's steps: the winch takes `dt` s of length off every joined rope, and `out` (`MAX_TETHERS` records of `ROPE_FLOATS`) says where each rope stands. */
  finish(dt: number, out: Float32Array): void {
    out.fill(0);
    for (let slot = 0; slot < MAX_TETHERS; slot++) {
      const link = this.links[slot]!;
      if (!link.live) continue;
      const o = slot * ROPE_FLOATS;
      if (!link.armed) {
        out[o + ROPE_STATE] = ROPE_PENDING;
        continue;
      }
      this.place(link.sides[0], _world);
      this.place(link.sides[1], _local);
      if (this.reeling) {
        link.length = Math.min(link.length, Math.max(Math.min(WINCH_MIN_LENGTH, link.length), _world.distanceTo(_local) - WINCH_SPEED * dt));
        this.world!.impulseJoints.raw.jointSetLimits(link.joint!.handle, ROPE_AXIS, 0, link.length);
      }
      out[o + ROPE_STATE] = ROPE_JOINED;
      _world.toArray(out, o + ROPE_A);
      _local.toArray(out, o + ROPE_B);
      out[o + ROPE_LENGTH] = link.length;
    }
  }

  /** Both ends are bound and their places known: the rope is as long as they stand apart now, and joined. */
  private join(slot: number): void {
    const link = this.links[slot]!;
    const [first, second] = link.sides;
    for (const side of link.sides) {
      if (side.held) continue;
      if (side.kind === "car" && this.cars[side.id] === undefined) {
        this.cut(slot);
        return;
      }
      this.driven(side, side.to);
      side.from.copy(side.to);
      side.body!.setTranslation(side.to, true);
      side.body!.setEnabled(true);
    }
    this.place(first, _world);
    this.place(second, _local);
    link.length = Math.max(_world.distanceTo(_local), MIN_ROPE);
    link.joint = this.world!.createImpulseJoint(this.R!.JointData.rope(link.length, first.held ? first.local : ORIGIN, second.held ? second.local : ORIGIN), first.body!, second.body!, true);
    link.armed = true;
  }

  /** Where `side`'s point is in the world now into `out`: a held one by its body's pose, a kinematic one by its car's (or the world's fixed point). */
  private place(side: Side, out: THREE.Vector3): void {
    if (!side.held) {
      out.copy(side.to);
      return;
    }
    const t = side.body!.translation();
    const r = side.body!.rotation();
    out.copy(side.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_p.set(t.x, t.y, t.z));
  }

  /** A kinematic side's point in the world now into `out`: a car's point in the car's frame, or the world point it is. */
  private driven(side: Side, out: THREE.Vector3): void {
    const car = side.kind === "car" ? this.cars[side.id] : undefined;
    if (car === undefined) {
      if (side.kind === "world") out.copy(side.local);
      return;
    }
    out.copy(side.local).applyQuaternion(car.group.quaternion).add(car.group.position);
  }

  /** `side` made `end`: a held end is tied to its body (false when there is none to tie), a kinematic one takes this rope's point body. */
  private bind(side: Side, point: number, end: RopeEnd): boolean {
    side.kind = end.kind;
    if (end.kind === "world" || end.kind === "car") {
      side.held = false;
      side.id = end.kind === "car" ? end.id : 0;
      side.local.fromArray(end.at);
      side.body = this.points[point]!;
      return true;
    }
    side.id = end.id;
    _world.fromArray(end.at);
    side.held = this.tie(side, end.kind, _world);
    if (side.held) side.handle = side.body!.handle;
    return side.held;
  }

  /** Body of thing `kind` `id` for `side`, and where the world point `at` lies in it (a point of its shape: no farther than it reaches). */
  private tie(side: Side, kind: Thing, at: THREE.Vector3): boolean {
    if (kind === "doll") return this.tieDoll(side, at);
    const body = kind === "prop" ? this.props.take(side.id) : this.boxes.bodyAt(side.id);
    if (body === null) return false;
    const reach = kind === "prop" ? this.props.reachOf(side.id) : this.boxes.reachOf(side.id);
    inFrame(body, at, side.local);
    if (side.local.length() > reach) side.local.multiplyScalar(reach / side.local.length());
    side.body = body;
    return true;
  }

  /** The part of dummy `side.id` nearest `at`, tied at the point of its box nearest `at`. */
  private tieDoll(side: Side, at: THREE.Vector3): boolean {
    const doll = this.dolls[side.id];
    if (doll === undefined || !doll.live || doll.driven) return false;
    let nearest = Infinity;
    for (let k = 0; k < PARTS.length; k++) {
      const gap = boxGap(inFrame(doll.bodies[k]!, at, _local), PARTS[k]!.h);
      if (gap >= nearest) continue;
      nearest = gap;
      side.body = doll.bodies[k]!;
      side.local.copy(_local);
    }
    const half = PARTS[doll.bodies.indexOf(side.body!)]!.h;
    side.local.set(THREE.MathUtils.clamp(side.local.x, -half[0], half[0]), THREE.MathUtils.clamp(side.local.y, -half[1], half[1]), THREE.MathUtils.clamp(side.local.z, -half[2], half[2]));
    doll.ropes++;
    return true;
  }

  private untie(side: Side): void {
    if (side.kind !== "doll") return;
    const doll = this.dolls[side.id];
    if (doll !== undefined) doll.ropes = Math.max(0, doll.ropes - 1);
  }
}
