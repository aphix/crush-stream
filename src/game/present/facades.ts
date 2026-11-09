import * as THREE from "three";
import { MAT } from "../kernel/material-ids.ts";
import { once } from "../kernel/scalar.ts";
import { SURFACE_REGION_ATTRIBUTE, tagMaterial } from "../vehicle/material-class.ts";
import type { PrefabId } from "../world/catalog.ts";
import { type BiomeId, PREFAB } from "../world/constants.ts";
import { DEFAULT_STOREYS } from "../world/openworld/interior-kinds.ts";
import layerData from "./facade-layers.json" with { type: "json" };
import { followRelief, reliefPossible } from "./surface-relief.ts";
import { flatLayers, loadLayers } from "./texture-array.ts";
import { hash01 } from "./track-mesh.ts";

/**
 * The building styles: one shared material each, so a draw cell's buildings cost one draw per style on it. A style's textures are three layered
 * textures (`texture-array.ts`) from `public/facades/<style>-{albedo,normal,glow}.webp`, packed by `scripts/pack-facades.mjs`: a layer per region of the
 * building (cornice, one storey, the ground floor, corner stones), each tiled by real metres by `facade-mesh.ts`, which sets every vertex's layer.
 * shortcut: a draw per style per cell; one array holding every style's layers with the style in the vertex makes it one, when the bench says draws limit.
 */

/** Weathered pastel stucco (pink, mint, ochre, sky, cream, terracotta, lilac): the Havana blocks and walls. */
export const PASTELS = [0xf3c6c0, 0xbfe0d0, 0xf2d9a0, 0xb8d4ea, 0xf0e2cb, 0xe8b9a0, 0xd9c8e6];

type StyleSpec = {
  roughness: number;
  metalness: number;
  /** Per-instance colours the style is multiplied by (the albedo is already coloured, so they stay near white). */
  tints: readonly number[];
  /** Share of a biome's buildings drawn in this style (weights). */
  mix: Readonly<Record<BiomeId, number>>;
  /** The building prefab this is the look of when no style is named. */
  home: PrefabId | null;
  /** Weights of the roof coverings on its buildings, in the roof strip's layer order: tar, clay tile, slate, copper, corrugated metal. */
  roofs: readonly [number, number, number, number, number];
};

/** A style no biome picks: a placement names it (the open world's programme). */
const NAMED_ONLY = { city: 0, park: 0, desert: 0, dirt: 0, circuit: 0, none: 0 } as const;

