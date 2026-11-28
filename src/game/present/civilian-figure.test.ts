import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FIGURE_ATTRIBUTE } from "./civilian-art-constants.ts";
import { civilianFigureGeometry, HEAD_PIVOT_ABOVE, STILL_SWING } from "./civilian-figure.ts";
import { JOINTS } from "./ragdoll-body.ts";

/** The vertex shader's head turn (`TURN_HEAD_GLSL`) in TypeScript, standing still: a head vertex turned about the neck, any other unmoved. */
function turnFigureHead(position: THREE.Vector3, rigSwing: number, rigPivot: number, yaw: number, pitch: number): THREE.Vector3 {
  const head = rigPivot >= HEAD_PIVOT_ABOVE && Math.abs(rigSwing) < STILL_SWING ? 1 : 0;
  const neck = rigPivot * head;
  const y = position.y - neck;
  const nodY = y * Math.cos(pitch * head) - position.z * Math.sin(pitch * head);
  const nodZ = y * Math.sin(pitch * head) + position.z * Math.cos(pitch * head);
  return position.set(position.x * Math.cos(yaw * head) + nodZ * Math.sin(yaw * head), nodY + neck, nodZ * Math.cos(yaw * head) - position.x * Math.sin(yaw * head));
}

const HEAD_TURN = 0.9;
const HEAD_NOD = 0.4;

const VERTICES_PER_PART = 36;
const TRIANGLE_BUDGET = { min: 100, max: 160 } as const;

describe("given the far figure", () => {
  const geometry = civilianFigureGeometry();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");

  it("when it is built, then it is about a hundred and fifty triangles", () => {
    const triangles = position.count / 3;
    expect(triangles, "triangles").toBeGreaterThanOrEqual(TRIANGLE_BUDGET.min);
    expect(triangles, "triangles").toBeLessThanOrEqual(TRIANGLE_BUDGET.max);
  });

  it("when it is built, then every face of every part points away from the part's middle and its normal says so", () => {
    const middle = new THREE.Vector3();
    const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
    const centroid = new THREE.Vector3();
    const geometric = new THREE.Vector3();
    const stored = new THREE.Vector3();
    let facesChecked = 0;
    for (let first = 0; first < position.count; first += VERTICES_PER_PART) {
      middle.set(0, 0, 0);
      for (let vertex = first; vertex < first + VERTICES_PER_PART; vertex++) middle.add(corner[0].fromBufferAttribute(position, vertex));
      middle.divideScalar(VERTICES_PER_PART);
      for (let triangle = first; triangle < first + VERTICES_PER_PART; triangle += 3) {
        for (let at = 0; at < 3; at++) corner[at]!.fromBufferAttribute(position, triangle + at);
        centroid.add(corner[0]).add(corner[1]).add(corner[2]).divideScalar(3);
        geometric.subVectors(corner[1], corner[0]).cross(stored.subVectors(corner[2], corner[0])).normalize();
        stored.fromBufferAttribute(normal, triangle);
        expect(geometric.dot(centroid.sub(middle)), `outward of triangle ${triangle / 3}`).toBeGreaterThan(0);
        expect(geometric.dot(stored), `stored normal of triangle ${triangle / 3}`).toBeGreaterThan(0.999);
        centroid.set(0, 0, 0);
        facesChecked++;
      }
    }
    expect(facesChecked, "faces checked").toBe(position.count / 3);
  });

  it("when it is built, then only the arms and legs are tagged to swing and each is tagged with a pivot above it", () => {
    const rig = geometry.getAttribute(FIGURE_ATTRIBUTE.RIG);
    const swinging = new Set<number>();
    let still = 0;
    for (let vertex = 0; vertex < rig.count; vertex++) {
      if (rig.getY(vertex) === 0) still++;
      else {
        swinging.add(Math.sign(rig.getY(vertex)) * (rig.getZ(vertex) > 1 ? 2 : 1));
        expect(rig.getZ(vertex), "pivot over the vertex").toBeGreaterThanOrEqual(position.getY(vertex));
      }
    }
    expect(still, "vertices of the torso and head").toBe(3 * VERTICES_PER_PART);
    expect(swinging.size, "swing kinds: leg and arm, each way").toBe(4);
  });

  it("when an instance's head turns and nods (the shader's math), then the head and hair turn about the neck toward her +x and down, and nothing else moves", () => {
    const rig = geometry.getAttribute(FIGURE_ATTRIBUTE.RIG);
    const neck = new THREE.Vector3(0, JOINTS[0][3], 0);
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    const front = { x: 0, y: 0, yBefore: 0, count: 0 };
    let turned = 0;
    for (let vertex = 0; vertex < position.count; vertex++) {
      before.fromBufferAttribute(position, vertex);
      turnFigureHead(after.copy(before), rig.getY(vertex), rig.getZ(vertex), HEAD_TURN, HEAD_NOD);
      const isHead = vertex >= VERTICES_PER_PART && vertex < 3 * VERTICES_PER_PART;
      if (!isHead) {
        expect(after.distanceTo(before), `body vertex ${vertex} still`).toBe(0);
        continue;
      }
      if (after.distanceTo(before) > 0.01) turned++;
      expect(after.distanceTo(neck), `head vertex ${vertex} about the neck`).toBeCloseTo(before.distanceTo(neck), 6);
      if (before.z > 0) {
        front.x += after.x;
        front.y += after.y;
        front.yBefore += before.y;
        front.count++;
      }
    }
    expect(turned, "head and hair vertices moved").toBe(2 * VERTICES_PER_PART);
    expect(front.x / front.count, "the face turned toward her +x").toBeGreaterThan(0.05);
    expect(front.y / front.count, "the face nodded down").toBeLessThan(front.yBefore / front.count);
  });
});
