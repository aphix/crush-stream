import * as THREE from "three";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { BODY_POSTURE, type BodyMotion } from "../net/body-codec.ts";
import { ShotFx } from "../present/shot-fx.ts";
import { gunModel } from "../present/weapon-models.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { TORSO_ABOVE_FEET } from "./body-follow.ts";
import { HandGuns } from "./engine-hand-gun.ts";
import { WEAPONS, weaponAt } from "./engine-onfoot-arms.ts";
import type { OpenWorldPlayers } from "./openworld-players.ts";

/** A shot is heard this far (m) from its muzzle: as far as a pistol reaches, past which street noise covers it. */
const SHOT_HEARD_M = WEAPONS.pistol.range;
/** A change of a player's shot counter is drawn as a shot only when this share of his weapon's interval (`Gun.every`) has passed since his last drawn one: a modified guest cannot make a machine flash and sound every frame, and the 15 Hz frames' jitter (a frame of 67 ms against the rifle's 120 ms) still passes an honest stream. */
const SHOT_SPACING = 0.9;
/** A figure's right hand from its torso: the rig's right-arm rest point (0.24 m out, 0.79 m up), the gun held 0.3 m ahead of it (tuned by feel). */
const HAND_SIDE_M = 0.24;
const HAND_UP_M = 0.79 - TORSO_ABOVE_FEET;
const HAND_AHEAD_M = 0.3;

const _hand = new THREE.Vector3();
const _forearm = new THREE.Vector3();
const _aim = new LookRay();

/** Where player `car`'s right hand is drawn when a dummy body carries it, into `hand`, and the unit way its forearm points (elbow to hand) into `forearm`; false when he is drawn as a figure. */
type HandOf = (car: number, hand: THREE.Vector3, forearm: THREE.Vector3) => boolean;

/** Whether the body that carries player `car` holds his right arm out as the local walker's is (`Walker.holdGun`); a player no body carries has nothing to raise. */
type RaiseArm = (car: number, held: boolean) => void;

/** The gun in each other player's hand, and the flash and tracer of his shots: drawn from his record's arms (weapon slot, shot counter, far end), the same on every machine. */
export class RemoteGuns {
  readonly group = new THREE.Group();
  private readonly shots = new ShotFx(MAX_CARS);
  private readonly meshes: (THREE.Mesh | null)[] = Array.from({ length: MAX_CARS }, () => null);
  private readonly guns: (HandGuns | null)[] = Array.from({ length: MAX_CARS }, () => null);
  /** Per player, the shot counter last seen (-1: not seen yet, so a first record fires nothing). */
  private readonly counted = new Int8Array(MAX_CARS).fill(-1);
  /** Per player, the seconds since the last shot drawn for him: a counter change is a shot only after `SHOT_SPACING` of his weapon's interval. */
  private readonly since = new Float32Array(MAX_CARS).fill(Infinity);
  private readonly material: THREE.Mesh["material"];
  /** The frame's seconds and the listener's eye (x, z), set before `frame` (a double handed across a call is boxed; a field is written in place). */
  dt = 0;
  eyeX = 0;
  eyeZ = 0;
  private readonly handOf: HandOf;
  private readonly raise: RaiseArm;
  private readonly heard: (weapon: "pistol" | "shotgun" | "rifle") => void;

  /** `handOf`: the hand of a body; `raise`: holds a body's right arm out or lets it hang; `heard`: plays the shot of a gun the listener is near enough to hear. */
  constructor(material: THREE.Mesh["material"], handOf: HandOf, raise: RaiseArm, heard: (weapon: "pistol" | "shotgun" | "rifle") => void) {
    this.material = material;
    this.handOf = handOf;
    this.raise = raise;
    this.heard = heard;
    this.group.add(this.shots.group);
  }

  /** The mesh and gun-laying state of player `car`, made the first time he holds one. */
  private gunOf(car: number): HandGuns {
    let guns = this.guns[car] ?? null;
    if (guns !== null) return guns;
    const mesh = new THREE.Mesh(gunModel("pistol").geometry, this.material);
    mesh.visible = false;
    this.group.add(mesh);
    guns = new HandGuns(mesh, this.shots.muzzles.subarray(3 * car, 3 * car + 3));
    this.meshes[car] = mesh;
    this.guns[car] = guns;
    return guns;
  }

  /** Once a frame, with `dt` and the listener's eye set: each other player's gun laid in his hand (hidden with fists, or while he is not on his feet), a shot he fired since the last frame flashed, traced and heard, and the flashes aged. */
  frame(arms: OpenWorldPlayers | null): void {
    for (let car = 0; car < MAX_CARS; car++) {
      const mesh = this.meshes[car] ?? null;
      if (arms === null || arms.armsSeen[car] === 0) {
        this.counted[car] = -1;
        this.since[car] = Infinity;
        if (mesh !== null && mesh.visible) {
          mesh.visible = false;
          this.raise(car, false);
        }
        continue;
      }
      const place = arms.armsPlace[car]!;
      const weapon = weaponAt(arms.armsWeapon[car]!);
      const held = weapon !== "fists" && place.posture === BODY_POSTURE.stand;
      this.raise(car, held);
      this.since[car] = this.since[car]! + this.dt;
      const fired = this.counted[car] !== -1 && this.counted[car] !== arms.armsShots[car]!;
      this.counted[car] = arms.armsShots[car]!;
      if (!held) {
        if (mesh !== null) mesh.visible = false;
        continue;
      }
      const guns = this.gunOf(car);
      this.meshes[car]!.visible = true;
      this.placeHand(car, place);
      _aim.eyeX = _hand.x;
      _aim.eyeY = _hand.y;
      _aim.eyeZ = _hand.z;
      _aim.dirX = _forearm.x;
      _aim.dirY = _forearm.y;
      _aim.dirZ = _forearm.z;
      guns.dt = this.dt;
      guns.pose(weapon, _hand, _aim);
      if (!fired || weapon === "hook" || this.since[car]! < SHOT_SPACING * WEAPONS[weapon].every || !guns.layOnRow(weapon, _hand, arms.armsFar, 3 * car)) continue;
      this.since[car] = 0;
      this.shots.fireFrom(car, arms.armsFar, 3 * car);
      const muzzles = this.shots.muzzles;
      const dx = muzzles[3 * car]! - this.eyeX;
      const dz = muzzles[3 * car + 2]! - this.eyeZ;
      if (dx * dx + dz * dz <= SHOT_HEARD_M * SHOT_HEARD_M) this.heard(weapon);
    }
    this.shots.dt = this.dt;
    this.shots.age();
  }

  /** `_hand` is player `car`'s right hand at `place`: his body's (and `_forearm` the way his forearm points, elbow to hand), else a figure's at its torso facing `place.heading` (`_forearm` level along it). */
  private placeHand(car: number, place: BodyMotion): void {
    if (this.handOf(car, _hand, _forearm)) return;
    const sin = detSin(place.heading);
    const cos = detCos(place.heading);
    _hand.x = place.x + cos * HAND_SIDE_M + sin * HAND_AHEAD_M;
    _hand.y = place.y + HAND_UP_M;
    _hand.z = place.z - sin * HAND_SIDE_M + cos * HAND_AHEAD_M;
    _forearm.x = sin;
    _forearm.y = 0;
    _forearm.z = cos;
  }

  dispose(): void {
    this.shots.dispose();
    for (let car = 0; car < MAX_CARS; car++) this.meshes[car]?.removeFromParent();
    this.group.removeFromParent();
  }
}
