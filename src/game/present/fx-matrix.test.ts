import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASIS_SIZE, cameraBasis, writeBillboard } from "./fx-matrix.ts";

/** The direct billboard writer against the Object3D compose it replaces: the same matrix to float rounding. */
const TOLERANCE = 1e-6;
const MATRIX_FLOATS = 16;
/** A slot past the first, so an offset that ignores `at` is caught. */
const SLOT = 3;

const POSES = [
  { name: "a camera with no turn", angles: [0, 0, 0], s: 1, at: [0, 0, 0] },
  { name: "a camera yawed and pitched", angles: [-0.4, 2.1, 0], s: 0.7, at: [3, 1.5, -8] },
  { name: "a camera rolled over", angles: [1.2, -0.3, 2.9], s: 2.4, at: [-120, 0.08, 45] },
  { name: "a camera turned through every axis", angles: [2.6, 1.7, 3.1], s: 0.45, at: [10.5, 0.2, 7] },
] as const;

for (const { name, angles, s, at } of POSES) {
  describe(`given ${name}`, () => {
    it("when a billboard is written on the camera's basis, then it is the matrix compose gives for the camera's quaternion", () => {
      const camera = new THREE.Object3D();
      camera.rotation.set(angles[0], angles[1], angles[2]);
      const basis = new Float64Array(BASIS_SIZE);
      cameraBasis(camera.quaternion, basis);
      const out = new Float32Array((SLOT + 1) * MATRIX_FLOATS);
      writeBillboard(out, SLOT * MATRIX_FLOATS, basis, s, at[0], at[1], at[2]);
      const dummy = new THREE.Object3D();
      dummy.position.set(at[0], at[1], at[2]);
      dummy.scale.setScalar(s);
      dummy.quaternion.copy(camera.quaternion);
      dummy.updateMatrix();
      for (let k = 0; k < MATRIX_FLOATS; k++) {
        const got = out[SLOT * MATRIX_FLOATS + k]!;
        expect(Math.abs(got - dummy.matrix.elements[k]!), `element ${k} is ${got}, compose gives ${dummy.matrix.elements[k]}`).toBeLessThan(TOLERANCE);
      }
    });
  });
}

describe("given a basis written for a turned camera", () => {
  it("when its three columns are read, then they are unit and at right angles", () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, -1.9, 0.3));
    const basis = new Float64Array(BASIS_SIZE);
    cameraBasis(q, basis);
    const column = (c: number) => new THREE.Vector3(basis[c * 3]!, basis[c * 3 + 1]!, basis[c * 3 + 2]!);
    for (let c = 0; c < 3; c++) expect(Math.abs(column(c).length() - 1), `column ${c} is unit`).toBeLessThan(TOLERANCE);
    expect(Math.abs(column(0).dot(column(1))) < TOLERANCE && Math.abs(column(1).dot(column(2))) < TOLERANCE, "the columns are at right angles").toBeTruthy();
  });
});
