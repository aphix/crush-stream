import type { AssetFamily } from "../../world/scenery-assets/types.ts";
import { COUNTRYSIDE_ATLAS } from "./countryside.ts";
import { DESERT_ATLAS } from "./desert.ts";
import { GREENERY_ATLAS } from "./greenery.ts";
import { GROUND_ATLAS } from "./ground.ts";
import { INDUSTRIAL_ATLAS } from "./industrial.ts";
import { STREET_ATLAS } from "./street.ts";
import { TRACKSIDE_ATLAS } from "./trackside.ts";
import type { AtlasFamily } from "./types.ts";

/** Each family's atlas. */
export const ATLAS: Record<AssetFamily, AtlasFamily> = { greenery: GREENERY_ATLAS, desert: DESERT_ATLAS, countryside: COUNTRYSIDE_ATLAS, street: STREET_ATLAS, industrial: INDUSTRIAL_ATLAS, ground: GROUND_ATLAS, trackside: TRACKSIDE_ATLAS };

export type { AtlasCell, AtlasFamily } from "./types.ts";
