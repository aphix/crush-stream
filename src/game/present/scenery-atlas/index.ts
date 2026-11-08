import { ASSET_FAMILIES, type AssetFamily } from "../../world/scenery-assets/types.ts";
import countryside from "./countryside.json" with { type: "json" };
import desert from "./desert.json" with { type: "json" };
import greenery from "./greenery.json" with { type: "json" };
import ground from "./ground.json" with { type: "json" };
import industrial from "./industrial.json" with { type: "json" };
import street from "./street.json" with { type: "json" };
import trackside from "./trackside.json" with { type: "json" };
import type { AtlasFamily } from "./types.ts";

/** A family's atlas as `scripts/sprite-pack.mjs` writes it: the family is the file's. */
type Atlas = Omit<AtlasFamily, "family">;

const ATLASES = { greenery, desert, countryside, street, industrial, ground, trackside } as unknown as Record<AssetFamily, Atlas>;

/** Each family's atlas. */
export const ATLAS = Object.fromEntries(ASSET_FAMILIES.map((family) => [family, { ...ATLASES[family], family }])) as Record<AssetFamily, AtlasFamily>;

export type { AtlasCell } from "./types.ts";
