import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MATERIAL_STRENGTH } from "../vehicle/material-class.ts";
import { FABRIC, FABRIC_ENV } from "./dummy-cloth.ts";
import { ROLE } from "./dummy-rig.ts";
import { SKIN_SSS } from "./dummy-shader.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { must } from "../kernel/must.test-util.ts";

function compileShader(material: THREE.Material, chunks: { vertexShader: string; fragmentShader: string }): THREE.WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: chunks.vertexShader, fragmentShader: chunks.fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

const compiled = (material: THREE.Material, chunks: { vertexShader: string; fragmentShader: string }): string => compileShader(material, chunks).fragmentShader;

function tableOf(fragment: string, name: string): number[] {
  const match = new RegExp(`const float ${name}\\[\\d+\\] = float\\[\\d+\\]\\(([^)]*)\\)`).exec(fragment);
  must(match, `${name} table`);
  return match[1]!.split(",").map(Number);
}

const fabricCases = [
  { it: "when the skin row is read, then it keeps no more than 0.5 of the reflection", fabric: FABRIC.SKIN, expectedMax: 0.5 },
  { it: "when the denim row is read, then it keeps no more than 0.3 of the reflection", fabric: FABRIC.DENIM, expectedMax: 0.3 },
  { it: "when the cotton row is read, then it keeps no more than 0.3 of the reflection", fabric: FABRIC.COTTON, expectedMax: 0.3 },
  { it: "when the hair row is read, then it keeps no more than 0.5 of the reflection", fabric: FABRIC.HAIR, expectedMax: 0.5 },
  { it: "when the leather row is read, then it keeps no more than 0.7 of the reflection", fabric: FABRIC.LEATHER, expectedMax: 0.7 },
] as const;

describe("given the people's lit material", () => {
  const mesh = new DummyMesh(1);
  const lit = compiled(mesh.material, THREE.ShaderLib.standard);
  const depth = compiled(mesh.customDepthMaterial!, THREE.ShaderLib.depth);
  const fabrics = tableOf(lit, "DOLL_FABRIC_ENV");
  const roles = tableOf(lit, "DOLL_ROLE_ENV");

  it("when it compiles, then the studio's reflection is scaled once after the lights and the shadow's depth shader has no such line", () => {
    expect(lit.split("reflectedLight.indirectSpecular *= materialSpecular(dollEnv);").length - 1, "lit scale lines").toBe(1);
    expect(depth.includes("dollEnv"), "depth shader").toBe(false);
  });

  it("when it compiles, then its reflection scale follows the shared Material strength setting", () => {
    const shader = compileShader(mesh.material, THREE.ShaderLib.standard);
    expect(shader.uniforms.materialStrength, "the uniform object").toBe(MATERIAL_STRENGTH);
    expect(shader.fragmentShader.split("uniform float materialStrength;").length - 1, "declared once").toBe(1);
  });

  it("when it compiles, then its skin look follows the one shared skin-scatter switch", () => {
    expect(compileShader(mesh.material, THREE.ShaderLib.standard).uniforms.uSkinSss).toBe(SKIN_SSS);
  });

  it("when its fabric table is read, then it has a row per fabric, bare 'none' last", () => {
    expect(fabrics.length, "rows").toBe(FABRIC.NONE + 1);
    expect(fabrics[FABRIC.NONE], "none row").toBe(1);
    for (const [index, share] of FABRIC_ENV.entries()) expect(fabrics[index], `row ${index}`).toBe(share);
  });

  for (const testCase of fabricCases) {
    it(testCase.it, () => {
      expect(fabrics[testCase.fabric]!, `share ${fabrics[testCase.fabric]}`).toBeLessThanOrEqual(testCase.expectedMax);
    });
  }

  it("when the metal and eye roles are read, then they keep the whole reflection and a rubber sole a quarter", () => {
    const rows = Object.entries(ROLE).sort(([, a], [, b]) => a - b).map(([name]) => name);
    expect(roles[rows.indexOf("BADGE")], "badge").toBe(1);
    expect(roles[rows.indexOf("BUCKLE")], "buckle").toBe(1);
    expect(roles[rows.indexOf("EYES")], "eyes").toBe(1);
    expect(roles[rows.indexOf("SOLE")], "sole").toBe(0.25);
    expect(roles[rows.indexOf("SHIRT")], "shirt follows its fabric").toBe(-1);
  });
});
