import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import type { Decal } from "./dummy-rig.ts";

/**
 * Fabric detail, built at boot: one tiling height map a fabric (a channel of a two-layer array texture, mipped, repeating),
 * sampled at the cloth uv in metres. The shader darkens a fabric's hollows and bends the normal along its slopes (a bump map).
 */

/** Fabrics by index: layer `index >> 2`, channel `index & 3`. HAIR is strands running down; NONE is smooth: rubber, metal, polished leather. */
export const FABRIC = { SKIN: 0, DENIM: 1, JERSEY: 2, CANVAS: 3, LEATHER: 4, WOOL: 5, COTTON: 6, TWILL: 7, HAIR: 8, NONE: 9 } as const;
/** Each fabric's registry material, by `FABRIC` index (NONE has none: a role that names no fabric names its own, `ROLE_MATERIAL`). */
export const FABRIC_MATERIAL = [MAT.DUMMY_SKIN, MAT.DENIM, MAT.KNIT, MAT.CANVAS, MAT.SHOE_LEATHER, MAT.WOOL, MAT.COTTON, MAT.TWILL, MAT.HAIR] as const;
/** Texels on a side of a fabric's tile. */
const TILE = 128;
/** Metres one tile spans on the body: denim's 16 twill lines a tile are then 2.5 mm apart, twice real, so they read at a metre. */
export const FABRIC_TILE = 0.04;
/** Each fabric's relief (m, hollow to crest: the bump's depth), by `FABRIC` index. */
export const FABRIC_RELIEF = [0.00008, 0.0003, 0.0002, 0.00025, 0.0002, 0.00012, 0.0001, 0.0002, 0.0008] as const;
/** How much darker each fabric's hollows are than its crests (a share of its colour), by `FABRIC` index. */
export const FABRIC_CONTRAST = [0.04, 0.22, 0.1, 0.16, 0.08, 0.08, 0.05, 0.12, 0.32] as const;
/** Each fabric's roughness, by `FABRIC` index, NONE last: leather a soft sheen (the reference's pumps and dress shoes read near their dark colour, not lit grey), hair a soft sheen, canvas and denim none. */
export const FABRIC_ROUGHNESS = [0.55, 0.9, 0.88, 0.92, 0.75, 0.85, 0.8, 0.75, 0.62, 0.3] as const;
/** Each fabric's share of the studio's specular reflection, by `FABRIC` index, NONE last (a role that names no fabric sets its own): skin and cloth are matte, leather keeps a sheen. */
export const FABRIC_ENV = [0.35, 0.2, 0.2, 0.2, 0.6, 0.2, 0.2, 0.2, 0.4, 1] as const;

/** A hash of lattice point (i, j) under `seed` into [0, 1). */
function hash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Value noise over a lattice of `cellsU` x `cellsV` cells that wraps with the tile. */
function noise(u: number, v: number, cellsU: number, cellsV: number, seed: number): number {
  const [x, y] = [u * cellsU, v * cellsV];
  const [i, j] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - i, y - j];
  const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const [i1, j1] = [(i + 1) % cellsU, (j + 1) % cellsV];
  const top = hash(i, j, seed) + (hash(i1, j, seed) - hash(i, j, seed)) * sx;
  const bottom = hash(i, j1, seed) + (hash(i1, j1, seed) - hash(i, j1, seed)) * sx;
  return top + (bottom - top) * sy;
}

/** The nearest and second-nearest distances (cells) to one random point a cell, over `cells` a side that wrap with the tile. */
function cellular(u: number, v: number, cells: number, seed: number): [number, number] {
  const [x, y] = [u * cells, v * cells];
  const [i, j] = [Math.floor(x), Math.floor(y)];
  let [first, second] = [Infinity, Infinity];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const [ci, cj] = [(((i + di) % cells) + cells) % cells, (((j + dj) % cells) + cells) % cells];
      const distance = Math.sqrt((i + di + hash(ci, cj, seed) - x) ** 2 + (j + dj + hash(cj, ci, seed + 1) - y) ** 2);
      if (distance < first) [first, second] = [distance, first];
      else if (distance < second) second = distance;
    }
  }
  return [first, second];
}

/** A cosine ridge: 1 at whole `t`, 0 half way between. */
const ridge = (t: number): number => 0.5 + 0.5 * Math.cos(2 * Math.PI * t);
const fract = (t: number): number => t - Math.floor(t);

