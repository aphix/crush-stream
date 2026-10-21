import * as THREE from "three";
import { loosePartsMaterial, partsMaterial, shadowOnlyMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { PART_KINDS, partGeometry } from "./part-geometry.ts";

/** A caster's stand-in until its style's first car syncs: the program links at the warm, before any car of the style draws. */
const NO_CASTER = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));

/**
 * Every car's seven static parts (interior, door linings, mirrors, grille, tail trim) as seven instanced draws, one per kind.
 * A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`) or a hidden car draws nothing.
 */
export class PartBatch {
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Every undamaged car's sun shadow (`DeformableCar.shadowCaster`) as one shadow-only draw per style, not one per car. */
  readonly casters: readonly THREE.InstancedMesh[];
  private readonly casterCounts = new Int32Array(CAR_STYLE_IDS.length);
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
    this.casters = CAR_STYLE_IDS.map((id) => {
      const mesh = new THREE.InstancedMesh(NO_CASTER, shadowOnlyMaterial(), capacity);
      mesh.name = `shadow-caster-${id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      return mesh;
    });
    this.looseWarm.name = "warm-loose-part";
    this.looseWarm.visible = false;
  }

  /** Pack the shown seats of `cars` (world matrices must be current). */
  sync(cars: readonly DeformableCar[]): void {
    const counts = this.counts;
    counts.fill(0);
    const casterCounts = this.casterCounts;
    casterCounts.fill(0);
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
      const caster = car.shadowCaster;
      let casts = caster.castShadow && caster.layers.isEnabled(0);
      for (let p = caster.parent; casts && p; p = p.parent) casts = p.visible;
      const style = CAR_STYLE_IDS.indexOf(car.style.id);
      const n = casterCounts[style]!;
      if (!casts || n >= this.capacity) continue;
      const mesh = this.casters[style]!;
      mesh.geometry = caster.geometry;
      mesh.setMatrixAt(n, caster.matrixWorld);
      casterCounts[style] = n + 1;
    }
    for (let s = 0; s < this.casters.length; s++) this.publish(this.casters[s]!, casterCounts[s]!);
    for (let k = 0; k < this.meshes.length; k++) this.publish(this.meshes[k]!, counts[k]!);
  }

  private publish(mesh: THREE.InstancedMesh, n: number): void {
    mesh.count = n;
    const attr = mesh.instanceMatrix;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * 16);
    attr.needsUpdate = true;
  }

  /** The batch's geometries and material are shared (never disposed here). */
  dispose(): void {
    for (const mesh of [...this.meshes, ...this.casters]) mesh.dispose();
    this.looseWarm.geometry.dispose();
  }
}
