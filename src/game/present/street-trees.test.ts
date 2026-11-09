import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { MAT } from "../kernel/material-ids.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { BAY, drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import { faceAt, inClearPath, outOf } from "../world/openworld/openworld-greenery.test-util.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { TREE_SCALE } from "../world/scenery.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { cyl, painted, type Piece } from "./prefab-pieces.ts";
import { prefabParts } from "./prefabs.ts";
import { PropTumble } from "./prop-tumble.ts";
import { streetTreePieces, treeOf } from "./street-trees.ts";

/** The most a pit may stand proud of the paving (m), and the most of the ivy's height. */
const PIT_TOP_MAX = 0.1;
const IVY_TOP_MAX = 0.4;
/** Ivy lumps a tree pit has at least, and how far from the trunk the ivy may lie (m). */
const IVY_LUMPS = 3;
const IVY_REACH = 0.8;
/** A canopy lump's lowest point is over a head (m). */
const CANOPY_FROM = 1;
/** The height a walker's head needs over the clear path (m): 1.8 m and a margin. */
const HEADROOM = 2.2;
/** A canopy keeps this far (m) from a bay's front. */
const BAY_CLEARANCE = 0.3;
/** Float noise on a point's coordinates (m). */
const EPSILON = 1e-6;
const TRUNK_FACE_REACH = 4;
const ROTATION_DIGITS = 5;

const lots = layOutLots();
const placed: Placed[] = (openWorldCourse(lots).props ?? [])
  .filter((prop) => prop.prefab === PREFAB.tree)
  .map((prop) => ({ prefab: PREFAB.tree, x: prop.x, y: 0, z: prop.z, yaw: prop.yaw ?? 0, sx: prop.scale ?? 1, sy: prop.scale ?? 1, sz: prop.scale ?? 1, style: prop.style }));
const skins = [...new Set(placed.map((tree) => treeOf(tree)!.skin))];

/** What the street trees were before kinds: a trunk and two cones of conifer leaves. */
function conifer(): Float32Array {
  const pieces: Piece[] = [
    [cyl(0.15, 0.24, -0.2, 2.0, 5, true), 0, MAT.TREE_BARK],
    [new THREE.ConeGeometry(1.6, 3.8, 6).translate(0, 3.3, 0), 0, MAT.CONIFER_FOLIAGE],
    [new THREE.ConeGeometry(1.05, 3.0, 6).translate(0, 5.5, 0), 0, MAT.CONIFER_FOLIAGE],
  ];
  return painted(pieces).getAttribute("position").array as Float32Array;
}

describe("given a tree with no street style", () => {
  it("when it is drawn, then its parts are the trunk and two cones it always had, whatever skin or none asks, and no placement of another course names a street tree", () => {
    const today = conifer();
    const material = new THREE.MeshBasicMaterial();
    for (const parts of [prefabParts(PREFAB.tree, plainMaterials(material)), prefabParts(PREFAB.tree, plainMaterials(material), null)]) {
      expect(parts.length).toBe(1);
      expect(firstMismatch(parts[0]!.geometry.getAttribute("position").array, today)).toBeUndefined();
    }
    for (const style of [undefined, "rowbrick", "street-tree"]) expect(treeOf({ prefab: PREFAB.tree, style })).toBeNull();
    expect(treeOf({ prefab: PREFAB.building, style: placed[0]!.style })).toBeNull();
  });
});

function boundsOf(piece: Piece): THREE.Box3 {
  piece[0].computeBoundingBox();
  return piece[0].boundingBox!;
}

