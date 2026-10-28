import type { ImpulseJoint, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { PARTS } from "./ragdoll-body.ts";
import type { Gait } from "./walker-gait.ts";
import { FORCE_BASED, FOOT_LOCK, LIN, MOTOR_FLOOR } from "./walker-motors.ts";
import { HEEL } from "./walker-rocker.ts";

/** The feet's parts, left then right (`PARTS`). */
const FOOT_PARTS = [10, 11] as const;
const ZERO = { x: 0, y: 0, z: 0 };
const AXIS = { x: 0, y: 0, z: 1 };
/** No axis of a lock is rigid: only its motors hold the foot. */
const NO_LOCKED_AXES: number = 0;
const _spot = { x: 0, y: 0, z: 0 };

/** The foot's two pivots on its box (the sole's back and front edges, in the part's own frame): heel, then toe. */
const FOOT_HALF = PARTS[10].h;
const PIVOTS = [
  { x: 0, y: -FOOT_HALF[1], z: -FOOT_HALF[2] },
  { x: 0, y: -FOOT_HALF[1], z: FOOT_HALF[2] },
] as const;

/**
 * A planted foot is held where the gait set it down: a kinematic anchor at the point the foot turns on, joined to that point of the foot's sole (its
 * heel, then its toe as the foot rolls) by three stiff linear motors that come on over `FOOT_LOCK.rampSeconds` after the touchdown and let go the moment
 * the gait lifts the foot. The motors, not the ground, hold the foot (it hovers a hair over the floor, the frame carries his weight), so a leg's motors
 * chasing the gait cannot make it skate, and the foot turns freely about the vertical and tips about the ankle. The heel is held where the gait put it;
 * the toe where the foot's own toe is when the weight rolls onto it (the foot has turned with his torso since the touchdown, and the gait's guess
 * of where it points is a few cm out in a turn: a lock that yanked the toe there would pull his legs and tip him).
 */
export class FootLocks {
  private readonly anchors: RigidBody[] = [];
  private readonly joints: ImpulseJoint[] = [];
  private readonly feet: RigidBody[] = [];
  private readonly held = new Float64Array(6);
  private readonly grip = new Float64Array(2);
  private readonly pivots = new Uint8Array(2);
  private world: World | null = null;

  attach(rapier: Rapier, world: World, bodies: readonly RigidBody[]): void {
    this.world = world;
    const raw = world.impulseJoints.raw;
    for (let f = 0; f < 2; f++) {
      const anchor = world.createRigidBody(rapier.RigidBodyDesc.kinematicVelocityBased());
      const joint = world.createImpulseJoint(rapier.JointData.generic(ZERO, PIVOTS[HEEL], AXIS, NO_LOCKED_AXES), anchor, bodies[FOOT_PARTS[f]!]!, true);
      this.feet.push(bodies[FOOT_PARTS[f]!]!);
      for (const axis of LIN) raw.jointConfigureMotorModel(joint.handle, axis, FORCE_BASED);
      this.anchors.push(anchor);
      this.joints.push(joint);
    }
    this.grip.fill(0);
    this.pivots.fill(HEEL);
    this.release();
  }

  /** Remove the anchors (and with them the locks). */
  detach(): void {
    for (const anchor of this.anchors) this.world!.removeRigidBody(anchor);
    this.anchors.length = 0;
    this.feet.length = 0;
    this.joints.length = 0;
    this.world = null;
  }

  /** One frame of `dt` s: the feet the gait holds down are locked to their points with `strength` (0-1) of the lock; `holding` false (down, the get-up) lets every foot go. */
  update(dt: number, gait: Gait, holding: boolean, strength: number): void {
    const raw = this.world!.impulseJoints.raw;
    for (let f = 0; f < 2; f++) {
      const down = holding && gait.planted[f]! === 1;
      this.grip[f] = down ? Math.min(1, this.grip[f]! + dt / FOOT_LOCK.rampSeconds) : 0;
      if (down) {
        if (this.grip[f]! < 1 || gait.pivot[f]! !== this.pivots[f]!) this.rollOnto(f, gait.pivot[f]!);
        _spot.x = this.held[f * 2]!;
        _spot.y = gait.plant[f * 3 + 1]!;
        _spot.z = this.held[f * 2 + 1]!;
        this.anchors[f]!.setTranslation(_spot, false);
      }
      const share = this.grip[f]! * strength;
      const handle = this.joints[f]!.handle;
      for (const axis of LIN) raw.jointConfigureMotorPosition(handle, axis, 0, Math.max(MOTOR_FLOOR, FOOT_LOCK.stiffness * share), Math.max(MOTOR_FLOOR, FOOT_LOCK.damping * share));
    }
  }

  /** Foot `f` turns on `pivot` from now: the lock moves to that point of its sole and holds it where it is now (x and z), not where the gait meant it to be. */
  private rollOnto(f: number, pivot: number): void {
    this.pivots[f] = pivot;
    this.joints[f]!.setAnchor2(PIVOTS[pivot]!);
    const foot = this.feet[f]!;
    const at = foot.translation();
    const q = foot.rotation();
    const p = PIVOTS[pivot]!;
    const tx = 2 * (q.y * p.z - q.z * p.y);
    const ty = 2 * (q.z * p.x - q.x * p.z);
    const tz = 2 * (q.x * p.y - q.y * p.x);
    this.held[f * 2] = at.x + p.x + q.w * tx + (q.y * tz - q.z * ty);
    this.held[f * 2 + 1] = at.z + p.z + q.w * tz + (q.x * ty - q.y * tx);
  }

  private release(): void {
    const raw = this.world!.impulseJoints.raw;
    for (const joint of this.joints) for (const axis of LIN) raw.jointConfigureMotorPosition(joint.handle, axis, 0, MOTOR_FLOOR, MOTOR_FLOOR);
  }
}
