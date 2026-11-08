import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { once } from "../kernel/scalar.ts";
import { GROUND_LEVEL } from "../scenes/constants.ts";
import { groundMaterial } from "../scenes/ground-stack.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import type { PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { ASSET_FAMILIES, FAMILY_BASE, SCENERY_ASSETS, type AssetFamily } from "../world/scenery-assets/index.ts";
import { loadUprightBitmap } from "./bitmap-loader.ts";
import { painted, type Piece, type PrefabMaterials, type PrefabPart, type Skin } from "./prefab-pieces.ts";
import { ATLAS, type AtlasCell } from "./scenery-atlas/index.ts";
import { reliefMaterial } from "./surface-relief.ts";
import { hash01 } from "./track-mesh.ts";

/**
 * The scenery assets' drawing: one material per family (its atlas of sprites, the normal map on the relief tier) and one unit geometry per way of
 * drawing (card, cross, box, flat decal). An instance picks its sprite by two per-instance attributes (`assetRect`, `assetFit`), so a family's
 * placements in a draw cell are one draw whatever their assets.
 */

const SCENERY_URL = `${import.meta.env?.BASE_URL ?? "/"}scenery/`;
/** What a family's sprites show until its atlas arrives: a mid green-grey, opaque. */
const STAND_IN = [112, 128, 104, 255] as const;
/** Alpha below which a texel is air: a sprite's cut-out edge. */
const ALPHA_CUTOFF = 0.5;
const SPRITE_ROUGHNESS = 0.9;
const ATLAS_ANISOTROPY = 4;
/** Every sprite is shaded as foliage: a rough surface with no concrete grain laid over a photograph. */
const SPRITE_CLASS = MAT.CONIFER_FOLIAGE;
const SPRITE_WHITE = 0xffffff;

/** A sprite's brightness runs over this share of its atlas colour by placement, and its warm/cool skew up to `TINT_SKEW` either way. */
const TINT_DARKEST = 0.85;
const TINT_BRIGHTEST = 1.15;
const TINT_SKEW = 0.06;
const TINT_SALT = { brightness: 31, skew: 32 } as const;

/** A box's ends sample this share of the cell's width (a sliver of its middle, stretched over the depth) and its top this share of the cell's width and height (a patch of its middle). */
const END_STRIP = 0.04;
const TOP_PATCH = 0.2;
/** `BoxGeometry` lays four vertices a face in the order +x, -x, +y, -y, +z, -z. */
const FACE_VERTICES = 4;
const BOX_FACE = { top: 2, nearEnd: 4, farEnd: 5 } as const;

/** Per-instance attributes the sprite shader reads: the cell's rect (u, v, du, dv; v up the picture) and the factors that widen local x and z (a solid sprite is drawn wider than its collider). */
export const ASSET_RECT = "assetRect";
export const ASSET_FIT = "assetFit";
const RECT_FLOATS = 4;
const FIT_FLOATS = 2;

export function isAssetFamily(skin: Skin): skin is AssetFamily {
  return ASSET_FAMILIES.some((family) => family === skin);
}

/** The family a bare prefab is drawn in (a test or the Lab asks for no skin): the first. */
export function familyOf(skin: Skin): AssetFamily {
  return isAssetFamily(skin) ? skin : ASSET_FAMILIES[0];
}

/** Asset `asset`'s cell in its family's atlas (rows and cells run parallel). */
export function assetCell(asset: number): AtlasCell {
  const row = SCENERY_ASSETS[asset];
  const cell = row && ATLAS[row.family].cells[asset - FAMILY_BASE[row.family]];
  if (!cell) throw new Error(`scenery asset ${asset} has no atlas cell`);
  return cell;
}

/** `out` = placement `i`'s sprite tint, a deterministic brightness and skew over the atlas colour. */
export function assetTint(i: number, out: THREE.Color): void {
  const brightness = TINT_DARKEST + (TINT_BRIGHTEST - TINT_DARKEST) * hash01(i, TINT_SALT.brightness);
  const skew = (hash01(i, TINT_SALT.skew) - 0.5) * 2 * TINT_SKEW;
  out.setRGB(brightness * (1 + skew), brightness, brightness * (1 - skew), THREE.LinearSRGBColorSpace);
}

// Geometry: every one in the unit space of its prefab (origin at the foot's centre, front on +x), uv 0..1 across a quad with v up the picture.

/** A quad in the y-z plane facing +x, y from 0 to 1 and z from -0.5 to 0.5 (u runs toward -z: to the right of a viewer on +x). */
function standingQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2).translate(0, 0.5, 0);
}

const sprite = (geometry: THREE.BufferGeometry): Piece => [geometry, SPRITE_WHITE, SPRITE_CLASS];

