import * as THREE from "three";
import { loosePartsMaterial, partsMaterial, shadowOnlyMaterial } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { PART_KIND, PART_KINDS, PART_PER_CAR, partGeometry } from "./part-geometry.ts";
import { partBatchGeometries } from "./part-variants.ts";
import { SeatDraw } from "./seat-draw.ts";

/** A caster's stand-in until its style's first car syncs: the program links at the warm, before any car of the style draws. */
const NO_CASTER = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));

/**
 * Every car's static parts (cabin, door cards, mirrors, grille, tail trim, seats, wheel, engine bay, crash bars) as one instanced draw per
 * kind. A loose part draws as its own mesh; a cut seat (layer 0 off, `CarDetail`), a hidden car or a seat whose `showIf` fails draws nothing.
 * The kinds a style may draw its own way (`partBatchGeometries`: mirrors, grille, tail trim) are ONE draw over every style's variant
 * (`SeatDraw`), each seat painted its car's panel colour. An empty draw is hidden.
 */
export class PartBatch {
  /** Every draw, for the scene. */
  readonly meshes: readonly THREE.Mesh[];
  /** Per kind, its instanced draw; a styled kind has none (`styled` draws it). */
  readonly kinds: readonly (THREE.InstancedMesh | null)[];
  /** The styled kinds' seats. */
  readonly styled: SeatDraw;
  /** Every undamaged car's sun shadow (`DeformableCar.restCaster`) as one draw per style, not one per car; the engine hangs them under the wheel shadow prisms (`WheelBatch`), so only the shadow pass draws them. */
  readonly casters: readonly THREE.InstancedMesh[];
  private readonly casterCounts = new Int32Array(CAR_STYLE_IDS.length);
  /** Per caster and per kind, whether this sync changed a matrix its draw holds: an unchanged draw uploads nothing (a resting field). */
  private readonly castersMoved = new Uint8Array(CAR_STYLE_IDS.length);
  private readonly moved = new Uint8Array(PART_KINDS.length);
  /** The casters' own shadow depth material: on three's shared one, every instanced ↔ plain caster switch reselects the program. */
  private readonly casterDepth = new THREE.MeshDepthMaterial();
  /** A hidden mesh in the torn-part material: the boot warm draws it, so a first tear links no program. */
  readonly looseWarm = new THREE.Mesh(new THREE.PlaneGeometry(0, 0), loosePartsMaterial());
  /** Per kind, its seats packed so far this sync. */
  private readonly counts = new Int32Array(PART_KINDS.length);
  /** Seats each kind holds: `cars` cars' worth (`PART_PER_CAR`). */
  private readonly capacity: Int32Array;
  /** Per kind, its first variant in `styled`; -1 for a kind drawn instanced. */
  private readonly first = new Int32Array(PART_KINDS.length).fill(-1);
  /** The styled kinds' variant geometries (the batch's own). */
  private readonly own: THREE.BufferGeometry[] = [];

  constructor(cars: number) {
    this.capacity = Int32Array.from(PART_KINDS, (kind) => cars * PART_PER_CAR[kind]!);
    let styledCapacity = 0;
    this.kinds = PART_KINDS.map((kind) => {
      const styled = partBatchGeometries(kind);
      if (styled === null) {
        const card = kind === PART_KIND.liningL ? -1 : kind === PART_KIND.liningR ? 1 : 0;
        return partDraw(card !== 0 ? drawnDoorCard(card) : partGeometry(kind), this.capacity[kind]!);
      }
      this.first[kind] = this.own.length;
      this.own.push(...styled);
      styledCapacity += this.capacity[kind]!;
      return null;
    });
    this.styled = new SeatDraw(this.own, partsMaterial(), styledCapacity, "tint");
    this.meshes = [...this.kinds.filter((mesh) => mesh !== null), this.styled.mesh];
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
    this.moved.fill(0);
    this.styled.begin();
    const casterCounts = this.casterCounts;
    casterCounts.fill(0);
    this.castersMoved.fill(0);
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
        const mesh = this.kinds[kind]!;
        if (mesh !== null) {
          if (storeMatrix(mesh, n, seat.matrixWorld)) this.moved[kind] = 1;
        } else if (!this.styled.put(this.first[kind]! + seat.variant, seat.matrixWorld, seat.tint)) continue;
        counts[kind] = n + 1;
      }
      let casts = car.restCasts;
      for (let p: THREE.Object3D | null = car.group; casts && p; p = p.parent) casts = p.visible;
      if (!casts) continue;
      const style = CAR_STYLE_IDS.indexOf(car.style.id);
      const n = casterCounts[style]!;
      const mesh = this.casters[style]!;
      if (n >= mesh.instanceMatrix.count) continue;
      mesh.geometry = car.restCaster;
      if (storeMatrix(mesh, n, car.group.matrixWorld)) this.castersMoved[style] = 1;
      casterCounts[style] = n + 1;
    }
    for (let s = 0; s < this.casters.length; s++) publish(this.casters[s]!, casterCounts[s]!, this.castersMoved[s] === 1);
    for (let k = 0; k < this.kinds.length; k++) {
      const mesh = this.kinds[k];
      if (mesh) publish(mesh, counts[k]!, this.moved[k] === 1);
    }
    this.styled.end();
  }

  /** Seats of `kind` packed by the last sync. */
  drawn(kind: number): number {
    return this.counts[kind]!;
  }

  /** The batch's material and its one-shape geometries are shared (never disposed here); its variant geometries are its own. */
  dispose(): void {
    for (const mesh of this.kinds) mesh?.dispose();
    for (const g of this.own) g.dispose();
    this.styled.dispose();
    for (const mesh of this.casters) mesh.dispose();
    this.casterDepth.dispose();
    this.looseWarm.geometry.dispose();
  }
}

/** Show `mesh`'s first `n` instances, uploading them only if their count or a matrix (`moved`) changed. */
function publish(mesh: THREE.InstancedMesh, n: number, moved: boolean): void {
  if (n === mesh.count && !moved) return;
  mesh.count = n;
  // An empty instanced draw still costs the scene walk, the upload and the program switch before three skips it.
  mesh.visible = n > 0;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, n * 16);
  mesh.instanceMatrix.needsUpdate = true;
}

/** Instance `i` of `mesh` set to `m` as the buffer stores it (float32); true when that changed it. */
function storeMatrix(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4): boolean {
  const a = mesh.instanceMatrix.array as Float32Array;
  const e = m.elements;
  let changed = false;
  for (let k = 0; k < 16; k++) {
    const v = Math.fround(e[k]!);
    if (a[i * 16 + k] === v) continue;
    a[i * 16 + k] = v;
    changed = true;
  }
  return changed;
}

/** One instanced part draw of `geo` for `capacity` instances. */
function partDraw(geo: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, partsMaterial(), capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instances span the pad and move every frame; a stale bound would cull live parts.
  mesh.frustumCulled = false;
  // At the scene root with an identity transform: three need not compose its matrices every frame.
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
