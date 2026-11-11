import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { MAT } from "../kernel/material-ids.ts";
import { OW_DRAW_CELL, PARK, PARK_BLOCK } from "../world/openworld/openworld-constants.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { BAY, drawnHalf } from "../world/openworld/openworld-facade-solids.ts";
import { distanceToPath, faceAt, inClearPath, outOf } from "../world/openworld/openworld-greenery.test-util.ts";
import type { StreetTreeSkin } from "../world/openworld/openworld-greenery.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { parkProps } from "../world/openworld/openworld-park.ts";
import { PLAZA_RADIUS } from "../world/openworld/openworld-plaza.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { TREE_SCALE } from "../world/scenery.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { cyl, painted, type Piece } from "./prefab-pieces.ts";
import { prefabParts } from "./prefabs.ts";
import { PropTumble } from "./prop-tumble.ts";
import { drawCell } from "./track-mesh.ts";
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
/** What a park tree's low parts (under head height) keep clear of (m): a path's half width and a walker's shoulder, a bench's or lamp's reach, the pavilion's. */
const PATH_CLEAR = PARK.pathWidth / 2 + 0.3;
const PROP_CLEAR = 0.8;
const PAVILION_CLEAR = 2.7;
/** A park tree's round bed reaches at least this far (m) across. */
const BED_MIN_HALF = 1.4;

const lots = layOutLots();
const allPlaced: Placed[] = (openWorldCourse(lots).props ?? [])
  .filter((prop) => prop.prefab === PREFAB.tree)
  .map((prop) => ({ prefab: PREFAB.tree, x: prop.x, y: 0, z: prop.z, yaw: prop.yaw ?? 0, sx: prop.scale ?? 1, sy: prop.scale ?? 1, sz: prop.scale ?? 1, style: prop.style }));
const placed = allPlaced.filter((tree) => !treeOf(tree)!.kind.startsWith("park"));
const parkPlaced = allPlaced.filter((tree) => treeOf(tree)!.kind.startsWith("park"));
const skins = [...new Set(allPlaced.map((tree) => treeOf(tree)!.skin))];

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

const vertexCache = new Map<string, Float32Array>();

/** Every vertex of skin `skin`'s pieces, flat, in the tree's frame at the prop's scale. */
function verticesOf(skin: StreetTreeSkin): Float32Array {
  let flat = vertexCache.get(skin);
  if (flat === undefined) {
    flat = Float32Array.from(streetTreePieces(skin).flatMap((piece) => [...piece[0].getAttribute("position").array]));
    vertexCache.set(skin, flat);
  }
  return flat;
}

/** Calls `visit` with every vertex of `tree`'s drawing in the world (x, height above its foot, z): its pose's turn and size, the prop's scale. */
function eachVertex(tree: Placed, visit: (x: number, height: number, z: number) => void): void {
  const pose = treeOf(tree)!;
  const flat = verticesOf(pose.skin);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const size = TREE_SCALE * pose.scale;
  for (let at = 0; at < flat.length; at += 3) {
    const x = flat[at]! * size;
    const z = flat[at + 2]! * size;
    visit(tree.x + x * cos + z * sin, flat[at + 1]! * size, tree.z - x * sin + z * cos);
  }
}

describe("given the street trees' drawings", () => {
  it("when each kind's pieces are read, then it stands in a pit of soil no higher than the paving's edge, a street tree with ivy lumps at its foot and a park tree in a round bed, under a canopy over a head's height", () => {
    expect(skins.length).toBeGreaterThanOrEqual(3);
    for (const skin of skins) {
      const pieces = streetTreePieces(skin);
      const park = skin.includes("park");
      expect(pieces[0]![2], `${skin} first piece`).toBe(MAT.HAY);
      expect(boundsOf(pieces[0]!).max.y * TREE_SCALE, `${skin} pit`).toBeLessThanOrEqual(PIT_TOP_MAX);
      expect(boundsOf(pieces[0]!).max.x * TREE_SCALE >= BED_MIN_HALF, `${skin} round bed`).toBe(park);
      const leaves = pieces.filter((piece) => piece[2] === MAT.CONIFER_FOLIAGE);
      const ivy = leaves.filter((piece) => boundsOf(piece).max.y * TREE_SCALE <= IVY_TOP_MAX);
      if (park) expect(ivy.length, `${skin} ivy`).toBe(0);
      else expect(ivy.length, `${skin} ivy`).toBeGreaterThanOrEqual(IVY_LUMPS);
      for (const lump of ivy) {
        const middle = boundsOf(lump).getCenter(new THREE.Vector3());
        expect(Math.hypot(middle.x, middle.z) * TREE_SCALE, `${skin} ivy reach`).toBeLessThanOrEqual(IVY_REACH);
      }
      for (const lump of leaves.filter((piece) => !ivy.includes(piece))) expect(boundsOf(lump).min.y * TREE_SCALE, `${skin} canopy`).toBeGreaterThan(CANOPY_FROM);
    }
  });

  it("when every street tree of the course is placed, then no part of it a walker can meet lies in the sidewalk's clear path and no part nears a bay's front", () => {
    const bayFront = -(lots.geometry.setback + lots.geometry.houseDepth / 2 - drawnHalf(lots.geometry.houseDepth)) + BAY.out;
    for (const tree of placed) {
      const face = faceAt(lots, tree.x, tree.z, TRUNK_FACE_REACH)!;
      const where = `${treeOf(tree)!.skin} at ${tree.x.toFixed(1)},${tree.z.toFixed(1)}`;
      eachVertex(tree, (x, height, z) => {
        if (inClearPath(lots, x, z, EPSILON)) expect(height, `${where} over the clear path`).toBeGreaterThanOrEqual(HEADROOM);
        expect(outOf(face, x, z), `${where} against the house`).toBeGreaterThanOrEqual(bayFront + BAY_CLEARANCE);
      });
    }
  });

  it("when every park tree is placed, then no part of it under head height lies on a path, in the plaza, on the court or over a bench, lamp, bin or the pavilion", () => {
    const index = lots.blocks.findIndex((block) => block.column === PARK_BLOCK.column && block.row === PARK_BLOCK.row);
    const block = lots.blocks[index]!;
    const paths = lots.paths.filter((path) => path.block === index);
    const dressing = parkProps(lots).filter((prop) => prop.prefab !== PREFAB.hoopFence && prop.prefab !== PREFAB.plaza);
    expect(parkPlaced.length).toBeGreaterThan(0);
    for (const tree of parkPlaced) {
      const where = `${treeOf(tree)!.skin} at ${tree.x.toFixed(1)},${tree.z.toFixed(1)}`;
      eachVertex(tree, (x, height, z) => {
        if (height >= HEADROOM) return;
        for (const path of paths) expect(distanceToPath(path, x, z), `${where} on a path`).toBeGreaterThanOrEqual(PATH_CLEAR);
        expect(Math.hypot(x - block.centreX, z - block.centreZ), `${where} in the plaza`).toBeGreaterThanOrEqual(PLAZA_RADIUS);
        const onCourt = Math.abs(x - (block.centreX + PARK.courtOffsetX)) < PARK.courtLength / 2 && Math.abs(z - (block.centreZ + PARK.courtOffsetZ)) < PARK.courtWidth / 2;
        expect(onCourt, `${where} on the court`).toBe(false);
        for (const prop of dressing) expect(Math.hypot(x - prop.x, z - prop.z), `${where} over ${prop.prefab}`).toBeGreaterThanOrEqual(prop.prefab === PREFAB.pavilion ? PAVILION_CLEAR : PROP_CLEAR);
      });
    }
  });
});

