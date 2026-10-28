import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as THREE from "three";
import { DERBY_PROP, DerbyGround } from "../scenes/derby-ground.ts";
import { GLASS_MESH_NAME, makeDerbyArena } from "../scenes/derby-arena.ts";
import { MATERIAL, MATERIAL_ATTRIBUTE, type MaterialClass } from "../vehicle/material-class.ts";
import { PREFAB } from "../world/constants.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";

const taggedClass = (material: THREE.Material): unknown => material.userData.materialClass;

const arenaCases = [
  { it: "the dirt floor is soil", mesh: "derby-floor", expected: MATERIAL.SOIL },
  { it: "the plank ramps are wood", mesh: "derby-ramp-decks", expected: MATERIAL.WOOD },
  { it: "the ground beyond the wall is soil", mesh: "derby-outer-ground", expected: MATERIAL.SOIL },
  { it: "the mounds are soil", mesh: "mounds", expected: MATERIAL.SOIL },
  { it: "the wall's concrete is concrete", mesh: DERBY_PROP.wall, expected: MATERIAL.CONCRETE },
  { it: "the K-rail is concrete", mesh: DERBY_PROP.rail, expected: MATERIAL.CONCRETE },
  { it: "the shipping containers are painted metal", mesh: DERBY_PROP.container, expected: MATERIAL.PAINTED_METAL },
  { it: "the rubber pads are rubber", mesh: DERBY_PROP.pad, expected: MATERIAL.RUBBER },
  { it: "the tyre stacks are rubber", mesh: DERBY_PROP.tyres, expected: MATERIAL.RUBBER },
  { it: "the glass above the wall is glass", mesh: GLASS_MESH_NAME, expected: MATERIAL.GLASS },
  { it: "the floodlight poles are painted metal", mesh: "floodlight-poles", expected: MATERIAL.PAINTED_METAL },
] as const;

describe("given the derby arena", () => {
  const arena = makeDerbyArena(new DerbyGround());

  for (const testCase of arenaCases) {
    it(`when ${testCase.it}, then its mesh's material says so`, () => {
      const mesh = arena.getObjectByName(testCase.mesh);
      assert.ok(mesh instanceof THREE.Mesh, `${testCase.mesh} mesh`);
      assert.equal(taggedClass(mesh.material as THREE.Material), testCase.expected, "class");
    });
  }

  it("when every lit material of the arena is listed, then each carries a class and the one program suffix", () => {
    const untagged: string[] = [];
    arena.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      if (taggedClass(object.material) === undefined || !object.material.customProgramCacheKey().includes("|surf")) untagged.push(object.name);
    });
    assert.equal(untagged.length, 0, `untagged: ${untagged.join(", ")}`);
  });
});

const prefabCases = [
  { it: "a cone", prefab: PREFAB.cone, expected: [MATERIAL.RUBBER, MATERIAL.PLASTIC] },
  { it: "a tyre stack", prefab: PREFAB.tyreStack, expected: [MATERIAL.RUBBER] },
  { it: "a hay bale", prefab: PREFAB.hayBale, expected: [MATERIAL.SOIL] },
  { it: "a crate", prefab: PREFAB.crate, expected: [MATERIAL.WOOD] },
  { it: "a tree", prefab: PREFAB.tree, expected: [MATERIAL.WOOD, MATERIAL.FOLIAGE] },
  { it: "a palm", prefab: PREFAB.palm, expected: [MATERIAL.WOOD, MATERIAL.FOLIAGE] },
  { it: "a dumpster", prefab: PREFAB.dumpster, expected: [MATERIAL.PAINTED_METAL] },
  { it: "an obelisk", prefab: PREFAB.obelisk, expected: [MATERIAL.STONE] },
] as const;

function classesOf(geometry: THREE.BufferGeometry): Set<number> {
  const attribute = geometry.getAttribute(MATERIAL_ATTRIBUTE);
  assert.ok(attribute, "per-vertex class");
  assert.equal(attribute.count, geometry.getAttribute("position").count, "one class per vertex");
  const found = new Set<number>();
  for (let i = 0; i < attribute.count; i++) found.add(attribute.getX(i));
  return found;
}

describe("given the prefabs drawn on the shared plain material", () => {
  let materials: ReturnType<typeof makePrefabMaterials>;

  before(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  for (const testCase of prefabCases) {
    it(`when ${testCase.it} is built, then its vertices carry exactly its classes`, () => {
      const found = new Set<number>();
      for (const part of prefabParts(testCase.prefab, materials)) if (part.material === materials.plain) for (const id of classesOf(part.geometry)) found.add(id);
      const expected: readonly MaterialClass[] = testCase.expected;
      assert.equal(found.size, expected.length, `classes ${[...found].join(",")}`);
      for (const id of expected) assert.ok(found.has(id), `class ${id}`);
    });
  }

  it("when every prefab is built, then no vertex on the plain material is left untagged", () => {
    const untagged: string[] = [];
    for (const [name, prefab] of Object.entries(PREFAB)) {
      for (const part of prefabParts(prefab, materials)) {
        if (part.material !== materials.plain) continue;
        if (classesOf(part.geometry).has(MATERIAL.GENERIC)) untagged.push(name);
      }
    }
    assert.equal(untagged.length, 0, `untagged prefabs: ${untagged.join(", ")}`);
  });

  it("when the shared materials are listed, then each carries its class", () => {
    assert.equal(taggedClass(materials.concrete), MATERIAL.CONCRETE, "concrete");
    assert.equal(taggedClass(materials.building), MATERIAL.CONCRETE, "building");
    assert.equal(taggedClass(materials.water), MATERIAL.GLASS, "water");
    assert.equal(taggedClass(materials.billboard), MATERIAL.PLASTIC, "billboard");
  });
});
