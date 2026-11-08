import { BIOME, type BiomeId } from "../constants.ts";

/** The seven asset families, in registry order (`index.ts`): a placement's `asset` is an index into the families' rows laid end to end. */
export const ASSET_FAMILIES = ["greenery", BIOME.desert, "countryside", "street", "industrial", "ground", "trackside"] as const;
export type AssetFamily = (typeof ASSET_FAMILIES)[number];

/** How an asset is drawn: an upright quad (`card`), two crossed quads (`cross`), a flat quad on the ground (`decal`), a repeating ground patch (`tile`), a box wearing the skin (`box`). */
export type AssetKind = "card" | "cross" | "decal" | "tile" | "box";
/** What a car meets: `poof` a plant it drives through (drawn only), `none` nothing, `knock` a loose prop, `solid` a collider where a car can reach it (else drawn only). */
type AssetBody = "none" | "poof" | "knock" | "solid";
/** The placement rule that picks an asset (`scenery.ts`). */
export type AssetRule = "verge" | "islands" | "frontage" | "paving" | "trackside" | "carpark" | "yard" | "ground";

/** One asset of a family: everything placement reads (the uv rects and textures are drawing's, `present/scenery-atlas`). Written by `scripts/sprite-pack.mjs`. */
export type SceneryAsset = {
  id: string;
  family: AssetFamily;
  kind: AssetKind;
  /** Width and height (m); a decal's or tile's x and z extent. */
  size: readonly [number, number];
  body: AssetBody;
  biomes: readonly Exclude<BiomeId, "none">[];
  rule: AssetRule;
  /** Share (0 to 1) of the rule's lattice cells in its biomes this asset takes, against the others'. */
  weight: number;
  /** Share (0.15 to 1) of the drawn width a solid asset's collider takes: the width its opaque texels span over the bottom fifth of the sprite. */
  core: number;
  /** A box's extent (m) along its front's normal; a box's width and height are `size`. */
  depth?: number;
};

/** The road paint a course may opt into (`scenery.roadDecals`) and the asset each is: a generated decal or tile never lies on a road otherwise. */
export const ROAD_DECAL_NAMES = ["manhole", "crosswalk", "arrow", "kerb"] as const;
export type RoadDecalName = (typeof ROAD_DECAL_NAMES)[number];
export const ROAD_DECAL_ASSET: Record<RoadDecalName, string> = { manhole: "ground-manhole-cover", crosswalk: "ground-crosswalk-stripes", arrow: "ground-painted-arrow", kerb: "trackside-kerb-paint" };
