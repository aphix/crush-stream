import type * as THREE from "three";
import type { SurfaceId } from "../world/catalog.ts";
import { reliefMaterial, type ReliefSpec } from "./surface-relief.ts";

/**
 * The normal maps of the ground surfaces (`public/surfaces/<name>-normal.webp`, packed by `scripts/pack-ground.mjs`): one tileable map per surface, drawn
 * as the normal only (the colours are the surface's own). `GROUND_METRES` is what one tile of each map spans on the ground; the mesh's uv spans `tile` metres to
 * the unit (the albedo's own tile), so the map repeats `tile / metres` times. A sidewalk slab (`slab`) is its own map: one flag a slab's length square, laid on the ground.
 */
const SLAB = "slab";
type GroundName = SurfaceId | typeof SLAB;

const GROUND_METRES = {
  asphalt: 2,
  concrete: 4,
  cobble: 1.2,
  dirt: 3,
  gravel: 1.5,
  grass: 3,
  sand: 3,
  mud: 4,
  slab: 3.2,
} as const satisfies Record<GroundName, number>;

const BASE = `${import.meta.env?.BASE_URL ?? "/"}surfaces/`;

/** Where ground map `name` is served from. */
const groundMapUrl = (name: GroundName): string => `${BASE}${name}-normal.webp`;

function specOf(name: GroundName, tile: number): ReliefSpec {
  return { url: groundMapUrl(name), repeat: tile / GROUND_METRES[name] };
}

/** A course ribbon's or terrain's material takes `surface`'s normal map, its mesh's uv spanning `tile` metres to the unit. */
export function dressGround(material: THREE.MeshStandardMaterial, surface: SurfaceId, tile: number): void {
  reliefMaterial(material, specOf(surface, tile));
}

/** A slab's top takes its maps' uv from the ground point it covers, a slab's length to the unit; its sides keep their own. */
const PAVING_UV_VERTEX = /* glsl */ `#include <uv_vertex>
if ( normal.y > 0.5 ) {
	vec4 pavingPoint = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		pavingPoint = instanceMatrix * pavingPoint;
	#endif
	vec2 pavingUv = ( modelMatrix * pavingPoint ).xz / ${GROUND_METRES[SLAB].toFixed(2)};
	#ifdef USE_MAP
		vMapUv = ( mapTransform * vec3( pavingUv, 1 ) ).xy;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = ( normalMapTransform * vec3( pavingUv, 1 ) ).xy;
	#endif
}`;

/** `vertexShader` (three's standard one) with the paving's uv (`PAVING_UV_VERTEX`) after its own. */
export function pavingVertex(vertexShader: string): string {
  return vertexShader.replace("#include <uv_vertex>", PAVING_UV_VERTEX);
}

/**
 * A sidewalk slab's material takes the paving's, its top's maps laid on the ground (`PAVING_UV_VERTEX`): slabs overlap by design (a bend's neighbours, two
 * streets' strips at a corner), and in each slab's own frame the overlap showed two pavings fighting in one plane; on the ground's they draw the same texel.
 */
export function dressPaving(material: THREE.MeshStandardMaterial): void {
  const hook = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    hook.call(material, shader, renderer);
    shader.vertexShader = pavingVertex(shader.vertexShader);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|paving`;
  reliefMaterial(material, specOf(SLAB, GROUND_METRES[SLAB]));
}
