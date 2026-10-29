import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DERBY_PROP, DerbyGround } from "../scenes/derby-ground.ts";
import { GLASS_MESH_NAME, makeDerbyArena } from "../scenes/derby-arena.ts";
import { MATERIAL_ATTRIBUTE } from "../vehicle/material-class.ts";
import { MAT, MATERIALS, type MaterialId } from "../kernel/material-ids.ts";
import { WINDOW_BAY } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "./prefabs.ts";
import type { PrefabMaterials, PrefabPart } from "./prefab-pieces.ts";
import { must } from "../kernel/must.test-util.ts";

const familyOf = (id: MaterialId): MaterialId => MATERIALS[id]![1];

/** The shading family a material is tagged with (the registry id's row), or undefined when untagged. */
const taggedClass = (material: THREE.Material): unknown => {
  const id = material.userData.materialClass as MaterialId | undefined;
  return id === undefined ? undefined : familyOf(id);
};

const arenaCases = [
  { it: "the dirt floor is soil", mesh: "derby-floor", expected: MAT.SOIL },
  { it: "the plank ramps are wood", mesh: "derby-ramp-decks", expected: MAT.WOOD },
  { it: "the ground beyond the wall is soil", mesh: "derby-outer-ground", expected: MAT.SOIL },
  { it: "the mounds are soil", mesh: "mounds", expected: MAT.SOIL },
  { it: "the wall's concrete is concrete", mesh: DERBY_PROP.wall, expected: MAT.CONCRETE },
  { it: "the K-rail is concrete", mesh: DERBY_PROP.rail, expected: MAT.CONCRETE },
  { it: "the shipping containers are painted metal", mesh: DERBY_PROP.container, expected: MAT.PAINTED_METAL },
  { it: "the rubber pads are rubber", mesh: DERBY_PROP.pad, expected: MAT.RUBBER },
  { it: "the tyre stacks are rubber", mesh: DERBY_PROP.tyres, expected: MAT.RUBBER },
  { it: "the glass above the wall is glass", mesh: GLASS_MESH_NAME, expected: MAT.GLASS },
  { it: "the floodlight poles are painted metal", mesh: "floodlight-poles", expected: MAT.PAINTED_METAL },
] as const;

describe("given the derby arena", () => {
  const arena = makeDerbyArena(new DerbyGround());

  for (const testCase of arenaCases) {
    it(`when ${testCase.it}, then its mesh's material says so`, () => {
      const mesh = arena.getObjectByName(testCase.mesh);
      must(mesh instanceof THREE.Mesh, `${testCase.mesh} mesh`);
      expect(taggedClass(mesh.material as THREE.Material), "class").toBe(testCase.expected);
    });
  }

  it("when every lit material of the arena is listed, then each carries a class and the one program suffix", () => {
    const untagged: string[] = [];
    arena.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
      if (taggedClass(object.material) === undefined || !object.material.customProgramCacheKey().includes("|surf")) untagged.push(object.name);
    });
    expect(untagged.length, `untagged: ${untagged.join(", ")}`).toBe(0);
  });
});

const prefabCases = [
  { it: "a cone", prefab: PREFAB.cone, expected: [MAT.RUBBER, MAT.PLASTIC] },
  { it: "a tyre stack", prefab: PREFAB.tyreStack, expected: [MAT.RUBBER] },
  { it: "a hay bale", prefab: PREFAB.hayBale, expected: [MAT.SOIL] },
  { it: "a crate", prefab: PREFAB.crate, expected: [MAT.WOOD] },
  { it: "a tree", prefab: PREFAB.tree, expected: [MAT.WOOD, MAT.FOLIAGE] },
  { it: "a palm", prefab: PREFAB.palm, expected: [MAT.WOOD, MAT.FOLIAGE] },
  { it: "a dumpster", prefab: PREFAB.dumpster, expected: [MAT.PAINTED_METAL] },
  { it: "an obelisk", prefab: PREFAB.obelisk, expected: [MAT.STONE] },
  { it: "a building", prefab: PREFAB.building, expected: [MAT.CONCRETE] },
  { it: "a stucco building", prefab: PREFAB.stucco, expected: [MAT.CONCRETE] },
  { it: "a billboard", prefab: PREFAB.billboard, expected: [MAT.PLASTIC] },
] as const;

