import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { once } from "../kernel/scalar.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import type { PrefabId } from "../world/catalog.ts";
import { type BiomeId, PREFAB } from "../world/constants.ts";
import { loadUprightBitmap } from "./bitmap-loader.ts";
import { hash01 } from "./track-mesh.ts";

/**
 * The building styles: one shared material each (albedo, normal and window-glow maps from `public/facades/`, packed by
 * `scripts/pack-facades.mjs`), so a draw cell's buildings cost one draw per style on it. A style's tile is one bay across and the whole
 * face tall; `building()` in prefabs.ts lays it `bays` times across a face.
 * shortcut: a draw per style per cell; a texture array with a per-instance style index makes it one, when the bench says draws limit.
 */

/** Weathered pastel stucco (pink, mint, ochre, sky, cream, terracotta, lilac): the Havana blocks and walls. */
export const PASTELS = [0xf3c6c0, 0xbfe0d0, 0xf2d9a0, 0xb8d4ea, 0xf0e2cb, 0xe8b9a0, 0xd9c8e6];

type StyleSpec = {
  /** Tiles across a 11.8 m face. */
  bays: number;
  /** A bare patch of wall in the tile (u, v up), for the roof slab to sample. */
  plain: readonly [number, number];
  roughness: number;
  metalness: number;
  /** Per-instance colours the style is multiplied by (the albedo is already coloured, so they stay near white). */
  tints: readonly number[];
  /** Share of a biome's buildings drawn in this style (weights). */
  mix: Readonly<Record<BiomeId, number>>;
  /** The building prefab this is the look of when no style is named. */
  home: PrefabId | null;
  /** Weights of the roof coverings on its buildings, in `ROOF_KINDS` order: tar, clay tile, slate, copper, corrugated metal. */
  roofs: readonly [number, number, number, number, number];
};

