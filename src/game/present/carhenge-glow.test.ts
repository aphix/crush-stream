import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

const plain = new THREE.MeshBasicMaterial();
const mats = plainMaterials(plain);

describe("given the Carhenge prefab (its campfire in the middle of the ring)", () => {
  beforeAll(stubBrowser);

  it("when its parts are listed, then one is the lamps' own night pool, laid flat round the fire, so the scene's night switch lights the fire's glow with every lamp", () => {
    const lampPool = prefabParts(PREFAB.lamp, mats).find((p) => p.shared && p.material.blending === THREE.AdditiveBlending);
    expect(lampPool, "the lamp prefab carries its night pool").toBeTruthy();
    const glow = prefabParts(PREFAB.carhenge, mats).find((p) => p.material === lampPool!.material);
    expect(glow, "a Carhenge part on the lamps' pool material").toBeTruthy();
    expect(glow!.shared, "shared: the night switch owns it").toBe(true);
    glow!.geometry.computeBoundingBox();
    const box = glow!.geometry.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    expect(Math.hypot(centre.x, centre.z), "centred on the fire").toBeLessThan(0.01);
    expect(box.max.y - box.min.y, "flat on the ground").toBeLessThan(0.01);
    expect(box.max.x - box.min.x, "wider than the fire ring").toBeGreaterThan(10);
  });
});
