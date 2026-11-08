import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PREFAB } from "../world/constants.ts";
import { NatureMaterial, setNatureTier } from "./nature-look.ts";
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
