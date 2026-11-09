import { detCos, detSin } from "../../kernel/physics-core.js";
import { PREFABS, type PrefabId } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { mulberry32 } from "../placements.ts";
import { SCENERY_ASSETS } from "../scenery-assets/index.ts";
import { assetPrefab } from "../scenery-assets/pick.ts";
import { FACING } from "./openworld-constants.ts";
import { BAY, DOOR, drawnHalf, homeFrontages, STOOP, type Frontage } from "./openworld-facade-solids.ts";
import type { Geometry, Lots, Side } from "./openworld-layout.ts";

/** The street trees' kinds: a big London plane, a medium linden, a young narrow tree and a flowering cherry. */
const STREET_TREE_KINDS = ["plane", "linden", "young", "cherry"] as const;
export type StreetTreeKind = (typeof STREET_TREE_KINDS)[number];
/** Out of `KIND_SHARE_TOTAL`, how many street trees are of each kind (in `STREET_TREE_KINDS` order): mostly planes, as on Society Hill's streets. */
const KIND_SHARES = [9, 5, 3, 3] as const;
const KIND_SHARE_TOTAL = 20;

/** What the track art draws a tree in: its kind, one draw group per kind whatever the tree's facing. */
export type StreetTreeSkin = `street-tree:${StreetTreeKind}`;
const SKIN_PREFIX = "street-tree";

/** A tree's drawn turn off its street's facing: within this (rad) either way, in `TURN_STEPS` even steps. */
const TURN_SPREAD = 0.15;
const TURN_STEPS = 4;
/** A tree's drawn size against its kind's own. */
const TREE_SIZES = [0.88, 0.96, 1.04, 1.12] as const;
const VARIATIONS = TURN_STEPS * TREE_SIZES.length;

/** Spatial hash primes (Teschner et al.): a point's cell on an eighth-metre grid mixes into one seed, the same on every peer. */
const HASH_PRIME_X = 73856093;
const HASH_PRIME_Z = 19349663;
const HASH_CELLS_PER_METRE = 8;
/** Salt of the street greenery's choices, so they never repeat another stream keyed by the same point. */
const GREENERY_SEED = 0x6ee7;

function seedAt(x: number, z: number): number {
  return (Math.imul(Math.round(x * HASH_CELLS_PER_METRE), HASH_PRIME_X) ^ Math.imul(Math.round(z * HASH_CELLS_PER_METRE), HASH_PRIME_Z) ^ GREENERY_SEED) >>> 0;
}

function kindOf(unit: number): StreetTreeKind {
  let pick = unit * KIND_SHARE_TOTAL;
  for (let kind = 0; kind < STREET_TREE_KINDS.length; kind++) {
    pick -= KIND_SHARES[kind]!;
    if (pick < 0) return STREET_TREE_KINDS[kind]!;
  }
  return STREET_TREE_KINDS[STREET_TREE_KINDS.length - 1]!;
}

/** The `style` of the street tree standing at (x, z) on a block's `side`: its kind and its variation, seeded by the spot; the facing is the side's street. */
export function streetTreeStyle(x: number, z: number, side: Side): string {
  const random = mulberry32(seedAt(x, z));
  const kind = kindOf(random());
  return `${SKIN_PREFIX}:${kind}:${side}:${Math.floor(random() * VARIATIONS)}`;
}

/** The kind a street tree's skin draws. */
export function streetTreeKindOf(skin: StreetTreeSkin): StreetTreeKind {
  return STREET_TREE_KINDS.find((kind) => skin === `${SKIN_PREFIX}:${kind}`) ?? STREET_TREE_KINDS[0];
}

const isSide = (name: string | undefined): name is Side => name !== undefined && Object.hasOwn(FACING, name);

export function isStreetTreeSkin(skin: string | null): skin is StreetTreeSkin {
  return skin !== null && STREET_TREE_KINDS.some((kind) => skin === `${SKIN_PREFIX}:${kind}`);
}

/** A street tree as drawn: its skin, the turn its canopy faces (the street's facing, give or take its own turn) and its size against its kind's. Drawn only: the prop's collider never reads it. */
type StreetTree = { skin: StreetTreeSkin; kind: StreetTreeKind; yaw: number; scale: number };

/** The street tree a tree prop's `style` names, null when it names none (a tree of any other course). */
export function streetTreeOf(style: string | undefined): StreetTree | null {
  if (style === undefined) return null;
  const [prefix, kind, side, variation] = style.split(":");
  const kindAt = STREET_TREE_KINDS.findIndex((candidate) => candidate === kind);
  const index = Number(variation);
  if (prefix !== SKIN_PREFIX || kindAt < 0 || !isSide(side) || !Number.isInteger(index) || index < 0 || index >= VARIATIONS) return null;
  const turn = -TURN_SPREAD + (2 * TURN_SPREAD * (index % TURN_STEPS)) / (TURN_STEPS - 1);
  const kindName = STREET_TREE_KINDS[kindAt]!;
  return { skin: `${SKIN_PREFIX}:${kindName}`, kind: kindName, yaw: FACING[side] + turn, scale: TREE_SIZES[Math.floor(index / TURN_STEPS)]! };
}

