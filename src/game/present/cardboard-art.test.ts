import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { CardboardBoxes } from "./cardboard-art.ts";
import { BOX_POSE_FLOATS, type BoxPlacement } from "./ragdoll-boxes.ts";

/** Poses are f32 and the instance matrices are f32 too: equal to within a few ulps of a value near 10. */
const FLOAT32_TOLERANCE = 1e-5;

const placements: readonly BoxPlacement[] = [
  { x: 0, y: 0, z: 0, yaw: 0, width: 0.9, height: 1.2, depth: 1.4 },
  { x: 0, y: 0, z: 0, yaw: 0, width: 1.4, height: 0.8, depth: 1 },
  { x: 0, y: 0, z: 0, yaw: 0, width: 1, height: 1, depth: 0.85 },
];
const tumbles = [new THREE.Vector3(1, 2, 3).normalize(), new THREE.Vector3(-3, 1, 0.5).normalize(), new THREE.Vector3(0, 0, 1)];
const spins = [1.1, 2.4, 0.3];
const centres = [new THREE.Vector3(10.5, 1.25, -3), new THREE.Vector3(12, 0.5, 2.25), new THREE.Vector3(14.75, 3, 0)];

/** What `RagdollSystem.copyBoxPoses` writes for the three boxes: position xyz then rotation xyzw each. */
function tumbledPoses(): Float32Array {
  const poses = new Float32Array(placements.length * BOX_POSE_FLOATS);
  for (let boxIndex = 0; boxIndex < placements.length; boxIndex++) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(tumbles[boxIndex]!, spins[boxIndex]!);
    poses.set([...centres[boxIndex]!.toArray(), rotation.x, rotation.y, rotation.z, rotation.w], boxIndex * BOX_POSE_FLOATS);
  }
  return poses;
}

function drawnBox(boxes: CardboardBoxes, boxIndex: number) {
  const matrix = new THREE.Matrix4();
  boxes.mesh.getMatrixAt(boxIndex, matrix);
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

describe("given the dynamic box piles' drawing", () => {
  beforeAll(stubBrowser);

  it("when it is built, then it is one instanced mesh of one material (one draw), its box textured and never frustum-culled", () => {
    const boxes = new CardboardBoxes(placements.length);
    expect(boxes.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(Array.isArray(boxes.mesh.material), "one material is one draw").toBe(false);
    expect(boxes.mesh.instanceMatrix.count, "one matrix slot per box of the capacity").toBe(placements.length);
    expect((boxes.mesh.material as THREE.MeshStandardMaterial).map, "the cardboard texture").toBeTruthy();
    expect(boxes.mesh.frustumCulled, "the pile tumbles away from the unit cube's own bounding sphere").toBe(false);
    boxes.dispose();
  });

  it("when the shader program is built, then the texture's uvs are scaled by each instance's own size in metres and centred on the face, once per tile, so a big box is not stretched", () => {
    const boxes = new CardboardBoxes(placements.length);
    const material = boxes.mesh.material as THREE.MeshStandardMaterial;
    const shader = { uniforms: {}, vertexShader: "void main() {\n#include <uv_vertex>\n}", fragmentShader: "" } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader, "after the stock uv chunk, for instanced draws").toMatch(/#include <uv_vertex>\n#ifdef USE_INSTANCING/);
    expect(shader.vertexShader, "the instance's own x size").toMatch(/length\(instanceMatrix\[0\]\.xyz\)/);
    expect(shader.vertexShader, "the instance's own y size").toMatch(/length\(instanceMatrix\[1\]\.xyz\)/);
    expect(shader.vertexShader, "the instance's own z size").toMatch(/length\(instanceMatrix\[2\]\.xyz\)/);
    expect(shader.vertexShader, "metres over a one-metre tile, about the face's centre").toMatch(/vMapUv = \(vMapUv - 0\.5\) \* faceMetres \/ 1\.0000 \+ 0\.5;/);
    boxes.dispose();
  });

  it("when the poses of tumbled boxes are drawn, then each instance sits at its pose's position, turned by its pose's rotation, scaled to its placement's size", () => {
    const boxes = new CardboardBoxes(placements.length);
    boxes.setLayout(placements);
    boxes.update(tumbledPoses(), placements.length);
    for (let boxIndex = 0; boxIndex < placements.length; boxIndex++) {
      const drawn = drawnBox(boxes, boxIndex);
      const placement = placements[boxIndex]!;
      expect(drawn.position.distanceTo(centres[boxIndex]!), `box ${boxIndex} position ${drawn.position.toArray()}`).toBeLessThan(FLOAT32_TOLERANCE);
      const expectedRotation = new THREE.Quaternion().setFromAxisAngle(tumbles[boxIndex]!, spins[boxIndex]!);
      expect(drawn.rotation.angleTo(expectedRotation), `box ${boxIndex} rotation is off by ${drawn.rotation.angleTo(expectedRotation)} rad`).toBeLessThan(FLOAT32_TOLERANCE);
      expect(drawn.scale.distanceTo(new THREE.Vector3(placement.width, placement.height, placement.depth)), `box ${boxIndex} size ${drawn.scale.toArray()}`).toBeLessThan(FLOAT32_TOLERANCE);
    }
    boxes.dispose();
  });

  it("when fewer boxes than the layout are updated, then only that many are drawn, and a later full update draws them all", () => {
    const boxes = new CardboardBoxes(placements.length);
    boxes.setLayout(placements);
    expect(boxes.mesh.count, "nothing draws before the first update").toBe(0);
    boxes.update(tumbledPoses(), 2);
    expect(boxes.mesh.count).toBe(2);
    boxes.update(tumbledPoses(), placements.length);
    expect(boxes.mesh.count).toBe(placements.length);
    boxes.dispose();
  });

  it("when a layout holds more boxes than the capacity, or an update more than the layout or the poses give, then it throws", () => {
    const boxes = new CardboardBoxes(placements.length);
    expect(() => boxes.setLayout([...placements, placements[0]!])).toThrow(RangeError);
    boxes.setLayout(placements);
    expect(() => boxes.update(tumbledPoses(), placements.length + 1), "more poses than boxes in the layout").toThrow(RangeError);
    expect(() => boxes.update(new Float32Array(BOX_POSE_FLOATS), placements.length), "poses too short").toThrow(RangeError);
    boxes.dispose();
  });
});
