import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { ACORN_LAMP } from "../world/street-kit.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

/** Slack (m) on a drawn extent: float rounding of the fitted vertices. */
const SLACK = 1e-5;
/** A lamp's old arm reaches this far (m) from its post: no acorn lamp does. */
const ARM_REACH = 0.3;

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

describe("given the acorn lamp the open world stands on its streets and in its park", () => {
  stubBrowser();
  const acorn = partsOf(PREFAB.acornLamp);
  const arm = partsOf(PREFAB.lamp);

  // mutation: sed -i 's/      return lamp(mats.plain, true);/      return lamp(mats.plain);/' src/game/present/prefabs.ts
  it("when it is built, then it is a slim post under an acorn globe, ACORN_LAMP tall, with no arm", () => {
    const whole = boundsOf(acorn.pole).clone().union(boundsOf(acorn.globe));
    expect(whole.max.y, "its height (m)").toBeCloseTo(ACORN_LAMP.height, 5);
    expect(whole.min.y, "its foot (m)").toBeGreaterThanOrEqual(-SLACK);
    expect(Math.max(-whole.min.x, whole.max.x, -whole.min.z, whole.max.z), "its reach from the post (m)").toBeLessThanOrEqual(ACORN_LAMP.globeRadius + SLACK);
    expect(boundsOf(acorn.globe).min.y, "the globe hangs over the collar (m)").toBeGreaterThan(ACORN_LAMP.collarBottom);
    const armReach = Math.max(-boundsOf(arm.pole).min.x, boundsOf(arm.pole).max.x, -boundsOf(arm.globe).min.x, boundsOf(arm.globe).max.x);
    expect(armReach, "the other courses' lamp keeps its arm (m)").toBeGreaterThan(ARM_REACH);
  });

  // mutation: sed -i 's/    return withPool ? addPool(g, 0) : g;/    return withPool ? addPool(g, 0.15) : g;/' src/game/present/engine-world.ts
  it("when its light is read, then it is the lamp's own: the same lit head and pool materials, the pool under the post's middle", () => {
    expect(acorn.shared[0], "the lit head's material").toBe(arm.shared[0]);
    expect(acorn.shared[1], "the light pool's material").toBe(arm.shared[1]);
    const pool = boundsOf(acorn.pool);
    expect((pool.min.x + pool.max.x) / 2, "the pool's middle along x (m)").toBeCloseTo(0, 5);
    expect((pool.min.z + pool.max.z) / 2, "the pool's middle along z (m)").toBeCloseTo(0, 5);
  });
});
