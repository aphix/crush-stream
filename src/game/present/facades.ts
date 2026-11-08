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
};

export const FACADE = {
  prague: { bays: 4, plain: [0.941, 0.753], roughness: 0.8, metalness: 0.05, tints: [0xffffff, 0xf6ecd8, 0xe9eef4, 0xf4e0d2, 0xecebdc], mix: { city: 4, park: 2, desert: 0, dirt: 0, circuit: 0, none: 4 }, home: null },
  dc: { bays: 4, plain: [0.27, 0.12], roughness: 0.85, metalness: 0.03, tints: [0xffffff, 0xf0d8c8, 0xd8c0b0, 0xffe6d0, 0xc9b8aa], mix: { city: 3, park: 3, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: PREFAB.building },
  stucco: { bays: 4, plain: [0.176, 0.46], roughness: 0.9, metalness: 0.03, tints: PASTELS, mix: { city: 1, park: 1, desert: 2, dirt: 2, circuit: 1, none: 1 }, home: PREFAB.stucco },
  glass: { bays: 4, plain: [0.566, 0.948], roughness: 0.4, metalness: 0.2, tints: [0xffffff, 0xcfe4f0, 0xe0e8e0, 0xbcd4e4, 0xf0f0f4], mix: { city: 3, park: 0, desert: 0, dirt: 0, circuit: 3, none: 3 }, home: null },
  adobe: { bays: 2, plain: [0.441, 0.803], roughness: 0.95, metalness: 0.02, tints: [0xffffff, 0xf0dcc0, 0xe0c8a8, 0xffe4cc, 0xd8c0a0], mix: { city: 0, park: 0, desert: 5, dirt: 1, circuit: 0, none: 0 }, home: null },
} as const satisfies Record<string, StyleSpec>;

export type FacadeStyle = keyof typeof FACADE;
const FACADE_STYLES = Object.keys(FACADE) as FacadeStyle[];

/** The building's roofline (m): a facade tile spans the ground to here, the roof slab's underside. */
export const ROOFLINE = 13.5;

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

/** The page's one fetch of every style's maps, started by the first materials; where there is no bitmap decoder (node) the stand-ins stay. */
const loadFacades = once((): void => {
  if (typeof createImageBitmap !== "function") return;
  for (const style of FACADE_STYLES) void loadStyle(style);
});

/** The glow map's R is the window, its G the window's turn-on threshold: a window lights once `FACADE_GLOW` passes its threshold, shifted by a seed per building face. */
const WINDOW_VERTEX = /* glsl */ `
varying float vFacadeSeed;`;
const WINDOW_SEED = /* glsl */ `
#ifdef USE_INSTANCING
vFacadeSeed = fract(dot(instanceMatrix[3].xz, vec2(0.0791, 0.1137)) + dot(objectNormal.xz, vec2(0.37, 0.61)));
#else
vFacadeSeed = 0.0;
#endif`;
const WINDOW_FRAGMENT = /* glsl */ `
uniform float facadeGlow;
varying float vFacadeSeed;`;
const WINDOW_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
vec2 facadeWindow = texture2D(emissiveMap, vEmissiveMapUv).rg;
float facadeOn = step(fract(facadeWindow.g + vFacadeSeed), facadeGlow * ${LIT_SHARE.toFixed(2)});
totalEmissiveRadiance *= facadeWindow.r * facadeOn;
#endif`;

/** One material per style: its maps (stand-ins until they load), the windows' glow, tagged as concrete. */
export function makeFacadeMaterials(): Record<FacadeStyle, THREE.MeshStandardMaterial> {
  loadFacades();
  const materials = {} as Record<FacadeStyle, THREE.MeshStandardMaterial>;
  for (const style of FACADE_STYLES) {
    const { roughness, metalness } = FACADE[style];
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, emissive: WINDOW_LIGHT, emissiveIntensity: WINDOW_LIGHT_INTENSITY });
    material.userData.facadeStyle = style;
    show(material, loaded[style] ?? standIn());
    material.onBeforeCompile = (shader) => {
      shader.uniforms.facadeGlow = FACADE_GLOW;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${WINDOW_VERTEX}`).replace("#include <begin_vertex>", `#include <begin_vertex>${WINDOW_SEED}`);
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${WINDOW_FRAGMENT}`).replace("#include <emissivemap_fragment>", WINDOW_EMISSIVE);
    };
    material.customProgramCacheKey = () => "facade";
    live.add(material);
    material.addEventListener("dispose", () => live.delete(material));
    materials[style] = tagMaterial(material, MAT.CONCRETE);
  }
  return materials;
}
