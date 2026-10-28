import * as THREE from "three";
import { glslFloat, perturbedNormalGlsl } from "./car-finish.ts";

/**
 * The material classes the drawn world is tagged with. A class sets how much of the environment's reflection a surface keeps
 * (`specular`, a share of the specular IBL: three's `envMapIntensity` is overwritten with the scene's, so only the shader can scale it) and of
 * the lights' own specular (`direct`), a procedural grain (`slope` the normal's tilt, `freq` features a metre) that costs no texture fetch and, for
 * the concrete family, a worn-concrete detail from one shared map (`detail`). Ids index the GLSL table; a vertex's class (`MATERIAL_ATTRIBUTE`) wins over the material's.
 */
export const MATERIAL = { GENERIC: 0, PAINTED_METAL: 1, PLASTIC: 2, RUBBER: 3, CONCRETE: 4, ASPHALT: 5, SOIL: 6, WOOD: 7, FOLIAGE: 8, GLASS: 9, STONE: 10, LEATHER: 11, METAL: 12, INTERIOR: 13 } as const;
export type MaterialClass = (typeof MATERIAL)[keyof typeof MATERIAL];

/** The shared detail map's use by a class: world metres one tile spans, the normal's tilt, how much of the map's lightness and roughness variation shows, the albedo's darkening, and the roughness multiplier. */
type Detail = { tile: number; normal: number; luma: number; rough: number; tint: number; smooth: number };
const NO_DETAIL: Detail = { tile: 1, normal: 0, luma: 0, rough: 0, tint: 1, smooth: 1 };
const CONCRETE_DETAIL: Detail = { tile: 0.7, normal: 0.6, luma: 0.6, rough: 0.4, tint: 1, smooth: 1 };

/** The share of a light's specular soil and foliage keep: a rough surface still returns nearly all of a grazing sun (Fresnel reaches 1), a sheet of gold across a lawn. */
const SOFT_GROUND_DIRECT = 0.2;
/** The share of a photograph's normal relief a soil or foliage fragment keeps when the material's own class is another (a lawn cell on a paved terrain's concrete scan): its cracks stop reading on grass. */
const SOFT_GROUND_RELIEF = 0.3;

/**
 * specular: the share of the specular IBL kept; direct: the share of the lights' specular kept; relief: the share of a photograph's normal kept on
 * a fragment whose class is not the material's own; slope, freq: the grain (none at 0); detail: the worn-concrete map;
 * wet: how far Wet takes the class to `WET_ROUGHNESS` (0: stays dry); dark: the share of its albedo wet porous ground loses.
 * Starting values tuned from headless shots; a rough dielectric under a bright studio env reads grey and wet at env 1.
 */
type Tune = { specular: number; direct: number; relief: number; slope: number; freq: number; detail: Detail; wet: number; dark: number };
const MATERIAL_TUNE: Record<MaterialClass, Tune> = {
  [MATERIAL.GENERIC]: { specular: 1, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.PAINTED_METAL]: { specular: 0.8, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.PLASTIC]: { specular: 0.55, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.RUBBER]: { specular: 0.25, direct: 1, relief: 1, slope: 0.2, freq: 60, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.CONCRETE]: { specular: 0.45, direct: 1, relief: 1, slope: 0, freq: 24, detail: CONCRETE_DETAIL, wet: 0.7, dark: 0 },
  [MATERIAL.ASPHALT]: { specular: 0.8, direct: 1, relief: 1, slope: 0, freq: 50, detail: { tile: 1, normal: 0.12, luma: 0.3, rough: 0, tint: 0.55, smooth: 1 }, wet: 1, dark: 0 },
  [MATERIAL.SOIL]: { specular: 0.2, direct: SOFT_GROUND_DIRECT, relief: SOFT_GROUND_RELIEF, slope: 0.25, freq: 18, detail: NO_DETAIL, wet: 0.8, dark: 0.35 },
  [MATERIAL.WOOD]: { specular: 0.35, direct: 1, relief: 1, slope: 0.25, freq: 20, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.FOLIAGE]: { specular: 0.25, direct: SOFT_GROUND_DIRECT, relief: SOFT_GROUND_RELIEF, slope: 0.2, freq: 25, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.GLASS]: { specular: 1, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.STONE]: { specular: 0.6, direct: 1, relief: 1, slope: 0, freq: 30, detail: { tile: 0.9, normal: 0.5, luma: 0.5, rough: 0.3, tint: 1, smooth: 1 }, wet: 0.6, dark: 0 },
  [MATERIAL.LEATHER]: { specular: 0.6, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.METAL]: { specular: 1, direct: 1, relief: 1, slope: 0, freq: 1, detail: NO_DETAIL, wet: 0, dark: 0 },
  [MATERIAL.INTERIOR]: { specular: 0.45, direct: 1, relief: 1, slope: 0, freq: 24, detail: CONCRETE_DETAIL, wet: 0, dark: 0 },
};

