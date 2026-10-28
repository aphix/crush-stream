import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.match(water.fragmentShader, /totalEmissiveRadiance \+= vec3\(prod/, "glints in the water's fragment shader");
    assert.ok(water.uniforms.uWaterTime && water.uniforms.uWaterLook, "the shared clock and tier switch");
    const plain = compiled(mats.plain);
    assert.doesNotMatch(plain.fragmentShader, /uWaterTime/);
    assert.equal(plain.uniforms.uWaterTime, undefined);
  });

  it("when the water draws, then its clock follows the wall time", () => {
    const water = compiled(mats.water);
    mats.water.onBeforeRender({} as THREE.WebGLRenderer, {} as THREE.Scene, {} as THREE.Camera, {} as THREE.BufferGeometry, {} as THREE.Object3D, {} as THREE.Group);
    assert.ok((water.uniforms.uWaterTime as THREE.IUniform<number>).value > 0);
  });

  it("when a lawn fountain is built, then its inner water is drawn with the water material and the stone is not", () => {
    const parts = prefabParts(PREFAB.fountain, mats);
    assert.equal(parts[0]!.material, mats.plain);
    assert.equal(parts[1]!.material, mats.water);
  });

  for (const [tier, look] of [["minimal", 0], ["off", 0], ["low", 1], ["high", 1], ["ultra", 1]] as const) {
    it(`when the tier is ${tier}, then the cartoon look is ${look ? "on" : "off"}`, () => {
      setWaterTier(tier);
      assert.equal((compiled(mats.water).uniforms.uWaterLook as THREE.IUniform<number>).value, look);
    });
  }
});
