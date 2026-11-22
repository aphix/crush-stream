import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { driverLook } from "./driver-look.ts";
import { ORBS_AT } from "./dummy-rig.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** Slot 0's eye turn in its row: yaw, then pitch. */
function eyesOf(mesh: DummyMesh): [number, number] {
  const rows = mesh["rows"];
  return [rows[ORBS_AT * 4 + 3]!, rows[(ORBS_AT + 1) * 4 + 3]!];
}

describe("given a person's dummy whose eyes turn in her head", () => {
  // mutation: sed -i 's/    this.rows\[at + 4\] = pitch;/    this.rows[at + 4] = 0;/' src/game/present/ragdoll-mesh.ts
  it("when they are turned 0.3 rad toward her +x and 0.2 down, then her row carries both; dressed again, they are centred", () => {
    const mesh = new DummyMesh(1);
    mesh.eyes(0, 0.3, 0.2);
    const [yaw, pitch] = eyesOf(mesh);
    expect(yaw, "across (rad)").toBeCloseTo(0.3, 6);
    expect(pitch, "down (rad)").toBeCloseTo(0.2, 6);
    mesh.dress(0, false, driverLook(1, 0));
    expect(eyesOf(mesh), "dressed again").toEqual([0, 0]);
  });

  // mutation: sed -i 's/  vec2 inkUv = printCell < .*/  vec2 inkUv = printUv;/' src/game/present/dummy-shader.ts
  it("when her lit program is compiled, then her face print is sampled through the iris warp, which reads the eye turn from her row's orb texels", () => {
    const mesh = new DummyMesh(1);
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
    const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
    mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader, "the face print through the warp").toMatch(/vec2 inkUv = .*dollEyes\(printUv, vDollSlot\)/);
    expect(shader.fragmentShader, "the ink read at the warped point").toContain("texture2D(prints, vec2(inkUv.x,");
    expect(shader.fragmentShader, "the turn from her row").toContain(`vec2(dollRow(${ORBS_AT}, slot).w, dollRow(${ORBS_AT + 1}, slot).w)`);
  });
});