describe("given a street tree's crown", () => {
  // mutation: sed -i 's/^  ball.setAttribute("normal", ball.getAttribute("position").clone());$//' src/game/present/street-trees.ts
  it("when it is built, then it is drawn on the leaf material and every corner of a canopy lump has one normal, whichever face it is on, so the crown shades round", () => {
    const leaves = new THREE.MeshBasicMaterial();
    const mats = { ...plainMaterials(new THREE.MeshBasicMaterial()), leaves };
    for (const skin of skins) {
      expect(prefabParts(PREFAB.tree, mats, skin)[0]!.material, skin).toBe(leaves);
      for (const piece of streetTreePieces(skin).filter((p) => p[2] === MAT.CONIFER_FOLIAGE)) {
        const flat = piece[0].index ? piece[0].toNonIndexed() : piece[0];
        const position = flat.getAttribute("position");
        const normal = flat.getAttribute("normal");
        const seen = new Map<string, number>();
        for (let at = 0; at < position.count; at++) {
          const corner = [position.getX(at), position.getY(at), position.getZ(at)].map((v) => v.toFixed(4)).join();
          const first = seen.get(corner);
          if (first === undefined) seen.set(corner, at);
          else expect(normal.getX(at) * normal.getX(first) + normal.getY(at) * normal.getY(first) + normal.getZ(at) * normal.getZ(first), `${skin} corner ${corner}`).toBeCloseTo(1, 5);
        }
      }
    }
  });
});

describe("given the street trees drawn as instances", () => {
  // mutation: sed -i 's/drawCell(pl.x, pl.z, cells.prop)/drawCell(pl.x, pl.z)/' src/game/present/prop-tumble.ts
  it("when the course's trees are made into meshes, then each kind in each draw cell is one draw group whatever its facing, and each instance carries its own facing and size", () => {
    const meshes: THREE.InstancedMesh[] = [];
    const material = new THREE.MeshBasicMaterial();
    const tumble = new PropTumble(
      allPlaced,
      plainMaterials(material),
      (mesh) => void meshes.push(mesh),
      () => false,
      (tree) => treeOf(tree)?.skin ?? null,
      treeOf,
      { prop: OW_DRAW_CELL, asset: OW_DRAW_CELL },
    );
    const groups = new Set(allPlaced.map((tree) => `${treeOf(tree)!.skin}@${drawCell(tree.x, tree.z, OW_DRAW_CELL)}`));
    expect(groups.size, "draw cells wide enough to split the city").toBeGreaterThan(skins.length);
    expect(meshes.length, "one mesh per skin and cell").toBe(groups.size);
    const matrix = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const [index, tree] of allPlaced.entries()) {
      const pose = treeOf(tree)!;
      const mesh = tumble["meshes"][tumble["cell"][index]!]![0]!;
      mesh.getMatrixAt(tumble["slot"][index]!, matrix);
      matrix.decompose(new THREE.Vector3(), turn, scale);
      const yaw = 2 * Math.atan2(turn.y, turn.w);
      expect(Math.cos(yaw), `facing ${index}`).toBeCloseTo(Math.cos(tree.yaw + pose.yaw), ROTATION_DIGITS);
      expect(Math.sin(yaw), `facing ${index}`).toBeCloseTo(Math.sin(tree.yaw + pose.yaw), ROTATION_DIGITS);
      expect(scale.x, `size ${index}`).toBeCloseTo(tree.sx * pose.scale, ROTATION_DIGITS);
    }
    expect(new Set(allPlaced.map((tree) => treeOf(tree)!.yaw.toFixed(3))).size).toBeGreaterThan(skins.length);
  });
});
