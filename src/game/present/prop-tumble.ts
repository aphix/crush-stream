import * as THREE from "three";
import { COUNT, countPart } from "../kernel/frame-parts.ts";
import { PREFABS, type PrefabId } from "../world/catalog.ts";
import type { Placed } from "../world/placements.ts";
import { assetDrawGroupOf } from "../world/scenery-assets/draw-group.ts";
import type { DrawnPose, PrefabMaterials, PrefabPart, Skin } from "./prefab-pieces.ts";
import { withAssetAttributes } from "./scenery-assets-art.ts";
import { prefabParts } from "./prefabs.ts";
import { drawCell } from "./track-mesh.ts";

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Placement `p`'s standing matrix into `out`, turned and sized by its drawn `pose` when it has one. */
function restMatrix(p: Placed, pose: DrawnPose | null, out: THREE.Matrix4): THREE.Matrix4 {
  if (pose === null) return out.compose(_p.set(p.x, p.y, p.z), _q.setFromAxisAngle(_up, p.yaw), _s.set(p.sx, p.sy, p.sz));
  return out.compose(_p.set(p.x, p.y, p.z), _q.setFromAxisAngle(_up, p.yaw + pose.yaw), _s.set(p.sx * pose.scale, p.sy * pose.scale, p.sz * pose.scale));
}

/**
 * Placed props drawn, one InstancedMesh per part of each prefab per draw cell (`drawCell`), so three culls each cell by
 * its own bounds (a scenery asset's group is its kind and family in a wider cell, `assetDrawGroupOf`); each placement at its slot: standing where it was put, a knocked one where the dummies' world has it
 * tumbling (`RagdollSystem.knockProp` moves it, `place`). A course's (`TrackArt`) and the Lab's (`LabArt`) props.
 */
export class PropTumble {
  private readonly placed: readonly Placed[];
  /** Per prefab and cell: its parts' meshes. */
  private readonly meshes: THREE.InstancedMesh[][] = [];
  /** Per placement: its prefab and cell's index in `meshes`. */
  private readonly cell: Int32Array;
  /** Per placement: instance slot in its cell's meshes. */
  private readonly slot: Int32Array;
  /** Per placement: 0 on its spot, 1 drawn off it (flown: its cell's bounds grew), 2 hidden where it stands (`hide`) since the last `reset`. */
  private readonly moved: Uint8Array;
  /** Per placement: its drawn pose (`drawnPose`), null for none. */
  private readonly poses: (DrawnPose | null)[];
  private readonly m4 = new THREE.Matrix4();
  private readonly sc = new THREE.Vector3();
  private readonly sphere = new THREE.Sphere();

  /**
   * Each placement standing in its slot of its prefab's meshes (`prefabParts` in `mats`, in the skin `styleOf` names: a building's facade style, an asset's family), coloured where `tint` says; `add` takes
   * each mesh as it is made (`shared`: its part's material when that is the scene's, else null). A group of scenery assets draws from its own copy of the geometry, each instance carrying its sprite's atlas cell.
   * `drawnPose` turns and sizes a placement's drawing only (a street tree facing its street).
   */
  constructor(
    placed: readonly Placed[],
    mats: PrefabMaterials,
    add: (mesh: THREE.InstancedMesh, id: PrefabId, shared: THREE.Material | null, cast: boolean) => void,
    tint: (id: PrefabId, i: number, out: THREE.Color, style: Skin) => boolean = () => false,
    styleOf: (p: Placed) => Skin = () => null,
    drawnPose: (p: Placed) => DrawnPose | null = () => null,
  ) {
    this.placed = placed;
    this.poses = placed.map(drawnPose);
    const byCell = new Map<string, number[]>();
    for (const [idx, pl] of placed.entries()) {
      const key = pl.asset === undefined ? `${pl.prefab}:${styleOf(pl) ?? ""}@${drawCell(pl.x, pl.z)}` : assetDrawGroupOf(pl.asset, pl.x, pl.z);
      let list = byCell.get(key);
      if (!list) byCell.set(key, (list = []));
      list.push(idx);
    }
    this.cell = new Int32Array(placed.length);
    this.slot = new Int32Array(placed.length);
    this.moved = new Uint8Array(placed.length);
    const col = new THREE.Color();
    const parts = new Map<string, PrefabPart[]>();
    for (const list of byCell.values()) {
      const first = placed[list[0]!]!;
      const id = first.prefab;
      const style = styleOf(first);
      const partsKey = `${id}:${style ?? ""}`;
      let built = parts.get(partsKey);
      if (!built) parts.set(partsKey, (built = prefabParts(id, mats, style)));
      const knockOf = Int32Array.from(list, (idx) => (PREFABS[id].body === "knock" ? idx : -1));
      const group = this.meshes.length;
      this.meshes.push(
        built.map((part, pi) => {
          const geometry = first.asset === undefined ? part.geometry : withAssetAttributes(part.geometry, placed, list);
          const mesh = new THREE.InstancedMesh(geometry, part.material, list.length);
          for (const [s, idx] of list.entries()) {
            this.cell[idx] = group;
            this.slot[idx] = s;
            mesh.setMatrixAt(s, restMatrix(placed[idx]!, this.poses[idx]!, this.m4));
            if (pi === 0 && tint(id, idx, col, style)) mesh.setColorAt(s, col);
          }
          mesh.computeBoundingSphere();
          mesh.userData.knockOf = knockOf;
          add(mesh, id, part.shared ? part.material : null, part.shadow !== false);
          return mesh;
        }),
      );
    }
  }

  /** Draw placement `index` with its base at `base`, turned `q`; its cell's bounds grow to hold it wherever it flies (no allocation). */
  place(index: number, base: THREE.Vector3, q: THREE.Quaternion): void {
    const p = this.placed[index]!;
    this.moved[index] = 1;
    const m = this.m4.compose(base, q, this.sc.set(p.sx, p.sy, p.sz));
    const meshes = this.write(index, m);
    for (let k = 0; k < meshes.length; k++) meshes[k]!.boundingSphere!.union(this.sphere.copy(meshes[k]!.geometry.boundingSphere!).applyMatrix4(m));
  }

  /** Draw placement `index` no more (scaled to nothing where it stands: its cell's bounds hold), until the next `reset`. */
  hide(index: number): void {
    const p = this.placed[index]!;
    if (!this.moved[index]) this.moved[index] = 2;
    this.write(index, this.m4.compose(_p.set(p.x, p.y, p.z), _q.identity(), _s.set(0, 0, 0)));
  }

  /** Every prop drawn back in place (a restart), each cell's bounds its standing props' again. */
  reset(): void {
    for (let i = 0; i < this.placed.length; i++) {
      const was = this.moved[i]!;
      if (!was) continue;
      this.moved[i] = 0;
      const meshes = this.write(i, restMatrix(this.placed[i]!, this.poses[i]!, this.m4));
      if (was === 1) for (let k = 0; k < meshes.length; k++) meshes[k]!.computeBoundingSphere();
    }
  }

  private write(index: number, m: THREE.Matrix4): readonly THREE.InstancedMesh[] {
    const meshes = this.meshes[this.cell[index]!]!;
    countPart(COUNT.propsMoved, 1);
    for (let k = 0; k < meshes.length; k++) {
      meshes[k]!.setMatrixAt(this.slot[index]!, m);
      meshes[k]!.instanceMatrix.needsUpdate = true;
    }
    return meshes;
  }
}