/** Out of 100, the rowhomes with a pot in the notch between their bay and their stoop, and those with a shrub before their bay beside the stoop. */
const POT_SHARE = 45;
const SHRUB_SHARE = 35;
const PERCENT = 100;
/** Bits of a frontage's variant that pick the shrub and which asset, apart from the pot's. */
const SHRUB_BITS = 7;
const ASSET_BITS = 14;
const POT_ASSETS = ["greenery-pot-terracotta-red", "greenery-pot-glazed-blue"] as const;
const SHRUB_ASSETS = ["greenery-boxwood-ball", "greenery-shrub-hydrangea-blue", "greenery-shrub-azalea-pink", "greenery-fern"] as const;
/** Clear (m) kept round a planter from the wall, the bay, the stoop and the sidewalk's clear path. */
const PLANTER_CLEAR = 0.05;
/** A cross sprite turned 45 degrees off the facade reaches this share of its width along the facade and out of it either way: half its width times cos 45. */
const CROSS_DIAGONAL_REACH = Math.SQRT1_2 / 2;
const QUARTER_PI = Math.PI / 4;

/** How far (m) out of a house's drawn front wall the sidewalk's clear path begins: the wall stands short of the footprint's front, which a setback behind the property line, the frontage zone beyond it. */
function clearPathFromWall(geometry: Geometry): number {
  return geometry.houseDepth / 2 - drawnHalf(geometry.houseDepth) + geometry.setback + geometry.sidewalkFrontage;
}

/** A course prop that names a greenery asset, collider-less, scaled to fit where it stands. */
type GreeneryProp = { prefab: PrefabId; asset: string; x: number; z: number; yaw: number; scale: number };

function greeneryProp(asset: string, frontage: Frontage, out: number, across: number, width: number): GreeneryProp {
  const row = SCENERY_ASSETS.find((candidate) => candidate.id === asset);
  if (row === undefined) throw new Error(`openworld greenery: no scenery asset "${asset}"`);
  const cos = detCos(frontage.yaw);
  const sin = detSin(frontage.yaw);
  return { prefab: assetPrefab(row), asset, x: frontage.x + cos * out + sin * across, z: frontage.z - sin * out + cos * across, yaw: frontage.yaw + QUARTER_PI, scale: width / row.size[0] };
}

/** The pot's spot: in the notch between the bay's side and the stoop's, against the wall. */
function potSpot(): Spot {
  const bayEdge = BAY.across + BAY.width / 2;
  const stoopEdge = DOOR.across - STOOP.width / 2;
  const reach = (stoopEdge - bayEdge) / 2 - PLANTER_CLEAR;
  return { out: reach + PLANTER_CLEAR, across: (bayEdge + stoopEdge) / 2, width: reach / CROSS_DIAGONAL_REACH };
}

/** The shrub's spot: before the bay's corner nearest the stoop, between the bay's front and the clear path. */
function shrubSpot(geometry: Geometry): Spot {
  const near = BAY.out + PLANTER_CLEAR;
  const far = clearPathFromWall(geometry) - PLANTER_CLEAR;
  const reach = (far - near) / 2;
  return { out: (near + far) / 2, across: BAY.across + BAY.width / 2 - reach - PLANTER_CLEAR, width: reach / CROSS_DIAGONAL_REACH };
}

/** A course prop's place: what the street's fabric stands (the cellar doors in the sidewalk a plant keeps off). */
type Fixture = { prefab: PrefabId; x: number; z: number; yaw: number };

type Spot = { out: number; across: number; width: number };

/** Kept clear (m) round a cellar door. */
const CELLAR_GAP = 0.1;

/** Whether a plant at `spot` stands clear of every cellar door of `fixtures`, all measured in the frontage's frame (a cellar door stands turned as its house, its first extent out of the wall, its third along it). */
function clearOfCellars(frontage: Frontage, spot: Spot, fixtures: readonly Fixture[]): boolean {
  const cos = detCos(frontage.yaw);
  const sin = detSin(frontage.yaw);
  const reach = spot.width * CROSS_DIAGONAL_REACH;
  const [depth, , span] = PREFABS[PREFAB.cellarDoor].size;
  for (const fixture of fixtures) {
    if (fixture.prefab !== PREFAB.cellarDoor) continue;
    const out = (fixture.x - frontage.x) * cos - (fixture.z - frontage.z) * sin;
    const across = (fixture.x - frontage.x) * sin + (fixture.z - frontage.z) * cos;
    if (Math.abs(out - spot.out) < reach + depth / 2 + CELLAR_GAP && Math.abs(across - spot.across) < reach + span / 2 + CELLAR_GAP) return false;
  }
  return true;
}

/**
 * What stands at one rowhome's front: a pot in the notch beside its stoop and/or a shrub before its bay, by the house's variant, and none where a cellar door of `fixtures` lies; drawn only, clear of the bay,
 * the stoop and the sidewalk's clear path.
 */
export function greeneryAt(frontage: Frontage, geometry: Geometry, fixtures: readonly Fixture[]): GreeneryProp[] {
  const pick = frontage.variant >>> ASSET_BITS;
  const props: GreeneryProp[] = [];
  const pot = potSpot();
  if (frontage.variant % PERCENT < POT_SHARE && clearOfCellars(frontage, pot, fixtures)) props.push(greeneryProp(POT_ASSETS[pick % POT_ASSETS.length]!, frontage, pot.out, pot.across, pot.width));
  const shrub = shrubSpot(geometry);
  if ((frontage.variant >>> SHRUB_BITS) % PERCENT < SHRUB_SHARE && clearOfCellars(frontage, shrub, fixtures)) props.push(greeneryProp(SHRUB_ASSETS[pick % SHRUB_ASSETS.length]!, frontage, shrub.out, shrub.across, shrub.width));
  return props;
}

/** Potted plants and shrubs at a share of the playable rowhomes' fronts, clear of the cellar doors among `fixtures`. */
export function stoopGreeneryProps(lots: Lots, fixtures: readonly Fixture[]): GreeneryProp[] {
  return homeFrontages(lots.places.slice(0, lots.backdropStart)).flatMap((frontage) => greeneryAt(frontage, lots.geometry, fixtures));
}
