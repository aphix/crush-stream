import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import { streetSignNames } from "../world/street-kit.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { WHITE } from "./openworld-shop-signs.ts";
import { STREET_SIGN } from "./prefabs-street.ts";

/** Texels of one printed name: 500 x 100 px for a 0.9 x 0.18 m blade face, about 555 px a metre, crisp at arm's length (the street atlas gave a sign's card 64 px). */
const CELL_WIDTH = 500;
const CELL_HEIGHT = 100;
/** Texels between cells: mip levels would blend a neighbour's colour into a name's edge. */
const CELL_GUTTER = 4;
/** Two cells a row; the atlas stays inside the scenery families' 1024 px a side. */
const ATLAS_WIDTH = 1024;
const ATLAS_ANISOTROPY = 8;
/** The printed face stands this far (m) off its blade's face, and the depth offset settles the rest. */
const FACE_STANDOFF = 0.001;
/** Philadelphia's street blades: white capitals and a white keyline on blue. */
const BLADE_FILL = "#1f56a6";
const BLADE_INK = WHITE;
const KEYLINE_PX = 4;
const KEYLINE_INSET = 8;
const NAME_PX = 58;
const NAME_MARGIN = 22;
/** A sign has no gloss: painted aluminium. */
const BLADE_ROUGHNESS = 0.55;

/** A placed street sign: its foot, its turn and the two names its blades show (along its x, along its z). */
type StreetSign = { x: number; y: number; z: number; yaw: number; alongX: string; alongZ: string };

/** Where a name is printed in the atlas (px, top left). */
type NameCell = { x: number; y: number };

/** The atlas: each name's cell and the canvas size. */
export type NameAtlas = { cells: ReadonlyMap<string, NameCell>; width: number; height: number };

/** One printed face: the name it carries, its middle, its outward normal and the direction its text runs (to a reader facing it, rightward), and its atlas rect [u0, v0, u1, v1] (v up). */
type BladeFace = { name: string; x: number; y: number; z: number; normalX: number; normalZ: number; rightX: number; rightZ: number; uv: readonly [number, number, number, number] };

/** What the atlas is painted with: a 2D canvas context's text and rectangle calls. */
export type NamePainter = Pick<CanvasRenderingContext2D, "fillStyle" | "strokeStyle" | "lineWidth" | "font" | "textAlign" | "textBaseline" | "fillRect" | "strokeRect" | "fillText">;

/** The street signs among `placed` whose style names two streets. */
export function streetSignsOf(placed: readonly Placed[]): StreetSign[] {
  const signs: StreetSign[] = [];
  for (const p of placed) {
    if (p.prefab !== PREFAB.streetSign) continue;
    const names = streetSignNames(p.style);
    if (names !== null) signs.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, alongX: names[0], alongZ: names[1] });
  }
  return signs;
}

/** A cell for every name the signs carry, in rows of two. */
export function nameAtlas(signs: readonly StreetSign[]): NameAtlas {
  const cells = new Map<string, NameCell>();
  const perRow = Math.floor((ATLAS_WIDTH + CELL_GUTTER) / (CELL_WIDTH + CELL_GUTTER));
  for (const sign of signs) {
    for (const name of [sign.alongX, sign.alongZ]) {
      if (cells.has(name)) continue;
      const index = cells.size;
      cells.set(name, { x: (index % perRow) * (CELL_WIDTH + CELL_GUTTER), y: Math.floor(index / perRow) * (CELL_HEIGHT + CELL_GUTTER) });
    }
  }
  const rows = Math.ceil(cells.size / perRow);
  return { cells, width: ATLAS_WIDTH, height: THREE.MathUtils.ceilPowerOfTwo(Math.max(1, rows * (CELL_HEIGHT + CELL_GUTTER))) };
}

