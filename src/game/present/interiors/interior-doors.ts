import * as THREE from "three";
import { hypot2 } from "../../kernel/physics-core.js";
import { DOOR_FACE, type DoorLeaf } from "../../world/openworld/interior-plan.ts";
import { DOOR_RANGE, DOOR_REACH, DOOR_SWING_SECONDS } from "./interior-constants.ts";

type DoorPoses = { count: number; x: ArrayLike<number>; z: ArrayLike<number>; shown: ArrayLike<number> };
/** Who can open a door this frame: the crowd's shown people (null before there is a crowd), the player's walker (null while he is in a car), and the few shown figures drawn apart from the crowd (the foot cops, the medics). */
export type DoorOpeners = { poses: DoorPoses | null; walker: { x: number; z: number } | null; others: DoorPoses[] };

/** How far a door swings open: a little short of square to the wall, so the leaf stands clear of the jamb it hinges on. */
const OPEN_ANGLE = 0.47 * Math.PI;
const LEAF_THICK = 0.05;
const STREET_LEAF = 0x3a2a20;
const BACK_LEAF = 0x6b4a32;
const VESTIBULE_WALL = 0xd8cfbf;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _rotation = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

/**
 * Every door leaf of the map's interiors as one instanced mesh, hinged and closed until someone stands at the door, then swung open into the room; and the vestibule behind each street
 * door, one instanced mesh of inside-out boxes, shown while the room behind it is not built. A swing is local drawing: no collider, nothing on the wire.
 */
export class DoorSet {
  readonly group = new THREE.Group();
  readonly leaves: readonly DoorLeaf[];
  private readonly openness: Float32Array;
  private readonly leafMesh: THREE.InstancedMesh;
  private readonly vestibuleMesh: THREE.InstancedMesh;
  private readonly leafGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly leafMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
  private readonly vestibuleGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly vestibuleMaterial = new THREE.MeshStandardMaterial({ color: VESTIBULE_WALL, roughness: 0.9, side: THREE.BackSide });
  /** The shown civilians near the eye this frame, by index into the poses: grown on the cold path when a crowd is bigger than any before. */
  private nearby = new Int32Array(0);

  constructor(leaves: readonly DoorLeaf[]) {
    this.leaves = leaves;
    this.openness = new Float32Array(leaves.length);
    this.group.name = "interior-doors";
    this.leafMesh = new THREE.InstancedMesh(this.leafGeometry, this.leafMaterial, Math.max(1, leaves.length));
    this.leafMesh.count = leaves.length;
    this.leafMesh.name = "door-leaves";
    this.vestibuleMesh = new THREE.InstancedMesh(this.vestibuleGeometry, this.vestibuleMaterial, Math.max(1, leaves.length));
    this.vestibuleMesh.count = leaves.length;
    this.vestibuleMesh.name = "door-vestibules";
    for (let door = 0; door < leaves.length; door++) {
      this.leafMesh.setColorAt(door, _color.setHex(leaves[door]!.face === DOOR_FACE.street ? STREET_LEAF : BACK_LEAF));
      this.placeLeaf(door);
      this.showVestibule(door, true);
    }
    this.group.add(this.leafMesh, this.vestibuleMesh);
  }

  /** The doors near the eye swing toward open while someone stands within reach and toward closed while no one does; a door out of range is shut at once. */
  update(eyeX: number, eyeZ: number, dt: number, openers: DoorOpeners): void {
    const near = this.gatherNearby(eyeX, eyeZ, openers);
    const step = dt / DOOR_SWING_SECONDS;
    let moved = false;
    for (let door = 0; door < this.leaves.length; door++) {
      const leaf = this.leaves[door]!;
      const was = this.openness[door]!;
      const inRange = hypot2(leaf.x - eyeX, leaf.z - eyeZ) <= DOOR_RANGE;
      if (!inRange && was === 0) continue;
      const next = !inRange ? 0 : this.someoneAt(leaf, near, openers) ? Math.min(1, was + step) : Math.max(0, was - step);
      if (next === was) continue;
      this.openness[door] = next;
      this.placeLeaf(door);
      moved = true;
    }
    if (moved) this.leafMesh.instanceMatrix.needsUpdate = true;
  }

