import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { RIM_LIGHT } from "./rim-light.ts";

/** Compile `material` against three's own `chunks` and return the patched shader. */
function compiled(material: THREE.Material, chunks: { vertexShader: string; fragmentShader: string }): THREE.WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: chunks.vertexShader, fragmentShader: chunks.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const mesh = new DummyMesh(1);
const CASES = [
  { it: "the lit material", material: mesh.material, chunks: THREE.ShaderLib.standard, rim: true },
  { it: "the shadow's depth material", material: mesh.customDepthMaterial!, chunks: THREE.ShaderLib.depth, rim: false },
] as const;

describe("given the people's materials patched by applyDolls", () => {
  for (const c of CASES) {
    it(`when ${c.it} is compiled, then it ${c.rim ? "shares RIM_LIGHT as uRim and adds the rim after the lights" : "carries no rim"}`, () => {
      const shader = compiled(c.material, c.chunks);
      assert.equal(shader.uniforms.uRim === RIM_LIGHT, c.rim, "the shared uniform object");
      assert.equal(shader.fragmentShader.includes("uniform float uRim;"), c.rim, "the uniform's declaration");
      assert.equal(shader.fragmentShader.includes("#include <lights_fragment_end>\n\n// after shader-skills (MIT)\nfloat dollRim"), c.rim, "the rim right after the lights");
      assert.equal(shader.fragmentShader.includes("reflectedLight.directSpecular += dollRim"), c.rim, "the rim added to the light");
    });
  }
});