function cardGeometry(): THREE.BufferGeometry {
  return painted([sprite(standingQuad())]);
}

function crossGeometry(): THREE.BufferGeometry {
  return painted([sprite(standingQuad()), sprite(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0))]);
}

/** A cuboid on the ground: the image on its +x and -x faces, a sliver of its middle stretched over each end, a patch of its middle on top. */
function boxGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const uv = geometry.getAttribute("uv");
  for (let v = 0; v < FACE_VERTICES; v++) {
    for (const end of [BOX_FACE.nearEnd, BOX_FACE.farEnd]) {
      const i = end * FACE_VERTICES + v;
      uv.setX(i, 0.5 + (uv.getX(i) - 0.5) * END_STRIP);
    }
    const top = BOX_FACE.top * FACE_VERTICES + v;
    uv.setXY(top, 0.5 + (uv.getX(top) - 0.5) * TOP_PATCH, 0.5 + (uv.getY(top) - 0.5) * TOP_PATCH);
  }
  return painted([sprite(geometry)]);
}

/** A quad on the ground, facing up: the picture's right on +x and its top toward -z. */
function flatGeometry(): THREE.BufferGeometry {
  return painted([sprite(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))]);
}

// Materials.

const mapsKey = (family: AssetFamily, full: boolean): string => `${family}${full ? "" : "-half"}`;
const mapUrl = (family: AssetFamily, name: string): string => `${SCENERY_URL}${family}-${name}.webp`;

const standIn = once((): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array(STAND_IN), 1, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
});

const loaded = new Map<string, THREE.Texture>();
const live = new Set<THREE.MeshStandardMaterial>();
const requested = new Set<string>();

async function loadAtlas(family: AssetFamily, full: boolean): Promise<void> {
  const key = mapsKey(family, full);
  try {
    const map = new THREE.Texture(await loadUprightBitmap(mapUrl(family, full ? "albedo" : "albedo-half")));
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = ATLAS_ANISOTROPY;
    map.needsUpdate = true;
    loaded.set(key, map);
    for (const material of live) if (material.userData.assetMaps === key) material.map = map;
  } catch (err) {
    console.error(`Crush Stream's ${family} scenery atlas did not load`, err);
  }
}

/** A family's atlas is fetched once per page and size, when its first material is made; where there is no bitmap decoder (node) the stand-in stays. */
function requestAtlas(family: AssetFamily, full: boolean): void {
  const key = mapsKey(family, full);
  if (requested.has(key) || typeof createImageBitmap !== "function") return;
  requested.add(key);
  void loadAtlas(family, full);
}

const SPRITE_VERTEX_PARS = /* glsl */ `
attribute vec4 ${ASSET_RECT};
attribute vec2 ${ASSET_FIT};`;
/** The fit widens the quad before the instance matrix scales it; the cell's rect then replaces the whole-picture uv of the colour and normal maps. */
const SPRITE_VERTEX_FIT = /* glsl */ `
transformed.xz *= ${ASSET_FIT};`;
const SPRITE_VERTEX_UV = /* glsl */ `
#ifdef USE_MAP
vMapUv = ${ASSET_RECT}.xy + uv * ${ASSET_RECT}.zw;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv = ${ASSET_RECT}.xy + uv * ${ASSET_RECT}.zw;
#endif`;
const SPRITE_PROGRAM = "asset";

