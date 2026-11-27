import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { DOOR_FACE, type DoorLeaf } from "../../world/openworld/interior-plan.ts";
import { DOOR_RANGE, DOOR_REACH, DOOR_SWING_SECONDS } from "./interior-constants.ts";
import { SPECIES } from "../../ai/civilians/civilian-constants.ts";
import { LOOK } from "../../ai/civilians/civilian-crowd-constants.ts";

/** Figures that may open a door: their look words say which are people (`LOOK`; a cat or a dog resting at a door opens none). */
type DoorPoses = { count: number; x: ArrayLike<number>; z: ArrayLike<number>; shown: ArrayLike<number>; look: ArrayLike<number> };
/** Who can open a door this frame: the crowd's shown people (null before there is a crowd), the player's walker (null while he is in a car), and the few shown figures drawn apart from the crowd (the foot cops, the medics). */
export type DoorOpeners = {
  poses: DoorPoses | null;
  walker: { x: number; z: number } | null;
  others: DoorPoses[];
  /** 1 at the map index of each place that is shut now (a wreck, or outside its hours), null where nothing says. */
  closed: Uint8Array | null;
  /** Bodies the hook holds, wherever they stand: the interior around each keeps its floor for the physics (`InteriorSet.update`); absent: none. */
  pinned?: PinnedSpots;
};

/** `count` spots (x, z of the first `count` entries): a hooked body's feet. */
export type PinnedSpots = { count: number; x: Float32Array; z: Float32Array };

