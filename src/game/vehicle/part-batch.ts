import * as THREE from "three";
import { INSTANCE_PART_VARIANT_ATTRIBUTE, loosePartsMaterial, partsMaterial, shadowOnlyMaterial, variantPartsMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { PART_KIND, PART_KINDS, PART_PER_CAR, partGeometry } from "./part-geometry.ts";
import { partBatchGeometry } from "./part-variants.ts";

/** A caster's stand-in until its style's first car syncs: the program links at the warm, before any car of the style draws. */
const NO_CASTER = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));

/**
 * Every car's static parts (cabin, door cards, mirrors, grille, tail trim, seats, wheel, engine bay, crash bars) as one instanced draw per
 * kind. A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`), a hidden car or a seat whose `showIf` fails draws nothing.
 * A kind a style may draw its own way (mirrors, grille) holds every style's variant in its one draw: an instance carries its car's variant
 * and panel paint (`withPartVariants`).
 */
export class PartBatch {
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Every undamaged car's sun shadow (`DeformableCar.restCaster`) as one draw per style, not one per car; the engine hangs them under the wheel shadow prisms (`WheelBatch`), so only the shadow pass draws them. */
  readonly casters: readonly THREE.InstancedMesh[];
  private readonly casterCounts = new Int32Array(CAR_STYLE_IDS.length);
  /** The casters' own shadow depth material: on three's shared one, every instanced ↔ plain caster switch reselects the program. */
  private readonly casterDepth = new THREE.MeshDepthMaterial();
  /** A hidden mesh in the torn-part material: the boot warm draws it, so a first tear links no program. */
  readonly looseWarm = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), loosePartsMaterial());
  private readonly counts = new Int32Array(PART_KINDS.length);
  /** Instances each kind holds: `cars` cars' worth (`PART_PER_CAR`). */
  private readonly capacity: Int32Array;
  /** Per kind, its instances' variants; null for a kind with one shape. */
  private readonly variants: (THREE.InstancedBufferAttribute | null)[] = [];
  /** Per kind, then per style's caster, the per-instance attributes a sync uploads. */
  private readonly uploads: THREE.InstancedBufferAttribute[][] = [];

  constructor(cars: number) {
    this.capacity = Int32Array.from(PART_KINDS, (kind) => cars * PART_PER_CAR[kind]!);
    const meshes: THREE.InstancedMesh[] = [];
    for (const kind of PART_KINDS) {
      const capacity = this.capacity[kind]!;
      const styled = partBatchGeometry(kind, capacity);
      const card = kind === PART_KIND.liningL ? -1 : kind === PART_KIND.liningR ? 1 : 0;
      const mesh = new THREE.InstancedMesh(styled ?? (card !== 0 ? drawnDoorCard(card) : partGeometry(kind)), styled ? variantPartsMaterial() : partsMaterial(), capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const variants = styled ? (styled.getAttribute(INSTANCE_PART_VARIANT_ATTRIBUTE) as THREE.InstancedBufferAttribute) : null;
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
    this.casters = CAR_STYLE_IDS.map((id) => {
      const mesh = new THREE.InstancedMesh(NO_CASTER, shadowOnlyMaterial(), cars);
      mesh.customDepthMaterial = this.casterDepth;
      mesh.name = `shadow-caster-${id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      this.uploads.push([mesh.instanceMatrix]);
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
      car.underbody?.follow();
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
        if (!shown || !seat.layers.isEnabled(0) || n >= this.capacity[kind]! || (seat.showIf !== null && !seat.showIf())) continue;
        const mesh = this.meshes[kind]!;
        mesh.setMatrixAt(n, seat.matrixWorld);
        const variants = this.variants[kind];
        if (variants) {
          variants.setX(n, seat.variant);
          mesh.setColorAt(n, seat.tint);
        }
        counts[kind] = n + 1;
      }
      let casts = car.restCasts;
      for (let p: THREE.Object3D | null = car.group; casts && p; p = p.parent) casts = p.visible;
      const style = CAR_STYLE_IDS.indexOf(car.style.id);
      const n = casterCounts[style]!;
      const mesh = this.casters[style]!;
      if (!casts || n >= mesh.instanceMatrix.count) continue;
      mesh.geometry = car.restCaster;
      mesh.setMatrixAt(n, car.group.matrixWorld);
      casterCounts[style] = n + 1;
    }
    const kinds = this.meshes.length;
    for (let s = 0; s < this.casters.length; s++) this.publish(this.casters[s]!, casterCounts[s]!, this.uploads[kinds + s]!);
    for (let k = 0; k < kinds; k++) this.publish(this.meshes[k]!, counts[k]!, this.uploads[k]!);
  }

  private publish(mesh: THREE.InstancedMesh, n: number, uploads: readonly THREE.InstancedBufferAttribute[]): void {
    mesh.count = n;
    for (const attr of uploads) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  /** The batch's material and its one-shape geometries are shared (never disposed here); its variant geometries are its own. */
  dispose(): void {
    for (const [k, mesh] of this.meshes.entries()) {
      mesh.dispose();
      if (this.variants[k]) mesh.geometry.dispose();
    }
    for (const mesh of this.casters) mesh.dispose();
    this.casterDepth.dispose();
    this.looseWarm.geometry.dispose();
  }
}
