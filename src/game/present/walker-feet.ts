import type { ImpulseJoint, RigidBody, World } from "@dimforge/rapier3d-simd";
import type { Rapier } from "../kernel/rapier.ts";
import { PARTS } from "./ragdoll-body.ts";
import type { Gait } from "./walker-gait.ts";
import { FORCE_BASED, FOOT_LOCK, LIN, MOTOR_FLOOR } from "./walker-motors.ts";

/** The shins' parts, left then right (`PARTS`): the foot is the shin's end. */
const SHIN_PARTS = [7, 9] as const;
const ZERO = { x: 0, y: 0, z: 0 };
const AXIS = { x: 0, y: 0, z: 1 };
/** No axis of a lock is rigid: only its motors hold the foot. */
const NO_LOCKED_AXES: number = 0;
const _tip = { x: 0, y: 0, z: 0 };
const _spot = { x: 0, y: 0, z: 0 };

/**
 * A planted foot is held where the gait set it down: a kinematic anchor at the spot, joined to the shin's end by three stiff linear motors that come
 * on over `FOOT_LOCK.rampSeconds` after the touchdown and let go the moment the gait lifts the foot. The motors, not the ground, hold the foot (it
 * hangs a few cm over the floor, the frame carries his weight), so a leg's motors chasing the gait cannot make it skate.
 */
export class FootLocks {
  private readonly anchors: RigidBody[] = [];
  private readonly joints: ImpulseJoint[] = [];
  private readonly grip = new Float64Array(2);
  private world: World | null = null;

  attach(rapier: Rapier, world: World, bodies: readonly RigidBody[]): void {
    this.world = world;
    const raw = world.impulseJoints.raw;
    for (let f = 0; f < 2; f++) {
      const anchor = world.createRigidBody(rapier.RigidBodyDesc.kinematicVelocityBased());
      _tip.y = -PARTS[SHIN_PARTS[f]!].h[1];
      const joint = world.createImpulseJoint(rapier.JointData.generic(ZERO, _tip, AXIS, NO_LOCKED_AXES), anchor, bodies[SHIN_PARTS[f]!]!, true);
      for (const axis of LIN) raw.jointConfigureMotorModel(joint.handle, axis, FORCE_BASED);
      this.anchors.push(anchor);
      this.joints.push(joint);
    }
    this.grip.fill(0);
    this.release();
  }

  /** Remove the anchors (and with them the locks). */
  detach(): void {
    for (const anchor of this.anchors) this.world!.removeRigidBody(anchor);
    this.anchors.length = 0;
    this.joints.length = 0;
    this.world = null;
  }

  /** One frame of `dt` s: the feet the gait holds down are locked to their spots with `strength` (0-1) of the lock; `holding` false (down, the get-up) lets every foot go. */
  update(dt: number, gait: Gait, holding: boolean, strength: number): void {
    const raw = this.world!.impulseJoints.raw;
    for (let f = 0; f < 2; f++) {
      const down = holding && gait.planted[f]! === 1;
      this.grip[f] = down ? Math.min(1, this.grip[f]! + dt / FOOT_LOCK.rampSeconds) : 0;
      if (down) {
        _spot.x = gait.plant[f * 3]!;
        _spot.y = gait.plant[f * 3 + 1]!;
        _spot.z = gait.plant[f * 3 + 2]!;
        this.anchors[f]!.setTranslation(_spot, false);
      }
      const share = this.grip[f]! * strength;
      const handle = this.joints[f]!.handle;
      for (const axis of LIN) raw.jointConfigureMotorPosition(handle, axis, 0, Math.max(MOTOR_FLOOR, FOOT_LOCK.stiffness * share), Math.max(MOTOR_FLOOR, FOOT_LOCK.damping * share));
    }
  }

  private release(): void {
    const raw = this.world!.impulseJoints.raw;
    for (const joint of this.joints) for (const axis of LIN) raw.jointConfigureMotorPosition(joint.handle, axis, 0, MOTOR_FLOOR, MOTOR_FLOOR);
  }
}
