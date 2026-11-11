import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { PLACE_KIND } from "../world/openworld/walk-graph.ts";
import { lampPool } from "./engine-world.ts";
import { onFrontFace } from "./openworld-shop-signs.ts";
import { ShopSpill } from "./shop-spill.ts";

const map = buildOpenWorldMap(layOutLots());
const sellers = map.places.map((place, index) => ({ place, index })).filter(({ place }) => place.kind === PLACE_KIND.shop || place.kind === PLACE_KIND.food);
const OUT = 1.2;

describe("given the open world's shops and eateries", () => {
  const spill = new ShopSpill(map.places, lampPool);

  // mutation: sed -i 's/place.kind !== PLACE_KIND.shop \&\& place.kind !== PLACE_KIND.food/place.kind !== PLACE_KIND.shop/' src/game/present/shop-spill.ts
  it("when the spill is built, then every shop and eatery has one quad, on the lamp pool's material", () => {
    expect(sellers.length, "the programme has shops").toBeGreaterThan(0);
    expect(spill.group.children.length).toBe(sellers.length);
    for (const child of spill.group.children) expect((child as THREE.Mesh).material, "the lamp pool").toBe(lampPool);
  });

  // mutation: sed -i 's/closed === null || closed\[quad.place\] !== 1/closed === null/' src/game/present/shop-spill.ts
  it("when a place is shut, then its quad is hidden and the others stay shown; open again, it shows", () => {
    const closed = new Uint8Array(map.places.length);
    closed[sellers[0]!.index] = 1;
    spill.update(closed);
    const shown = spill.group.children.map((child) => child.visible);
    expect(shown[0], "the shut one").toBe(false);
    expect(shown.slice(1).every(Boolean), "the rest").toBe(true);
    closed[sellers[0]!.index] = 0;
    spill.update(closed);
    expect(spill.group.children.every((child) => child.visible), "all open").toBe(true);
  });

  // mutation: sed -i 's/const SPILL_OUT = 1.2/const SPILL_OUT = 2.2/' src/game/present/shop-spill.ts
  it("when a quad is read, then it lies flat just over the ground, centred 1.2 m in front of its place's face", () => {
    for (const [at, { place }] of sellers.entries()) {
      const mesh = spill.group.children[at] as THREE.Mesh;
      const face = onFrontFace(place, 0, OUT);
      expect(mesh.position.x).toBeCloseTo(face.x, 6);
      expect(mesh.position.z).toBeCloseTo(face.z, 6);
      expect(mesh.position.y, "just over the ground").toBeGreaterThan(0);
      expect(mesh.position.y).toBeLessThan(0.1);
      const up = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      expect(up.y, "faces up").toBeCloseTo(1, 6);
    }
  });
});
