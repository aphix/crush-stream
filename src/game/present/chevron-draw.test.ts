import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CHEVRON, PREFABS } from "../world/catalog.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeProps } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { prefabParts } from "./prefabs.ts";
import { PropTumble } from "./prop-tumble.ts";
import { drawCell } from "./track-mesh.ts";

const plain = new THREE.MeshBasicMaterial();
const mats = { plain, concrete: plain, building: plain, billboard: plain, water: plain };

/** Linear red above this reads as the yellow of the chevron: the board's black and the post's grey are under 0.05. */
const YELLOW_RED = 0.5;

describe("given the chevron prefab", () => {
  const parts = prefabParts(PREFAB.chevron, mats);
  const position = parts[0]!.geometry.getAttribute("position");
  const color = parts[0]!.geometry.getAttribute("color");
  const boardCentre = CHEVRON.top - CHEVRON.height / 2;

  it("when its parts are listed, then it is one part on the scene's plain material, so a course draws all its boards in one call", () => {
    expect(parts.length, "parts").toBe(1);
    expect(parts[0]!.material, "material").toBe(plain);
    expect(parts[0]!.shared, "owns no shared material (the track art casts its shadow)").toBe(false);
  });

  it("when its drawn extent is measured, then it stands on the ground inside its size box", () => {
    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
    const [width, height, depth] = PREFABS[PREFAB.chevron].size;
    expect(box.min.y >= 0 && box.max.y <= height + 1e-6, `height ${box.min.y} to ${box.max.y} m`).toBeTruthy();
    expect(box.max.x <= width / 2 + 1e-6 && box.min.x >= -width / 2 - 1e-6, `through ${box.min.x} to ${box.max.x} m`).toBeTruthy();
    expect(box.max.z <= depth / 2 + 1e-6 && box.min.z >= -depth / 2 - 1e-6, `across ${box.min.z} to ${box.max.z} m`).toBeTruthy();
    expect(Math.abs(box.max.y - CHEVRON.top), "its top is the board's top").toBeLessThan(1e-6);
  });

  it("when the yellow strokes are measured, then their ends stand further toward +Z than their apex, so the arrow points along local -Z", () => {
    let tipZ = 0;
    let tips = 0;
    let apexZ = 0;
    let apexes = 0;
    for (let i = 0; i < position.count; i++) {
      if (color.getX(i) < YELLOW_RED) continue;
      const height = Math.abs(position.getY(i) - boardCentre);
      if (height > CHEVRON.height / 4) {
        tipZ += position.getZ(i);
        tips++;
      } else if (height < CHEVRON.height / 8) {
        apexZ += position.getZ(i);
        apexes++;
      }
    }
    expect(tips > 0 && apexes > 0, `${tips} tip and ${apexes} apex vertices found`).toBeTruthy();
    expect(tipZ / tips, `tips at z ${(tipZ / tips).toFixed(3)}, apex at z ${(apexZ / apexes).toFixed(3)}`).toBeGreaterThan(apexZ / apexes);
  });

  it("when its strokes are measured through the board, then each face carries them proud of the black", () => {
    const front = new THREE.Box3();
    const back = new THREE.Box3();
    const black = new THREE.Box3();
    for (let i = 0; i < position.count; i++) {
      const yellow = color.getX(i) >= YELLOW_RED;
      const x = position.getX(i);
      if (yellow) (x > 0 ? front : back).expandByPoint(new THREE.Vector3(x, 0, 0));
      else if (position.getY(i) > CHEVRON.top - CHEVRON.height) black.expandByPoint(new THREE.Vector3(x, 0, 0));
    }
    expect(front.max.x, `front stroke face ${front.max.x} over the board's ${black.max.x}`).toBeGreaterThan(black.max.x);
    expect(back.min.x, `back stroke face ${back.min.x} under the board's ${black.min.x}`).toBeLessThan(black.min.x);
  });
});

describe("given every chevron board of the four-count course", () => {
  it("when they are drawn, then one instanced mesh per draw cell they stand in holds them, every board once", () => {
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.fourCount));
    const boards = placeProps(track).filter((p) => p.prefab === PREFAB.chevron);
    const chevronMeshes: THREE.InstancedMesh[] = [];
    new PropTumble(boards, mats, (mesh, id) => {
      if (id === PREFAB.chevron) chevronMeshes.push(mesh);
    });
    expect(boards.length, `${boards.length} boards`).toBeGreaterThan(1);
    expect(chevronMeshes.length, "instanced meshes of the chevron prefab").toBe(new Set(boards.map((b) => drawCell(b.x, b.z))).size);
    expect(chevronMeshes.reduce((sum, mesh) => sum + mesh.count, 0), "boards in them").toBe(boards.length);
  });
});