/** The registry ids written on a geometry's vertices. */
function idsOf(geometry: THREE.BufferGeometry): Set<MaterialId> {
  const attribute = geometry.getAttribute(MATERIAL_ATTRIBUTE);
  expect(attribute, "per-vertex class").toBeTruthy();
  expect(attribute.count, "one class per vertex").toBe(geometry.getAttribute("position").count);
  const found = new Set<MaterialId>();
  for (let i = 0; i < attribute.count; i++) found.add(attribute.getX(i));
  return found;
}

/** The shading families a geometry's vertices resolve to. */
const classesOf = (geometry: THREE.BufferGeometry): Set<number> => new Set([...idsOf(geometry)].map(familyOf));

/** Which part of a window bay the point (u, v) of the window texture falls on (v up, so canvas y = (1 - v) * px). */
function bayPart(u: number, v: number): "glass" | "mullion" | "frame" | "sill" | "wall" {
  const { px, glass: [x0, y0, x1, y1], frame, mullion, sillOut, sillGap, sillHeight } = WINDOW_BAY;
  const x = u * px;
  const y = (1 - v) * px;
  const within = (lo: number, hi: number, at: number): boolean => at >= lo && at < hi;
  if (within(x0, x1, x) && within(y0, y1, y)) return Math.abs(x - (x0 + x1) / 2) < mullion / 2 ? "mullion" : "glass";
  if (within(x0 - frame, x1 + frame, x) && within(y0 - frame, y1 + frame, y)) return "frame";
  if (within(x0 - sillOut, x1 + sillOut, x) && within(y1 + sillGap, y1 + sillGap + sillHeight, y)) return "sill";
  return "wall";
}

/** The first row past the 14 shading families: every id on a per-vertex material must be at least this. */
const FIRST_FINE_ID = 14;

describe("given the prefabs drawn on the shared per-vertex materials", () => {
  let materials: PrefabMaterials;
  const onPerVertexMaterial = (part: PrefabPart): boolean => ([materials.plain, materials.building, materials.billboard] as readonly THREE.Material[]).includes(part.material);

  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  for (const testCase of prefabCases) {
    it(`when ${testCase.it} is built, then its vertices carry exactly its classes`, () => {
      const found = new Set<number>();
      for (const part of prefabParts(testCase.prefab, materials).filter(onPerVertexMaterial)) for (const family of classesOf(part.geometry)) found.add(family);
      const expected: readonly MaterialId[] = testCase.expected;
      expect(found.size, `classes ${[...found].join(",")}`).toBe(expected.length);
      for (const id of expected) expect(found.has(id), `class ${id}`).toBeTruthy();
    });
  }

  it("when every prefab is built, then no vertex on the plain, building or billboard material is left on a family id", () => {
    const coarse: string[] = [];
    for (const [name, prefab] of Object.entries(PREFAB)) {
      for (const part of prefabParts(prefab, materials).filter(onPerVertexMaterial)) {
        if ([...idsOf(part.geometry)].some((id) => id < FIRST_FINE_ID)) coarse.push(name);
      }
    }
    expect(coarse.length, `prefabs with a family or GENERIC id: ${coarse.join(", ")}`).toBe(0);
  });

  it("when the shared materials are listed, then each carries its registry id", () => {
    expect(materials.concrete.userData.materialClass, "concrete").toBe(MAT.CONCRETE);
    expect(materials.building.userData.materialClass, "building").toBe(MAT.CONCRETE);
    expect(materials.water.userData.materialClass, "water").toBe(MAT.WATER);
    expect(materials.billboard.userData.materialClass, "billboard").toBe(MAT.BILLBOARD_FACE);
    for (const [name, material] of Object.entries(materials)) expect(material.userData.materialClass, `${name} tagged`).not.toBe(undefined);
  });

  it("when a point of the window texture is looked up, then the bay's rectangles name it", () => {
    expect(bayPart(0.3, 0.6)).toBe("glass");
    expect(bayPart(0.5, 0.6)).toBe("mullion");
    expect(bayPart(0.5, 0.215)).toBe("sill");
    expect(bayPart(0.02, 0.95)).toBe("wall");
  });
});
