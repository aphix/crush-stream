import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { makePrefabMaterials, prefabParts } from "./prefabs.ts";
import { PREFAB } from "../world/constants.ts";
import { setWaterTier } from "./water-look.ts";

/** Compile `material` against three's own standard chunks and return the patched shader. */
function compiled(material: THREE.Material): THREE.WebGLProgramParametersWithUniforms {
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe("given the prefab materials", () => {
  // The materials only point at the textures; the canvas-made ones need a DOM, so plain textures stand in.
  const blank = new THREE.Texture();
  const mats = makePrefabMaterials({ concrete: blank, concreteGain: new THREE.Color(1, 1, 1), windows: blank, billboard: blank } as Parameters<typeof makePrefabMaterials>[0]);

  it("when water and the plain stone are compiled, then only the water carries the glint path and its clock", () => {
    const water = compiled(mats.water);
    expect(water.fragmentShader, "glints in the water's fragment shader").toMatch(/totalEmissiveRadiance \+= vec3\(prod/);
    expect(water.uniforms.uWaterTime && water.uniforms.uWaterLook, "the shared clock and tier switch").toBeTruthy();
    const plain = compiled(mats.plain);
    expect(plain.fragmentShader).not.toMatch(/uWaterTime/);
    expect(plain.uniforms.uWaterTime).toBe(undefined);
  });

  it("when the water draws, then its clock follows the wall time", () => {
    const water = compiled(mats.water);
    mats.water.onBeforeRender({} as THREE.WebGLRenderer, {} as THREE.Scene, {} as THREE.Camera, {} as THREE.BufferGeometry, {} as THREE.Object3D, {} as THREE.Group);
    expect((water.uniforms.uWaterTime as THREE.IUniform<number>).value).toBeGreaterThan(0);
  });

  it("when a lawn fountain is built, then its inner water is drawn with the water material and the stone is not", () => {
    const parts = prefabParts(PREFAB.fountain, mats);
    expect(parts[0]!.material).toBe(mats.plain);
    expect(parts[1]!.material).toBe(mats.water);
  });

  const tierCases = [
    { tier: "minimal", look: 0, expectedLookState: "off" },
    { tier: "off", look: 0, expectedLookState: "off" },
    { tier: "low", look: 1, expectedLookState: "on" },
    { tier: "high", look: 1, expectedLookState: "on" },
    { tier: "ultra", look: 1, expectedLookState: "on" },
  ] as const;
  for (const testCase of tierCases) {
    it(`when the effects tier is ${testCase.tier}, then the water's cartoon look is ${testCase.expectedLookState}`, () => {
      setWaterTier(testCase.tier);
      expect((compiled(mats.water).uniforms.uWaterLook as THREE.IUniform<number>).value).toBe(testCase.look);
    });
  }
});
