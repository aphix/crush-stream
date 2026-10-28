import * as THREE from "three";
import { glslFloat, perturbedNormalGlsl } from "./car-finish.ts";

/**
 * The material classes the drawn world is tagged with. A class sets how much of the environment's reflection a surface keeps
 * (`specular`, a share of the specular IBL: three's `envMapIntensity` is overwritten with the scene's, so only the shader can scale it) and a
 * procedural grain (`slope` the normal's tilt, `freq` features a metre) that costs no texture fetch. Ids index the GLSL table.
 */
export const MATERIAL = { GENERIC: 0, PAINTED_METAL: 1, PLASTIC: 2, RUBBER: 3, CONCRETE: 4, ASPHALT: 5, SOIL: 6, WOOD: 7, FOLIAGE: 8, GLASS: 9, STONE: 10, LEATHER: 11, METAL: 12 } as const;
export type MaterialClass = (typeof MATERIAL)[keyof typeof MATERIAL];

/** specular: the share of the specular IBL kept; slope, freq: the grain (none at 0). Starting values tuned from headless shots; a rough dielectric under a bright studio env reads grey and wet at env 1. */
const MATERIAL_TUNE: Record<MaterialClass, { specular: number; slope: number; freq: number }> = {
  [MATERIAL.GENERIC]: { specular: 1, slope: 0, freq: 1 },
  [MATERIAL.PAINTED_METAL]: { specular: 0.8, slope: 0, freq: 1 },
  [MATERIAL.PLASTIC]: { specular: 0.55, slope: 0, freq: 1 },
  [MATERIAL.RUBBER]: { specular: 0.25, slope: 0.2, freq: 60 },
  [MATERIAL.CONCRETE]: { specular: 0.45, slope: 0.15, freq: 24 },
  [MATERIAL.ASPHALT]: { specular: 0.8, slope: 0.3, freq: 50 },
  [MATERIAL.SOIL]: { specular: 0.2, slope: 0.25, freq: 18 },
  [MATERIAL.WOOD]: { specular: 0.35, slope: 0.25, freq: 20 },
  [MATERIAL.FOLIAGE]: { specular: 0.25, slope: 0.2, freq: 25 },
  [MATERIAL.GLASS]: { specular: 1, slope: 0, freq: 1 },
  [MATERIAL.STONE]: { specular: 0.6, slope: 0.1, freq: 30 },
  [MATERIAL.LEATHER]: { specular: 0.6, slope: 0, freq: 1 },
  [MATERIAL.METAL]: { specular: 1, slope: 0, freq: 1 },
};

/** 1 on the tiers that draw the finish (high, ultra), 0 elsewhere: the grain's one switch, shared by every tagged material (a uniform, so no program changes). */
export const MATERIAL_GRAIN = { value: 0 };

/** The HUD's Material strength, one uniform object every classed material shares: 0 draws main's old uniform reflections and no grain, 1 the default look. */
export const MATERIAL_STRENGTH = { value: 1 };

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

const MATERIAL_IDS = Object.values(MATERIAL);
const tuneTable = (field: "specular" | "slope" | "freq"): string => MATERIAL_IDS.map((id) => glslFloat(MATERIAL_TUNE[id][field])).join(", ");

const MATERIAL_VERTEX_PARS = /* glsl */ `
attribute float ${MATERIAL_ATTRIBUTE};
varying float vMaterialAttribute;
varying vec3 vMaterialPoint;`;

/** Value noise (a hash of the lattice, no texture), one octave: the grain's height. */
const MATERIAL_FRAGMENT_PARS = /* glsl */ `
uniform float materialId;
uniform float materialGrain;
${MATERIAL_STRENGTH_GLSL}
varying float vMaterialAttribute;
varying vec3 vMaterialPoint;
const float MATERIAL_ENV[${MATERIAL_IDS.length}] = float[${MATERIAL_IDS.length}](${tuneTable("specular")});
const float MATERIAL_SLOPE[${MATERIAL_IDS.length}] = float[${MATERIAL_IDS.length}](${tuneTable("slope")});
const float MATERIAL_FREQ[${MATERIAL_IDS.length}] = float[${MATERIAL_IDS.length}](${tuneTable("freq")});
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
${perturbedNormalGlsl("materialPerturbedNormal")}`;

/** A class's grain on `normal`, where the material has no normal map of its own (Ultra's photographs win). The height is in metres: slope over the feature size. */
const MATERIAL_GRAIN_FRAGMENT = /* glsl */ `
int materialClass = int(vMaterialAttribute + 0.5) > 0 ? int(vMaterialAttribute + 0.5) : int(materialId + 0.5);
#ifndef USE_NORMALMAP
if (materialGrain > 0.0) {
  float materialFreq = MATERIAL_FREQ[materialClass];
  float materialFade = 1.0 - smoothstep(${glslFloat(GRAIN_FADE_FROM)}, ${glslFloat(GRAIN_FADE_TO)}, length(dFdx(vViewPosition)) * materialFreq);
  float materialHeight = materialNoise(vMaterialPoint * materialFreq) * MATERIAL_SLOPE[materialClass] * materialStrength / materialFreq * materialFade;
  normal = materialPerturbedNormal(normal, vec2(dFdx(materialHeight), dFdy(materialHeight)), faceDirection);
}
#endif`;

/**
 * Tag `material` with `materialClass`: its specular IBL scales by the class's env share, and on the finish tiers its normal takes the
 * class's grain. Chains the earlier compile hook and key like `applyMarkMap`; the class is a number in `userData`, so a `clone()` keeps it.
 * Tag every lit world material, or the untagged ones link a program of their own.
 */
export function tagMaterial<T extends THREE.MeshStandardMaterial>(material: T, materialClass: MaterialClass): T {
  const previousHook = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const materialId = { value: materialClass };
  material.userData.materialClass = materialClass;
  material.onBeforeCompile = (shader, renderer) => {
    previousHook.call(material, shader, renderer);
    shader.uniforms.materialId = materialId;
    shader.uniforms.materialGrain = MATERIAL_GRAIN;
    shader.uniforms.materialStrength = MATERIAL_STRENGTH;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${MATERIAL_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvMaterialAttribute = ${MATERIAL_ATTRIBUTE};\nvMaterialPoint = transformed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${MATERIAL_FRAGMENT_PARS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${MATERIAL_GRAIN_FRAGMENT}`)
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= materialSpecular(MATERIAL_ENV[materialClass]);");
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
  if (copy instanceof THREE.MeshStandardMaterial && isMaterialClass(tagged)) tagMaterial(copy, tagged);
  return copy;
}