/** The Wet toggle (0 dry, 1 wet), one uniform object every classed material shares: no recompile. */
export const MATERIAL_WET = { value: 0 };
/** A wet surface's roughness: a satin sheen, not the mirror whose glare band outshone the cars. */
const WET_ROUGHNESS = 0.38;
/** Rain wets what faces the sky: the wet drop fades in over this range of the normal's up component, so walls and kerb faces stay dry. */
const WET_UP_FROM = 0.6;
const WET_UP_TO = 0.9;
/** Below `GLOSS_TO` a class's env cut lifts toward 1, fully by `GLOSS_FROM`: a glossy surface (wet, polished) keeps its reflection. */
const GLOSS_FROM = 0.2;
const GLOSS_TO = 0.55;

/** 1 on the tiers that draw the finish (high, ultra), 0 elsewhere: the grain's and the detail's one switch, shared by every tagged material (a uniform, so no program changes). */
export const MATERIAL_GRAIN = { value: 0 };

/** The HUD's Material strength, one uniform object every classed material shares: 0 draws main's old uniform reflections and no grain, 1 the default look. */
export const MATERIAL_STRENGTH = { value: 1 };

/** The one detail map every concrete-family material samples: R, G the normal's x and y, B the tone (lightness over its mean, half; a dark texel is also a rough one). `present/concrete-detail.ts` swaps the real map in; until then the sampler holds an image-less texture, which reads black. */
export const MATERIAL_DETAIL = { value: new THREE.Texture() };

/** 1 while a finish tier is on and the detail map has loaded, 0 otherwise: the detail's one switch (the grain's is `MATERIAL_GRAIN`), so a black stand-in is never read. */
export const MATERIAL_DETAIL_READY = { value: 0 };

/** The uniform and the one function every class's reflection share goes through: a share of 1 stays 1, a cut (share < 1) deepens or fades with the strength. */
export const MATERIAL_STRENGTH_GLSL = /* glsl */ `
uniform float materialStrength;
float materialSpecular(float share) { return max(1.0 + (share - 1.0) * materialStrength, 0.0); }`;

/** The per-vertex class of a merged prefab (0: the material's own); `painted()` writes it. */
export const MATERIAL_ATTRIBUTE = "materialClass";

/** A car material's env share by its final roughness and metalness: a rough dielectric keeps `CAR_ENV_FLOOR` of it, a metal all. */
const CAR_ENV_ROUGH_FROM = 0.45;
const CAR_ENV_ROUGH_TO = 0.92;
const CAR_ENV_FLOOR = 0.25;
const CAR_ENV_METAL_FROM = 0.3;
const CAR_ENV_METAL_TO = 0.7;

/** Appended after `<lights_fragment_end>` of every car material that chains `capHighlights`: tyres, carpet and matte trim stop mirroring the studio. */
export const CAR_MATERIAL_ENV_GLSL = /* glsl */ `
float carEnvShare = mix(mix(1.0, ${glslFloat(CAR_ENV_FLOOR)}, smoothstep(${glslFloat(CAR_ENV_ROUGH_FROM)}, ${glslFloat(CAR_ENV_ROUGH_TO)}, roughnessFactor)), 1.0, smoothstep(${glslFloat(CAR_ENV_METAL_FROM)}, ${glslFloat(CAR_ENV_METAL_TO)}, metalnessFactor));
reflectedLight.indirectSpecular *= materialSpecular(carEnvShare);`;

