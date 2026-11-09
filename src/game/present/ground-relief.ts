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

/** A slab's top takes its maps' uv from the ground point it covers (`vPavingGround`, m), a slab's length to the unit; its sides keep their own. */
const PAVING_UV_VERTEX = /* glsl */ `#include <uv_vertex>
vPavingTop = 0.0;
vPavingGround = vec2( 0.0 );
if ( normal.y > 0.5 ) {
	vec4 pavingPoint = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		pavingPoint = instanceMatrix * pavingPoint;
	#endif
	vPavingGround = ( modelMatrix * pavingPoint ).xz;
	vPavingTop = 1.0;
	vec2 pavingUv = vPavingGround / ${GROUND_METRES[SLAB].toFixed(2)};
	#ifdef USE_MAP
		vMapUv = ( mapTransform * vec3( pavingUv, 1 ) ).xy;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = ( normalMapTransform * vec3( pavingUv, 1 ) ).xy;
	#endif
}`;

const PAVING_VARYINGS = /* glsl */ `
varying vec2 vPavingGround;
varying float vPavingTop;`;

/** `vertexShader` (three's standard one) with the paving's uv (`PAVING_UV_VERTEX`) after its own. */
export function pavingVertex(vertexShader: string): string {
  return vertexShader.replace("#include <common>", `#include <common>${PAVING_VARYINGS}`).replace("#include <uv_vertex>", PAVING_UV_VERTEX);
}

/** Red brick in running bond, laid on the ground: a brick's length and height, the joint's width (all m), and the colours of a brick, of its joint and the mean the bond blurs to where its joints are under a pixel. */
const BRICK = { length: 0.215, height: 0.065, joint: 0.01, colour: [0.52, 0.17, 0.1], mortar: [0.5, 0.48, 0.44], mean: [0.46, 0.2, 0.14] } as const;
/** How far a brick's colour wanders from its own (share), brick to brick. */
const BRICK_WANDER = 0.25;
/** The bond fades to its mean as a pixel spans this share of a brick or more (a joint's width in a pixel and the joints alias). */
const BOND_FADE = [0.25, 0.6] as const;
const vec3Of = (rgb: readonly number[]): string => `vec3( ${rgb.map((channel) => channel.toFixed(3)).join(", ")} )`;

/** With `PAVING_BRICK` defined: a slab's top is laid in brick, its colour replacing the slab's (the instance's and the concrete's alike). */
const PAVING_BRICK_FRAGMENT = /* glsl */ `
#ifdef PAVING_BRICK
if ( vPavingTop > 0.5 ) {
	vec2 bond = vPavingGround / vec2( ${BRICK.length.toFixed(3)}, ${BRICK.height.toFixed(3)} );
	bond.x += 0.5 * floor( bond.y );
	vec2 within = fract( bond );
	vec2 toEdge = min( within, 1.0 - within ) * vec2( ${BRICK.length.toFixed(3)}, ${BRICK.height.toFixed(3)} );
	float joint = 1.0 - step( ${(BRICK.joint / 2).toFixed(4)}, min( toEdge.x, toEdge.y ) );
	vec2 brickId = floor( bond );
	float wander = fract( sin( dot( brickId, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	vec3 brickColour = ${vec3Of(BRICK.colour)} * ( 1.0 - ${BRICK_WANDER.toFixed(2)} + 2.0 * ${BRICK_WANDER.toFixed(2)} * wander );
	vec2 spread = fwidth( bond );
	float blur = smoothstep( ${BOND_FADE[0].toFixed(2)}, ${BOND_FADE[1].toFixed(2)}, max( spread.x, spread.y ) );
	diffuseColor.rgb = mix( mix( brickColour, ${vec3Of(BRICK.mortar)}, joint ), ${vec3Of(BRICK.mean)}, blur );
}
#endif`;

/** `fragmentShader` (three's standard one, as the slab's material has it) with the paving's varyings and, under `PAVING_BRICK`, the brick bond after the colour is made. */
function pavingFragment(fragmentShader: string): string {
  return fragmentShader.replace("#include <common>", `#include <common>${PAVING_VARYINGS}`).replace("#include <color_fragment>", `#include <color_fragment>${PAVING_BRICK_FRAGMENT}`);
}

/** The slabs' material lays brick instead of the concrete (one course's choice): its programs are keyed apart. */
export function layBrick(material: THREE.MeshStandardMaterial): void {
  material.defines = { ...material.defines, PAVING_BRICK: "" };
  material.needsUpdate = true;
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
    shader.fragmentShader = pavingFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${key.call(material)}|paving`;
  reliefMaterial(material, specOf(SLAB, GROUND_METRES[SLAB]));
}
