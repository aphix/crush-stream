import type { AssetFamily } from "../../world/scenery-assets/types.ts";

/** One asset's place in its family's textures (rows parallel the family's `world/scenery-assets` rows). */
export type AtlasCell = {
  id: string;
  /** Left, top, width and height of the cell as shares of the atlas (origin top left, as the maps are loaded: `flipY` off). A tile has none. */
  rect: readonly [number, number, number, number];
  /** Mean sRGB colour of the cell's opaque texels: a plant's leaves take it when a car drives through. */
  tint: number;
  /** A tile's layer in the family's tile arrays. */
  layer?: number;
};

/** A family's textures, written by `scripts/sprite-pack.mjs` to `public/scenery/<family>-*.webp`. */
export type AtlasFamily = {
  family: AssetFamily;
  /** Size (px) of the full tier's albedo atlas (the half-size one and the normal map are 1/2 of it each way). */
  width: number;
  height: number;
  /** Layers of the tile arrays (each `tileSize` px square at the full tier, half at the low ones); 0 when the family has no tiles. */
  tiles: number;
  tileSize: number;
  cells: readonly AtlasCell[];
};
