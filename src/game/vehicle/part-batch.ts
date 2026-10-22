import * as THREE from "three";
import { loosePartsMaterial, partsMaterial, shadowOnlyMaterial, variantPartsMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { PART_KIND, PART_KINDS, PART_PER_CAR, partGeometry } from "./part-geometry.ts";
import { partBatchGeometries } from "./part-variants.ts";

/** A caster's stand-in until its style's first car syncs: the program links at the warm, before any car of the style draws. */
const NO_CASTER = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));

/**
 * Every car's static parts (cabin, door cards, mirrors, grille, tail trim, seats, wheel, engine bay, crash bars) as one instanced draw per
 * kind. A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`), a hidden car or a seat whose `showIf` fails draws nothing.
 * A kind a style may draw its own way (mirrors, grille) takes one draw per style variant (an empty one issues no draw call), each
 * instance painted its car's panel colour.
 */
export class PartBatch {
  /** Every draw, for the scene. */
  readonly meshes: readonly THREE.InstancedMesh[];
  /** Per kind, its draws by variant (`PartSeat.variant`); a one-shape kind has one. */
  readonly kinds: readonly (readonly THREE.InstancedMesh[])[];
  /** Every undamaged car's sun shadow (`DeformableCar.restCaster`) as one draw per style, not one per car; the engine hangs them under the wheel shadow prisms (`WheelBatch`), so only the shadow pass draws them. */
  readonly casters: readonly THREE.InstancedMesh[];
  private readonly casterCounts = new Int32Array(CAR_STYLE_IDS.length);
  /** The casters' own shadow depth material: on three's shared one, every instanced ↔ plain caster switch reselects the program. */
  private readonly casterDepth = new THREE.MeshDepthMaterial();
  /** A hidden mesh in the torn-part material: the boot warm draws it, so a first tear links no program. */
  readonly looseWarm = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), loosePartsMaterial());
  /** Per kind, its instances held so far this sync (all variants), and per kind and variant. */
  private readonly counts = new Int32Array(PART_KINDS.length);
  private readonly variantCounts: Int32Array[];
  /** Instances each kind holds: `cars` cars' worth (`PART_PER_CAR`). */
  private readonly capacity: Int32Array;
  /** Whether a kind's draws are its own variant geometries (disposed here) and carry instance colours. */
  private readonly styled: boolean[] = [];

  constructor(cars: number) {
    this.capacity = Int32Array.from(PART_KINDS, (kind) => cars * PART_PER_CAR[kind]!);
    const kinds: THREE.InstancedMesh[][] = [];
    for (const kind of PART_KINDS) {
      const capacity = this.capacity[kind]!;
      const styled = partBatchGeometries(kind);
      const card = kind === PART_KIND.liningL ? -1 : kind === PART_KIND.liningR ? 1 : 0;
      const geos = styled ?? [card !== 0 ? drawnDoorCard(card) : partGeometry(kind)];
      this.styled.push(styled !== null);
      kinds.push(geos.map((geo) => partDraw(geo, styled !== null, capacity)));
    }
    this.kinds = kinds;
    this.meshes = kinds.flat();
    this.variantCounts = kinds.map((k) => new Int32Array(k.length));
    this.casters = CAR_STYLE_IDS.map((id) => {
      const mesh = new THREE.InstancedMesh(NO_CASTER, shadowOnlyMaterial(), cars);
      mesh.customDepthMaterial = this.casterDepth;
      mesh.name = `shadow-caster-${id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
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
    for (const c of this.variantCounts) c.fill(0);
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
        const meshes = this.kinds[kind]!;
        const variant = meshes.length === 1 ? 0 : seat.variant;
        const mesh = meshes[variant]!;
        const i = this.variantCounts[kind]![variant]!;
        mesh.setMatrixAt(i, seat.matrixWorld);
        if (this.styled[kind]) mesh.setColorAt(i, seat.tint);
        this.variantCounts[kind]![variant] = i + 1;
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
    for (let s = 0; s < this.casters.length; s++) this.publish(this.casters[s]!, casterCounts[s]!);
    for (let k = 0; k < this.kinds.length; k++) for (let v = 0; v < this.kinds[k]!.length; v++) this.publish(this.kinds[k]![v]!, this.variantCounts[k]![v]!);
  }

  private publish(mesh: THREE.InstancedMesh, n: number): void {
    if (n === 0 && mesh.count === 0) return;
    mesh.count = n;
    // An empty instanced draw still costs the scene walk, the upload and the program switch before three skips it.
    mesh.visible = n > 0;
    upload(mesh.instanceMatrix, n);
    if (mesh.instanceColor) upload(mesh.instanceColor, n);
  }

  /** The batch's material and its one-shape geometries are shared (never disposed here); its variant geometries are its own. */
  dispose(): void {
    for (const [k, meshes] of this.kinds.entries()) {
      for (const mesh of meshes) {
        mesh.dispose();
        if (this.styled[k]) mesh.geometry.dispose();
      }
    }
    for (const mesh of this.casters) mesh.dispose();
    this.casterDepth.dispose();
    this.looseWarm.geometry.dispose();
  }
}

/** Mark the first `n` instances of `attr` for upload. */
function upload(attr: THREE.InstancedBufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * attr.itemSize);
  attr.needsUpdate = true;
}

/** One instanced part draw of `geo` for `capacity` instances; `styled`: a style variant, painted per instance. */
function partDraw(geo: THREE.BufferGeometry, styled: boolean, capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, styled ? variantPartsMaterial() : partsMaterial(), capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (styled) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  // Instances span the pad and move every frame; a stale bound would cull live parts.
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
