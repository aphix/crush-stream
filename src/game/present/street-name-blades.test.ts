import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { streetSignStyle } from "../world/street-kit.ts";
import { PREFAB } from "../world/constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-constants.ts";
import { placeCourse, type Placed } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";
import { STREET_SIGN } from "./prefabs-street.ts";
import { bladeFaces, nameAtlas, paintNames, streetSignsOf, type NameAtlas, type NamePainter } from "./street-name-blades.ts";
import { TrackArt } from "./track-art.ts";

/** Slack on a face's coordinates and uv: float rounding. */
const SLACK = 1e-9;
/** The faces of a street sign: two blades, each printed on both sides. */
const FACES_PER_SIGN = 4;

const sign = (x: number, z: number, yaw: number, alongX: string, alongZ: string): Placed => ({ prefab: PREFAB.streetSign, x, y: 0, z, yaw, sx: 1, sy: 1, sz: 1, style: streetSignStyle(alongX, alongZ) });

/** A painter that keeps every name it prints and where. */
class PrintedNames {
  fillStyle: NamePainter["fillStyle"] = "";
  strokeStyle: NamePainter["strokeStyle"] = "";
  lineWidth = 1;
  font = "";
  textAlign: NamePainter["textAlign"] = "start";
  textBaseline: NamePainter["textBaseline"] = "alphabetic";
  readonly printed: { text: string; x: number; y: number; maxWidth: number }[] = [];
  fillRect(): void {}
  strokeRect(): void {}
  fillText(text: string, x: number, y: number, maxWidth = Infinity): void {
    this.printed.push({ text, x, y, maxWidth });
  }
}

/** The atlas cell (px) a face's uv rect covers. */
function cellOfUv(atlas: NameAtlas, uv: readonly [number, number, number, number]): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: uv[0] * atlas.width, x1: uv[2] * atlas.width, y0: (1 - uv[3]) * atlas.height, y1: (1 - uv[1]) * atlas.height };
}

describe("given two street signs, one turned, sharing a street", () => {
  const placed = [sign(4, -3, 0, "Moore St", "10th St"), sign(-20, 7, Math.PI / 2, "Moore St", "9th St"), { ...sign(0, 0, 0, "x", "y"), prefab: PREFAB.lamp }];
  const signs = streetSignsOf(placed);
  const atlas = nameAtlas(signs);
  const faces = bladeFaces(signs, atlas);
  const painter = new PrintedNames();
  paintNames(painter, atlas);

  // mutation: sed -i 's/      { name: sign.alongX, height: STREET_SIGN.alongXHeight, normalX: sin, normalZ: cos },/      { name: sign.alongZ, height: STREET_SIGN.alongXHeight, normalX: sin, normalZ: cos },/' src/game/present/street-name-blades.ts
  // mutation: sed -i 's/      for (const side of \[1, -1\]) {/      for (const side of [1]) {/' src/game/present/street-name-blades.ts
  it("when their blades are printed, then each blade carries its street's name on both faces, the faces back to back and each reading left to right", () => {
    expect(signs.length, "street signs read (not the lamp)").toBe(2);
    expect(atlas.cells.size, "names printed once each").toBe(3);
    expect(faces.length, "faces").toBe(signs.length * FACES_PER_SIGN);
    for (const [index, placedSign] of signs.entries()) {
      const own = faces.slice(index * FACES_PER_SIGN, (index + 1) * FACES_PER_SIGN);
      // The blade along the sign's own x faces its local z: (sin yaw, cos yaw).
      const localZ = [detSin(placedSign.yaw), detCos(placedSign.yaw)] as const;
      for (const face of own) {
        const facesLocalZ = Math.abs(face.normalX * localZ[0] + face.normalZ * localZ[1]) > 1 - SLACK;
        expect(face.name, `the name on a face along local ${facesLocalZ ? "x" : "z"}`).toBe(facesLocalZ ? placedSign.alongX : placedSign.alongZ);
        expect(face.y, "the blade's height").toBeCloseTo(placedSign.y + (facesLocalZ ? STREET_SIGN.alongXHeight : STREET_SIGN.alongZHeight), 9);
        const cell = atlas.cells.get(face.name)!;
        const rect = cellOfUv(atlas, face.uv);
        expect([rect.x0 - cell.x, rect.y0 - cell.y].map((gap) => Math.abs(gap) < SLACK).join(), "the face's uv is its name's cell").toBe("true,true");
        // A reader facing the face (looking along -normal) has the text running to their right: right = up x normal.
        expect(face.rightX * face.normalZ - face.rightZ * face.normalX, "the text runs to the reader's right").toBeCloseTo(face.normalZ * face.normalZ + face.normalX * face.normalX, 9);
      }
      for (const name of [placedSign.alongX, placedSign.alongZ]) {
        const pair = own.filter((face) => face.name === name);
        expect(pair.length, `faces carrying ${name}`).toBe(2);
        expect(pair[0]!.normalX + pair[1]!.normalX, `${name}'s faces back to back (x)`).toBeCloseTo(0, 9);
        expect(pair[0]!.normalZ + pair[1]!.normalZ, `${name}'s faces back to back (z)`).toBeCloseTo(0, 9);
      }
    }
  });

  // mutation: sed -i 's/    g.fillText(name.toUpperCase(), cell.x + CELL_WIDTH \/ 2, cell.y + CELL_HEIGHT \/ 2, CELL_WIDTH - 2 \* NAME_MARGIN);/    g.fillText(name.toUpperCase(), cell.x, cell.y + CELL_HEIGHT * 2, CELL_WIDTH);/' src/game/present/street-name-blades.ts
  it("when the atlas is painted, then each name is printed in capitals inside its own cell, squeezed to fit it", () => {
    expect(painter.printed.length, "names printed").toBe(atlas.cells.size);
    for (const [name, cell] of atlas.cells) {
      const print = painter.printed.find((entry) => entry.text === name.toUpperCase());
      expect(print, `${name} printed`).toBeDefined();
      const rect = cellOfUv(atlas, faces.find((face) => face.name === name)!.uv);
      expect(print!.x > rect.x0 && print!.x < rect.x1 && print!.y > rect.y0 && print!.y < rect.y1, `${name} printed inside its cell at ${cell.x}, ${cell.y}`).toBe(true);
      expect(print!.maxWidth, `${name}'s width kept inside its cell (px)`).toBeLessThan(rect.x1 - rect.x0);
    }
  });
});

