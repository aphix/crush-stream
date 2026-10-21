import * as THREE from "three";
import { INSTANCE_MIRROR_VARIANT_ATTRIBUTE, loosePartsMaterial, mirrorPartsMaterial, partsMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { mirrorBatchGeometry, PART_KIND, PART_KINDS, partGeometry } from "./part-geometry.ts";

/**
 * Every car's seven static parts (interior, door linings, mirrors, grille, tail trim) as seven instanced draws, one per kind.
 * A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`) or a hidden car draws nothing.
 * Each mirror draw holds every style's mirror: an instance carries its car's variant and door paint (`mirrorPartsMaterial`).
 */
export class PartBatch {
  readonly meshes: readonly THREE.InstancedMesh[];
  /** A hidden mesh in the torn-part material: the boot warm draws it, so a first tear links no program. */
  readonly looseWarm = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), loosePartsMaterial());
  private readonly counts = new Int32Array(PART_KINDS.length);
  private readonly capacity: number;
  /** Per kind, its instances' mirror variants; null for a kind that is not a mirror. */
  private readonly variants: (THREE.InstancedBufferAttribute | null)[] = [];
  /** Per kind, the per-instance attributes a sync uploads. */
  private readonly uploads: THREE.InstancedBufferAttribute[][] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
    const meshes: THREE.InstancedMesh[] = [];
    for (const kind of PART_KINDS) {
      const side = kind === PART_KIND.mirrorL ? -1 : kind === PART_KIND.mirrorR ? 1 : 0;
      const geometry = side === 0 ? partGeometry(kind) : mirrorBatchGeometry(side, capacity);
      const mesh = new THREE.InstancedMesh(geometry, side === 0 ? partsMaterial() : mirrorPartsMaterial(), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const variants = side === 0 ? null : (geometry.getAttribute(INSTANCE_MIRROR_VARIANT_ATTRIBUTE) as THREE.InstancedBufferAttribute);
      if (variants) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      this.variants.push(variants);
      this.uploads.push(variants ? [mesh.instanceMatrix, mesh.instanceColor!, variants] : [mesh.instanceMatrix]);
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
        const mesh = this.meshes[kind]!;
        mesh.setMatrixAt(n, seat.matrixWorld);
        const variants = this.variants[kind];
        if (variants) {
          variants.setX(n, seat.variant);
          mesh.setColorAt(n, seat.tint);
        }
        counts[kind] = n + 1;
      }
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const mesh = this.meshes[k]!;
      const n = counts[k]!;
      mesh.count = n;
      for (const attr of this.uploads[k]!) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }

  /** The batch's material and its non-mirror geometries are shared (never disposed here); its mirror geometries are its own. */
  dispose(): void {
    for (const [k, mesh] of this.meshes.entries()) {
      mesh.dispose();
      if (this.variants[k]) mesh.geometry.dispose();
    }
    this.looseWarm.geometry.dispose();
  }
}
