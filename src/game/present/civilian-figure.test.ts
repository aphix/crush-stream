import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FIGURE_ATTRIBUTE } from "./civilian-art-constants.ts";
import { civilianFigureGeometry } from "./civilian-figure.ts";

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
});
