import * as THREE from "three";
import { loosePartsMaterial, partsMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { PART_KINDS, partGeometry } from "./part-geometry.ts";

/**
 * Every car's seven static parts (interior, door linings, mirrors, grille, tail trim) as seven instanced draws, one per kind.
 * A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`) or a hidden car draws nothing.
 */
export class PartBatch {
  readonly meshes: readonly THREE.InstancedMesh[];
  /** A hidden mesh in the torn-part material: the boot warm draws it, so a first tear links no program. */
  readonly looseWarm = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), loosePartsMaterial());
  private readonly counts = new Int32Array(PART_KINDS.length);
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    const meshes: THREE.InstancedMesh[] = [];
    for (const kind of PART_KINDS) {
      const mesh = new THREE.InstancedMesh(partGeometry(kind), partsMaterial(), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Instances span the pad and move every frame; a stale bound would cull live parts.
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      meshes.push(mesh);
    }
    this.meshes = meshes;
    this.looseWarm.name = "warm-loose-part";
    this.looseWarm.visible = false;
  }

  /** Pack the shown seats of `cars` (world matrices must be current). */
  sync(cars: readonly DeformableCar[]): void {
    const counts = this.counts;
    counts.fill(0);
    for (const car of cars) {
      for (const seat of car.partSeats) {
        let shown = seat.visible;
        let attached = false;
        for (let p = seat.parent; p; p = p.parent) {
          shown = shown && p.visible;
          if (p === car.group) attached = true;
        }
        if (!attached) continue;
        if (seat.loose) seat.fasten();
        const kind = seat.kind;
        const n = counts[kind]!;
        if (!shown || !seat.layers.isEnabled(0) || n >= this.capacity) continue;
        this.meshes[kind]!.setMatrixAt(n, seat.matrixWorld);
        counts[kind] = n + 1;
      }
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k]!;
      const n = counts[k]!;
      mesh.count = n;
      const attr = mesh.instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 16);
      attr.needsUpdate = true;
    }
  }

  /** The batch's geometries and material are shared (never disposed here). */
  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    this.looseWarm.geometry.dispose();
  }
}
