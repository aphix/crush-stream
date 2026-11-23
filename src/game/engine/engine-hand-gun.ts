import type * as THREE from "three";
import type { LookRay } from "../ai/civilians/civilian-look.ts";
import { GUN } from "../present/people.ts";
import { FLASH_S } from "../present/shot-fx.ts";
import type { WeaponId } from "./engine-onfoot-arms.ts";

/** A held gun as the pose reads it: its mesh (long axis down -y, the muzzle at the -y end), how far (m) its muzzle is from the grip along the barrel, and how far (m) its middle is from the grip. */
type HandGunModel = { mesh: THREE.Object3D; muzzle: number; centre: number };

/** The grip sits this far (m) from the box's near end, so the hand closes on its rear. */
const GRIP_FROM_REAR = 0.04;
/** How far (m) past its point nearest the hand the aim ray is followed to find the point the barrel points at between shots. */
const GUN_AIM_M = 25;
/** After a shot the gun keeps the lay it fired on for the muzzle flash, then eases back to the aim point over this long (s). */
const GUN_EASE_S = 0.15;
/** A barrel this close to straight up has no turn from the box's own axis that is not a half turn about x. */
const STRAIGHT_UP_Y = 0.999999;

/**
 * The held gun: its model per weapon (today the one box and its length for every weapon; a model per weapon replaces `model` here and nowhere else), its barrel laid between shots at the aim point
 * (`pose`), and laid on a shot's target at the moment it is fired (`layOn`), kept there for the flash and eased back. Every number is a scalar field and the mesh is written in place: it runs every frame,
 * and a vector method called with a computed double boxes it.
 */
export class HandGuns {
  private readonly box: HandGunModel;
  /** The barrel's unit direction as it lies now. */
  private bx = 0;
  private by = -1;
  private bz = 0;
  /** The barrel's direction when the last shot was fired, and the seconds it is still held, then eased. */
  private lx = 0;
  private ly = -1;
  private lz = 0;
  private holdLeft = 0;
  private easeLeft = 0;
  /** The frame's seconds, set before `pose` (a double handed across a call is boxed; a field is written in place). */
  dt = 0;
  /** The tip's row of the flash set (x, y, z), written in place by every pose and lay. */
  private readonly muzzles: Float32Array;

  /** `mesh` is drawn from the matrix this writes (it has no position or rotation of its own); `muzzles`: the flash set's muzzle row of the player's gun. */
  constructor(mesh: THREE.Mesh, muzzles: Float32Array) {
    mesh.matrixAutoUpdate = false;
    this.box = { mesh, muzzle: GUN.muzzle + GUN.len / 2, centre: GUN.len / 2 - GRIP_FROM_REAR };
    this.muzzles = muzzles;
  }

  /** The model held for `weapon`. */
  model(_weapon: WeaponId): HandGunModel {
    return this.box;
  }

  /** The held gun laid from `hand` along the barrel (bx, by, bz): its matrix written in place (the turn from the box's axis (0, -1, 0) to the barrel, then its middle), its tip into the muzzle row. */
  private place(weapon: WeaponId, hand: THREE.Vector3): void {
    const model = this.model(weapon);
    const { bx, by, bz } = this;
    // The minimal turn: axis (-bz, 0, bx), cosine 1 - by, as a quaternion; a barrel straight up is the half turn about x.
    const w = 1 - by;
    const length = Math.sqrt(bz * bz + bx * bx + w * w);
    const up = by > STRAIGHT_UP_Y || length === 0;
    const qx = up ? 1 : -bz / length;
    const qz = up ? 0 : bx / length;
    const qw = up ? 0 : w / length;
    const e = model.mesh.matrix.elements;
    e[0] = 1 - 2 * qz * qz;
    e[1] = 2 * qz * qw;
    e[2] = 2 * qx * qz;
    e[4] = -2 * qz * qw;
    e[5] = 1 - 2 * (qx * qx + qz * qz);
    e[6] = 2 * qx * qw;
    e[8] = 2 * qx * qz;
    e[9] = -2 * qx * qw;
    e[10] = 1 - 2 * qx * qx;
    e[12] = hand.x + bx * model.centre;
    e[13] = hand.y + by * model.centre;
    e[14] = hand.z + bz * model.centre;
    model.mesh.matrixWorldNeedsUpdate = true;
    this.muzzles[0] = hand.x + bx * model.muzzle;
    this.muzzles[1] = hand.y + by * model.muzzle;
    this.muzzles[2] = hand.z + bz * model.muzzle;
  }

  /** Each frame: the gun in `hand` with its barrel at the point `GUN_AIM_M` past where `aim` passes nearest the hand, or (for the flash and the ease after a shot) on the lay of the shot; `dt` is set first. */
  pose(weapon: WeaponId, hand: THREE.Vector3, aim: LookRay): void {
    const dt = this.dt;
    const along = (hand.x - aim.eyeX) * aim.dirX + (hand.y - aim.eyeY) * aim.dirY + (hand.z - aim.eyeZ) * aim.dirZ + GUN_AIM_M;
    let ax = aim.eyeX + aim.dirX * along - hand.x;
    let ay = aim.eyeY + aim.dirY * along - hand.y;
    let az = aim.eyeZ + aim.dirZ * along - hand.z;
    const aimLength = Math.sqrt(ax * ax + ay * ay + az * az);
    ax /= aimLength;
    ay /= aimLength;
    az /= aimLength;
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      this.bx = this.lx;
      this.by = this.ly;
      this.bz = this.lz;
    } else if (this.easeLeft > 0) {
      this.easeLeft -= dt;
      const kept = Math.max(0, this.easeLeft) / GUN_EASE_S;
      const mx = ax * (1 - kept) + this.lx * kept;
      const my = ay * (1 - kept) + this.ly * kept;
      const mz = az * (1 - kept) + this.lz * kept;
      const mixLength = Math.sqrt(mx * mx + my * my + mz * mz);
      this.bx = mx / mixLength;
      this.by = my / mixLength;
      this.bz = mz / mixLength;
    } else {
      this.bx = ax;
      this.by = ay;
      this.bz = az;
    }
    this.place(weapon, hand);
  }

  /** A shot is fired at (x, y, z): the gun is laid from `hand` straight at it now, so its barrel, its tip and the bullet's line are one line; the tip is in the muzzle row. False when the hand is on the point (no direction). */
  layOn(weapon: WeaponId, hand: THREE.Vector3, x: number, y: number, z: number): boolean {
    const dx = x - hand.x;
    const dy = y - hand.y;
    const dz = z - hand.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-3) return false;
    this.bx = dx / length;
    this.by = dy / length;
    this.bz = dz / length;
    this.lx = this.bx;
    this.ly = this.by;
    this.lz = this.bz;
    this.holdLeft = FLASH_S;
    this.easeLeft = GUN_EASE_S;
    this.place(weapon, hand);
    return true;
  }
}
