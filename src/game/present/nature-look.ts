import * as THREE from "three";
import type { FxTier } from "./engine-post.ts";
import { MAT } from "../kernel/material-ids.ts";

/**
 * The one material of rocks, trees, palms and bushes: the flat-shaded vertex-colour look of `plain` plus a shader chunk that keeps a few reused meshes from reading as copies. Per pixel, from the world
 * position (no textures): a noise tint (fine grain, and a patch-wide warm or cool shift so a clump agrees with itself), dust or moss on the upward faces, and a darkening toward the foot.
 */

/** Fine grain cell (m) and patch cell (m) of the tint noise, and its swing (about 1) in brightness and in warm/cool. */
const GRAIN_CELL = 1.6;
const PATCH_CELL = 38;
const GRAIN_BRIGHT = 0.18;
const PATCH_HUE = 0.16;
/** Dust (pale, sun-bleached) and moss (green) on a face turned up by `COVER_FROM` to `COVER_TO` of the normal's y, the most of the colour it takes on stone and on leaves, and the noise's share in the edge. */
const DUST = [0.66, 0.58, 0.44] as const;
const MOSS = [0.3, 0.42, 0.18] as const;
const COVER_FROM = 0.55;
const COVER_TO = 0.9;
const COVER_STONE = 0.6;
const COVER_LEAF = 0.18;
const COVER_BREAKUP = 0.5;
/** Object-space height (m) over which the foot darkens: from `AO_FROM` (a rock's buried base) to `AO_TO`, down to this share of the colour. */
const AO_FROM = -0.25;
const AO_TO = 1.4;
const AO_FLOOR = 0.6;

/** 1 where the tier draws the detail (the tint noise and the cover), 0 for the plain look: Low and under skip the noise and cover and add only the foot's shade. */
const LOOK = { value: 1 };

export function setNatureTier(tier: FxTier): void {
  LOOK.value = tier === "high" || tier === "ultra" ? 1 : 0;
}

const vec3 = (rgb: readonly number[]): string => `vec3(${rgb.map((n) => n.toFixed(3)).join(", ")})`;