describe("given the open world's course drawn", () => {
  // mutation: sed -i 's/    if (this.streetNames !== null) this.add(this.streetNames.mesh, { kind: "prop", prefab: PREFAB.streetSign }, false);//' src/game/present/track-art.ts
  it("when its art is built, then every kit piece is drawn by one instanced mesh per part of its prefab, and the street names by one mesh of four faces a sign", () => {
    stubBrowser();
    const track = new Track(OFF_MENU.find((json) => parseTrack(json).id === OPENWORLD_ID)!);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const plain = plainMaterials(new THREE.MeshBasicMaterial());
    const kinds = [PREFAB.bench, PREFAB.bikeRack, PREFAB.litterBin, PREFAB.parkingMeter, PREFAB.hydrant, PREFAB.cafeSet, PREFAB.busShelter, PREFAB.busStopSign, PREFAB.streetSign];
    const meshes = new Map<string, THREE.Mesh[]>();
    art.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const list = meshes.get(object.name) ?? [];
      list.push(object);
      meshes.set(object.name, list);
    });
    for (const kind of kinds) {
      const placedCount = course.placed.filter((prop) => prop.prefab === kind).length;
      const drawn = (meshes.get(`prop:${kind}`) ?? []).filter((mesh): mesh is THREE.InstancedMesh => mesh instanceof THREE.InstancedMesh);
      expect(placedCount, `${kind} placed`).toBeGreaterThan(0);
      expect(drawn.length, `${kind}'s instanced meshes: one a part of its prefab (a bike rack's spokes are its second)`).toBe(prefabParts(kind, plain).length);
      for (const mesh of drawn) expect(mesh.count, `${kind}'s instances`).toBe(placedCount);
    }
    const names = (meshes.get(`prop:${PREFAB.streetSign}`) ?? []).filter((mesh) => !(mesh instanceof THREE.InstancedMesh));
    expect(names.length, "the street names' mesh").toBe(1);
    const signCount = course.placed.filter((prop) => prop.prefab === PREFAB.streetSign).length;
    expect(names[0]!.geometry.getIndex()!.count / 6, "printed faces").toBe(signCount * FACES_PER_SIGN);
    art.dispose();
  });
});
