import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { LeafMaterial, leafDepth, NatureMaterial, setNatureTier } from "./nature-look.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";
import { PropTumble } from "./prop-tumble.ts";
import { CLUSTER_LOOK } from "../world/scenery-biome.ts";
import type { PrefabId } from "../world/catalog.ts";

/** The shader three hands `onBeforeCompile`, cut to the chunk anchors the patch replaces. */
function compile(material: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe("given the material of rocks, trees, palms and bushes", () => {
  it("when it is compiled, then the fragment shader takes the world-space tint, the dust and moss cover and the foot shade, and the vertex shader hands it the world position", () => {
    const { vertexShader, fragmentShader } = compile(new NatureMaterial());
    expect(vertexShader, "the world position of the vertex").toContain("vNatureWorld = (modelMatrix * natureAt).xyz;");
    expect(fragmentShader, "triplanar noise tint").toContain("natureAxis.x * natureNoise(vNatureWorld.zy");
    expect(fragmentShader, "dust or moss on the upward faces").toContain("smoothstep(0.4, 0.6, naturePatch)");
    expect(fragmentShader, "a darker foot").toContain("diffuseColor.rgb *= natureShade;");
  });

  it("when the track art copies it for another draw kind (a clone), then the copy is patched the same", () => {
    const copy = new NatureMaterial().clone();
    expect(compile(copy).fragmentShader).toContain("natureShade");
    expect(copy.customProgramCacheKey()).toBe(new NatureMaterial().customProgramCacheKey());
  });

  it("when the effects tier is Low or under, then the detail switch is off (only the foot's shade stays), and on High and Ultra it is on", () => {
    const detail = (): number => (compile(new NatureMaterial()).uniforms.uNatureLook as THREE.IUniform<number>).value;
    for (const tier of ["off", "minimal", "low"] as const) {
      setNatureTier(tier);
      expect(detail(), tier).toBe(0);
    }
    for (const tier of ["high", "ultra"] as const) {
      setNatureTier(tier);
      expect(detail(), tier).toBe(1);
    }
  });

  it("when a rock, a tree, a palm, a bush and a cone are built, then the first four are drawn on the nature material and the cone on the plain one", () => {
    const [plain, nature] = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const mats = { ...plainMaterials(plain), nature };
    for (const id of [PREFAB.rock, PREFAB.tree, PREFAB.palm, PREFAB.bush]) expect(prefabParts(id, mats)[0]!.material, id).toBe(nature);
    expect(prefabParts(PREFAB.cone, mats)[0]!.material).toBe(plain);
  });
});

describe("given the street trees' leaf material", () => {
  const compileLit = (material: THREE.Material): string => {
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>" } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader.fragmentShader;
  };

  it("when it is made or copied for another draw kind, then it is smooth-shaded and two-sided, keeps the nature look, and cuts leaf fragments by its atlas's alpha, not by noise", () => {
    const texture = new THREE.Texture();
    for (const material of [new LeafMaterial(texture), new LeafMaterial(texture).clone()]) {
      expect(material.flatShading, "smooth").toBe(false);
      expect(material.side, "two-sided").toBe(THREE.DoubleSide);
      expect(material.alphaTest, "cut by the atlas's alpha").toBe(0.45);
      expect(material.alphaToCoverage, "softened by coverage").toBe(true);
      expect(material.map, "the atlas travels with the copy").toBe(texture);
      const fragment = compileLit(material);
      expect(fragment, "the nature look").toContain("natureShade");
      expect(fragment, "the atlas").toContain("texture2D(map, vMapUv)");
      expect(fragment, "a leaf card's bent normal is the same on both faces").toContain(`if (int(vMaterialAttribute + 0.5) != ${MAT.CONIFER_FOLIAGE}) normal *= faceDirection;`);
      expect(fragment, "no noise holes").not.toContain("leafFineAt");
    }
  });

  it("when its shadow is drawn, then the leaf material and its copies cast through a depth material that carries their atlas and cuts leaf fragments by its alpha, and the nature material casts through the plain one", () => {
    expect(leafDepth(new NatureMaterial()), "rocks and old trees").toBeNull();
    const texture = new THREE.Texture();
    const depth = leafDepth(new LeafMaterial(texture));
    expect(depth, "a copy for another draw kind").toBe(leafDepth(new LeafMaterial(texture).clone()));
    expect(depth!.map, "its atlas").toBe(texture);
    expect(depth!.alphaTest, "cut by alpha").toBe(0.45);
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n#include <map_fragment>\n}" } as THREE.WebGLProgramParametersWithUniforms;
    depth!.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader, "the leaf class handed on").toContain("vLeafClass = materialClass;");
    expect(shader.fragmentShader, "the atlas read on leaf fragments").toContain("texture2D(map, vMapUv)");
  });
});

describe("given a rock placed leaning 0.2 rad, and one upright", () => {
  it("when their instance matrices are read, then the leaning rock's up axis is 0.2 rad off vertical and the upright one's is vertical", () => {
    const rock = (lean?: number): Placed => ({ prefab: PREFAB.rock, x: 3, y: 1, z: -2, yaw: 0.7, sx: 1.5, sy: 2, sz: 1, ...(lean === undefined ? {} : { lean }) });
    const meshes: THREE.InstancedMesh[] = [];
    new PropTumble([rock(0.2), rock()], plainMaterials(new THREE.MeshBasicMaterial()), (mesh) => meshes.push(mesh));
    const matrix = new THREE.Matrix4();
    const tilt: number[] = [];
    for (const slot of [0, 1]) {
      meshes[0]!.getMatrixAt(slot, matrix);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
      tilt.push(Math.acos(Math.min(1, up.y)));
    }
    expect(tilt[0]!, "the leaning rock").toBeCloseTo(0.2, 6);
    expect(tilt[1]!, "the upright rock").toBeCloseTo(0, 6);
  });
});

describe("given a far cluster rock and a near one of the same prefab in the same cell, and a far rock two cells away", () => {
  it("when their meshes are made, then the far rocks share one mesh that casts no shadow wherever they stand, and the near one still casts", () => {
    const rock = (x: number, far?: true): Placed => ({ prefab: PREFAB.rock, x, y: 1, z: -2, yaw: 0, sx: 1, sy: 1, sz: 1, ...(far === undefined ? {} : { far }) });
    const made: { count: number; cast: boolean }[] = [];
    new PropTumble([rock(3), rock(3, true), rock(1500, true)], plainMaterials(new THREE.MeshBasicMaterial()), (mesh, _id, _shared, cast) => made.push({ count: mesh.count, cast }));
    expect(made.length, "meshes: near and far").toBe(2);
    expect([made[0]!.count, made[0]!.cast], "the near rock's mesh").toEqual([1, true]);
    expect([made[1]!.count, made[1]!.cast], "the far rocks' mesh").toEqual([2, false]);
  });
});

describe("given the kinds a far cluster is made of", () => {
  it("when each kind's drawn prefab is counted, then its triangles are the number the clump budget spends on it", () => {
    const [plain, nature] = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    const mats = { ...plainMaterials(plain), nature };
    const triangles = (geometry: THREE.BufferGeometry): number => (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
    for (const [id, look] of Object.entries(CLUSTER_LOOK)) {
      const counted = prefabParts(id as PrefabId, mats).reduce((sum, part) => sum + triangles(part.geometry), 0);
      expect(counted, id).toBe(look.triangles);
    }
  });
});