/** Each fabric's height (0 hollow to 1 crest) at (u, v) in its tile, by `FABRIC` index. Whole frequencies, so every tile wraps. */
const HEIGHTS: readonly ((u: number, v: number) => number)[] = [
  (u, v) => 0.6 + 0.3 * noise(u, v, 16, 16, 1) + 0.1 * Math.min(1, cellular(u, v, 40, 2)[0] / 0.35),
  (u, v) => 0.6 * ridge(16 * (u + v)) * (0.8 + 0.2 * ridge(64 * v)) + 0.4 * noise(u, v, 32, 4, 3),
  (u, v) => {
    const across = fract(24 * u);
    return Math.sin(Math.PI * across) * (0.6 + 0.4 * ridge(32 * v + Math.abs(across - 0.5)));
  },
  (u, v) => {
    const over = (Math.floor(20 * u) + Math.floor(20 * v)) % 2 === 0;
    const [warp, weft] = [Math.sin(Math.PI * fract(20 * u)), Math.sin(Math.PI * fract(20 * v))];
    return 0.55 * (over ? warp : weft) + 0.3 * warp * weft + 0.15 * noise(u, v, 8, 64, 4);
  },
  (u, v) => {
    const [first, second] = cellular(u, v, 20, 5);
    return Math.min(1, (second - first) / 0.25) * (1 - 0.4 * first * first);
  },
  (u, v) => 0.5 * ridge(24 * (u + v)) + 0.5 * noise(u, v, 48, 48, 6),
  (u, v) => 0.4 * (ridge(32 * u) + ridge(32 * v)) + 0.2 * noise(u, v, 16, 16, 7),
  (u, v) => 0.7 * ridge(20 * (u + v)) + 0.3 * noise(u, v, 40, 8, 8),
  (u, v) => 0.15 + 0.6 * ridge(8 * u + 0.8 * noise(u, v, 4, 2, 9)) * (0.7 + 0.3 * noise(u, v, 2, 8, 12)) + 0.25 * ridge(24 * u + 0.5 * noise(u, v, 8, 4, 11)) * noise(u, v, 24, 4, 10),
];
const LAYERS = Math.ceil(HEIGHTS.length / 4);

/** Every fabric's tile, four to a layer, heights as bytes. */
export function fabricTexels(): Uint8Array {
  const texels = new Uint8Array(LAYERS * TILE * TILE * 4);
  for (const [fabric, height] of HEIGHTS.entries()) {
    const [layer, channel] = [fabric >> 2, fabric & 3];
    for (let j = 0; j < TILE; j++) {
      for (let i = 0; i < TILE; i++) texels[((layer * TILE + j) * TILE + i) * 4 + channel] = Math.round(255 * Math.min(1, Math.max(0, height(i / TILE, j / TILE))));
    }
  }
  return texels;
}

