import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { MATERIAL_STRENGTH } from "../vehicle/material-class.ts";
import { FABRIC, FABRIC_ENV } from "./dummy-cloth.ts";
import { ROLE } from "./dummy-rig.ts";
import { SKIN_SSS } from "./dummy-shader.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

function compileShader(material: THREE.Material, chunks: { vertexShader: string; fragmentShader: string }): THREE.WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: chunks.vertexShader, fragmentShader: chunks.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const compiled = (material: THREE.Material, chunks: { vertexShader: string; fragmentShader: string }): string => compileShader(material, chunks).fragmentShader;

function tableOf(fragment: string, name: string): number[] {
  const match = new RegExp(`const float ${name}\\[\\d+\\] = float\\[\\d+\\]\\(([^)]*)\\)`).exec(fragment);
  assert.ok(match, `${name} table`);
  return match[1]!.split(",").map(Number);
}

const fabricCases = [
  { it: "skin", fabric: FABRIC.SKIN, expectedMax: 0.5 },
  { it: "denim", fabric: FABRIC.DENIM, expectedMax: 0.3 },
  { it: "cotton", fabric: FABRIC.COTTON, expectedMax: 0.3 },
  { it: "hair", fabric: FABRIC.HAIR, expectedMax: 0.5 },
  { it: "leather", fabric: FABRIC.LEATHER, expectedMax: 0.7 },
] as const;

describe("given the people's lit material", () => {
  const mesh = new DummyMesh(1);
  const lit = compiled(mesh.material, THREE.ShaderLib.standard);
  const depth = compiled(mesh.customDepthMaterial!, THREE.ShaderLib.depth);
  const fabrics = tableOf(lit, "DOLL_FABRIC_ENV");
  const roles = tableOf(lit, "DOLL_ROLE_ENV");

  it("when it compiles, then the studio's reflection is scaled once after the lights and the shadow's depth shader has no such line", () => {
    assert.equal(lit.split("reflectedLight.indirectSpecular *= materialSpecular(dollEnv);").length - 1, 1, "lit scale lines");
    assert.equal(depth.includes("dollEnv"), false, "depth shader");
  });

  it("when it compiles, then its reflection scale reads the shared Material strength uniform object", () => {
    const shader = compileShader(mesh.material, THREE.ShaderLib.standard);
    assert.equal(shader.uniforms.materialStrength, MATERIAL_STRENGTH, "the uniform object");
    assert.equal(shader.fragmentShader.split("uniform float materialStrength;").length - 1, 1, "declared once");
  });

  it("when it compiles, then its skin look reads the one shared switch uniform object", () => {
    assert.equal(compileShader(mesh.material, THREE.ShaderLib.standard).uniforms.uSkinSss, SKIN_SSS);
  });

  it("when its fabric table is read, then it has a row per fabric, bare 'none' last", () => {
    assert.equal(fabrics.length, FABRIC.NONE + 1, "rows");
    assert.equal(fabrics[FABRIC.NONE], 1, "none row");
    for (const [index, share] of FABRIC_ENV.entries()) assert.equal(fabrics[index], share, `row ${index}`);
  });

  for (const testCase of fabricCases) {
    it(`when the ${testCase.it} row is read, then it keeps no more than ${testCase.expectedMax} of the reflection`, () => {
      assert.ok(fabrics[testCase.fabric]! <= testCase.expectedMax, `share ${fabrics[testCase.fabric]}`);
    });
  }

  it("when the metal and eye roles are read, then they keep the whole reflection and a rubber sole a quarter", () => {
    const rows = Object.entries(ROLE).sort(([, a], [, b]) => a - b).map(([name]) => name);
    assert.equal(roles[rows.indexOf("BADGE")], 1, "badge");
    assert.equal(roles[rows.indexOf("BUCKLE")], 1, "buckle");
    assert.equal(roles[rows.indexOf("EYES")], 1, "eyes");
    assert.equal(roles[rows.indexOf("SOLE")], 0.25, "sole");
    assert.equal(roles[rows.indexOf("SHIRT")], -1, "shirt follows its fabric");
  });
});
