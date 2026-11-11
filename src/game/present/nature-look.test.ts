import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { PREFAB } from "../world/constants.ts";
import { LeafMaterial, leafDepth, NatureMaterial, setNatureTier } from "./nature-look.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

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
  // mutation: sed -i 's/^diffuseColor.rgb \*= natureShade;`;$/`;/' src/game/present/nature-look.ts
  it("when it is compiled, then the fragment shader takes the world-space tint, the dust and moss cover and the foot shade, and the vertex shader hands it the world position", () => {
    const { vertexShader, fragmentShader } = compile(new NatureMaterial());
    expect(vertexShader, "the world position of the vertex").toContain("vNatureWorld = (modelMatrix * natureAt).xyz;");
    expect(fragmentShader, "triplanar noise tint").toContain("natureAxis.x * natureNoise(vNatureWorld.zy");
    expect(fragmentShader, "dust or moss on the upward faces").toContain("smoothstep(0.4, 0.6, naturePatch)");
    expect(fragmentShader, "a darker foot").toContain("diffuseColor.rgb *= natureShade;");
  });

  // mutation: sed -i 's/^export class NatureMaterial extends THREE.MeshStandardMaterial {/export class NatureMaterial extends THREE.MeshStandardMaterial {\n  clone(): this { return new THREE.MeshStandardMaterial().copy(this) as unknown as this; }/' src/game/present/nature-look.ts
  it("when the track art copies it for another draw kind (a clone), then the copy is patched the same", () => {
    const copy = new NatureMaterial().clone();
    expect(compile(copy).fragmentShader).toContain("natureShade");
    expect(copy.customProgramCacheKey()).toBe(new NatureMaterial().customProgramCacheKey());
  });

  // mutation: sed -i 's/LOOK.value = tier === "high" || tier === "ultra" ? 1 : 0;/LOOK.value = 1;/' src/game/present/nature-look.ts
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

  // mutation: sed -i 's/return one(rock(), mats.nature);/return one(rock(), mats.plain);/' src/game/present/prefabs.ts
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

  // mutation: sed -i 's/    this.alphaTest = LEAF_ALPHA_TEST;/    this.alphaTest = 0;/' src/game/present/nature-look.ts
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
      expect(material.customProgramCacheKey(), "a program of its own").not.toBe(new NatureMaterial().customProgramCacheKey());
    }
  });

  // mutation: sed -i 's/  if (!(material instanceof LeafMaterial)) return null;/  return null;/' src/game/present/nature-look.ts
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
