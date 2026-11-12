import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { PARK_LAMP } from "../world/openworld/openworld-park.ts";
import { ACORN_LAMP } from "../world/street-kit.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

/** Slack (m) on a drawn extent: float rounding of the fitted vertices. */
const SLACK = 1e-5;
/** A lamp's arm hangs its head at least this far (m) off its post (0.13 m measured): the acorn lamp's globe stands over its post. */
const ARM_OFFSET = 0.1;

/** The prefab's parts: the pole in vertex colours, then the globe and the light pool on the scene's own shared lamp materials. */
function partsOf(id: typeof PREFAB.lamp | typeof PREFAB.acornLamp): { pole: THREE.BufferGeometry; globe: THREE.BufferGeometry; pool: THREE.BufferGeometry; shared: THREE.Material[] } {
  const parts = prefabParts(id, plainMaterials(new THREE.MeshBasicMaterial()));
  expect(parts.length, `${id}'s parts: pole, head, pool`).toBe(3);
  return { pole: parts[0]!.geometry, globe: parts[1]!.geometry, pool: parts[2]!.geometry, shared: [parts[1]!.material, parts[2]!.material] };
}

function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

/** Where a head's middle stands off its post along x (m): the arm of a lamp, whichever way the fit turns it. */
function offsetOf(geometry: THREE.BufferGeometry): number {
  const bounds = boundsOf(geometry);
  return (bounds.min.x + bounds.max.x) / 2;
}

describe("given the acorn lamp the open world stands on its streets and in its park", () => {
  stubBrowser();
  const acorn = partsOf(PREFAB.acornLamp);
  const arm = partsOf(PREFAB.lamp);

  // mutation: sed -i 's/      return lamp(mats.plain, true, skin !== PARK_LAMP);/      return lamp(mats.plain);/' src/game/present/prefabs.ts
  it("when it is built, then it is a slim post under an acorn globe, ACORN_LAMP tall, with no arm", () => {
    const whole = boundsOf(acorn.pole).clone().union(boundsOf(acorn.globe));
    expect(whole.max.y, "its height (m)").toBeCloseTo(ACORN_LAMP.height, 5);
    expect(whole.min.y, "its foot (m)").toBeGreaterThanOrEqual(-SLACK);
    expect(Math.max(-whole.min.x, whole.max.x, -whole.min.z, whole.max.z), "its reach from the post (m)").toBeLessThanOrEqual(ACORN_LAMP.globeRadius + SLACK);
    expect(boundsOf(acorn.globe).min.y, "the globe hangs over the collar (m)").toBeGreaterThan(ACORN_LAMP.collarBottom);
    expect(Math.abs(offsetOf(acorn.globe)), "the acorn globe stands over its post (m)").toBeLessThan(SLACK);
    expect(Math.abs(offsetOf(arm.globe)), "the other courses' lamp keeps its arm: its head hangs off the post (m)").toBeGreaterThan(ARM_OFFSET);
  });

  // mutation: sed -i 's/    return withPool ? addPool(g, 0) : g;/    return withPool ? addPool(g, 0.15) : g;/' src/game/present/engine-world.ts
  it("when its light is read, then it is the lamp's own: the same lit head and pool materials, the pool under the post's middle", () => {
    expect(acorn.shared[0], "the lit head's material").toBe(arm.shared[0]);
    expect(acorn.shared[1], "the light pool's material").toBe(arm.shared[1]);
    const pool = boundsOf(acorn.pool);
    expect((pool.min.x + pool.max.x) / 2, "the pool's middle along x (m)").toBeCloseTo(0, 5);
    expect((pool.min.z + pool.max.z) / 2, "the pool's middle along z (m)").toBeCloseTo(0, 5);
  });

  // mutation: sed -i 's/geometry: geo.translate(0, PREFABS\[PREFAB.sidewalk\].size\[1\], 0)/geometry: geo/' src/game/present/prefabs.ts
  it("when the pools are read, then the acorn lamp's lies over the sidewalk slab's top and a race lamp's stays on the ground", () => {
    const slabTop = PREFABS[PREFAB.sidewalk].size[1];
    expect(boundsOf(acorn.pool).min.y, "the acorn pool over the slab").toBeGreaterThan(slabTop);
    expect(boundsOf(arm.pool).max.y, "the race lamp's pool under a slab's height").toBeLessThan(slabTop);
  });

  // mutation: sed -i 's/      return lamp(mats.plain, true, skin !== PARK_LAMP);/      return lamp(mats.plain, true);/' src/game/present/prefabs.ts
  it("when a park's lamp is built, then it stands on the ground with no slab, so its pool lies under a slab's height, as a race lamp's does", () => {
    const park = prefabParts(PREFAB.acornLamp, plainMaterials(new THREE.MeshBasicMaterial()), PARK_LAMP);
    expect(boundsOf(park[2]!.geometry).max.y, "the park lamp's pool over its foot (m)").toBeLessThan(PREFABS[PREFAB.sidewalk].size[1]);
    expect(boundsOf(park[0]!.geometry).max.y, "its post as tall as a street's (m)").toBeCloseTo(boundsOf(acorn.pole).max.y, 5);
  });
});