/** The side (m) of a cell of the leaf grid `markOpeners` reads: at least `DOOR_REACH`, so the cells around a point hold every leaf in its reach. */
const DOOR_CELL = 4;

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
  /** 1 for a leaf that no one opens: its shop is shut. */
  private readonly locked: Uint8Array;
  private readonly leafMesh: THREE.InstancedMesh;
  private readonly vestibuleMesh: THREE.InstancedMesh;
  private readonly leafGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly leafMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
  private readonly vestibuleGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly vestibuleMaterial = new THREE.MeshStandardMaterial({ color: VESTIBULE_WALL, roughness: 0.9, side: THREE.BackSide });
  /** The shown civilians near the eye this frame, by index into the poses: grown on the cold path when a crowd is bigger than any before. */
  private nearby = new Int32Array(0);
  /** 1 for a leaf someone (the walker, a figure of `others`, a person of the crowd) stands within `DOOR_REACH` of this frame. */
  private readonly touched: Uint8Array;
  /** The leaves by cell of `DOOR_CELL` (CSR: `cellLeaves[cellStart[c]..cellStart[c + 1]]`), the grid's corner and size in cells. */
  private readonly cellStart: Int32Array;
  private readonly cellLeaves: Int32Array;
  private readonly cellX0: number;
  private readonly cellZ0: number;
  private readonly cellCols: number;
  private readonly cellRows: number;
  /** The walker's spot, so `touch` takes it as it takes a crowd's: from arrays. */
  private readonly walkerX = new Float64Array(1);
  private readonly walkerZ = new Float64Array(1);

  constructor(leaves: readonly DoorLeaf[]) {
    this.leaves = leaves;
    this.openness = new Float32Array(leaves.length);
    this.locked = new Uint8Array(leaves.length);
    this.touched = new Uint8Array(leaves.length);
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const leaf of leaves) {
      x0 = Math.min(x0, leaf.x);
      z0 = Math.min(z0, leaf.z);
      x1 = Math.max(x1, leaf.x);
      z1 = Math.max(z1, leaf.z);
    }
    this.cellX0 = leaves.length === 0 ? 0 : x0;
    this.cellZ0 = leaves.length === 0 ? 0 : z0;
    this.cellCols = leaves.length === 0 ? 1 : Math.floor((x1 - x0) / DOOR_CELL) + 1;
    this.cellRows = leaves.length === 0 ? 1 : Math.floor((z1 - z0) / DOOR_CELL) + 1;
    this.cellStart = new Int32Array(this.cellCols * this.cellRows + 1);
    const cellOf = (leaf: DoorLeaf): number => Math.floor((leaf.z - this.cellZ0) / DOOR_CELL) * this.cellCols + Math.floor((leaf.x - this.cellX0) / DOOR_CELL);
    for (const leaf of leaves) this.cellStart[cellOf(leaf) + 1]!++;
    for (let cell = 0; cell < this.cellCols * this.cellRows; cell++) this.cellStart[cell + 1]! += this.cellStart[cell]!;
    this.cellLeaves = new Int32Array(leaves.length);
    const fill = this.cellStart.slice(0, this.cellCols * this.cellRows);
    for (let door = 0; door < leaves.length; door++) this.cellLeaves[fill[cellOf(leaves[door]!)]!++] = door;
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
    this.markOpeners(near, openers);
    const step = dt / DOOR_SWING_SECONDS;
    let moved = false;
    for (let door = 0; door < this.leaves.length; door++) {
      const leaf = this.leaves[door]!;
      const was = this.openness[door]!;
      const inRange = hypot2(leaf.x - eyeX, leaf.z - eyeZ) <= DOOR_RANGE;
      if (!inRange && was === 0) continue;
      const next = !inRange ? 0 : this.locked[door] === 0 && this.touched[door] === 1 ? Math.min(1, was + step) : Math.max(0, was - step);
      if (next === was) continue;
      this.openness[door] = next;
      this.placeLeaf(door);
      moved = true;
    }
    if (moved) this.leafMesh.instanceMatrix.needsUpdate = true;
  }

  /** A locked leaf swings shut and stays shut, whoever stands at it. */
  setLocked(door: number, locked: boolean): void {
    this.locked[door] = locked ? 1 : 0;
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
    const alongX = leaf.closedX * detCos(angle) + leaf.openX * detSin(angle);
    const alongZ = leaf.closedZ * detCos(angle) + leaf.openZ * detSin(angle);
    _position.set(leaf.hingeX + (alongX * leaf.width) / 2, leaf.floorY + leaf.height / 2, leaf.hingeZ + (alongZ * leaf.width) / 2);
    _rotation.setFromAxisAngle(_up, detAtan2(-alongZ, alongX));
    _scale.set(leaf.width, leaf.height, LEAF_THICK);
    this.leafMesh.setMatrixAt(door, _matrix.compose(_position, _rotation, _scale));
  }

  /** The shown people (not the cats and dogs) within the doors' range of the eye, into `nearby`; their count. */
  private gatherNearby(eyeX: number, eyeZ: number, openers: DoorOpeners): number {
    const poses = openers.poses;
    if (poses === null) return 0;
    if (this.nearby.length < poses.count) this.nearby = new Int32Array(poses.count);
    let count = 0;
    for (let person = 0; person < poses.count; person++) {
      if (poses.shown[person] === 0 || poses.look[person]! >>> LOOK.speciesShift !== SPECIES.person) continue;
      if (hypot2(poses.x[person]! - eyeX, poses.z[person]! - eyeZ) <= DOOR_RANGE + DOOR_REACH) this.nearby[count++] = person;
    }
    return count;
  }

  /** `touched` for this frame: each point that opens a door (the walker, every shown figure of `others`, the `near` people) marks the leaves within `DOOR_REACH` of it, found in the cells around it. */
  private markOpeners(near: number, openers: DoorOpeners): void {
    this.touched.fill(0);
    const walker = openers.walker;
    if (walker !== null) {
      this.walkerX[0] = walker.x;
      this.walkerZ[0] = walker.z;
      this.touch(this.walkerX, this.walkerZ, 0);
    }
    for (let set = 0; set < openers.others.length; set++) {
      const other = openers.others[set]!;
      for (let figure = 0; figure < other.count; figure++) if (other.shown[figure] === 1) this.touch(other.x, other.z, figure);
    }
    const poses = openers.poses;
    if (poses === null) return;
    for (let at = 0; at < near; at++) this.touch(poses.x, poses.z, this.nearby[at]!);
  }

  /** Marks the leaves within `DOOR_REACH` of (`xs[at]`, `zs[at]`): arrays and an index, so no double crosses the call. */
  private touch(xs: ArrayLike<number>, zs: ArrayLike<number>, at: number): void {
    const col = Math.floor((xs[at]! - this.cellX0) / DOOR_CELL);
    const row = Math.floor((zs[at]! - this.cellZ0) / DOOR_CELL);
    for (let r = row - 1; r <= row + 1; r++) {
      if (!(r >= 0 && r < this.cellRows)) continue;
      for (let c = col - 1; c <= col + 1; c++) {
        if (!(c >= 0 && c < this.cellCols)) continue;
        const cell = r * this.cellCols + c;
        for (let item = this.cellStart[cell]!; item < this.cellStart[cell + 1]!; item++) {
          const door = this.cellLeaves[item]!;
          const leaf = this.leaves[door]!;
          if (hypot2(xs[at]! - leaf.x, zs[at]! - leaf.z) <= DOOR_REACH) this.touched[door] = 1;
        }
      }
    }
  }
}
