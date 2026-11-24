import type * as THREE from "three";
import type { LookRay } from "../ai/civilians/civilian-look.ts";
import { FLASH_S } from "../present/shot-fx.ts";
import { gunModel, type GunModelId } from "../present/weapon-models.ts";
import type { WeaponId } from "./engine-onfoot-arms.ts";

/** How far (m) past its point nearest the hand the aim ray is followed to find the point the barrel points at between shots. */
const GUN_AIM_M = 25;
/** After a shot the gun keeps the lay it fired on for the muzzle flash, then eases back to the aim point over this long (s). */
const GUN_EASE_S = 0.15;
/** A barrel this level or steeper (the length of its level part) has a side; one nearer straight up or down takes the world's x as its side. */
const LEVEL_MIN = 1e-6;

/**
 * The thing held out in the player's hand: the model of the weapon in hand (`gunModel`: a pistol, a shotgun, a rifle or the hook's launcher; `model` is the one place a weapon becomes a mesh), its barrel laid between
 * shots at the aim point (`pose`), and laid on a shot's target at the moment it is fired (`layOn`), kept there for the flash and eased back. The grip is at the hand, the barrel runs down the mesh's -y and the gun's top
 * is its +z, kept upward. The bore is above the grip, so the barrel is tipped down by the angle that puts the target on the bore's own line: the barrel, the tip and the bullet's line are one line.
 * Every number is a scalar field and the mesh is written in place: it runs every frame, and a vector method called with a computed double boxes it.
 */
export class HandGuns {
  private readonly mesh: THREE.Mesh;
  /** The model the mesh wears, and how far (m) its muzzle is from the grip along the barrel and above it. */
  private worn: GunModelId | null = null;
  private along = 0;
  private above = 0;
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
  /** The barrel that puts a point on the bore's line, and the side (x, z) of the direction to that point (`toward`): the gun keeps that side when its tipped barrel passes straight down. */
  private tx = 0;
  private ty = -1;
  private tz = 0;
  private sideX = 1;
  private sideZ = 0;
  /** The side of the last shot's lay: the gun keeps it while that lay is held and eased, whatever side the aim point has. */
  private laySideX = 1;
  private laySideZ = 0;
  /** The point `toward` aims the barrel at, written by its caller (a number handed across a call is boxed; a field is written in place). */
  private qx = 0;
  private qy = 0;
  private qz = 0;
  /** The frame's seconds, set before `pose` (a double handed across a call is boxed; a field is written in place). */
  dt = 0;
  /** The tip's row of the flash set (x, y, z), written in place by every pose and lay. */
  private readonly muzzles: Float32Array;

  /** `mesh` is drawn from the matrix this writes (it has no position or rotation of its own); `muzzles`: the flash set's muzzle row of the player's gun. */
  constructor(mesh: THREE.Mesh, muzzles: Float32Array) {
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    this.muzzles = muzzles;
  }

  /** The mesh, wearing the model of `weapon` (fists hold none: the mesh keeps what it wore and is not shown). */
  model(weapon: WeaponId): THREE.Mesh {
    if (weapon !== "fists" && weapon !== this.worn) {
      const model = gunModel(weapon);
      this.mesh.geometry = model.geometry;
      this.along = model.muzzle[0];
      this.above = model.muzzle[1];
      this.worn = weapon;
    }
    return this.mesh;
  }