export const FACADE = {
  prague: { roughness: 0.8, metalness: 0.05, tints: [0xffffff, 0xf6ecd8, 0xe9eef4, 0xf4e0d2, 0xecebdc], mix: { city: 3, park: 0, desert: 0, dirt: 0, circuit: 0, none: 1 }, home: null, roofs: [0, 1, 1, 3, 0] },
  dc: { roughness: 0.85, metalness: 0.03, tints: [0xffffff, 0xf0d8c8, 0xd8c0b0, 0xffe6d0, 0xc9b8aa], mix: { city: 2, park: 2, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: PREFAB.building, roofs: [2, 1, 3, 0, 0] },
  stucco: { roughness: 0.9, metalness: 0.03, tints: PASTELS, mix: { city: 0, park: 0, desert: 2, dirt: 1, circuit: 0, none: 0 }, home: PREFAB.stucco, roofs: [1, 4, 0, 0, 0] },
  glass: { roughness: 0.4, metalness: 0.2, tints: [0xffffff, 0xcfe4f0, 0xe0e8e0, 0xbcd4e4, 0xf0f0f4], mix: { city: 3, park: 0, desert: 0, dirt: 0, circuit: 3, none: 0 }, home: null, roofs: [3, 0, 0, 0, 1] },
  adobe: { roughness: 0.95, metalness: 0.02, tints: [0xffffff, 0xf0dcc0, 0xe0c8a8, 0xffe4cc, 0xd8c0a0], mix: { city: 0, park: 0, desert: 5, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [1, 0, 0, 0, 0] },
  shops: { roughness: 0.8, metalness: 0.05, tints: PASTELS, mix: { city: 3, park: 1, desert: 0, dirt: 0, circuit: 1, none: 1 }, home: null, roofs: [2, 2, 1, 0, 0] },
  baroque: { roughness: 0.85, metalness: 0.03, tints: [0xffffff, 0xf6ecd8, 0xf4e0d2, 0xe9eef4, 0xecebdc], mix: { city: 2, park: 0, desert: 0, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [0, 4, 0, 1, 0] },
  havana: { roughness: 0.9, metalness: 0.03, tints: [0xffffff, 0xeaf5f0, 0xd8efe8, 0xf0d0d8, 0xd0e0f0], mix: { city: 1, park: 0, desert: 1, dirt: 0, circuit: 0, none: 0 }, home: null, roofs: [1, 5, 0, 0, 0] },
  federal: { roughness: 0.85, metalness: 0.04, tints: [0xffffff, 0xf4efe4, 0xe8e8ec, 0xf0e8d8, 0xe0e4e4], mix: { city: 0, park: 0, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: null, roofs: [1, 0, 2, 2, 0] },
  warehouse: { roughness: 0.9, metalness: 0.1, tints: [0xffffff, 0xe8d8d0, 0xd8c8c0, 0xf0e0d0, 0xc8c0b8], mix: { city: 0, park: 0, desert: 0, dirt: 4, circuit: 2, none: 0 }, home: null, roofs: [1, 0, 0, 0, 4] },
  farm: { roughness: 0.92, metalness: 0.02, tints: [0xffffff, 0xf0d8d0, 0xe0c0a8, 0xd0b8a0, 0xb8c0c8], mix: { city: 0, park: 3, desert: 0, dirt: 2, circuit: 0, none: 0 }, home: null, roofs: [0, 1, 0, 0, 3] },
  rowhouse: { roughness: 0.8, metalness: 0.03, tints: PASTELS, mix: { city: 3, park: 1, desert: 0, dirt: 0, circuit: 0, none: 3 }, home: null, roofs: [2, 3, 3, 0, 0] },
  rowbrick: { roughness: 0.88, metalness: 0.02, tints: [0xffffff, 0xf3dccd, 0xe2c2ae, 0xf0d0b8, 0xd9b8a8], mix: NAMED_ONLY, home: null, roofs: [2, 1, 3, 0, 0] },
  rowpainted: { roughness: 0.88, metalness: 0.02, tints: [0xffffff, 0xf0f4ea, 0xe8ecf0, 0xf4e8e0], mix: NAMED_ONLY, home: null, roofs: [2, 1, 3, 0, 0] },
  coffee: { roughness: 0.8, metalness: 0.05, tints: [0xffffff, 0xf6f2ea, 0xeef2f0], mix: NAMED_ONLY, home: null, roofs: [1, 0, 0, 0, 0] },
  bar: { roughness: 0.85, metalness: 0.05, tints: [0xffffff, 0xeeeeee, 0xf4eeee], mix: NAMED_ONLY, home: null, roofs: [1, 0, 0, 0, 0] },
  office: { roughness: 0.4, metalness: 0.2, tints: [0xffffff, 0xe6eef4, 0xf0f4f4], mix: NAMED_ONLY, home: null, roofs: [3, 0, 0, 0, 1] },
  cornerstore: { roughness: 0.82, metalness: 0.04, tints: [0xffffff, 0xf4eee8, 0xeef0f4], mix: NAMED_ONLY, home: null, roofs: [1, 0, 0, 0, 0] },
  supermarket: { roughness: 0.7, metalness: 0.08, tints: [0xffffff], mix: NAMED_ONLY, home: null, roofs: [3, 0, 0, 0, 2] },
} as const satisfies Record<string, StyleSpec>;

export type FacadeStyle = keyof typeof FACADE;
const FACADE_STYLES = Object.keys(FACADE) as FacadeStyle[];

/**
 * One style's layers as `scripts/pack-facades.mjs` packed them: bays across a 11.8 m face, layers in its strips, each band's height (m) and a bare patch of wall (u, v in the floor layer). `height` and `roughness`:
 * the style has those strips too (read only on the relief tier); `neon`: its glow strip's blue is a sign mask lit in the sign's own colour; `open`: the ground layer's albedo alpha is 0 where the interior shows through (a doorway, a shopfront window).
 */
type LayerSpec = { bays: number; layers: number; metres: { cornice: number; floor: number; ground: number }; plain: readonly number[]; height?: boolean; roughness?: boolean; neon?: boolean; open?: boolean };
/** The JSON module's keys are the styles' (a row pins it): its inferred type is only as loose as the file. */
export const FACADE_LAYERS = layerData as Record<FacadeStyle, LayerSpec>;

/** The layer of each region in a style's strips (the corner stones' layer exists only where the style has them), and the roof's marker. */
export const LAYER = { cornice: 0, floor: 1, ground: 2, quoin: 3 } as const;
export const ROOF_LAYER = -1;

/** World metres one roof tile spans on a roof slab (`facade-mesh.ts` lays the slab's top in them). */
export const ROOF_TILE_M = 2.4;
/** Metres a roof may be raised over the collider's top, picked per building: a taller parapet drawn on the 14 m block, nothing the sim reads. */
const ROOF_LIFTS = [0, 0, 0.7, 1.4, 2.8];
/** The per-building hash of `FACADE_LIFT` below, its two weights on the instance's x and z, and the stretch and shift that pick a lift from it. */
const LIFT_HASH_X = 0.0791;
const LIFT_HASH_Z = 0.1137;
const LIFT_PICK_SCALE = 5.7;
const LIFT_PICK_SHIFT = 0.3;

/** The lift (block metres) `FACADE_LIFT` gives the roof of a building whose instance stands at (x, z), in the shader's 32-bit arithmetic: what stands on a roof stands this much higher. */
export function roofLiftAt(x: number, z: number): number {
  const f32 = Math.fround;
  const hash = f32(f32(f32(x) * f32(LIFT_HASH_X)) + f32(f32(z) * f32(LIFT_HASH_Z)));
  const building = f32(hash - Math.floor(hash));
  const pick = f32(f32(building * f32(LIFT_PICK_SCALE)) + f32(LIFT_PICK_SHIFT));
  return ROOF_LIFTS[Math.floor(f32(f32(pick - Math.floor(pick)) * ROOF_LIFTS.length))]!;
}

/** The share of a style's windows lit at full night. */
const LIT_SHARE = 0.6;
const WINDOW_LIGHT = 0xffb35e;
const WINDOW_LIGHT_INTENSITY = 1.3;
/** A neon or LED sign's radiance at full glow (linear colour, over the windows' 1.3): bright enough to bloom, a sign being the night's light source. */
const NEON_INTENSITY = 2.2;
/** The relief tier's parallax: the metres a wall's deepest recess lies behind its proudest moulding, the steps the view ray takes through it, and the cosine of the grazing angle a view is held to (a flatter one would throw the offset across the wall). */
const PARALLAX_METRES = 0.3;
const PARALLAX_STEPS = 8;
const PARALLAX_MIN_FACING = 0.25;

/** How far the windows are lit, 0 (day) to 1 (night): one uniform every style's material shares, set by `WorldStage.apply` beside the lamp heads. */
export const FACADE_GLOW = { value: 0 };

/** A building's skin is its facade style, and, where its storeys are not the usual three, the count after this mark ("rowbrick@4"): one geometry per style and count, their bands laid for it. */
const STOREYS_MARK = "@";

/** A building's skin: its facade style, or the style and a storey count. */
export type FacadeSkin = FacadeStyle | `${FacadeStyle}@${number}`;

/** The skin of a building of facade `style` with `storeys` storeys: the style's own name for the usual count. */
export function facadeSkin(style: FacadeStyle, storeys: number): FacadeSkin {
  return storeys === DEFAULT_STOREYS ? style : `${style}${STOREYS_MARK}${storeys}`;
}

/** The style and the storeys a building skin names. */
export function splitFacadeSkin(skin: string): { style: FacadeStyle; storeys: number } {
  const [name, count] = skin.split(STOREYS_MARK);
  if (!isFacadeStyle(name)) throw new Error(`${skin} names no facade style`);
  return { style: name, storeys: count === undefined ? DEFAULT_STOREYS : Number(count) };
}

/** `out` = the tint number `h` (0..1) picks among the tints of the style `skin` names. */
export function facadeTint(skin: string, h: number, out: THREE.Color): void {
  const tints = FACADE[splitFacadeSkin(skin).style].tints;
  out.setHex(tints[Math.floor(h * tints.length)]!);
}

/** The style a building prefab stands in when none is named (the one whose `home` it is); null for a prefab that is no building. */
export function homeStyle(prefab: PrefabId): FacadeStyle | null {
  return FACADE_STYLES.find((style) => FACADE[style].home === prefab) ?? null;
}

/** A museum slab: a `marble` block this wide (m, along its long side) and this tall at its placed size is drawn as a block in `SLAB_STYLE`, its layers laid in the slab's own metres. */
const SLAB_MIN_SPAN = 25;
const SLAB_MIN_HEIGHT = 12;
export const SLAB_STYLE: FacadeStyle = "federal";

/** The style prefab `prefab` stands in at (x, z) in `biome`: only a `building` (or a drawn-only `buildingShell`) is picked by its position (so a row's neighbours differ and no placement moves another's); a `marble` block is a slab (`span` and `height` its placed size, m) or has no style; any other prefab has its home style, or none. */
export function facadeStyle(prefab: PrefabId, x: number, z: number, biome: BiomeId, span = 0, height = 0): FacadeStyle | null {
  if (prefab === PREFAB.marble) return span >= SLAB_MIN_SPAN && height >= SLAB_MIN_HEIGHT ? SLAB_STYLE : null;
  if (prefab !== PREFAB.building && prefab !== PREFAB.buildingShell) return homeStyle(prefab);
  let pick = hash01(Math.round(x) * 7919 + Math.round(z) * 104729, 31) * FACADE_STYLES.reduce((sum, style) => sum + FACADE[style].mix[biome], 0);
  for (const style of FACADE_STYLES) {
    pick -= FACADE[style].mix[biome];
    if (pick < 0) return style;
  }
  return homeStyle(prefab);
}

/** Whether `name` (a placement's `style`) names a facade style. */
export const isFacadeStyle = (name: string | undefined): name is FacadeStyle => name !== undefined && Object.hasOwn(FACADE, name);

/** The style a placed building stands in: the style its placement names when that is a facade style and the prefab is drawn in one, else `facadeStyle`'s pick for its spot (a forced style never dresses a tree or a plain block). */
export function placedFacadeStyle(prefab: PrefabId, named: string | undefined, x: number, z: number, biome: BiomeId, span = 0, height = 0): FacadeStyle | null {
  const picked = facadeStyle(prefab, x, z, biome, span, height);
  return picked !== null && isFacadeStyle(named) ? named : picked;
}

const MAPS_URL = `${import.meta.env?.BASE_URL ?? "/"}facades/`;

/** Where style `style`'s `kind` strip is served from. */
export const facadeMapUrl = (style: FacadeStyle, kind: "albedo" | "normal" | "glow" | "height" | "roughness"): string => `${MAPS_URL}${style}-${kind}.webp`;
const ROOF_URL = `${MAPS_URL}roofs-`;
/** Layers in the roof strips: tar, clay tile, slate, green copper, corrugated metal. */
const ROOF_LAYERS = 5;

type StyleTextures = {
  albedo: THREE.IUniform<THREE.Texture>;
  glow: THREE.IUniform<THREE.Texture>;
  normal: THREE.IUniform<THREE.Texture>;
  /** The relief tier's strips and how far each is on (0 until its strip has loaded with the tier on): the parallax depth (m) and the share of the roughness the strip sets. */
  height: THREE.IUniform<THREE.Texture>;
  roughness: THREE.IUniform<THREE.Texture>;
  depth: THREE.IUniform<number>;
  roughnessMix: THREE.IUniform<number>;
};

/** What a layered texture shows until its strip arrives: a cream wall, no glow, a flat normal, a brown roof (DOM-free, so a test builds the materials too). */
const standIn = once(() => ({
  albedo: flatLayers([205, 200, 190, 255], THREE.SRGBColorSpace),
  glow: flatLayers([0, 0, 0, 255], THREE.NoColorSpace),
  roof: flatLayers([110, 92, 78, 255], THREE.SRGBColorSpace),
  normal: flatLayers([128, 128, 255, 255], THREE.NoColorSpace),
  /** No recess and the full material roughness: what a relief strip shows until it arrives. */
  relief: flatLayers([255, 255, 255, 255], THREE.NoColorSpace),
}));

/** The one 1 x 1 white map every facade material wears for the maps three needs set to keep their shader paths (the layered textures are read by the patch). */
const placeholder = once((): THREE.DataTexture => {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
});

async function loadStyle(style: FacadeStyle, into: StyleTextures): Promise<void> {
  const { layers } = FACADE_LAYERS[style];
  try {
    const [albedo, glow] = await Promise.all([
      loadLayers({ url: facadeMapUrl(style, "albedo"), layers, colorSpace: THREE.SRGBColorSpace, anisotropy: 8, halve: !reliefPossible() }),
      loadLayers({ url: facadeMapUrl(style, "glow"), layers, colorSpace: THREE.NoColorSpace, anisotropy: 4, halve: !reliefPossible() }),
    ]);
    into.albedo.value = albedo;
    into.glow.value = glow;
  } catch (err) {
    console.error(`Crush Stream's ${style} facade maps did not load`, err);
  }
}

const textures = new Map<FacadeStyle, StyleTextures>();

/** A style's textures (shared by every material of the style), fetched the first time the style is read; where there is no bitmap decoder (node) the stand-ins stay. */
function texturesOf(style: FacadeStyle): StyleTextures {
  let found = textures.get(style);
  if (!found) {
    const stand = standIn();
    textures.set(style, (found = { albedo: { value: stand.albedo }, glow: { value: stand.glow }, normal: { value: stand.normal }, height: { value: stand.relief }, roughness: { value: stand.relief }, depth: { value: 0 }, roughnessMix: { value: 0 } }));
    if (typeof createImageBitmap === "function") void loadStyle(style, found);
  }
  return found;
}

type RoofTextures = { albedo: THREE.IUniform<THREE.Texture>; normal: THREE.IUniform<THREE.Texture> };

/**
 * The roof strips' two uniforms, made once per page by the first facade material (a plain brown and a flat normal until the colours arrive, and in node), and the colour strip
 * fetched then. `once` must return the value: it memoizes by it, and a `void` function would run again with every material (a fresh fetch and relief subscriber each course).
 */
const roofTextures = once((): RoofTextures => {
  const albedo: THREE.IUniform<THREE.Texture> = { value: standIn().roof };
  const normal: THREE.IUniform<THREE.Texture> = { value: standIn().normal };
  followRelief({ url: `${ROOF_URL}normal.webp`, repeat: 1, layers: ROOF_LAYERS }, (map) => {
    normal.value = map;
  });
  if (typeof createImageBitmap === "function") {
    void (async () => {
      try {
        albedo.value = await loadLayers({ url: `${ROOF_URL}albedo.webp`, layers: ROOF_LAYERS, colorSpace: THREE.SRGBColorSpace, anisotropy: 4, halve: !reliefPossible() });
      } catch (err) {
        console.error("Crush Stream's roof colour map did not load", err);
      }
    })();
  }
  return { albedo, normal };
});

/**
 * The glow layer's R is the window, its G the window's turn-on threshold: a window lights once `FACADE_GLOW` passes its threshold, shifted by a seed per building face.
 * A roof top (`ROOF_LAYER`) takes its colour and normal from the roof strips, one covering per building by the same seed; the top of the slab is raised by a per-building lift.
 */
const FACADE_VERTEX = /* glsl */ `
attribute vec3 ${SURFACE_REGION_ATTRIBUTE};
uniform float facadeBays;
flat varying vec2 vFacadeRegion;
varying float vFacadeSeed;`;
/** The parapet lift, shared by the colour pass and the sun's shadow pass (a shadow that missed it would fall up to 2.8 m short): taken before the class tag's grain point, which follows it. */
const FACADE_LIFT = /* glsl */ `
#ifdef USE_INSTANCING
float facadeBuilding = fract(dot(instanceMatrix[3].xz, vec2(${LIFT_HASH_X}, ${LIFT_HASH_Z})));
const float facadeLifts[5] = float[5](${ROOF_LIFTS.map((m) => m.toFixed(1)).join(", ")});
transformed.y += facadeLifts[int(fract(facadeBuilding * ${LIFT_PICK_SCALE} + ${LIFT_PICK_SHIFT}) * ${ROOF_LIFTS.length.toFixed(1)})] * step(13.9, transformed.y);
#endif`;
/**
 * A slab's uv (the region's third number) is the block's, stretched by the instance's scale: laid again in its metres. A wall's bays keep their width (a whole number of them
 * along the face), its storeys their height (a whole number of them up it, which the cornice and the ground band, stretched with the instance, do not take part in); a roof top's tiles keep theirs.
 */
const FACADE_METRES = /* glsl */ `
#ifdef USE_INSTANCING
if (surfaceRegion.z > 0.5 && surfaceRegion.x < 2.5) {
  vec3 facadeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  float facadeAlong = abs(objectNormal.z) > 0.5 ? facadeScale.x : facadeScale.z;
  vec2 facadeUv = uv;
  if (surfaceRegion.x < 0.0) facadeUv *= facadeScale.xz;
  else {
    facadeUv.x *= max(1.0, floor(facadeAlong * facadeBays + 0.5) / facadeBays);
    if (abs(surfaceRegion.x - 1.0) < 0.5) facadeUv.y = step(0.5, uv.y) * max(1.0, floor(uv.y * facadeScale.y + 0.5));
  }
  #ifdef USE_MAP
  vMapUv = facadeUv;
  #endif
  #ifdef USE_NORMALMAP
  vNormalMapUv = facadeUv;
  #endif
  #ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = facadeUv;
  #endif
}
#endif`;
const FACADE_SEED = /* glsl */ `
vFacadeRegion = ${SURFACE_REGION_ATTRIBUTE}.xy;${FACADE_LIFT}${FACADE_METRES}
#ifdef USE_INSTANCING
vFacadeSeed = fract(facadeBuilding + dot(objectNormal.xz, vec2(0.37, 0.61)));
#else
vFacadeSeed = 0.0;
#endif`;
const FACADE_FRAGMENT = /* glsl */ `
uniform float facadeGlow;
uniform float facadeRoofMix[4];
uniform highp sampler2DArray facadeAlbedo;
uniform highp sampler2DArray facadeNormalMap;
uniform highp sampler2DArray facadeGlowMap;
uniform highp sampler2DArray facadeRoofAlbedo;
uniform highp sampler2DArray facadeRoofNormal;
flat varying vec2 vFacadeRegion;
varying float vFacadeSeed;
float facadeRoofKind() {
  float pick = fract(vFacadeSeed * 7.31 + 0.17);
  return step(facadeRoofMix[0], pick) + step(facadeRoofMix[1], pick) + step(facadeRoofMix[2], pick) + step(facadeRoofMix[3], pick);
}`;
/**
 * What a style's program adds to the base facade: the relief tier's strips (only where the device can draw relief) and the sign colour of a neon style. A style with none has exactly the base program,
 * the base program's key and its uniforms.
 */
type Extras = { height: boolean; roughness: boolean; neon: boolean; open: boolean };

function extrasOf(style: FacadeStyle): Extras {
  const spec = FACADE_LAYERS[style];
  const relief = reliefPossible();
  return { height: relief && spec.height === true, roughness: relief && spec.roughness === true, neon: spec.neon === true, open: spec.open === true };
}

/** Each strip's sampler and the uv varying it is read with, and the layer every read takes (the region's first number). */
const MAP_UV = "vMapUv";
const REGION_LAYER = "vFacadeRegion.x";
const FACADE_READS = { albedo: ["facadeAlbedo", MAP_UV], normal: ["facadeNormalMap", "vNormalMapUv"], glow: ["facadeGlowMap", "vEmissiveMapUv"], roughness: ["facadeRoughnessMap", MAP_UV] } as const;

/** The strips a style's program reads by layer: with parallax a read is shifted by `facadeShift` and takes its mip level from the unshifted uv (a shift that jumps at a window's edge would otherwise blur a line there). */
function facadeRead(extras: Extras, strip: keyof typeof FACADE_READS): string {
  const [map, uv] = FACADE_READS[strip];
  return extras.height ? `textureGrad(${map}, vec3(${uv} + facadeShift, ${REGION_LAYER}), facadeDx, facadeDy)` : `texture(${map}, vec3(${uv}, ${REGION_LAYER}))`;
}

/** The uniforms of the strips beyond the base ones. */
const facadeExtraUniforms = (extras: Extras): string =>
  (extras.height ? "uniform highp sampler2DArray facadeHeightMap;\nuniform float facadeReliefDepth;\n" : "") + (extras.roughness ? "uniform highp sampler2DArray facadeRoughnessMap;\nuniform float facadeRoughnessMix;\n" : "");

/**
 * Parallax through the height strip (1 proud, 0 the deepest recess): the uv shift per metre of depth along the view ray is read from the surface's own screen derivatives (so it holds at any bay or storey
 * stretch), the ray steps through the strip `PARALLAX_STEPS` times and the last two steps are blended. A roof, and a wall while the strip is not on (`facadeReliefDepth` 0), keep their own uv.
 */
const FACADE_PARALLAX = /* glsl */ `
vec2 facadeShift = vec2(0.0);
vec2 facadeDx = vec2(0.0);
vec2 facadeDy = vec2(0.0);
void facadeParallax(float layer) {
  facadeDx = dFdx(vMapUv);
  facadeDy = dFdy(vMapUv);
  vec3 facadeNormal = normalize(vNormal);
  vec3 dPdx = dFdx(-vViewPosition);
  vec3 dPdy = dFdy(-vViewPosition);
  vec3 perpY = cross(dPdy, facadeNormal);
  vec3 perpX = cross(facadeNormal, dPdx);
  float area = dot(dPdx, perpY);
  vec3 eye = normalize(vViewPosition);
  float facing = max(dot(eye, facadeNormal), ${PARALLAX_MIN_FACING.toFixed(2)});
  if (facadeReliefDepth <= 0.0 || layer < 0.0 || abs(area) < 1e-12) return;
  vec3 gradU = (perpY * facadeDx.x + perpX * facadeDy.x) / area;
  vec3 gradV = (perpY * facadeDx.y + perpX * facadeDy.y) / area;
  vec2 stride = -vec2(dot(gradU, eye), dot(gradV, eye)) / facing * (facadeReliefDepth / ${PARALLAX_STEPS.toFixed(1)});
  float rayDepth = 0.0;
  vec2 at = vMapUv;
  float surfaceDepth = 1.0 - textureGrad(facadeHeightMap, vec3(at, layer), facadeDx, facadeDy).r;
  float lastDepth = surfaceDepth;
  float lastRay = 0.0;
  for (int tap = 0; tap < ${PARALLAX_STEPS}; tap++) {
    if (rayDepth >= surfaceDepth) break;
    lastDepth = surfaceDepth;
    lastRay = rayDepth;
    at += stride;
    surfaceDepth = 1.0 - textureGrad(facadeHeightMap, vec3(at, layer), facadeDx, facadeDy).r;
    rayDepth += ${(1 / PARALLAX_STEPS).toFixed(4)};
  }
  float after = surfaceDepth - rayDepth;
  float before = lastDepth - lastRay;
  float back = clamp(after / min(after - before, -1e-5), 0.0, 1.0);
  facadeShift = at - stride * back - vMapUv;
}`;

/** After three's own normal-map uniforms are declared: the parallax, and the layered normal read by layer (the roof covering for a roof). */
const facadeNormalPars = (extras: Extras): string => /* glsl */ `${extras.height ? FACADE_PARALLAX : ""}
#ifdef USE_NORMALMAP
vec4 facadeNormalTexel() {
  return vFacadeRegion.x < 0.0 ? texture(facadeRoofNormal, vec3(vNormalMapUv, facadeRoofKind())) : ${facadeRead(extras, "normal")};
}
#endif`;
const facadeMap = (extras: Extras): string => /* glsl */ `
#ifdef USE_MAP
${extras.height ? "facadeParallax(vFacadeRegion.x);\n" : ""}diffuseColor *= vFacadeRegion.x < 0.0 ? vec4(1.0) : ${facadeRead(extras, "albedo")};${extras.open ? `\nif (abs(vFacadeRegion.x - ${LAYER.ground}.0) < 0.5 && diffuseColor.a < 0.5) discard;` : ""}
#endif`;
/** The roughness strip's green sets the surface's roughness where its share is on (the relief tier), in place of the material's one number. */
const facadeRoughness = (extras: Extras): string => `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, ${facadeRead(extras, "roughness")}.g, facadeRoughnessMix * step(0.0, vFacadeRegion.x));`;
const FACADE_ROOF_COLOR = /* glsl */ `
if (vFacadeRegion.x < 0.0) diffuseColor.rgb = texture(facadeRoofAlbedo, vec3(vMapUv, facadeRoofKind())).rgb * (0.88 + 0.24 * fract(vFacadeSeed * 3.1));`;
/** The glow strip's red is the window, its green the window's threshold; of a neon style its blue is a sign, lit in its own albedo's colour from dusk. */
const facadeEmissive = (extras: Extras): string => /* glsl */ `
#ifdef USE_EMISSIVEMAP
${extras.neon ? `vec3 facadeSign = ${facadeRead(extras, "glow")}.rgb;
vec2 facadeWindow = facadeSign.rg;` : `vec2 facadeWindow = ${facadeRead(extras, "glow")}.rg;`}
float facadeOn = step(fract(facadeWindow.g + vFacadeSeed), facadeGlow * ${LIT_SHARE.toFixed(2)});
totalEmissiveRadiance *= smoothstep(0.3, 0.7, facadeWindow.r) * facadeOn * step(0.0, vFacadeRegion.x);${
    extras.neon
      ? `
totalEmissiveRadiance += diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 0.05)) * (smoothstep(0.1, 0.6, facadeSign.b) * smoothstep(0.0, 0.4, facadeGlow) * ${NEON_INTENSITY.toFixed(1)} * step(0.0, vFacadeRegion.x));`
      : ""
  }
#endif`;
/** three's own tangent-space normal read, with the layered texel in its place and the region's share of the relief on it. */
const FACADE_NORMAL_MAPS = THREE.ShaderChunk.normal_fragment_maps.replaceAll("texture2D( normalMap, vNormalMapUv )", "facadeNormalTexel()").replace("mapN.xy *= normalScale;", "mapN.xy *= normalScale * vFacadeRegion.y;");

/** The cumulative first four of a style's roof weights over their sum: where a building's seed switches from one covering to the next. */
function roofEdges(style: FacadeStyle): number[] {
  const weights: readonly number[] = FACADE[style].roofs;
  const total = weights.reduce((sum, w) => sum + w, 0);
  let run = 0;
  return weights.slice(0, 4).map((w) => (run += w) / total);
}

/** The facade shader on `shader` (after the class tag's own patch, whose includes stay): layered colour, normal and glow, the roof covering, the lift. */
function patchFacade(shader: THREE.WebGLProgramParametersWithUniforms, own: StyleTextures, roofs: RoofTextures, edges: number[], bays: number, extras: Extras): void {
  shader.uniforms.facadeGlow = FACADE_GLOW;
  shader.uniforms.facadeBays = { value: bays };
  shader.uniforms.facadeRoofMix = { value: edges };
  shader.uniforms.facadeAlbedo = own.albedo;
  shader.uniforms.facadeNormalMap = own.normal;
  shader.uniforms.facadeGlowMap = own.glow;
  shader.uniforms.facadeRoofAlbedo = roofs.albedo;
  shader.uniforms.facadeRoofNormal = roofs.normal;
  if (extras.height) {
    shader.uniforms.facadeHeightMap = own.height;
    shader.uniforms.facadeReliefDepth = own.depth;
  }
  if (extras.roughness) {
    shader.uniforms.facadeRoughnessMap = own.roughness;
    shader.uniforms.facadeRoughnessMix = own.roughnessMix;
  }
  shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${FACADE_VERTEX}`).replace("#include <begin_vertex>", `#include <begin_vertex>${FACADE_SEED}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>${FACADE_FRAGMENT}${facadeExtraUniforms(extras)}`)
    .replace("#include <normalmap_pars_fragment>", `#include <normalmap_pars_fragment>${facadeNormalPars(extras)}`)
    .replace("#include <map_fragment>", facadeMap(extras))
    .replace("#include <color_fragment>", `#include <color_fragment>${FACADE_ROOF_COLOR}`)
    .replace("#include <roughnessmap_fragment>", extras.roughness ? facadeRoughness(extras) : "#include <roughnessmap_fragment>")
    .replace("#include <normal_fragment_maps>", FACADE_NORMAL_MAPS)
    .replace("#include <emissivemap_fragment>", facadeEmissive(extras));
}

/** One material of `style`: its layered maps (stand-ins until they load), the windows' glow, the roofs, tagged as concrete. */
function makeFacadeMaterial(style: FacadeStyle): THREE.MeshStandardMaterial {
  const own = texturesOf(style);
  const roofs = roofTextures();
  const { roughness, metalness } = FACADE[style];
  const blank = placeholder();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, emissive: WINDOW_LIGHT, emissiveIntensity: WINDOW_LIGHT_INTENSITY, map: blank, normalMap: reliefPossible() ? blank : null, emissiveMap: blank });
  material.userData.facadeStyle = style;
  tagMaterial(material, MAT.CONCRETE);
  const tagHook = material.onBeforeCompile;
  const tagKey = material.customProgramCacheKey;
  const edges = roofEdges(style);
  const extras = extrasOf(style);
  material.onBeforeCompile = (shader, renderer) => {
    tagHook.call(material, shader, renderer);
    patchFacade(shader, own, roofs, edges, FACADE_LAYERS[style].bays, extras);
  };
  const variant = `${extras.height ? "|height" : ""}${extras.roughness ? "|roughness" : ""}${extras.neon ? "|neon" : ""}${extras.open ? "|open" : ""}`;
  material.customProgramCacheKey = () => `${tagKey.call(material)}|facade${variant}`;
  const { layers } = FACADE_LAYERS[style];
  const stops = [
    followRelief({ url: facadeMapUrl(style, "normal"), repeat: 1, layers }, (map, scale) => {
      own.normal.value = map;
      material.normalScale.set(scale, scale);
    }),
  ];
  if (extras.height) {
    stops.push(
      followRelief({ url: facadeMapUrl(style, "height"), repeat: 1, layers }, (map, scale) => {
        own.height.value = map;
        own.depth.value = scale * PARALLAX_METRES;
      }),
    );
  }
  if (extras.roughness) {
    stops.push(
      followRelief({ url: facadeMapUrl(style, "roughness"), repeat: 1, layers }, (map, scale) => {
        own.roughness.value = map;
        own.roughnessMix.value = scale;
      }),
    );
  }
  material.addEventListener("dispose", () => {
    for (const stop of stops) stop();
  });
  return material;
}

/** The sun's shadow depth of a facade mesh: three's depth material with the facade's parapet lift, one for every style (a fixed program key). */
const FACADE_DEPTH = new THREE.MeshDepthMaterial();
FACADE_DEPTH.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>${FACADE_LIFT}`);
};
FACADE_DEPTH.customProgramCacheKey = () => "facade-depth";

/** `material`'s sun shadow depth material when it is a facade's (so lifted parapets cast their shadow), else null for the plain one. */
export function facadeDepth(material: THREE.Material): THREE.MeshDepthMaterial | null {
  return material.userData.facadeStyle === undefined ? null : FACADE_DEPTH;
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
