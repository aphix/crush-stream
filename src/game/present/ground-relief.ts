import type * as THREE from "three";
import type { SurfaceId } from "../world/catalog.ts";
import { reliefMaterial, type ReliefSpec } from "./surface-relief.ts";

/**
 * The normal maps of the ground surfaces (`public/surfaces/<name>-normal.webp`, packed by `scripts/pack-ground.mjs`): one tileable map per surface, drawn
 * as the normal only (the colours are the surface's own). `GROUND_METRES` is what one tile of each map spans on the ground; the mesh's uv spans `tile` metres to
 * the unit (the albedo's own tile), so the map repeats `tile / metres` times. A sidewalk slab (`slab`) is its own map: it spans a slab's whole face.
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

/** A sidewalk slab's material takes the paving's: the slab's own uv (0 to 1 over a face) spans the map once. */
export function dressPaving(material: THREE.MeshStandardMaterial): void {
  reliefMaterial(material, specOf(SLAB, GROUND_METRES[SLAB]));
}