  /** Open from the first frame of its swing. */
  isOpen(door: number): boolean {
    return this.openness[door]! > 0;
  }

  openCount(): number {
    let count = 0;
    for (let door = 0; door < this.openness.length; door++) if (this.openness[door]! > 0) count++;
    return count;
  }

  /** The vestibule behind a street door is drawn while the room behind it is not. */
  showVestibule(door: number, shown: boolean): void {
    const room = this.leaves[door]!.vestibule;
    if (room === null || !shown) this.vestibuleMesh.setMatrixAt(door, HIDDEN);
    else this.vestibuleMesh.setMatrixAt(door, _matrix.makeScale(room.x1 - room.x0, room.y1 - room.y0, room.z1 - room.z0).setPosition((room.x0 + room.x1) / 2, (room.y0 + room.y1) / 2, (room.z0 + room.z1) / 2));
    this.vestibuleMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.leafMesh.dispose();
    this.vestibuleMesh.dispose();
    this.leafGeometry.dispose();
    this.leafMaterial.dispose();
    this.vestibuleGeometry.dispose();
    this.vestibuleMaterial.dispose();
    this.group.removeFromParent();
  }

  /** The leaf turned about its hinge by its openness: along the wall when shut, into the room when open. */
  private placeLeaf(door: number): void {
    const leaf = this.leaves[door]!;
    const angle = this.openness[door]! * OPEN_ANGLE;
    const alongX = leaf.closedX * Math.cos(angle) + leaf.openX * Math.sin(angle);
    const alongZ = leaf.closedZ * Math.cos(angle) + leaf.openZ * Math.sin(angle);
    _position.set(leaf.hingeX + (alongX * leaf.width) / 2, leaf.floorY + leaf.height / 2, leaf.hingeZ + (alongZ * leaf.width) / 2);
    _rotation.setFromAxisAngle(_up, Math.atan2(-alongZ, alongX));
    _scale.set(leaf.width, leaf.height, LEAF_THICK);
    this.leafMesh.setMatrixAt(door, _matrix.compose(_position, _rotation, _scale));
  }

  /** The shown civilians within the doors' range of the eye, into `nearby`; their count. */
  private gatherNearby(eyeX: number, eyeZ: number, openers: DoorOpeners): number {
    const poses = openers.poses;
    if (poses === null) return 0;
    if (this.nearby.length < poses.count) this.nearby = new Int32Array(poses.count);
    let count = 0;
    for (let person = 0; person < poses.count; person++) {
      if (poses.shown[person] === 0) continue;
      if (hypot2(poses.x[person]! - eyeX, poses.z[person]! - eyeZ) <= DOOR_RANGE + DOOR_REACH) this.nearby[count++] = person;
    }
    return count;
  }

  private someoneAt(leaf: DoorLeaf, near: number, openers: DoorOpeners): boolean {
    const walker = openers.walker;
    if (walker !== null && hypot2(walker.x - leaf.x, walker.z - leaf.z) <= DOOR_REACH) return true;
    for (let set = 0; set < openers.others.length; set++) {
      const other = openers.others[set]!;
      for (let figure = 0; figure < other.count; figure++) if (other.shown[figure] === 1 && hypot2(other.x[figure]! - leaf.x, other.z[figure]! - leaf.z) <= DOOR_REACH) return true;
    }
    const poses = openers.poses;
    if (poses === null) return false;
    for (let at = 0; at < near; at++) {
      const person = this.nearby[at]!;
      if (hypot2(poses.x[person]! - leaf.x, poses.z[person]! - leaf.z) <= DOOR_REACH) return true;
    }
    return false;
  }
}
