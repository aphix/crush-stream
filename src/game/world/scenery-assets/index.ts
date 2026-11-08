import { COUNTRYSIDE } from "./countryside.ts";
import { DESERT } from "./desert.ts";
import { GREENERY } from "./greenery.ts";
import { GROUND } from "./ground.ts";
import { INDUSTRIAL } from "./industrial.ts";
import { STREET } from "./street.ts";
import { TRACKSIDE } from "./trackside.ts";
import { ASSET_FAMILIES, type AssetFamily, type SceneryAsset } from "./types.ts";

/** Every family's assets, in `ASSET_FAMILIES` order: a placement's `asset` indexes this list, a family's rows being contiguous. */
const BY_FAMILY: Record<AssetFamily, readonly SceneryAsset[]> = { greenery: GREENERY, desert: DESERT, countryside: COUNTRYSIDE, street: STREET, industrial: INDUSTRIAL, ground: GROUND, trackside: TRACKSIDE };
export const SCENERY_ASSETS: readonly SceneryAsset[] = ASSET_FAMILIES.flatMap((f) => BY_FAMILY[f]);

/** Index in `SCENERY_ASSETS` of each family's first asset. */
export const FAMILY_BASE = Object.fromEntries(ASSET_FAMILIES.map((f, i) => [f, ASSET_FAMILIES.slice(0, i).reduce((n, g) => n + BY_FAMILY[g].length, 0)])) as Record<AssetFamily, number>;

export { ASSET_FAMILIES, type AssetFamily, type SceneryAsset } from "./types.ts";
