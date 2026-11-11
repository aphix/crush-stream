import * as THREE from "three";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { groundMesh } from "../scenes/ground-stack.ts";
import { PLACE_KIND, type Place } from "../world/openworld/walk-graph.ts";
import { onFrontFace } from "./openworld-shop-signs.ts";

/** How far past a shopfront's width its light spreads along the pavement (m), and how deep it reaches out from the wall (m). */
const SPILL_EXTRA_WIDTH = 2;
const SPILL_DEPTH = 3;
/** The pool's middle stands this far out from the front face (m). */
const SPILL_OUT = 1.2;
/** The street's pavement is slabs (`PREFAB.sidewalk`) whose top is proud of the ground: the pool lies this far (m) over that top, as a decal's lift over what it lies on. */
const SPILL_LIFT = 0.02;
const SPILL_Y = PREFABS[PREFAB.sidewalk].size[1] + SPILL_LIFT;

/** The light a lit shop or eatery throws on the pavement at night: one flat quad per place on the lamp pool's own material (so it fades in at dusk and is gone by day), hidden while the place is shut. */
export class ShopSpill {
  readonly group = new THREE.Group();
  private readonly quads: { place: number; mesh: THREE.Mesh }[] = [];

  constructor(places: readonly Place[], material: THREE.MeshBasicMaterial) {
    this.group.name = "shop-spill";
    for (let index = 0; index < places.length; index++) {
      const place = places[index]!;
      if (place.kind !== PLACE_KIND.shop && place.kind !== PLACE_KIND.food) continue;
      const mesh = groundMesh(new THREE.PlaneGeometry(place.width + SPILL_EXTRA_WIDTH, SPILL_DEPTH), material, "decal");
      const face = onFrontFace(place, 0, SPILL_OUT);
      mesh.rotation.set(-Math.PI / 2, place.yaw + Math.PI / 2, 0, "YXZ");
      mesh.position.set(face.x, SPILL_Y, face.z);
      this.group.add(mesh);
      this.quads.push({ place: index, mesh });
    }
  }

  /** The places `closed` marks shut (one byte a place) throw no light; null: all are open. */
  update(closed: Uint8Array | null): void {
    for (let at = 0; at < this.quads.length; at++) {
      const quad = this.quads[at]!;
      quad.mesh.visible = closed === null || closed[quad.place] !== 1;
    }
  }

  dispose(): void {
    for (let at = 0; at < this.quads.length; at++) this.quads[at]!.mesh.geometry.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
