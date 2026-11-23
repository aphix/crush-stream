import * as THREE from "three";
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
/** The box's barrel axis in its own frame. */
const BARREL_AXIS = new THREE.Vector3(0, -1, 0);

/**
 * The held gun: its model per weapon (today the one box and its length for every weapon; a model per weapon replaces `model` here and nowhere else), its barrel laid between shots at the aim point
 * (`pose`), and laid on a shot's target at the moment it is fired (`layOn`), kept there for the flash and eased back.
 */
export class HandGuns {
  private readonly box: HandGunModel;
  private readonly barrel = new THREE.Vector3();
  private readonly aimed = new THREE.Vector3();
  /** The barrel's direction when the last shot was fired, and the seconds it is still held, then eased. */
  private readonly laid = new THREE.Vector3();
  private holdLeft = 0;
  private easeLeft = 0;

  constructor(mesh: THREE.Mesh) {
    this.box = { mesh, muzzle: GUN.muzzle + GUN.len / 2, centre: GUN.len / 2 - GRIP_FROM_REAR };
  }

  /** The model held for `weapon`. */
  model(_weapon: WeaponId): HandGunModel {
    return this.box;
  }

  /** The gun held for `weapon` is laid from `hand` along `this.barrel` and its tip written to `muzzle`. */
  private place(weapon: WeaponId, hand: THREE.Vector3, muzzle: THREE.Vector3): void {
    const model = this.model(weapon);
    model.mesh.quaternion.setFromUnitVectors(BARREL_AXIS, this.barrel);
    model.mesh.position.copy(hand).addScaledVector(this.barrel, model.centre);
    muzzle.copy(hand).addScaledVector(this.barrel, model.muzzle);
  }

  /** Each frame: the gun in `hand` with its barrel at the point `GUN_AIM_M` past where `aim` passes nearest the hand, or (for the flash and the ease after a shot) on the lay of the shot; the tip into `muzzle`. */
  pose(weapon: WeaponId, hand: THREE.Vector3, aim: LookRay, dt: number, muzzle: THREE.Vector3): void {
    const along = (hand.x - aim.eyeX) * aim.dirX + (hand.y - aim.eyeY) * aim.dirY + (hand.z - aim.eyeZ) * aim.dirZ + GUN_AIM_M;
    this.aimed.set(aim.eyeX + aim.dirX * along - hand.x, aim.eyeY + aim.dirY * along - hand.y, aim.eyeZ + aim.dirZ * along - hand.z).normalize();
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      this.barrel.copy(this.laid);
    } else if (this.easeLeft > 0) {
      this.easeLeft -= dt;
      const kept = Math.max(0, this.easeLeft) / GUN_EASE_S;
      this.barrel.copy(this.aimed).multiplyScalar(1 - kept).addScaledVector(this.laid, kept).normalize();
    } else this.barrel.copy(this.aimed);
    this.place(weapon, hand, muzzle);
  }

  /** A shot is fired at (x, y, z): the gun is laid from `hand` straight at it now, so its barrel, its tip and the bullet's line are one line; the tip into `muzzle`. False when the hand is on the point (no direction). */
  layOn(weapon: WeaponId, hand: THREE.Vector3, x: number, y: number, z: number, muzzle: THREE.Vector3): boolean {
    this.barrel.set(x - hand.x, y - hand.y, z - hand.z);
    if (this.barrel.lengthSq() < 1e-6) return false;
    this.barrel.normalize();
    this.laid.copy(this.barrel);
    this.holdLeft = FLASH_S;
    this.easeLeft = GUN_EASE_S;
    this.place(weapon, hand, muzzle);
    return true;
  }
}