/** Every name on its blue cell, in capitals, squeezed to the cell's width when long. */
export function paintNames(g: NamePainter, atlas: NameAtlas): void {
  for (const [name, cell] of atlas.cells) {
    g.fillStyle = BLADE_FILL;
    g.fillRect(cell.x, cell.y, CELL_WIDTH, CELL_HEIGHT);
    g.strokeStyle = BLADE_INK;
    g.lineWidth = KEYLINE_PX;
    g.strokeRect(cell.x + KEYLINE_INSET, cell.y + KEYLINE_INSET, CELL_WIDTH - 2 * KEYLINE_INSET, CELL_HEIGHT - 2 * KEYLINE_INSET);
    g.fillStyle = BLADE_INK;
    g.font = `bold ${NAME_PX}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(name.toUpperCase(), cell.x + CELL_WIDTH / 2, cell.y + CELL_HEIGHT / 2, CELL_WIDTH - 2 * NAME_MARGIN);
  }
}

function uvOf(atlas: NameAtlas, name: string): readonly [number, number, number, number] {
  const cell = atlas.cells.get(name)!;
  return [cell.x / atlas.width, 1 - (cell.y + CELL_HEIGHT) / atlas.height, (cell.x + CELL_WIDTH) / atlas.width, 1 - cell.y / atlas.height];
}

/** Both faces of both blades of every sign: the blade along the sign's x shows `alongX`, the one along z `alongZ`, each name readable from either side. */
export function bladeFaces(signs: readonly StreetSign[], atlas: NameAtlas): BladeFace[] {
  const faces: BladeFace[] = [];
  const out = STREET_SIGN.bladeThickness / 2 + FACE_STANDOFF;
  for (const sign of signs) {
    const cos = detCos(sign.yaw);
    const sin = detSin(sign.yaw);
    // The blade along local x faces local ±z = ±(sin, cos); the one along local z faces local ±x = ±(cos, -sin).
    const blades = [
      { name: sign.alongX, height: STREET_SIGN.alongXHeight, normalX: sin, normalZ: cos },
      { name: sign.alongZ, height: STREET_SIGN.alongZHeight, normalX: cos, normalZ: -sin },
    ];
    for (const blade of blades) {
      for (const side of [1, -1]) {
        const normalX = side * blade.normalX;
        const normalZ = side * blade.normalZ;
        faces.push({ name: blade.name, x: sign.x + normalX * out, y: sign.y + blade.height, z: sign.z + normalZ * out, normalX, normalZ, rightX: normalZ, rightZ: -normalX, uv: uvOf(atlas, blade.name) });
      }
    }
  }
  return faces;
}

/** The faces as one quad each, wound to face their normal. */
function facesGeometry(faces: readonly BladeFace[]): THREE.BufferGeometry {
  const halfLength = STREET_SIGN.bladeLength / 2;
  const halfHeight = STREET_SIGN.bladeHeight / 2;
  const positions = new Float32Array(faces.length * 12);
  const normals = new Float32Array(faces.length * 12);
  const uvs = new Float32Array(faces.length * 8);
  const indices = new Uint16Array(faces.length * 6);
  for (let at = 0; at < faces.length; at++) {
    const face = faces[at]!;
    const [u0, v0, u1, v1] = face.uv;
    const rx = face.rightX * halfLength;
    const rz = face.rightZ * halfLength;
    const bottom = face.y - halfHeight;
    const top = face.y + halfHeight;
    positions.set([face.x - rx, bottom, face.z - rz, face.x + rx, bottom, face.z + rz, face.x + rx, top, face.z + rz, face.x - rx, top, face.z - rz], at * 12);
    for (let corner = 0; corner < 4; corner++) normals.set([face.normalX, 0, face.normalZ], at * 12 + corner * 3);
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], at * 8);
    indices.set([at * 4, at * 4 + 1, at * 4 + 2, at * 4, at * 4 + 2, at * 4 + 3], at * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/**
 * The street names on the street signs' blades, printed from text (the shop signs' way: a canvas atlas, one texture), one mesh and one draw call for the course.
 * The blades themselves are the `street-sign` prefab's.
 */
export class StreetNameBlades {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;

  /** The names of `placed`'s street signs, null when it has none. */
  static of(placed: readonly Placed[]): StreetNameBlades | null {
    const signs = streetSignsOf(placed);
    return signs.length === 0 ? null : new StreetNameBlades(signs);
  }

  private constructor(signs: readonly StreetSign[]) {
    const atlas = nameAtlas(signs);
    const canvas = document.createElement("canvas");
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    paintNames(canvas.getContext("2d")!, atlas);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = ATLAS_ANISOTROPY;
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, roughness: BLADE_ROUGHNESS, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mesh = new THREE.Mesh(facesGeometry(bladeFaces(signs, atlas)), this.material);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
