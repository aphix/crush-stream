import countryside from "./countryside.json" with { type: "json" };
import desert from "./desert.json" with { type: "json" };
import greenery from "./greenery.json" with { type: "json" };
import ground from "./ground.json" with { type: "json" };
import industrial from "./industrial.json" with { type: "json" };
import street from "./street.json" with { type: "json" };
import trackside from "./trackside.json" with { type: "json" };
import { ASSET_FAMILIES, type AssetFamily, type SceneryAsset } from "./types.ts";

/** A family's rows as `scripts/sprite-pack.mjs` writes them: the family is the file's. */
type Row = Omit<SceneryAsset, "family">;

const ROWS = { greenery, desert, countryside, street, industrial, ground, trackside } as unknown as Record<AssetFamily, readonly Row[]>;

/** Every family's assets, in `ASSET_FAMILIES` order: a placement's `asset` indexes this list, a family's rows being contiguous. */
export const SCENERY_ASSETS: readonly SceneryAsset[] = ASSET_FAMILIES.flatMap((family) => ROWS[family].map((row) => ({ ...row, family })));

/** Index in `SCENERY_ASSETS` of each family's first asset. */
export const FAMILY_BASE = Object.fromEntries(ASSET_FAMILIES.map((f, i) => [f, ASSET_FAMILIES.slice(0, i).reduce((n, g) => n + ROWS[g].length, 0)])) as Record<AssetFamily, number>;

export { ASSET_FAMILIES, type AssetFamily, type SceneryAsset } from "./types.ts";
