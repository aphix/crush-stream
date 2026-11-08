import { PREFABS, type PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { ASSET_FAMILIES, SCENERY_ASSETS, type AssetFamily, type SceneryAsset } from "../world/scenery-assets/index.ts";
import { assetPrefab, assetScale } from "../world/scenery-assets/pick.ts";
import { FACADE, type FacadeStyle } from "./facades.ts";
import type { Skin } from "./prefab-pieces.ts";

/** The showcase gallery's rows: a row is cells laid left to right, centred on x 0, each turned to face a viewer who stands near the eye and looks +z. */

/** A prefab's front is +X, so a quarter turn puts it toward -z, where a free cam standing near the eye and looking +z sees it. */
const FACE_EYE_SIDE = Math.PI / 2;
/** A flat sprite's picture has its top toward -z at yaw 0: a half turn puts the top away from that viewer, so it reads upright. */
const FLAT_YAW = Math.PI;
/** Prefabs whose long side already runs along x at yaw 0: turned a quarter they would stand end-on. */
const LONG_SIDE_ALONG_X: ReadonlySet<PrefabId> = new Set([PREFAB.fence, PREFAB.dumpster]);

/** Metres between neighbours in a row, between a row's far edge and the next row's near edge, and between neighbouring buildings (room for each to slide to its roof). */
const GAP = 1.5;
const ROW_GAP = 2.5;
const BUILDING_GAP = 4;
/** The widest a row of the scenery rows may run (m): a longer family is cut into two rows. */
const MAX_ROW_WIDTH = 100;
/** Where the scenery rows begin (z, m): the old rows end with the building row's far edge at 44. */
const FIRST_ROW_EDGE = 47;

/** The facade shader's roof pick, mirrored (`facades.ts`): a building's position hashed to a fraction in [0, 1) that its style's roof weights cut into the five coverings. */
const ROOF_HASH = { x: 0.0791, z: 0.1137, spread: 7.31, shift: 0.17 } as const;
/** How far (m) a building may slide along its row to land on its style's likeliest covering, and the step it is tried at: the pick turns 0.58 a metre, so a metre each way tries every covering. */
const ROOF_SLIDE = 1;
const ROOF_STEP = 0.01;

const fract = (value: number): number => value - Math.floor(value);
const add = (a: number, b: number): number => a + b;

function roofPick(x: number, z: number): number {
  return fract(fract(ROOF_HASH.x * x + ROOF_HASH.z * z) * ROOF_HASH.spread + ROOF_HASH.shift);
}

/** `x` slid within `ROOF_SLIDE` to where the shader picks the middle of `style`'s likeliest roof covering for a building at (x, z). */
function roofSpot(style: FacadeStyle, x: number, z: number): number {
  const weights: readonly number[] = FACADE[style].roofs;
  const likeliest = weights.indexOf(Math.max(...weights));
  const middle = (weights.slice(0, likeliest).reduce(add, 0) + weights[likeliest]! / 2) / weights.reduce(add, 0);
  let best = x;
  let miss = Infinity;
  for (let slide = -ROOF_SLIDE; slide <= ROOF_SLIDE; slide += ROOF_STEP) {
    const off = Math.abs(roofPick(x + slide, z) - middle);
    if (off < miss) {
      miss = off;
      best = x + slide;
    }
  }
  return best;
}

/** One piece of a row: what stands, the x extent it fills along the row and the z depth it needs, both after its turn; a building also names its facade style. */
type Cell = { stand: Omit<Placed, "x" | "y" | "z">; width: number; depth: number; style?: FacadeStyle };
type Row = { cells: Cell[]; gap: number };

/** The facade style of each building the rows stand in a style of its own (the placement itself holds nothing of it). */
const BUILDING_STYLE = new Map<Placed, FacadeStyle>();

/** What a placement of the gallery is dressed in: its asset's family, or its building's style; null for a prefab with one look. */
export function galleryStyleOf(p: Placed): Skin {
  return p.asset === undefined ? (BUILDING_STYLE.get(p) ?? null) : SCENERY_ASSETS[p.asset]!.family;
}

function layRow(z: number, cells: readonly Cell[], gap: number): Placed[] {
  let left = -(cells.reduce((sum, c) => sum + c.width, 0) + gap * (cells.length - 1)) / 2;
  return cells.map(({ stand, width, style }) => {
    const middle = left + width / 2;
    left += width + gap;
    const placed: Placed = { ...stand, x: style ? roofSpot(style, middle, z) : middle, y: 0, z };
    if (style) BUILDING_STYLE.set(placed, style);
    return placed;
  });
}

function cellOfPrefab(prefab: PrefabId): Cell {
  const alongX = LONG_SIDE_ALONG_X.has(prefab);
  const [w, , d] = PREFABS[prefab].size;
  return { stand: { prefab, yaw: alongX ? 0 : FACE_EYE_SIDE, sx: 1, sy: 1, sz: 1 }, width: alongX ? w : d, depth: alongX ? d : w };
}

/** `ids` at scale 1 in a row at `z`, `gap` m apart, centred on x 0 and laid left to right by each one's x extent after its turn. */
export function galleryRow(z: number, ids: readonly PrefabId[], gap: number): Placed[] {
  return layRow(z, ids.map(cellOfPrefab), gap);
}

const isFlat = (a: SceneryAsset): boolean => a.kind === "decal" || a.kind === "tile";

/** Asset `asset` at its own size: an upright sprite is as wide as it is drawn (a solid one is drawn wider than its collider), a cross as deep as it is wide. */
function cellOfAsset(asset: number, a: SceneryAsset): Cell {
  const [sx, sy, sz] = assetScale(a, 1);
  const stand = { prefab: assetPrefab(a), yaw: isFlat(a) ? FLAT_YAW : FACE_EYE_SIDE, sx, sy, sz, asset };
  if (isFlat(a)) return { stand, width: sx, depth: sz };
  return { stand, width: a.size[0], depth: a.kind === "cross" ? a.size[0] : sx };
}

/** `cells` cut into rows no wider than `MAX_ROW_WIDTH`, each filled before the next. */
function inRows(cells: readonly Cell[], gap: number): Row[] {
  const rows: Row[] = [];
  let used = 0;
  for (const cell of cells) {
    const row = rows[rows.length - 1];
    if (row && used + gap + cell.width <= MAX_ROW_WIDTH) {
      row.cells.push(cell);
      used += gap + cell.width;
    } else {
      rows.push({ cells: [cell], gap });
      used = cell.width;
    }
  }
  return rows;
}

/** A family's flat patches in front rows (a viewer would not see them behind an upright sprite), then its upright sprites. */
function familyRows(family: AssetFamily): Row[] {
  const flats: Cell[] = [];
  const uprights: Cell[] = [];
  for (const [asset, a] of SCENERY_ASSETS.entries()) {
    if (a.family !== family) continue;
    (isFlat(a) ? flats : uprights).push(cellOfAsset(asset, a));
  }
  return [...inRows(flats, GAP), ...inRows(uprights, GAP)];
}

/** Low families first (by their tallest upright), so a tall row never hides the one behind it. */
const tallest = (family: AssetFamily): number => Math.max(0, ...SCENERY_ASSETS.filter((a) => a.family === family && !isFlat(a)).map((a) => a.size[1]));
const FAMILY_ORDER: readonly AssetFamily[] = [...ASSET_FAMILIES].sort((a, b) => tallest(a) - tallest(b));

/** The building styles with no prefab of their own (the old rows hold the two that have), each on the generic building. */
const OTHER_STYLES = (Object.keys(FACADE) as FacadeStyle[]).filter((style) => FACADE[style].home === null);

const ROWS: readonly Row[] = [
  { cells: [PREFAB.bush, PREFAB.flowers, PREFAB.sidewalk].map(cellOfPrefab), gap: GAP },
  ...FAMILY_ORDER.flatMap(familyRows),
  ...inRows(OTHER_STYLES.map((style) => ({ ...cellOfPrefab(PREFAB.building), style })), BUILDING_GAP),
];

/** The ground cover and paving, then every scenery asset family by family, then a building of every other facade style: rows behind the old ones, `ROW_GAP` apart. */
export const SCENERY_GALLERY: readonly Placed[] = (() => {
  let edge = FIRST_ROW_EDGE;
  return ROWS.flatMap(({ cells, gap }) => {
    const depth = Math.max(...cells.map((c) => c.depth));
    const z = edge + depth / 2;
    edge = z + depth / 2 + ROW_GAP;
    return layRow(z, cells, gap);
  });
})();