export const FACADE = {
  prague: { bays: 4, plain: [0.941, 0.753], roughness: 0.8, metalness: 0.05, tints: [0xffffff, 0xf6ecd8, 0xe9eef4, 0xf4e0d2, 0xecebdc], mix: { city: 3, park: 0, desert: 0, dirt: 0, circuit: 0, none: 1 }, home: null, roofs: [0, 1, 1, 3, 0] },
  dc: { bays: 4, plain: [0.27, 0.12], roughness: 0.85, metalness: 0.03, tints: [0xffffff, 0xf0d8c8, 0xd8c0b0, 0xffe6d0, 0xc9b8aa], mix: { city: 2, park: 2, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: PREFAB.building, roofs: [2, 1, 3, 0, 0] },
  stucco: { bays: 4, plain: [0.176, 0.46], roughness: 0.9, metalness: 0.03, tints: PASTELS, mix: { city: 0, park: 0, desert: 2, dirt: 1, circuit: 0, none: 0 }, home: PREFAB.stucco, roofs: [1, 4, 0, 0, 0] },
  glass: { bays: 4, plain: [0.566, 0.948], roughness: 0.4, metalness: 0.2, tints: [0xffffff, 0xcfe4f0, 0xe0e8e0, 0xbcd4e4, 0xf0f0f4], mix: { city: 3, park: 0, desert: 0, dirt: 0, circuit: 3, none: 0 }, home: null, roofs: [3, 0, 0, 0, 1] },
  adobe: { bays: 2, plain: [0.441, 0.803], roughness: 0.95, metalness: 0.02, tints: [0xffffff, 0xf0dcc0, 0xe0c8a8, 0xffe4cc, 0xd8c0a0], mix: { city: 0, park: 0, desert: 5, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [1, 0, 0, 0, 0] },
  shops: { bays: 4, plain: [0.207, 0.222], roughness: 0.8, metalness: 0.05, tints: PASTELS, mix: { city: 3, park: 1, desert: 0, dirt: 0, circuit: 1, none: 1 }, home: null, roofs: [2, 2, 1, 0, 0] },
  baroque: { bays: 4, plain: [0.051, 0.987], roughness: 0.85, metalness: 0.03, tints: [0xffffff, 0xf6ecd8, 0xf4e0d2, 0xe9eef4, 0xecebdc], mix: { city: 2, park: 0, desert: 0, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [0, 4, 0, 1, 0] },
  havana: { bays: 4, plain: [0.879, 0.761], roughness: 0.9, metalness: 0.03, tints: [0xffffff, 0xeaf5f0, 0xd8efe8, 0xf0d0d8, 0xd0e0f0], mix: { city: 1, park: 0, desert: 1, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [1, 5, 0, 0, 0] },
  federal: { bays: 4, plain: [0.441, 0.741], roughness: 0.85, metalness: 0.04, tints: [0xffffff, 0xf4efe4, 0xe8e8ec, 0xf0e8d8, 0xe0e4e4], mix: { city: 0, park: 0, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: null, roofs: [1, 0, 2, 2, 0] },
  warehouse: { bays: 4, plain: [0.77, 0.05], roughness: 0.9, metalness: 0.1, tints: [0xffffff, 0xe8d8d0, 0xd8c8c0, 0xf0e0d0, 0xc8c0b8], mix: { city: 0, park: 0, desert: 0, dirt: 4, circuit: 2, none: 0 }, home: null, roofs: [1, 0, 0, 0, 4] },
  farm: { bays: 4, plain: [0.191, 0.05], roughness: 0.92, metalness: 0.02, tints: [0xffffff, 0xf0d8d0, 0xe0c0a8, 0xd0b8a0, 0xb8c0c8], mix: { city: 0, park: 3, desert: 0, dirt: 2, circuit: 0, none: 0 }, home: null, roofs: [0, 1, 0, 0, 3] },
  rowhouse: { bays: 4, plain: [0.332, 0.726], roughness: 0.8, metalness: 0.03, tints: PASTELS, mix: { city: 3, park: 1, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: null, roofs: [2, 3, 3, 0, 0] },
} as const satisfies Record<string, StyleSpec>;

export type FacadeStyle = keyof typeof FACADE;
const FACADE_STYLES = Object.keys(FACADE) as FacadeStyle[];

/** The building's roofline (m): a facade tile spans the ground to here, the roof slab's underside. */
export const ROOFLINE = 13.5;

/** World metres one roof tile of the atlas spans on a roof slab (`prefabs.ts` lays the slab's top in them). */
export const ROOF_TILE_M = 2.4;
/** Metres a roof may be raised over the collider's top, picked per building: a taller parapet drawn on the 14 m block, nothing the sim reads. */
const ROOF_LIFTS = [0, 0, 0.7, 1.4, 2.8];
/** Atlas cells across and up, the share of a cell's edge kept clear of its neighbours' bleed, and the coarsest mip (texels) a far roof samples. */
const ROOF_CELLS = [3, 2] as const;
const ROOF_PAD = 0.01;
const ROOF_MIP_TEXELS = 32;

/** The share of a style's windows lit at full night. */
const LIT_SHARE = 0.6;
const WINDOW_LIGHT = 0xffb35e;
const WINDOW_LIGHT_INTENSITY = 1.3;

/** How far the windows are lit, 0 (day) to 1 (night): one uniform every style's material shares, set by `WorldStage.apply` beside the lamp heads. */
export const FACADE_GLOW = { value: 0 };

/** `out` = the tint number `h` (0..1) picks among `style`'s. */
export function facadeTint(style: FacadeStyle, h: number, out: THREE.Color): void {
  const tints = FACADE[style].tints;
  out.setHex(tints[Math.floor(h * tints.length)]!);
}

/** The style a building prefab stands in when none is named (the one whose `home` it is); null for a prefab that is no building. */
export function homeStyle(prefab: PrefabId): FacadeStyle | null {
  return FACADE_STYLES.find((style) => FACADE[style].home === prefab) ?? null;
}

/** The style prefab `prefab` stands in at (x, z) in `biome`: only a `building` is picked by its position (so a row's neighbours differ and no placement moves another's); any other prefab has its home style, or none. */
export function facadeStyle(prefab: PrefabId, x: number, z: number, biome: BiomeId): FacadeStyle | null {
  if (prefab !== PREFAB.building) return homeStyle(prefab);
  let pick = hash01(Math.round(x) * 7919 + Math.round(z) * 104729, 31) * FACADE_STYLES.reduce((sum, style) => sum + FACADE[style].mix[biome], 0);
  for (const style of FACADE_STYLES) {
    pick -= FACADE[style].mix[biome];
    if (pick < 0) return style;
  }
  return homeStyle(prefab);
}

type Maps = { albedo: THREE.Texture; normal: THREE.Texture; glow: THREE.Texture };

function dataTexture(r: number, g: number, b: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** What a style shows until its maps arrive: a plain cream wall, flat, unlit (DOM-free, so a test builds the materials too). */
const standIn = once((): Maps => ({ albedo: dataTexture(205, 200, 190, THREE.SRGBColorSpace), normal: dataTexture(128, 128, 255, THREE.NoColorSpace), glow: dataTexture(0, 0, 0, THREE.NoColorSpace) }));

const loaded: Partial<Record<FacadeStyle, Maps>> = {};
const live = new Set<THREE.MeshStandardMaterial>();
const requested = new Set<FacadeStyle>();
const MAPS_URL = `${import.meta.env?.BASE_URL ?? "/"}facades/`;

/** Where style `style`'s `kind` map is served from. */
export const facadeMapUrl = (style: FacadeStyle, kind: "albedo" | "normal" | "glow"): string => `${MAPS_URL}${style}-${kind}.webp`;

function mapOf(bitmap: ImageBitmap, colorSpace: THREE.ColorSpace, anisotropy: number): THREE.Texture {
  const tex = new THREE.Texture(bitmap);
  tex.wrapS = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.colorSpace = colorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function show(material: THREE.MeshStandardMaterial, maps: Maps): void {
  material.map = maps.albedo;
  material.normalMap = maps.normal;
  material.emissiveMap = maps.glow;
}

async function loadStyle(style: FacadeStyle): Promise<void> {
  try {
    const [albedo, normal, glow] = await Promise.all([
      loadUprightBitmap(facadeMapUrl(style, "albedo")),
      loadUprightBitmap(facadeMapUrl(style, "normal")),
      loadUprightBitmap(facadeMapUrl(style, "glow")),
    ]);
    const maps = { albedo: mapOf(albedo, THREE.SRGBColorSpace, 8), normal: mapOf(normal, THREE.NoColorSpace, 4), glow: mapOf(glow, THREE.NoColorSpace, 4) };
    loaded[style] = maps;
    for (const material of live) if (material.userData.facadeStyle === style) show(material, maps);
  } catch (err) {
    console.error(`Crush Stream's ${style} facade maps did not load`, err);
  }
}

/** A style's maps are fetched once per page, when the first material of the style is made (a course fetches the styles it draws); where there is no bitmap decoder (node) the stand-ins stay. */
function requestStyle(style: FacadeStyle): void {
  if (requested.has(style) || typeof createImageBitmap !== "function") return;
  requested.add(style);
  void loadStyle(style);
}

const ROOF_ALBEDO = { value: new THREE.Texture() };
const ROOF_NORMAL = { value: new THREE.Texture() };
const ROOF_URL = `${MAPS_URL}roofs-`;

/** The atlas's two maps, fetched once per page by the first facade material; until they arrive a roof is a plain brown with a flat normal (and in node it stays so). */
const requestRoofs = once((): void => {
  ROOF_ALBEDO.value = dataTexture(110, 92, 78, THREE.SRGBColorSpace);
  ROOF_NORMAL.value = dataTexture(128, 128, 255, THREE.NoColorSpace);
  if (typeof createImageBitmap !== "function") return;
  void (async () => {
    try {
      const [albedo, normal] = await Promise.all([loadUprightBitmap(`${ROOF_URL}albedo.webp`), loadUprightBitmap(`${ROOF_URL}normal.webp`)]);
      for (const [uniform, bitmap, colorSpace] of [[ROOF_ALBEDO, albedo, THREE.SRGBColorSpace], [ROOF_NORMAL, normal, THREE.NoColorSpace]] as const) {
        const tex = new THREE.Texture(bitmap);
        tex.flipY = false;
        tex.colorSpace = colorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        uniform.value = tex;
      }
    } catch (err) {
      console.error("Crush Stream's roof maps did not load", err);
    }
  })();
});

/**
 * The glow map's R is the window, its G the window's turn-on threshold: a window lights once `FACADE_GLOW` passes its threshold, shifted by a seed
 * per building face. A roof top (the vertices of class `BUILDING_ROOF`) takes its colour and normal from the roof atlas instead, one covering per
 * building by the same seed, and the top of the slab is raised by a per-building lift.
 */
const WINDOW_VERTEX = /* glsl */ `
varying float vFacadeSeed;`;
const WINDOW_SEED = /* glsl */ `
#ifdef USE_INSTANCING
float facadeBuilding = fract(dot(instanceMatrix[3].xz, vec2(0.0791, 0.1137)));
vFacadeSeed = fract(facadeBuilding + dot(objectNormal.xz, vec2(0.37, 0.61)));
const float facadeLifts[5] = float[5](${ROOF_LIFTS.map((m) => m.toFixed(1)).join(", ")});
transformed.y += facadeLifts[int(fract(facadeBuilding * 5.7 + 0.3) * 5.0)] * step(13.9, transformed.y);
#else
vFacadeSeed = 0.0;
#endif`;
const WINDOW_FRAGMENT = /* glsl */ `
uniform float facadeGlow;
uniform float facadeRoofMix[4];
uniform sampler2D facadeRoofAlbedo;
uniform sampler2D facadeRoofNormal;
varying float vFacadeSeed;`;
const ROOF_CELL = /* glsl */ `vec2(${ROOF_CELLS[0]}.0, ${ROOF_CELLS[1]}.0)`;
const ROOF_INNER = (1 - 2 * ROOF_PAD).toFixed(4);
const WINDOW_COLOR = /* glsl */ `
bool facadeRoof = int(vMaterialAttribute + 0.5) == ${MAT.BUILDING_ROOF};
float facadePick = fract(vFacadeSeed * 7.31 + 0.17);
float facadeKind = step(facadeRoofMix[0], facadePick) + step(facadeRoofMix[1], facadePick) + step(facadeRoofMix[2], facadePick) + step(facadeRoofMix[3], facadePick);
vec2 facadeRoofCell = vec2(mod(facadeKind, ${ROOF_CELLS[0]}.0), floor(facadeKind / ${ROOF_CELLS[0]}.0));
vec2 facadeRoofUv = (facadeRoofCell + fract(vMapUv) * ${ROOF_INNER} + ${ROOF_PAD}) / ${ROOF_CELL};
vec2 facadeRoofGrad = vec2(${ROOF_MIP_TEXELS}.0) / (${ROOF_CELL} * vec2(256.0));
vec2 facadeRoofDx = clamp(dFdx(vMapUv) * ${ROOF_INNER} / ${ROOF_CELL}, -facadeRoofGrad, facadeRoofGrad);
vec2 facadeRoofDy = clamp(dFdy(vMapUv) * ${ROOF_INNER} / ${ROOF_CELL}, -facadeRoofGrad, facadeRoofGrad);
if (facadeRoof) diffuseColor.rgb = textureGrad(facadeRoofAlbedo, facadeRoofUv, facadeRoofDx, facadeRoofDy).rgb * (0.88 + 0.24 * fract(vFacadeSeed * 3.1));`;
const WINDOW_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
if (facadeRoof) normal = normalize(tbn * (textureGrad(facadeRoofNormal, facadeRoofUv, facadeRoofDx, facadeRoofDy).xyz * 2.0 - 1.0));
#endif`;
const WINDOW_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
vec2 facadeWindow = texture2D(emissiveMap, vEmissiveMapUv).rg;
float facadeOn = step(fract(facadeWindow.g + vFacadeSeed), facadeGlow * ${LIT_SHARE.toFixed(2)});
totalEmissiveRadiance *= smoothstep(0.3, 0.7, facadeWindow.r) * facadeOn * float(!facadeRoof);
#endif`;

/** The cumulative first four of a style's roof weights over their sum: where a building's seed switches from one covering to the next. */
function roofEdges(style: FacadeStyle): number[] {
  const weights: readonly number[] = FACADE[style].roofs;
  const total = weights.reduce((sum, w) => sum + w, 0);
  let run = 0;
  return weights.slice(0, 4).map((w) => (run += w) / total);
}

/** One material of `style`: its maps (stand-ins until they load), the windows' glow, tagged as concrete. */
function makeFacadeMaterial(style: FacadeStyle): THREE.MeshStandardMaterial {
  requestStyle(style);
  requestRoofs();
  const { roughness, metalness } = FACADE[style];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, emissive: WINDOW_LIGHT, emissiveIntensity: WINDOW_LIGHT_INTENSITY });
  material.userData.facadeStyle = style;
  show(material, loaded[style] ?? standIn());
  const edges = roofEdges(style);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.facadeGlow = FACADE_GLOW;
    shader.uniforms.facadeRoofMix = { value: edges };
    shader.uniforms.facadeRoofAlbedo = ROOF_ALBEDO;
    shader.uniforms.facadeRoofNormal = ROOF_NORMAL;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${WINDOW_VERTEX}`).replace("#include <begin_vertex>", `#include <begin_vertex>${WINDOW_SEED}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${WINDOW_FRAGMENT}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${WINDOW_COLOR}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${WINDOW_NORMAL}`)
      .replace("#include <emissivemap_fragment>", WINDOW_EMISSIVE);
  };
  material.customProgramCacheKey = () => "facade";
  live.add(material);
  material.addEventListener("dispose", () => live.delete(material));
  return tagMaterial(material, MAT.CONCRETE);
}

/** The materials each facade record has made, so a record's owner can dispose just those. */
const made = new WeakMap<object, THREE.MeshStandardMaterial[]>();

/** One material per style, each made (and its maps fetched) the first time the style is read. */
export function makeFacadeMaterials(): Record<FacadeStyle, THREE.MeshStandardMaterial> {
  const materials = {} as Record<FacadeStyle, THREE.MeshStandardMaterial>;
  const own: THREE.MeshStandardMaterial[] = [];
  made.set(materials, own);
  for (const style of FACADE_STYLES) {
    let material: THREE.MeshStandardMaterial | undefined;
    Object.defineProperty(materials, style, {
      enumerable: true,
      get: () => {
        if (!material) own.push((material = makeFacadeMaterial(style)));
        return material;
      },
    });
  }
  return materials;
}

/** Dispose the materials `makeFacadeMaterials` made (only those read). */
export function disposeFacadeMaterials(materials: Readonly<Record<FacadeStyle, THREE.Material>>): void {
  for (const material of made.get(materials) ?? []) material.dispose();
}