/** The grain stops where a pixel spans this share of a feature, so a far surface never shimmers. */
const GRAIN_FADE_FROM = 0.15;
const GRAIN_FADE_TO = 0.5;
/** The share of a class's detail darkening a surface with its own normal map (Ultra's photographs) takes: they are already as dark as they should be, and the full tint took Ultra's road 11 px under main's. */
const PHOTOGRAPH_TINT_SHARE = 0.15;

const MATERIAL_IDS = Object.values(MATERIAL);
const table = (pick: (id: MaterialClass) => number): string => MATERIAL_IDS.map((id) => glslFloat(pick(id))).join(", ");
const glslTable = (name: string, pick: (id: MaterialClass) => number): string => `const float ${name}[${MATERIAL_IDS.length}] = float[${MATERIAL_IDS.length}](${table(pick)});`;
const hasDetail = (id: MaterialClass): number => (MATERIAL_TUNE[id].detail.normal + MATERIAL_TUNE[id].detail.luma + MATERIAL_TUNE[id].detail.rough > 0 ? 1 : 0);

const MATERIAL_VERTEX_PARS = /* glsl */ `
attribute float ${MATERIAL_ATTRIBUTE};
flat varying float vMaterialAttribute;
varying vec3 vMaterialPoint;
varying vec3 vMaterialNormal;`;

/** The point a class's textures are laid on: the object's own, scaled by an instance's size so a stretched box shows the map at its true metres, and riding the object as it moves. */
const MATERIAL_VERTEX_POINT = /* glsl */ `
#ifdef USE_INSTANCING
vec3 materialScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
vec3 materialScale = vec3(1.0);
#endif
vMaterialPoint = transformed * materialScale;
vMaterialNormal = objectNormal;`;

/** Value noise (a hash of the lattice, no texture), one octave: the grain's height. */
const MATERIAL_FRAGMENT_PARS = /* glsl */ `
uniform float materialId;
uniform float materialWetShare;
uniform float materialGrain;
uniform float materialDetailReady;
uniform sampler2D materialDetailMap;
uniform float materialWet;
${MATERIAL_STRENGTH_GLSL}
flat varying float vMaterialAttribute;
varying vec3 vMaterialPoint;
varying vec3 vMaterialNormal;
${glslTable("MATERIAL_ENV", (id) => MATERIAL_TUNE[id].specular)}
${glslTable("MATERIAL_DIRECT", (id) => MATERIAL_TUNE[id].direct)}
${glslTable("MATERIAL_RELIEF", (id) => MATERIAL_TUNE[id].relief)}
${glslTable("MATERIAL_SLOPE", (id) => MATERIAL_TUNE[id].slope)}
${glslTable("MATERIAL_FREQ", (id) => MATERIAL_TUNE[id].freq)}
${glslTable("MATERIAL_DETAIL_ON", hasDetail)}
${glslTable("MATERIAL_TILE", (id) => MATERIAL_TUNE[id].detail.tile)}
${glslTable("MATERIAL_NORMAL", (id) => MATERIAL_TUNE[id].detail.normal)}
${glslTable("MATERIAL_LUMA", (id) => MATERIAL_TUNE[id].detail.luma)}
${glslTable("MATERIAL_ROUGH", (id) => MATERIAL_TUNE[id].detail.rough)}
${glslTable("MATERIAL_TINT", (id) => MATERIAL_TUNE[id].detail.tint)}
${glslTable("MATERIAL_SMOOTH", (id) => MATERIAL_TUNE[id].detail.smooth)}
${glslTable("MATERIAL_WET", (id) => MATERIAL_TUNE[id].wet)}
${glslTable("MATERIAL_DARK", (id) => MATERIAL_TUNE[id].dark)}
const float WET_ROUGHNESS = ${glslFloat(WET_ROUGHNESS)};
float worldEnvShare(float share, float roughness, float wetK) { return mix(mix(share, 1.0, 1.0 - smoothstep(${glslFloat(GLOSS_FROM)}, ${glslFloat(GLOSS_TO)}, roughness)), 1.0, wetK); }
float materialHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float materialNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(materialHash(i), materialHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(materialHash(i + vec3(0.0, 1.0, 0.0)), materialHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(materialHash(i + vec3(0.0, 0.0, 1.0)), materialHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(materialHash(i + vec3(0.0, 1.0, 1.0)), materialHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
mat3 materialFrame(vec3 q0, vec3 q1, vec2 st0, vec2 st1, vec3 surfaceNormal) {
  vec3 q1perp = cross(q1, surfaceNormal);
  vec3 q0perp = cross(surfaceNormal, q0);
  vec3 tangent = q1perp * st0.x + q0perp * st1.x;
  vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(tangent, tangent), dot(bitangent, bitangent));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(tangent * scale, bitangent * scale, surfaceNormal);
}
${perturbedNormalGlsl("materialPerturbedNormal")}`;

