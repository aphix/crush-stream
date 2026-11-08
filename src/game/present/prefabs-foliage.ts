import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { PREFAB } from "../world/constants.ts";
import type { PrefabId } from "../world/catalog.ts";
import { box, cyl, painted, type Piece, type PrefabMaterials, type PrefabPart } from "./prefab-pieces.ts";
import { assetCell, assetTint } from "./scenery-assets-art.ts";
import { hash01 } from "./track-mesh.ts";

/** Ground cover a car drives through: a few faceted lumps (a bush) or low blooms on a soil bed (flowers). Part 0 takes the instance's tint (`foliageTint`) as its whole colour, so its vertex colours stay near white. */

const BUSH_GREENS = [0x4f8a3c, 0x3f7a35, 0x5f9a45, 0x2f6a30, 0x7a9a3a, 0x6b7f3a];
const BLOOMS = [0xd23c4b, 0xf2c400, 0xe86aa8, 0xf4f0e6, 0x7a5ad6, 0xf08a2a];
/** The share of bushes that flower (a bloom colour instead of a green). */
const FLOWERING_BUSHES = 0.18;
/** Tint hash salts: green or bloom pick, and which. */
const SALT = { flowering: 21, bloom: 22, green: 23 } as const;

const SOIL = 0x5a4030;
const LEAF = 0x4f7a3a;
const SHADE = [0xffffff, 0xdcebd2, 0xbcd4b0] as const;

/** An ellipsoid lump of radii (rx, ry, rz) centred at (x, y, z): 20 flat facets. */
function lump(rx: number, ry: number, rz: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, 0).scale(rx, ry, rz).translate(x, y, z);
}

/** A bush: a main lump with two smaller ones leaning on it, the lowest the darkest. */
export function bushParts(mats: PrefabMaterials): PrefabPart[] {
  const pieces: Piece[] = [
    [lump(0.62, 0.34, 0.6, 0, 0.18, 0), SHADE[2], MAT.CONIFER_FOLIAGE],
    [lump(0.58, 0.44, 0.56, -0.04, 0.46, 0.02), SHADE[0], MAT.CONIFER_FOLIAGE],
    [lump(0.36, 0.3, 0.34, 0.3, 0.62, -0.2), SHADE[1], MAT.CONIFER_FOLIAGE],
  ];
  return [{ geometry: painted(pieces), material: mats.plain, shared: false, shadow: false }];
}

/** Bloom positions on the bed (x, z) and their size. */
const BLOOM_SPOTS: readonly (readonly [number, number, number])[] = [
  [-0.75, -0.3, 1],
  [-0.2, 0.28, 0.9],
  [0.35, -0.25, 1.05],
  [0.8, 0.2, 0.85],
  [-0.4, -0.05, 0.8],
  [0.1, 0.02, 1],
];

/** A flower bed: blooms (part 0, the tinted one) over a soil slab studded with leaf lumps. */
export function flowerParts(mats: PrefabMaterials): PrefabPart[] {
  const blooms: Piece[] = BLOOM_SPOTS.map(([x, z, s]) => [cyl(0.1 * s, 0.2 * s, 0.14, 0.34 * s + 0.14, 5).translate(x, 0, z), 0xffffff, MAT.CONIFER_FOLIAGE]);
  const bed: Piece[] = [
    [box(2.2, 0.14, 1.2, 0, 0.07, 0), SOIL, MAT.HAY],
    [lump(0.3, 0.14, 0.3, -0.5, 0.16, 0.2), LEAF, MAT.CONIFER_FOLIAGE],
    [lump(0.3, 0.14, 0.3, 0.55, 0.16, -0.1), LEAF, MAT.CONIFER_FOLIAGE],
  ];
  return [
    { geometry: painted(blooms), material: mats.plain, shared: false, shadow: false },
    { geometry: painted(bed), material: mats.plain, shared: false, shadow: false },
  ];
}

/** Placement `i`'s tint, when `id` is ground cover (a pure function of the index, so the poof's leaves match what was drawn); false: not ours. */
export function foliageTint(id: PrefabId, i: number, out: THREE.Color): boolean {
  if (id !== PREFAB.bush && id !== PREFAB.flowers) return false;
  const flowering = id === PREFAB.flowers || hash01(i, SALT.flowering) < FLOWERING_BUSHES;
  const palette = flowering ? BLOOMS : BUSH_GREENS;
  out.setHex(palette[Math.floor(hash01(i, flowering ? SALT.bloom : SALT.green) * palette.length)]!);
  return true;
}

const _variation = new THREE.Color();

/** `out` = the leaf colour of plant asset `asset` standing as placement `i`: its atlas cell's mean colour, shaded as the drawn sprite is (a pure function of the two, so the poof's leaves match what was drawn). */
export function assetLeafTint(asset: number, i: number, out: THREE.Color): void {
  out.setHex(assetCell(asset).tint);
  assetTint(i, _variation);
  out.multiply(_variation);
}
