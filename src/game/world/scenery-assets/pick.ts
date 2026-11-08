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

/** The generic prefab that draws `a`: a solid card is a standee, a solid cross a solid cross and a solid box a solid box (each a unit collider the placement scales). */
export function assetPrefab(a: SceneryAsset): PrefabId {
  const solid = a.body === "solid";
  switch (a.kind) {
    case "card":
      return solid ? PREFAB.assetStandee : PREFAB.assetCard;
    case "cross":
      return solid ? PREFAB.assetCrossSolid : PREFAB.assetCross;
    case "box":
      return solid ? PREFAB.assetBoxSolid : PREFAB.assetBox;
    case "tile":
      return PREFAB.assetTile;
    case "decal":
      return PREFAB.assetDecal;
  }
}

/**
 * The scale (x along the front, y up, z across) at which `a`'s generic prefab is `a`'s own size (m), times `k`. A decal or tile lies
 * flat: x and z are its extent, y 1. A solid card or cross is scaled to its collider, `core` of the drawn width (the art widens to the
 * drawn width); a box is as deep as its `depth`, else as deep as it is wide to its height.
 */
export function assetScale(a: SceneryAsset, k: number): readonly [number, number, number] {
  const [w, h] = a.size;
  switch (assetPrefab(a)) {
    case PREFAB.assetCard:
      return [CARD_DEPTH * k, h * k, w * k];
    case PREFAB.assetCross:
      return [w * k, h * k, w * k];
    case PREFAB.assetStandee:
      return [Math.min(STANDEE_DEPTH, w * a.core) * k, h * k, w * a.core * k];
    case PREFAB.assetCrossSolid:
      return [w * a.core * k, h * k, w * a.core * k];
    case PREFAB.assetBox:
    case PREFAB.assetBoxSolid:
      return [(a.depth ?? Math.min(w, Math.max(h, 1))) * k, h * k, w * k];
    case PREFAB.assetTile:
      return [w * TILE_REPEATS * k, 1, h * TILE_REPEATS * k];
    default:
      return [w * k, 1, h * k];
  }
}

/**
 * Where an asset stands (`scenery.ts` has a pass for each): on a lattice beyond the wall line (`lattice`: uprights and ground paint;
 * `patch`: tiles), inside a loop (`islands`), at stations along the wall line (`frontage`; `trackside` in rows along the race loop),
 * on the road surface (`road`) or on a car park slab (`lot`).
 */
export type AssetMode = "lattice" | "patch" | "islands" | "frontage" | "trackside" | "road" | "lot";

/** The asset rules that have a lattice beyond the wall line, and the rules whose flat assets lie on the road surface. */
export const LATTICE_RULES = ["verge", "yard", "ground", "paving"] as const;
export type LatticeRule = (typeof LATTICE_RULES)[number];
export const ROAD_RULES = ["paving", "trackside", "yard"] as const;

type SceneryRule = (typeof SCENERY_RULES)[number];

const RULE_OF: Record<AssetRule, SceneryRule> = { verge: "verge", yard: "verge", ground: "verge", islands: "islands", frontage: "frontage", paving: "paving", trackside: "trackside", carpark: "trackside" };

/** The scenery rule (index into `SCENERY_RULES`, which a course's `scenery.off` and `density` name) an asset rule belongs to. */
export function sceneryRule(rule: AssetRule): number {
  return SCENERY_RULES.indexOf(RULE_OF[rule]);
}

/** The id of the tile that also paves a city's roads (thinly), as well as standing beside them. */
const ROAD_TILE = "ground-tile-cobblestone";

function modeOf(a: SceneryAsset): AssetMode {
  switch (a.rule) {
    case "carpark":
      return "lot";
    case "islands":
      return "islands";
    case "frontage":
      return "frontage";
    case "trackside":
      return a.kind === "decal" || a.kind === "tile" ? "road" : "trackside";
    default:
      if (a.kind === "tile") return "patch";
      return a.kind === "decal" && (a.rule === "paving" || a.rule === "yard") ? "road" : "lattice";
  }
}

/** Whether `a` of asset rule `rule` stands in `mode`: its own mode, and a cobbled road's tile on the road too. */
function inMode(a: SceneryAsset, rule: AssetRule, mode: AssetMode): boolean {
  return a.weight > 0 && a.rule === rule && (modeOf(a) === mode || (mode === "road" && a.id === ROAD_TILE));
}

/** Whether any asset of asset rule `rule` stands in `mode`, in any biome: a pass over nothing is skipped. */
export function hasAssets(mode: AssetMode, rule: AssetRule): boolean {
  return SCENERY_ASSETS.some((a) => inMode(a, rule, mode));
}

/** Whether `a` is drawn in `biome`. */
export function standsIn(a: SceneryAsset, biome: BiomeId): boolean {
  return a.biomes.some((b) => b === biome);
}

type Table = { index: Int32Array; share: Float64Array; total: number };

const tables = new Map<string, Table>();

/** The assets of asset rule `rule` that stand in `mode` in `biome`, with their cumulative weights: built once per triple. */
function tableOf(mode: AssetMode, rule: AssetRule, biome: BiomeId): Table {
  const key = `${mode}:${rule}:${biome}`;
  let t = tables.get(key);
  if (!t) {
    const rows: number[] = [];
    for (let i = 0; i < SCENERY_ASSETS.length; i++) {
      const a = SCENERY_ASSETS[i]!;
      if (inMode(a, rule, mode) && standsIn(a, biome)) rows.push(i);
    }
    const share = new Float64Array(rows.length);
    let total = 0;
    for (let n = 0; n < rows.length; n++) share[n] = total += SCENERY_ASSETS[rows[n]!]!.weight;
    t = { index: Int32Array.from(rows), share, total };
    tables.set(key, t);
  }
  return t;
}

/** The index in `SCENERY_ASSETS` of the asset of asset rule `rule` in `mode` and `biome` that `u` (in [0, 1)) picks by weight; -1 when none stands there. */
export function pickAsset(mode: AssetMode, rule: AssetRule, biome: BiomeId, u: number): number {
  const t = tableOf(mode, rule, biome);
  const at = u * t.total;
  for (let n = 0; n < t.index.length; n++) if (at < t.share[n]!) return t.index[n]!;
  return t.index.length > 0 ? t.index[t.index.length - 1]! : -1;
}