/**
 * After `<color_fragment>`: the fragment's class (its vertex's, else the material's), the detail map's texel where the class takes it (a
 * plane picked by the object normal's largest axis, the map tiled by the class's metres; one fetch, none on a class without detail), and the
 * class's darkening and lightness variation on the albedo. The screen-space steps the normal pass needs are taken here, outside any branch.
 */
const MATERIAL_COLOR_FRAGMENT = /* glsl */ `
int materialClass = int(vMaterialAttribute + 0.5) > 0 ? int(vMaterialAttribute + 0.5) : int(materialId + 0.5);
vec3 materialAxis = abs(vMaterialNormal);
vec2 materialPlane = materialAxis.x > max(materialAxis.y, materialAxis.z) ? vMaterialPoint.zy : (materialAxis.y > materialAxis.z ? vMaterialPoint.xz : vMaterialPoint.xy);
vec2 materialUv = materialPlane / MATERIAL_TILE[materialClass];
vec2 materialDx = dFdx(materialUv);
vec2 materialDy = dFdy(materialUv);
vec3 materialQ0 = dFdx(-vViewPosition);
vec3 materialQ1 = dFdy(-vViewPosition);
float materialDetailOn = materialDetailReady * MATERIAL_DETAIL_ON[materialClass];
vec3 materialDetail = vec3(0.5);
if (materialDetailOn > 0.0) materialDetail = textureGrad(materialDetailMap, materialUv, materialDx, materialDy).rgb;
float materialBlend = materialDetailOn * min(materialStrength, 1.0);
#ifdef USE_NORMALMAP
float materialTintBlend = materialBlend * ${glslFloat(PHOTOGRAPH_TINT_SHARE)};
#else
float materialTintBlend = materialBlend;
#endif
diffuseColor.rgb *= mix(1.0, materialDetail.b * 2.0, min(MATERIAL_LUMA[materialClass] * materialStrength, 1.0) * materialDetailOn) * mix(1.0, MATERIAL_TINT[materialClass], materialTintBlend);
`;

/** After `<roughnessmap_fragment>`: the class's smoothing and the tone's roughness variation (darker is rougher). */
const MATERIAL_ROUGHNESS_FRAGMENT = /* glsl */ `
roughnessFactor = clamp(roughnessFactor * mix(1.0, MATERIAL_SMOOTH[materialClass], materialBlend) + (0.5 - materialDetail.b) * 2.0 * MATERIAL_ROUGH[materialClass] * materialDetailOn * materialStrength, 0.04, 1.0);`;

/**
 * After `<normal_fragment_maps>`: with a normal map of its own (Ultra's photographs), a fragment whose class is not the material's (a vertex
 * class, `MATERIAL_ATTRIBUTE`) keeps the class's share of that relief; without one, the class's procedural grain (the height in metres: slope
 * over the feature size), then the detail map's tilt in the surface's own tangent frame (zero for a class without detail, so the normal is unchanged).
 */