function buildFabrics(): THREE.DataArrayTexture {
  const map = new THREE.DataArrayTexture(fabricTexels(), TILE, TILE, LAYERS);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** The fabrics' heights: one texture for every slot, sampled by fabric layer and channel. */
export const FABRIC_MAP = buildFabrics();

/**
 * The decal window, in the man's rest metres: the front and the back over x, each side over z, all over y; a texel is
 * `DECAL_TEXEL` m, so a pocket's 4 mm stitch groove spans a texel. One layer an outfit, its four faces side by side.
 */
export const DECAL_HALF_X = 0.34;
export const DECAL_HALF_Z = 0.16;
export const DECAL_Y = [0.2, 1.78] as const;
const DECAL_TEXEL = 0.005;
const FRONT_TEXELS = Math.round((2 * DECAL_HALF_X) / DECAL_TEXEL);
const SIDE_TEXELS = Math.round((2 * DECAL_HALF_Z) / DECAL_TEXEL);
export const DECAL_W = 2 * FRONT_TEXELS + 2 * SIDE_TEXELS;
export const DECAL_H = Math.round((DECAL_Y[1] - DECAL_Y[0]) / DECAL_TEXEL);
/** Each face's first column in a layer, in `Decal.face` order. */
export const DECAL_FACE_AT = { "+z": 0, "-z": FRONT_TEXELS, "+x": 2 * FRONT_TEXELS, "-x": 2 * FRONT_TEXELS + SIDE_TEXELS } as const;
/** A decal texel: red the colour multiplier (128 = 1), green the height (128 flat, a step `DECAL_RAISE_STEP` m), blue the painted role (255 none), alpha its cover. */
export const DECAL_FLAT = 128;
export const DECAL_RAISE_STEP = 0.00002;
export const DECAL_NO_PAINT = 255;
/** A painted role's index reaches this many texels past its cover, so the nearest texel at a soft edge still names it. */
const PAINT_REACH = 2;

/** Cover (0..1) of `decal` at (across, y) in metres, and how far inside its outline the point is (m, negative outside). */
function coverOf(decal: Decal, across: number, y: number): [number, number] {
  const halfHeight = (decal.y1 - decal.y0) / 2;
  const along = Math.min(1, Math.max(0, (y - decal.y0) / (decal.y1 - decal.y0)));
  const halfWidth = ((decal.x1 - decal.x0) / 2) * (decal.taper + (1 - decal.taper) * along);
  const inset = (halfX: number, halfY: number): number => {
    if (halfX <= 0 || halfY <= 0) return -Infinity;
    const [dx, dy] = [Math.abs(across - (decal.x0 + decal.x1) / 2) / halfX, Math.abs(y - (decal.y0 + decal.y1) / 2) / halfY];
    const reach = decal.round > 0 ? (dx ** (2 / decal.round) + dy ** (2 / decal.round)) ** (decal.round / 2) : Math.max(dx, dy);
    return (1 - reach) * Math.min(halfX, halfY);
  };
  const outer = inset(halfWidth, halfHeight);
  const cover = Math.min(1, Math.max(0, 0.5 + outer / DECAL_TEXEL));
  if (decal.edge <= 0) return [cover, outer];
  const inner = Math.min(1, Math.max(0, 0.5 + inset(halfWidth - decal.edge, halfHeight - decal.edge) / DECAL_TEXEL));
  return [cover * (1 - inner), outer];
}

/** `decals` painted into layer `layer` of `texels` (`DECAL_W` x `DECAL_H` RGBA a layer). */
function paintLayer(texels: Uint8Array, layer: number, decals: readonly Decal[]): void {
  const base = layer * DECAL_W * DECAL_H * 4;
  for (let at = base, end = base + DECAL_W * DECAL_H * 4; at < end; at += 4) {
    texels[at] = DECAL_FLAT;
    texels[at + 1] = DECAL_FLAT;
    texels[at + 2] = DECAL_NO_PAINT;
    texels[at + 3] = 0;
  }
  for (const decal of decals) {
    const side = decal.face === "+x" || decal.face === "-x";
    const [half, columns] = side ? [DECAL_HALF_Z, SIDE_TEXELS] : [DECAL_HALF_X, FRONT_TEXELS];
    const columnOf = (across: number) => Math.floor((across + half) / DECAL_TEXEL);
    const rowOf = (y: number) => Math.floor((y - DECAL_Y[0]) / DECAL_TEXEL);
    const [c0, c1] = [Math.max(0, columnOf(decal.x0) - PAINT_REACH), Math.min(columns - 1, columnOf(decal.x1) + PAINT_REACH)];
    const [r0, r1] = [Math.max(0, rowOf(decal.y0) - PAINT_REACH), Math.min(DECAL_H - 1, rowOf(decal.y1) + PAINT_REACH)];
    for (let row = r0; row <= r1; row++) {
      for (let column = c0; column <= c1; column++) {
        const [cover, inside] = coverOf(decal, (column + 0.5) * DECAL_TEXEL - half, DECAL_Y[0] + (row + 0.5) * DECAL_TEXEL);
        const at = base + (row * DECAL_W + DECAL_FACE_AT[decal.face] + column) * 4;
        texels[at] = Math.round(Math.min(255, texels[at]! * (1 + (decal.shade - 1) * cover)));
        texels[at + 1] = Math.round(Math.min(255, Math.max(0, texels[at + 1]! + (cover * decal.raise) / DECAL_RAISE_STEP)));
        if (decal.paint < 0 || inside < -PAINT_REACH * DECAL_TEXEL) continue;
        texels[at + 2] = decal.paint;
        texels[at + 3] = Math.max(texels[at + 3]!, Math.round(255 * cover));
      }
    }
  }
}

/** Every outfit's decals, a layer each (`layers[i]` is layer i), as a mipped array texture. */
export function decalMap(layers: readonly (readonly Decal[])[]): THREE.DataArrayTexture {
  const texels = new Uint8Array(layers.length * DECAL_W * DECAL_H * 4);
  for (const [layer, decals] of layers.entries()) paintLayer(texels, layer, decals);
  const map = new THREE.DataArrayTexture(texels, DECAL_W, DECAL_H, layers.length);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}