const NATURE_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
vec4 natureAt = instanceMatrix * vec4(transformed, 1.0);
#else
vec4 natureAt = vec4(transformed, 1.0);
#endif
vNatureWorld = (modelMatrix * natureAt).xyz;
vNatureHeight = transformed.y;`;

const NATURE_FRAGMENT = /* glsl */ `
float natureShade = mix(${AO_FLOOR.toFixed(2)}, 1.0, smoothstep(${AO_FROM.toFixed(2)}, ${AO_TO.toFixed(2)}, vNatureHeight));
if (uNatureLook > 0.5) {
  vec3 natureUp = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 natureAxis = pow(abs(natureUp), vec3(4.0));
  natureAxis /= natureAxis.x + natureAxis.y + natureAxis.z;
  float natureGrain = natureAxis.x * natureNoise(vNatureWorld.zy / ${GRAIN_CELL.toFixed(2)}) + natureAxis.y * natureNoise(vNatureWorld.xz / ${GRAIN_CELL.toFixed(2)}) + natureAxis.z * natureNoise(vNatureWorld.xy / ${GRAIN_CELL.toFixed(2)});
  float naturePatch = natureNoise(vNatureWorld.xz / ${PATCH_CELL.toFixed(1)});
  diffuseColor.rgb *= (1.0 + ${GRAIN_BRIGHT.toFixed(2)} * (natureGrain - 0.5)) * vec3(1.0 + ${PATCH_HUE.toFixed(2)} * (naturePatch - 0.5), 1.0, 1.0 - ${PATCH_HUE.toFixed(2)} * (naturePatch - 0.5));
  float natureChroma = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
  float natureCover = smoothstep(${COVER_FROM.toFixed(2)}, ${COVER_TO.toFixed(2)}, natureUp.y + ${COVER_BREAKUP.toFixed(2)} * (natureGrain - 0.5)) * mix(${COVER_STONE.toFixed(2)}, ${COVER_LEAF.toFixed(2)}, smoothstep(0.04, 0.16, natureChroma));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(${vec3(DUST)}, ${vec3(MOSS)}, smoothstep(0.4, 0.6, naturePatch)) * (0.7 + 0.6 * natureGrain), natureCover);
}
diffuseColor.rgb *= natureShade;`;

const NATURE_NOISE = /* glsl */ `
float natureHash(ivec2 p) {
  uint x = uint(p.x * 7919 + p.y) ^ 2654435769u;
  x *= 2246822507u;
  x ^= x >> 13u;
  x *= 3266489917u;
  x ^= x >> 16u;
  return float(x) / 4294967296.0;
}
float natureNoise(vec2 p) {
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  ivec2 i = ivec2(floor(p));
  return mix(mix(natureHash(i), natureHash(i + ivec2(1, 0)), f.x), mix(natureHash(i + ivec2(0, 1)), natureHash(i + ivec2(1, 1)), f.x), f.y);
}`;

/** Rocks, trees, palms and bushes in this one class so a `clone()` (the track art's per-draw-kind copies) keeps the patch: the hook is installed by the constructor, which `copy` does not touch. */
export class NatureMaterial extends THREE.MeshStandardMaterial {
  constructor() {
    super({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05 });
    this.onBeforeCompile = (shader) => {
      shader.uniforms.uNatureLook = LOOK;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vNatureWorld;\nvarying float vNatureHeight;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>${NATURE_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vNatureWorld;\nvarying float vNatureHeight;\nuniform float uNatureLook;${NATURE_NOISE}`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${NATURE_FRAGMENT}`);
    };
    this.customProgramCacheKey = () => "nature-look";
  }
}

/** Leaves (a vertex class of `MAT.CONIFER_FOLIAGE`) clump in cells this size (m), darkest to brightest by these shares. */
const LEAF_CELL = 0.42;
const LEAF_DARK = 0.7;
const LEAF_BRIGHT = 1.15;
/** Where a crown turns this far from the eye (|cos| under it), its leaves thin out, up to this share of the clumps cut at the very edge: a ragged, leafy outline. */
const LEAF_EDGE = 0.5;
const LEAF_CUT = 0.85;

/** After the normal is final, before lighting: on leaf fragments only, clumps of light and dark leaves, and gaps cut through the outline. Reads the surface tag's per-vertex class (`vMaterialAttribute`). */
const LEAF_FRAGMENT = /* glsl */ `
if (int(vMaterialAttribute + 0.5) == ${MAT.CONIFER_FOLIAGE}) {
  vec3 leafAt = vNatureWorld / ${LEAF_CELL.toFixed(2)};
  float leafClump = 0.5 * natureNoise(leafAt.xz + 0.71 * leafAt.y) + 0.5 * natureNoise(1.9 * leafAt.zy + 3.1);
  diffuseColor.rgb *= mix(${LEAF_DARK.toFixed(2)}, ${LEAF_BRIGHT.toFixed(2)}, leafClump);
  float leafFacing = abs(dot(normal, normalize(vViewPosition)));
  if (leafFacing < ${LEAF_EDGE.toFixed(2)} && leafClump < (1.0 - leafFacing / ${LEAF_EDGE.toFixed(2)}) * ${LEAF_CUT.toFixed(2)}) discard;
}`;

/**
 * The street trees' one material: the nature look, smooth-shaded (a canopy lump's normals are its ellipsoid's, so a crown shades as one soft mass, not as facets), its leaves in clumps of light and dark, and
 * its outline thinned where a lump turns away from the eye, so a crown's edge reads as leaves against the sky. Needs the surface tag (`tagMaterial`): the leaf class comes from it.
 */
export class LeafMaterial extends NatureMaterial {
  constructor() {
    super();
    this.flatShading = false;
    const nature = this.onBeforeCompile;
    this.onBeforeCompile = (shader, renderer) => {
      nature.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_fragment>", `${LEAF_FRAGMENT}\n#include <lights_physical_fragment>`);
    };
    this.customProgramCacheKey = () => "leaf-look";
  }
}