/** One material of `family`: its atlas (the stand-in until it loads), the relief normal, shaded as foliage. `onGround` is the blended copy a decal wears at its place in the ground stack. */
function makeMaterial(family: AssetFamily, full: boolean, onGround: boolean): THREE.MeshStandardMaterial {
  requestAtlas(family, full);
  const key = mapsKey(family, full);
  const material = new THREE.MeshStandardMaterial(
    onGround ? { transparent: true, roughness: SPRITE_ROUGHNESS, metalness: 0 } : { alphaTest: ALPHA_CUTOFF, alphaToCoverage: true, side: THREE.DoubleSide, roughness: SPRITE_ROUGHNESS, metalness: 0 },
  );
  material.userData.assetMaps = key;
  material.map = loaded.get(key) ?? standIn();
  reliefMaterial(material, { url: mapUrl(family, "normal"), repeat: 1, clampV: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${SPRITE_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${SPRITE_VERTEX_FIT}`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>${SPRITE_VERTEX_UV}`);
  };
  material.customProgramCacheKey = () => SPRITE_PROGRAM;
  live.add(material);
  material.addEventListener("dispose", () => live.delete(material));
  tagMaterial(material, SPRITE_CLASS);
  return onGround ? groundMaterial(material, GROUND_LEVEL.decal) : material;
}

/** The materials each record has made, and the blended ground copy of each family a record's decals wear (the record itself holds the upright ones). */
const made = new WeakMap<object, THREE.Material[]>();
const groundCopies = new WeakMap<object, (family: AssetFamily) => THREE.Material>();

/** One material per family, each made (and its atlas fetched) the first time the family is read; `full` is the full-size atlas, else its half. */
export function makeAssetMaterials(full: boolean): Readonly<Record<AssetFamily, THREE.Material>> {
  const materials = {} as Record<AssetFamily, THREE.Material>;
  const own: THREE.Material[] = [];
  const grounds: Partial<Record<AssetFamily, THREE.Material>> = {};
  made.set(materials, own);
  groundCopies.set(materials, (family) => {
    if (!grounds[family]) own.push((grounds[family] = makeMaterial(family, full, true)));
    return grounds[family]!;
  });
  for (const family of ASSET_FAMILIES) {
    let material: THREE.Material | undefined;
    Object.defineProperty(materials, family, {
      enumerable: true,
      get: () => {
        if (!material) own.push((material = makeMaterial(family, full, false)));
        return material;
      },
    });
  }
  return materials;
}

/** Dispose the materials `makeAssetMaterials` made (only those read). */
export function disposeAssetMaterials(materials: PrefabMaterials["assets"]): void {
  for (const material of made.get(materials) ?? []) material.dispose();
}

// Parts and instances.

const part = (geometry: THREE.BufferGeometry, material: THREE.Material, casts: boolean): PrefabPart[] => [{ geometry, material, shared: false, shadow: casts }];

/** The parts of generic asset prefab `id` in `family` at scale 1: only the boxes cast a shadow (a sprite's depth shadow is its whole rectangle). A record not made by `makeAssetMaterials` (a test's) wears one material throughout. */
export function assetParts(id: PrefabId, family: AssetFamily, mats: PrefabMaterials): PrefabPart[] {
  switch (id) {
    case PREFAB.assetCard:
      return part(cardGeometry(), mats.assets[family], false);
    case PREFAB.assetStandee:
      return part(cardGeometry(), mats.assets[family], false);
    case PREFAB.assetCross:
      return part(crossGeometry(), mats.assets[family], false);
    case PREFAB.assetCrossSolid:
      return part(crossGeometry(), mats.assets[family], false);
    case PREFAB.assetBox:
    case PREFAB.assetBoxSolid:
      return part(boxGeometry(), mats.assets[family], true);
    case PREFAB.assetDecal:
      return part(flatGeometry(), groundCopies.get(mats.assets)?.(family) ?? mats.assets[family], false);
    case PREFAB.assetTile:
      // shortcut: tiles draw through layered textures whose loader is not in this tree: no parts, nothing drawn, until it lands.
      return [];
    default:
      throw new Error(`${id} is no scenery asset prefab`);
  }
}

function assetOf(p: Placed): number {
  if (p.asset === undefined) throw new Error(`${p.prefab} at ${p.x}, ${p.z} names no scenery asset`);
  return p.asset;
}

/**
 * A copy of `geometry` with each of `list`'s placements' (indices into `placed`) cell rect and fit as per-instance attributes, in slot order. A solid
 * sprite's collider is its opaque core, so it is drawn `1 / core` wider than the placement's width (a cross-solid's second quad too, whatever its depth).
 */
export function withAssetAttributes(geometry: THREE.BufferGeometry, placed: readonly Placed[], list: readonly number[]): THREE.BufferGeometry {
  const instanced = geometry.clone();
  const rect = new Float32Array(list.length * RECT_FLOATS);
  const fit = new Float32Array(list.length * FIT_FLOATS);
  for (const [slot, index] of list.entries()) {
    const p = placed[index]!;
    const asset = assetOf(p);
    const [left, top, width, height] = assetCell(asset).rect;
    // The atlas rect's origin is the picture's top left, GL's v runs up the picture.
    rect.set([left, 1 - top - height, width, height], slot * RECT_FLOATS);
    const widen = p.prefab === PREFAB.assetStandee || p.prefab === PREFAB.assetCrossSolid ? 1 / SCENERY_ASSETS[asset]!.core : 1;
    fit[slot * FIT_FLOATS] = p.prefab === PREFAB.assetCrossSolid ? (p.sz * widen) / p.sx : 1;
    fit[slot * FIT_FLOATS + 1] = widen;
  }
  instanced.setAttribute(ASSET_RECT, new THREE.InstancedBufferAttribute(rect, RECT_FLOATS));
  instanced.setAttribute(ASSET_FIT, new THREE.InstancedBufferAttribute(fit, FIT_FLOATS));
  return instanced;
}
