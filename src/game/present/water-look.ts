import * as THREE from "three";
import type { FxTier } from "./engine-post.ts";

/** ShaderFrog "Cartoon Water" on the pools' material (docs/PRESENTATION.md): scrolling caustic colour plus cartoon glints, in world xz with value noise (no textures). */

/** Metres one of the export's uv units spans: 12x denser than the first cut's 7 m, so caustic cells come to ~0.1 m and glints to ~3-8 cm. */
const TILE_M = 0.58;
/** The first cut's tile (m): the scrolls below are the export's rates times TILE_M's shrink from it, so the water moves at the same m/s as before. */
const FIRST_TILE_M = 7;
const SPEED = FIRST_TILE_M / TILE_M;
/** The export's constants: the blue mixed into the base and its share; the glint band cut out of the noise product, its brightness and the base scroll. */
const WATER_COLOR = "vec3(0.0, 0.40, 1.0)";
const WATER_AMT = 0.469;
const SPEC_MAX = 0.303;
const SPEC_POP = 0.782;
const SPEC_BRIGHT = 2.0;
/** How far the cartoon base replaces the vertex colour (1 = the export's colour whole): below 1 the sky's gloss still shows through. */
const BASE_SHARE = 0.55;
/** Noise cells per pixel at which the pattern starts to fade out (to flat colour, no glints) and is gone: finer than ~2 px a cell it would shimmer. */
const FADE_FROM = 0.3;
const FADE_TO = 0.6;

/** Value-noise contrast about 0.5: the export's Perlin jpg is low-contrast, so its product only rarely clears the glint band's top. */
const NOISE_CONTRAST = 0.6;

/** Shared by every water program: the clock (s) and 1 where the tier draws the cartoon look, 0 for the plain gloss. */
const TIME = { value: 0 };
const LOOK = { value: 0 };

/** Minimal and off keep the plain water: no noise taps at all. */
export function setWaterTier(tier: FxTier): void {
  LOOK.value = tier === "minimal" || tier === "off" ? 0 : 1;
}

const NOISE = /* glsl */ `
float wHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float v = mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
  return 0.5 + ${NOISE_CONTRAST.toFixed(2)} * (v - 0.5);
}`;

const CARTOON = /* glsl */ `
if (uWaterLook > 0.5) {
  vec2 uv = vWaterXZ / ${TILE_M.toFixed(2)};
  float disp = wNoise(uv * 3.0 + uWaterTime * ${SPEED.toFixed(3)} * vec2(-0.071, 0.068));
  float cellPx = fwidth(uv.x);
  float caustic = mix(0.5, wNoise((uv * 2.0 + disp * 0.21) * 3.0 + uWaterTime * ${SPEED.toFixed(3)} * vec2(-0.166, -0.170)), 1.0 - smoothstep(${FADE_FROM.toFixed(2)}, ${FADE_TO.toFixed(2)}, cellPx * 6.0));
  vec3 shallow = vec3(0.10, 0.62, 0.95);
  vec3 deep = vec3(0.0, 0.30, 0.75);
  vec3 base = mix(mix(deep, shallow, smoothstep(0.42, 0.58, caustic)), ${WATER_COLOR}, ${WATER_AMT.toFixed(3)});
  diffuseColor.rgb = mix(diffuseColor.rgb, pow(base, vec3(2.2)), ${BASE_SHARE.toFixed(2)});
  vec2 sp = uv * 0.706 * 3.0;
  vec2 drift = uWaterTime * ${SPEED.toFixed(3)} * vec2(0.0375, 0.0467);
  float prod = wNoise(sp + drift) * wNoise(sp - drift);
  float len = prod * 1.73;
  float cut = (len > ${SPEC_MAX.toFixed(3)} && len < ${SPEC_POP.toFixed(3)}) ? 0.0 : 1.0;
  float darken = clamp(wNoise(uv * 0.25 * 3.0 - drift * 0.5) * 3.0 - 1.0, 0.0, 1.0);
  totalEmissiveRadiance += vec3(prod * ${SPEC_BRIGHT.toFixed(1)} * cut * darken * (1.0 - smoothstep(${FADE_FROM.toFixed(2)}, ${FADE_TO.toFixed(2)}, cellPx * 2.1)));
}`;

/** Patches the pools' lit material: one program, lights and reflections kept; the glints are emissive so the sun does not dim them. */
export function applyWaterLook(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = TIME;
    shader.uniforms.uWaterLook = LOOK;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vWaterXZ;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
  vWaterXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
#else
  vWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vWaterXZ;\nuniform float uWaterTime;\nuniform float uWaterLook;${NOISE}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>${CARTOON}`);
  };
  material.customProgramCacheKey = () => "water-look";
  material.onBeforeRender = () => {
    TIME.value = performance.now() * 0.001;
  };
}
