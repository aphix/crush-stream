import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { driverLook } from "./driver-look.ts";
import { ORBS_AT } from "./dummy-rig.ts";
import { PRINT_CELL } from "./dummy-texture.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

/** Her lit program's fragment stage, as compiled over three's standard shader. */
function litFragment(): string {
  const mesh = new DummyMesh(1);
  const { vertexShader, fragmentShader } = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader, fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
  mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

/** Slot 0's eye turn in its row: yaw, then pitch. */
function eyesOf(mesh: DummyMesh): [number, number] {
  const rows = mesh["rows"];
  return [rows[ORBS_AT * 4 + 3]!, rows[(ORBS_AT + 1) * 4 + 3]!];
}

describe("given a person's dummy whose eyes turn in her head", () => {
  it("when they are turned 0.3 rad toward her +x and 0.2 down, then her row carries both; dressed again, they are centred", () => {
    const mesh = new DummyMesh(1);
    mesh.eyes(0, 0.3, 0.2);
    const [yaw, pitch] = eyesOf(mesh);
    expect(yaw, "across (rad)").toBeCloseTo(0.3, 6);
    expect(pitch, "down (rad)").toBeCloseTo(0.2, 6);
    mesh.dress(0, false, driverLook(1, 0));
    expect(eyesOf(mesh), "dressed again").toEqual([0, 0]);
  });

  it("when her lit program is compiled, then her face print is sampled through the iris warp, which reads the eye turn from her row's orb texels", () => {
    const fragment = litFragment();
    expect(fragment, "the face print through the warp").toMatch(/vec2 inkUv = .*dollEyes\(printUv, vDollSlot\)/);
    expect(fragment, "the ink read at the warped point").toContain("texture2D(prints, vec2(inkUv.x,");
    expect(fragment, "the turn from her row").toContain(`vec2(dollRow(${ORBS_AT}, slot).w, dollRow(${ORBS_AT + 1}, slot).w)`);
  });

  it("when the warp is read, then the print is sampled against the turn across and with it down: the iris moves toward her +x as her eyes turn there, and down as they look down", () => {
    expect(litFragment()).toContain("* vec2(turn.x, -turn.y);");
  });

  it("when the warp is read, then the capped man's face, whose picture wears dark glasses, is not warped", () => {
    expect(litFragment()).toContain(`printCell != ${PRINT_CELL.CAP_MAN.toFixed(6)} ? dollEyes(printUv, vDollSlot)`);
  });
});