const MATERIAL_NORMAL_FRAGMENT = /* glsl */ `
float materialWetK = materialWet * materialWetShare * MATERIAL_WET[materialClass] * smoothstep(${glslFloat(WET_UP_FROM)}, ${glslFloat(WET_UP_TO)}, dot(normalize(normal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, WET_ROUGHNESS), materialWetK);
metalnessFactor *= 1.0 - materialWetK;
diffuseColor.rgb *= 1.0 - MATERIAL_DARK[materialClass] * materialWetK;
#ifndef USE_NORMALMAP
if (materialGrain > 0.0) {
  float materialFreq = MATERIAL_FREQ[materialClass];
  float materialFade = 1.0 - smoothstep(${glslFloat(GRAIN_FADE_FROM)}, ${glslFloat(GRAIN_FADE_TO)}, length(materialQ0) * materialFreq);
  float materialHeight = materialNoise(vMaterialPoint * materialFreq) * MATERIAL_SLOPE[materialClass] * materialStrength / materialFreq * materialFade;
  normal = materialPerturbedNormal(normal, vec2(dFdx(materialHeight), dFdy(materialHeight)), faceDirection);
  vec2 materialTilt = (materialDetail.rg * 2.0 - 1.0) * MATERIAL_NORMAL[materialClass] * materialStrength;
  vec3 materialTangentNormal = vec3(materialTilt, sqrt(max(1.0 - dot(materialTilt, materialTilt), 0.05)));
  normal = normalize(materialFrame(materialQ0, materialQ1, materialDx, materialDy, normal) * materialTangentNormal);

}
#endif
#ifdef USE_NORMALMAP
if (materialClass != int(materialId + 0.5)) normal = normalize(mix(nonPerturbedNormal, normal, MATERIAL_RELIEF[materialClass]));
#endif`;

/**
 * Tag `material` with `materialClass`: its specular IBL scales by the class's env share, and on the finish tiers its normal takes the
 * class's grain or detail. `wetShare` (0-1) is how much of its class's wetness this one material takes (a studio floor wets less than a street). Chains the earlier compile hook and key like `applyMarkMap`; the class is a number in `userData`, so a `clone()` keeps it.
 * Tag every lit world material, or the untagged ones link a program of their own.
 */
export function tagMaterial<T extends THREE.MeshStandardMaterial>(material: T, materialClass: MaterialClass, wetShare = 1): T {
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const materialId = { value: materialClass };
  const materialWetShare = { value: wetShare };
  material.userData.materialClass = materialClass;
  material.userData.wetShare = wetShare;
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    shader.uniforms.materialId = materialId;
    shader.uniforms.materialWetShare = materialWetShare;
    shader.uniforms.materialGrain = MATERIAL_GRAIN;
    shader.uniforms.materialDetailReady = MATERIAL_DETAIL_READY;
    shader.uniforms.materialStrength = MATERIAL_STRENGTH;
    shader.uniforms.materialDetailMap = MATERIAL_DETAIL;
    shader.uniforms.materialWet = MATERIAL_WET;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${MATERIAL_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvMaterialAttribute = ${MATERIAL_ATTRIBUTE};${MATERIAL_VERTEX_POINT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${MATERIAL_FRAGMENT_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${MATERIAL_COLOR_FRAGMENT}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>${MATERIAL_ROUGHNESS_FRAGMENT}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${MATERIAL_NORMAL_FRAGMENT}`)
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directSpecular *= materialSpecular(MATERIAL_DIRECT[materialClass]);\nreflectedLight.indirectSpecular *= materialSpecular(worldEnvShare(MATERIAL_ENV[materialClass], roughnessFactor, materialWetK));");
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|surf`;
  return material;
}

function isMaterialClass(value: unknown): value is MaterialClass {
  return MATERIAL_IDS.some((id) => id === value);
}

/** `copy`, a `clone()` of a tagged material (which keeps `userData` but not the compile hook), tagged like `original`. */
export function tagLike<T extends THREE.Material>(copy: T, original: THREE.Material): T {
  const tagged: unknown = original.userData.materialClass;
  if (copy instanceof THREE.MeshStandardMaterial && isMaterialClass(tagged)) tagMaterial(copy, tagged, Number(original.userData.wetShare ?? 1));
  return copy;
}
