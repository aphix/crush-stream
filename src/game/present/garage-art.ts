import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canvasTexture, cinderBlock, concrete } from "./lab-art.ts";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import type { DriverLook } from "./driver-look.ts";
import type { SprayBitmap } from "./spray.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import { MAT } from "../kernel/material-ids.ts";

/** The garage (m): the room's half width, its back wall, its height; where the driver stands; and what the camera circles. */
export const GARAGE = {
  halfW: 6,
  back: -5,
  height: 3.6,
  turntableR: 2.8,
  /** The driver stands here beside the car, facing +z (the same way as the car): his rest frame is this point's. */
  person: new THREE.Vector3(1.9, 0, 0.6),
  /**
   * The opening shot (`ChaseCamera.frameReset`): from the front right, the car and the driver beside it in view, and the point the
   * orbit circles. Its closest (`minRadius`, m) keeps the near plane out of every body the player can pick (a sedan's would allow
   * 2.05, the monster's needs 3).
   */
  angle: 0.75,
  shot: { lookX: 0.7, lookY: 0.8, lookZ: 0.2, radius: 8.5, pitch: 0.3, minRadius: 3 },
  /**
   * The driver's close shot (`EngineGarage.frameGarage`): the orbit circles his chest (`chest`, on his posed torso), not the car, so a
   * phone can reach his shirt, his hair and his back. At its closest the near plane clears every build's head from above (a woman's
   * needs 0.65 m); there a phone shows 0.5 m of him and the can's smallest dot (4 cm across) 53 px wide.
   */
  driverShot: { radius: 3.5, pitch: 0.14, minRadius: 0.65 },
  /** His sternum on the standing torso (m, part 0's rest frame: its box spans 0.84 to 1.38 m up). */
  chest: new THREE.Vector3(0, 1.25, 0),
} as const;

/** One painted-block tile and one concrete slab (m), as the Lab's garage draws them. */
const BLOCK_TILE = 0.8;
const SLAB_TILE = 3;
const TURNTABLE_STEEL = 0x3d4147;

/**
 * The garage's set, drawn only: a concrete floor, painted block on the back and both side walls, a work light under the
 * ceiling, the car's turntable, and the player's driver standing beside it (`stand`).
 */
export class GarageArt {
  readonly group = new THREE.Group();
  readonly dummy = new DummyMesh(1, true);
  private readonly own: THREE.Texture[];

  constructor() {
    this.group.name = "garage";
    this.group.visible = false;
    const { halfW, back, height } = GARAGE;
    const blocks = canvasTexture(256, 256, cinderBlock);
    blocks.repeat.set((halfW * 2) / BLOCK_TILE, height / BLOCK_TILE);
    const sides = [
      new THREE.PlaneGeometry(halfW * 2, height).translate(0, height / 2, back),
      new THREE.PlaneGeometry(halfW * 2, height).rotateY(-Math.PI / 2).translate(halfW, height / 2, back + halfW),
      new THREE.PlaneGeometry(halfW * 2, height).rotateY(Math.PI / 2).translate(-halfW, height / 2, back + halfW),
    ];
    const walls = new THREE.Mesh(mergeGeometries(sides)!, tagMaterial(new THREE.MeshStandardMaterial({ map: blocks, roughness: 0.95, metalness: 0 }), MAT.BLOCK_WALL));
    for (const g of sides) g.dispose();
    walls.receiveShadow = true;
    const slab = canvasTexture(512, 512, concrete);
    slab.repeat.set((halfW * 2) / SLAB_TILE, (halfW * 2) / SLAB_TILE);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW * 2, halfW * 2).rotateX(-Math.PI / 2).translate(0, 0.002, back + halfW),
      tagMaterial(new THREE.MeshStandardMaterial({ map: slab, roughness: 0.9, metalness: 0 }), MAT.INDOOR_CONCRETE),
    );
    floor.receiveShadow = true;
    const turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(GARAGE.turntableR, GARAGE.turntableR, 0.01, 48).translate(0, 0.005, 0),
      tagMaterial(new THREE.MeshStandardMaterial({ color: TURNTABLE_STEEL, roughness: 0.5, metalness: 0.6 }), MAT.TURNTABLE_STEEL),
    );
    turntable.receiveShadow = true;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.3).translate(0, height - 0.25, 0), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
    this.dummy.castShadow = true;
    this.dummy.frustumCulled = false;
    this.group.add(walls, floor, turntable, lamp, this.dummy);
    this.own = [blocks, slab];
  }

  /** The player's driver standing beside the car in `look`, wearing `spray`. */
  stand(look: DriverLook, spray: SprayBitmap): void {
    this.dummy.dress(0, false, look);
    this.dummy.spray(0, spray);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const [k, part] of PARTS.entries()) this.dummy.pose(0, k, p.fromArray(part.c).add(GARAGE.person), q);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o !== this.dummy) o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    });
    for (const t of this.own) t.dispose();
  }
}
