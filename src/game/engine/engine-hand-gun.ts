import * as THREE from "three";
import type { LookRay } from "../ai/civilians/civilian-look.ts";
import { GUN } from "../present/people.ts";
import type { WeaponId } from "./engine-onfoot-arms.ts";

/** A held gun as the pose reads it: its mesh (long axis down -y, the muzzle at the -y end), how far (m) its muzzle is from the grip along the barrel, and how far (m) its middle is from the grip. */
type HandGunModel = { mesh: THREE.Object3D; muzzle: number; centre: number };

/** The grip sits this far (m) from the box's near end, so the hand closes on its rear. */
const GRIP_FROM_REAR = 0.04;

/** The pose's one source of a gun's mesh and lengths per weapon: today the one box and its length for every weapon; a model per weapon replaces `model` here and nowhere else. */
export class HandGuns {
  private readonly box: HandGunModel;

  constructor(mesh: THREE.Mesh) {
    this.box = { mesh, muzzle: GUN.muzzle + GUN.len / 2, centre: GUN.len / 2 - GRIP_FROM_REAR };
  }

  /** The model held for `weapon`. */
  model(_weapon: WeaponId): HandGunModel {
    return this.box;
  }
}

/** How far (m) past its point nearest the hand the aim ray is followed to find the point the barrel points at: the barrel and the shot's line then agree to within a degree or two for a target 15 m or more off. */
const GUN_AIM_M = 25;
/** The box's barrel axis in its own frame. */
const BARREL_AXIS = new THREE.Vector3(0, -1, 0);

/**
 * Lays `model` in the hand at `hand`, its barrel pointing at the point `GUN_AIM_M` past where `aim` passes nearest the hand (the barrel's, the muzzle's and the bullet's line are one line to what the
 * camera looks at), and writes the muzzle point into `muzzle`. `scratch` holds the barrel's unit direction.
 */
export function pointGun(model: HandGunModel, hand: THREE.Vector3, aim: LookRay, scratch: THREE.Vector3, muzzle: THREE.Vector3): void {
  const along = (hand.x - aim.eyeX) * aim.dirX + (hand.y - aim.eyeY) * aim.dirY + (hand.z - aim.eyeZ) * aim.dirZ + GUN_AIM_M;
  scratch.set(aim.eyeX + aim.dirX * along - hand.x, aim.eyeY + aim.dirY * along - hand.y, aim.eyeZ + aim.dirZ * along - hand.z).normalize();
  model.mesh.quaternion.setFromUnitVectors(BARREL_AXIS, scratch);
  model.mesh.position.copy(hand).addScaledVector(scratch, model.centre);
  muzzle.copy(hand).addScaledVector(scratch, model.muzzle);
}
