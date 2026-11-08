import type { PrefabId } from "../catalog.ts";
import { PREFAB, SCENERY_RULES, type BiomeId } from "../constants.ts";
import { SCENERY_ASSETS } from "./index.ts";
import type { AssetRule, SceneryAsset } from "./types.ts";

/** Depth (m, along the front) of a card's footprint: a sprite is a quad, this is the room it keeps from its neighbours. */
const CARD_DEPTH = 0.3;
/** The thickest (m) a standee's collider is: a sprite's solid box is as deep as it is wide, to this. */
const STANDEE_DEPTH = 0.5;
/** A tile patch's side as a number of its repeats (a tile's `size` is metres per repeat). */
export const TILE_REPEATS = 2;

/** The generic prefab that draws `a`: a solid card or cross is a standee (a sprite on a thin solid box), a solid box a solid box. */
export function assetPrefab(a: SceneryAsset): PrefabId {
  const solid = a.body === "solid";
  switch (a.kind) {
    case "card":
    case "cross":
      return solid ? PREFAB.assetStandee : a.kind === "card" ? PREFAB.assetCard : PREFAB.assetCross;
    case "box":
      return solid ? PREFAB.assetBoxSolid : PREFAB.assetBox;
    case "tile":
      return PREFAB.assetTile;
    case "decal":
      return PREFAB.assetDecal;
  }
}

/** The scale (x along the front, y up, z across) at which `a`'s generic prefab is `a`'s own size (m), times `k`. A decal or tile lies flat: x and z are its extent, y 1. */
export function assetScale(a: SceneryAsset, k: number): readonly [number, number, number] {
  const [w, h] = a.size;
  switch (assetPrefab(a)) {
    case PREFAB.assetCard:
      return [CARD_DEPTH * k, h * k, w * k];
    case PREFAB.assetCross:
      return [w * k, h * k, w * k];
    case PREFAB.assetStandee:
      return [Math.min(STANDEE_DEPTH, w) * k, h * k, w * k];
    case PREFAB.assetBox:
    case PREFAB.assetBoxSolid:
      return [Math.min(w, Math.max(h, 1)) * k, h * k, w * k];
    case PREFAB.assetTile:
      return [w * TILE_REPEATS * k, 1, h * TILE_REPEATS * k];
    default:
      return [w * k, 1, h * k];
  }
}

/** Where an asset stands: spots on the road surface (flat paint), stations along the wall line, inside the loops' islands, or on the verge's lattice. */
export type AssetMode = "road" | "stations" | "islands" | "lattice";

/** The scenery rule (index into `SCENERY_RULES`, which a course's `scenery.off` and `density` name) each asset rule belongs to. */
const RULE_OF: Record<AssetRule, string> = { verge: "verge", yard: "verge", ground: "verge", islands: "islands", frontage: "frontage", paving: "paving", trackside: "trackside", carpark: "trackside" };

export function ruleOf(a: SceneryAsset): number {
  return SCENERY_RULES.indexOf(RULE_OF[a.rule] as (typeof SCENERY_RULES)[number]);
}

export function modeOf(a: SceneryAsset): AssetMode {
  if (a.kind === "decal" && (a.rule === "paving" || a.rule === "trackside" || a.rule === "carpark" || a.rule === "yard")) return "road";
  if (a.rule === "frontage" || a.rule === "trackside") return "stations";
  return a.rule === "islands" ? "islands" : "lattice";
}

type Table = { index: Int32Array; share: Float64Array; total: number };

const tables = new Map<string, Table>();

/** The assets that stand in `mode` under scenery rule `rule` in `biome`, with their cumulative weights: built once per triple. */
function tableOf(mode: AssetMode, rule: number, biome: BiomeId): Table {
  const key = `${mode}:${rule}:${biome}`;
  let t = tables.get(key);
  if (!t) {
    const rows: number[] = [];
    for (let i = 0; i < SCENERY_ASSETS.length; i++) {
      const a = SCENERY_ASSETS[i]!;
      if (a.weight > 0 && modeOf(a) === mode && ruleOf(a) === rule && (a.biomes as readonly BiomeId[]).includes(biome)) rows.push(i);
    }
    const share = new Float64Array(rows.length);
    let total = 0;
    for (let n = 0; n < rows.length; n++) share[n] = total += SCENERY_ASSETS[rows[n]!]!.weight;
    t = { index: Int32Array.from(rows), share, total };
    tables.set(key, t);
  }
  return t;
}

/** The summed weight of the assets of `mode` and scenery `rule` that stand in `biome` (0: none). */
export function assetWeight(mode: AssetMode, rule: number, biome: BiomeId): number {
  return tableOf(mode, rule, biome).total;
}

/** The index in `SCENERY_ASSETS` of the asset of `mode` and scenery `rule` in `biome` that `u` (in [0, 1)) picks by weight; -1 when none stands there. */
export function pickAsset(mode: AssetMode, rule: number, biome: BiomeId, u: number): number {
  const t = tableOf(mode, rule, biome);
  const at = u * t.total;
  for (let n = 0; n < t.index.length; n++) if (at < t.share[n]!) return t.index[n]!;
  return t.index.length > 0 ? t.index[t.index.length - 1]! : -1;
}