  /** Into (tx, ty, tz): the barrel from `hand` that puts the point (qx, qy, qz) on the bore's line: the direction to the point, tipped down by the bore's height over the grip seen from that far. False when the hand is on the point. */
  private toward(hand: THREE.Vector3): boolean {
    const dx = this.qx - hand.x;
    const dy = this.qy - hand.y;
    const dz = this.qz - hand.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-3) return false;
    const ux = dx / length;
    const uy = dy / length;
    const uz = dz / length;
    // The upward perpendicular of that direction in its own vertical plane: (side x direction), side = direction x up.
    const level = Math.sqrt(ux * ux + uz * uz);
    const sx = level < LEVEL_MIN ? 1 : -uz / level;
    const sz = level < LEVEL_MIN ? 0 : ux / level;
    this.sideX = sx;
    this.sideZ = sz;
    const tip = Math.min(1, this.above / length);
    const keep = Math.sqrt(1 - tip * tip);
    this.tx = keep * ux - tip * (-sz * uy);
    this.ty = keep * uy - tip * (sz * ux - sx * uz);
    this.tz = keep * uz - tip * (sx * uy);
    return true;
  }

  /** The held gun laid from `hand` along the barrel (bx, by, bz): its matrix written in place (its -y down the barrel, its +z the upward perpendicular, the grip at the hand), its tip into the muzzle row. */
  private place(weapon: WeaponId, hand: THREE.Vector3): void {
    const mesh = this.model(weapon);
    const { bx, by, bz } = this;
    const level = Math.sqrt(bx * bx + bz * bz);
    const flip = level >= LEVEL_MIN && -bz * this.sideX + bx * this.sideZ < 0 ? -1 : 1;
    const sx = level < LEVEL_MIN ? this.sideX : (flip * -bz) / level;
    const sz = level < LEVEL_MIN ? this.sideZ : (flip * bx) / level;
    const upX = -sz * by;
    const upY = sz * bx - sx * bz;
    const upZ = sx * by;
    const e = mesh.matrix.elements;
    e[0] = -sx;
    e[1] = 0;
    e[2] = -sz;
    e[4] = -bx;
    e[5] = -by;
    e[6] = -bz;
    e[8] = upX;
    e[9] = upY;
    e[10] = upZ;
    e[12] = hand.x;
    e[13] = hand.y;
    e[14] = hand.z;
    mesh.matrixWorldNeedsUpdate = true;
    this.muzzles[0] = hand.x + bx * this.along + upX * this.above;
    this.muzzles[1] = hand.y + by * this.along + upY * this.above;
    this.muzzles[2] = hand.z + bz * this.along + upZ * this.above;
  }

  /** Each frame: the gun in `hand` with its barrel at the point `GUN_AIM_M` past where `aim` passes nearest the hand, or (for the flash and the ease after a shot) on the lay of the shot; `dt` is set first. */
  pose(weapon: WeaponId, hand: THREE.Vector3, aim: LookRay): void {
    const dt = this.dt;
    this.model(weapon);
    const along = (hand.x - aim.eyeX) * aim.dirX + (hand.y - aim.eyeY) * aim.dirY + (hand.z - aim.eyeZ) * aim.dirZ + GUN_AIM_M;
    const laid = this.holdLeft > 0 || this.easeLeft > 0;
    this.qx = aim.eyeX + aim.dirX * along;
    this.qy = aim.eyeY + aim.dirY * along;
    this.qz = aim.eyeZ + aim.dirZ * along;
    this.toward(hand);
    if (laid) {
      this.sideX = this.laySideX;
      this.sideZ = this.laySideZ;
    }
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
      this.bx = this.lx;
      this.by = this.ly;
      this.bz = this.lz;
    } else if (this.easeLeft > 0) {
      this.easeLeft -= dt;
      const kept = Math.max(0, this.easeLeft) / GUN_EASE_S;
      const mx = this.tx * (1 - kept) + this.lx * kept;
      const my = this.ty * (1 - kept) + this.ly * kept;
      const mz = this.tz * (1 - kept) + this.lz * kept;
      const mixLength = Math.sqrt(mx * mx + my * my + mz * mz);
      this.bx = mx / mixLength;
      this.by = my / mixLength;
      this.bz = mz / mixLength;
    } else {
      this.bx = this.tx;
      this.by = this.ty;
      this.bz = this.tz;
    }
    this.place(weapon, hand);
  }

  /** A shot is fired at (x, y, z): the gun is laid from `hand` with its bore on it now, so its barrel, its tip and the bullet's line are one line; the tip is in the muzzle row. False when the hand is on the point (no direction). */
  layOn(weapon: WeaponId, hand: THREE.Vector3, x: number, y: number, z: number): boolean {
    this.model(weapon);
    this.qx = x;
    this.qy = y;
    this.qz = z;
    if (!this.toward(hand)) return false;
    this.keepLay(weapon, hand);
    return true;
  }

  /** `layOn` at the point `row[at..at + 3)`: no number crosses the call, so a frame's shot allocates nothing. */
  layOnRow(weapon: WeaponId, hand: THREE.Vector3, row: Float32Array, at: number): boolean {
    this.model(weapon);
    this.qx = row[at]!;
    this.qy = row[at + 1]!;
    this.qz = row[at + 2]!;
    if (!this.toward(hand)) return false;
    this.keepLay(weapon, hand);
    return true;
  }

  /** The barrel that `toward` found is the gun's lay now, held for the flash and eased back after it. */
  private keepLay(weapon: WeaponId, hand: THREE.Vector3): void {
    this.bx = this.tx;
    this.by = this.ty;
    this.bz = this.tz;
    this.lx = this.bx;
    this.ly = this.by;
    this.lz = this.bz;
    this.laySideX = this.sideX;
    this.laySideZ = this.sideZ;
    this.holdLeft = FLASH_S;
    this.easeLeft = GUN_EASE_S;
    this.place(weapon, hand);
  }
}