describe("given the street trees' drawings", () => {
  it("when each kind's pieces are read, then it stands in a pit of soil no higher than the paving's edge with ivy lumps at its foot, under a canopy over a head's height", () => {
    expect(skins.length).toBeGreaterThanOrEqual(3);
    for (const skin of skins) {
      const pieces = streetTreePieces(skin);
      expect(pieces[0]![2], `${skin} first piece`).toBe(MAT.HAY);
      expect(boundsOf(pieces[0]!).max.y * TREE_SCALE, `${skin} pit`).toBeLessThanOrEqual(PIT_TOP_MAX);
      const leaves = pieces.filter((piece) => piece[2] === MAT.CONIFER_FOLIAGE);
      const ivy = leaves.filter((piece) => boundsOf(piece).max.y * TREE_SCALE <= IVY_TOP_MAX);
      expect(ivy.length, `${skin} ivy`).toBeGreaterThanOrEqual(IVY_LUMPS);
      for (const lump of ivy) {
        const middle = boundsOf(lump).getCenter(new THREE.Vector3());
        expect(Math.hypot(middle.x, middle.z) * TREE_SCALE, `${skin} ivy reach`).toBeLessThanOrEqual(IVY_REACH);
      }
      for (const lump of leaves.filter((piece) => !ivy.includes(piece))) expect(boundsOf(lump).min.y * TREE_SCALE, `${skin} canopy`).toBeGreaterThan(CANOPY_FROM);
    }
  });

  it("when every tree of the course is placed, then no part of it a walker can meet lies in the sidewalk's clear path and no part nears a bay's front", () => {
    const bayFront = -(lots.geometry.setback + lots.geometry.houseDepth / 2 - drawnHalf(lots.geometry.houseDepth)) + BAY.out;
    const vertices = new Map(skins.map((skin) => [skin, streetTreePieces(skin).flatMap((piece) => [...piece[0].getAttribute("position").array])]));
    for (const tree of placed) {
      const pose = treeOf(tree)!;
      const face = faceAt(lots, tree.x, tree.z, TRUNK_FACE_REACH)!;
      const cos = Math.cos(pose.yaw);
      const sin = Math.sin(pose.yaw);
      const flat = vertices.get(pose.skin)!;
      for (let at = 0; at < flat.length; at += 3) {
        const x = flat[at]! * TREE_SCALE * pose.scale;
        const z = flat[at + 2]! * TREE_SCALE * pose.scale;
        const worldX = tree.x + x * cos + z * sin;
        const worldZ = tree.z - x * sin + z * cos;
        const height = flat[at + 1]! * TREE_SCALE * pose.scale;
        const where = `${pose.skin} at ${tree.x.toFixed(1)},${tree.z.toFixed(1)}`;
        if (inClearPath(lots, worldX, worldZ, EPSILON)) expect(height, `${where} over the clear path`).toBeGreaterThanOrEqual(HEADROOM);
        expect(outOf(face, worldX, worldZ), `${where} against the house`).toBeGreaterThanOrEqual(bayFront + BAY_CLEARANCE);
      }
    }
  });
});

describe("given the street trees drawn as instances", () => {
  it("when the course's trees are made into meshes, then each kind is one draw group whatever its facing, and each instance carries its own facing and size", () => {
    const meshes: THREE.InstancedMesh[] = [];
    const material = new THREE.MeshBasicMaterial();
    const tumble = new PropTumble(
      placed,
      plainMaterials(material),
      (mesh) => void meshes.push(mesh),
      () => false,
      (tree) => treeOf(tree)?.skin ?? null,
      treeOf,
    );
    expect(meshes.length).toBe(skins.length);
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const [index, tree] of placed.entries()) {
      const pose = treeOf(tree)!;
      const mesh = tumble["meshes"][tumble["cell"][index]!]![0]!;
      mesh.getMatrixAt(tumble["slot"][index]!, matrix);
      matrix.decompose(new THREE.Vector3(), turn, scale);
      const yaw = 2 * Math.atan2(turn.y, turn.w);
      expect(Math.cos(yaw), `facing ${index}`).toBeCloseTo(Math.cos(tree.yaw + pose.yaw), ROTATION_DIGITS);
      expect(Math.sin(yaw), `facing ${index}`).toBeCloseTo(Math.sin(tree.yaw + pose.yaw), ROTATION_DIGITS);
      expect(scale.x, `size ${index}`).toBeCloseTo(tree.sx * pose.scale, ROTATION_DIGITS);
    }
    expect(new Set(placed.map((tree) => treeOf(tree)!.yaw.toFixed(3))).size).toBeGreaterThan(skins.length);
  });
});
