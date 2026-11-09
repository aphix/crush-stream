import { ROOFLINE } from "../constants.ts";
import { LAYOUT } from "./openworld-constants.ts";
import type { InteriorKind } from "./walk-graph.ts";

/** Plan coordinates: `deep` runs from the building's street face inward, `across` along the face from its centre line (its sign follows the building's local +z). */
export type Rect = { deep0: number; across0: number; deep1: number; across1: number };

/** A solid box in plan coordinates with its heights (m above the ground). */
export type Box = Rect & { y0: number; y1: number };

/** What a gap in a wall is: a doorway, a window (glazed), or the mouth of a bay window's alcove (open to the floor, its glazing and sides outside the wall). */
export const OPENING = { door: 0, window: 1, bay: 2 } as const;
type OpeningKind = (typeof OPENING)[keyof typeof OPENING];

/** A gap in a wall: its centre along the wall, its width, its sill and top above the floor (m), and what it is. */
export type Opening = { centre: number; width: number; sill: number; top: number; kind: OpeningKind };

/** A sheet of glass standing upright over a plan segment (deep and across at both ends) between two heights above the ground (m), on a floor's `level`. */
export type Pane = { level: number; deep0: number; across0: number; deep1: number; across1: number; y0: number; y1: number };

/** A bay window's alcove on a floor: the room's floor and ceiling carried out over the bay's outline (plan points: deep is negative outside the wall), the apron up to the sill and the head the glass stops at. */
export type Alcove = { level: number; floorY: number; sill: number; head: number; corners: readonly (readonly [deep: number, across: number])[] };

/** A wall running along `axis` at `fixed` on the other axis, `from` to `to`; `shell` walls are the envelope the far view keeps. */
export type Wall = { level: number; axis: "across" | "deep"; fixed: number; from: number; to: number; thick: number; openings: readonly Opening[]; shell: boolean };

/** A floor or ceiling slab: heights and plan rectangle; `shell` ones are part of the far view. */
export type Slab = { y0: number; y1: number; rect: Rect; shell: boolean };

/** Where a furnishing's front points, in plan axes: toward the street, toward +across, toward the back, toward -across. */
export const TURN = { front: 0, right: 1, back: 2, left: 3 } as const;
export type Turn = (typeof TURN)[keyof typeof TURN];

type FurnishingSpec = {
  /** Size across its front (m), along its front's direction, and height. */
  width: number;
  depth: number;
  height: number;
  /** Walkers and cars meet it. */
  solid: boolean;
  /** Seats it offers, evenly along its width, and each one's top above the floor (m). */
  seats: number;
  seatHeight: number;
  /** Drawn unlit (a lamp, a screen): the night's light. */
  glow: boolean;
};

const BARE = { solid: true, seats: 0, seatHeight: 0, glow: false } as const;
const SEAT = { solid: false, seats: 1, glow: false } as const;
const LIGHT = { solid: false, seats: 0, seatHeight: 0, glow: true } as const;
const SOFT = { solid: true, glow: false } as const;

/** A furnishing's size (m): across its front, along its front's direction, and its height. */
const size = (width: number, depth: number, height: number) => ({ width, depth, height });

/** One row per piece of furniture: size, whether it blocks, its seats. */
export const FURNISHING = {
  counter: { ...BARE, ...size(2, 0.7, 1.1) },
  backShelf: { ...BARE, ...size(2, 0.35, 2.1) },
  gondola: { ...BARE, ...size(1.6, 0.5, 1.8) },
  fridge: { ...BARE, ...size(0.75, 0.7, 1.8) },
  cabinet: { ...BARE, ...size(0.6, 0.6, 0.9) },
  stove: { ...BARE, ...size(0.75, 0.65, 0.9) },
  sink: { ...BARE, ...size(1.2, 0.6, 0.9) },
  table: { ...BARE, ...size(0.9, 0.9, 0.75) },
  desk: { ...BARE, ...size(1.4, 0.7, 0.75) },
  bed: { ...BARE, ...size(1.5, 2, 0.55) },
  dresser: { ...BARE, ...size(1, 0.5, 0.9) },
  bathtub: { ...BARE, ...size(1.7, 0.75, 0.55) },
  toilet: { ...BARE, ...size(0.4, 0.7, 0.7) },
  basin: { ...BARE, ...size(0.5, 0.4, 0.85) },
  tvUnit: { ...BARE, ...size(1.4, 0.45, 0.5) },
  poolTable: { ...BARE, ...size(2.4, 1.3, 0.85) },
  jukebox: { ...BARE, ...size(0.8, 0.6, 1.5) },
  rail: { ...BARE, ...size(3, 0.06, 1) },
  sofa: { ...SOFT, seats: 2, ...size(1.9, 0.9, 0.85), seatHeight: 0.44 },
  armchair: { ...SOFT, seats: 1, ...size(0.8, 0.8, 0.85), seatHeight: 0.44 },
  bench: { ...SOFT, seats: 2, ...size(1.4, 0.55, 0.9), seatHeight: 0.46 },
  stool: { ...SEAT, ...size(0.4, 0.4, 0.7), seatHeight: 0.7 },
  chair: { ...SEAT, ...size(0.45, 0.45, 0.9), seatHeight: 0.46 },
  deskChair: { ...SEAT, ...size(0.55, 0.55, 0.95), seatHeight: 0.5 },
  plant: { solid: false, seats: 0, seatHeight: 0, glow: false, ...size(0.45, 0.45, 1.2) },
  lamp: { ...LIGHT, ...size(0.45, 0.45, 0.3) },
  screen: { ...LIGHT, ...size(1, 0.05, 0.6) },
} as const satisfies Record<string, FurnishingSpec>;
export type FurnishingKind = keyof typeof FURNISHING;

export type Furnishing = {
  kind: FurnishingKind;
  level: number;
  /** Footprint centre in plan coordinates. */
  deep: number;
  across: number;
  facing: Turn;
  width: number;
  depth: number;
  height: number;
  /** Heights above the floor the piece is lifted by (a hanging lamp, a wall sign). */
  lift: number;
  /** The one counter customers buy at: its stand points are published on the place, `serveAt` m along its width from its middle. */
  serves: boolean;
  serveAt: number;
};

/** A straight flight: `steps` treads of `rise` and `run` from its foot `deep0` on the floor of `level`, climbing toward the back (`dir` 1) or toward the street (-1). */
export type Stairs = { level: number; deep0: number; across: number; width: number; steps: number; rise: number; run: number; dir: 1 | -1 };

export type InteriorPlan = {
  kind: InteriorKind;
  width: number;
  depth: number;
  /** Floor tops by level, and the underside of the topmost ceiling (m above the ground). */
  floors: readonly number[];
  topCeiling: number;
  walls: readonly Wall[];
  slabs: readonly Slab[];
  furnishings: readonly Furnishing[];
  stairs: readonly Stairs[];
  /** Every window's glass and every alcove, in plan coordinates. */
  panes: readonly Pane[];
  alcoves: readonly Alcove[];
};

/** The rowhome's ground floor stands on its stoop's landing (m). */
export const ROWHOME_FLOOR_Y = 0.9;
/** A rowhome's door stands this far along the lot from its centre line, toward the building's local +z: the bay stack takes the other side. */
const ROWHOME_DOOR_OFFSET = 1.8;
/** A shop floor stands this far over the sidewalk, so it never shares a plane with the ground (m). */
export const SHOP_FLOOR_Y = 0.05;
/** A slab between levels, the street and back walls, the party walls, and a partition (m). */
export const SLAB_THICK = 0.25;
export const SHELL_WALL = 0.3;
export const PARTY_WALL = 0.25;
export const PARTITION = 0.15;
/** The street wall's outer face stands this far behind the facade's own face, so the two never fight for a pixel (m). */
export const STREET_SKIN = 0.02;
/** The most a stair step may rise (m): the walker climbs 0.22 and a person is happiest on less. */
export const MAX_RISER = 0.19;
/** Depth of a tread (m). */
export const TREAD_RUN = 0.26;
/** The clear height a climber needs over every tread (m): a standing walker (1.8 m) and a margin. */
export const HEADROOM = 2;

/** Underside of the ceiling over `level`: the next floor's slab, or the roof's. */
export function ceilingOver(floors: readonly number[], topCeiling: number, level: number): number {
  return level + 1 < floors.length ? floors[level + 1]! - SLAB_THICK : topCeiling;
}

/** A building's storeys: a house or a shop stands between the fewest and the most, three as a rule. */
export const MIN_STOREYS = 2;
export const MAX_STOREYS = 5;
export const DEFAULT_STOREYS = 3;

/** The building prefab's own height (m): a placement stretches it to its height, and every band of its facade is laid in this height's metres. A row pins it to the catalog's. */
export const BLOCK_HEIGHT = 14;
/** Storey heights (m): a house's ground storey (its parlour 3.0-3.7 m), a shop's taller one, each storey above (nominal), the cornice, and what the roof slab adds over the cornice's top. */
const GROUND_STOREY = 3.6;
export const SHOP_GROUND_STOREY = 4;
const STOREY = 3;
export const CORNICE_DEPTH = 0.9;
const ROOF_ALLOWANCE = CORNICE_DEPTH + 0.4;
/** A floor stands this far (m) over its storey line, so a window's sill and the floor beside it never share a plane. */
const FLOOR_OVER_LINE = 0.1;

/** Whether an interior's building has a shop's taller ground storey. */
const hasShopGround = (kind: InteriorKind): boolean => kind !== "rowhome";

/** The height (m) of a building of `storeys` storeys (a shop's ground storey is taller). */
export function buildingHeight(storeys: number, shopGround: boolean): number {
  return (shopGround ? SHOP_GROUND_STOREY : GROUND_STOREY) + STOREY * (storeys - 1) + ROOF_ALLOWANCE;
}

/** How many storeys a building `height` m tall has (the inverse of `buildingHeight`), within the range buildings are built in. */
export function storeysOfHeight(height: number, shopGround: boolean): number {
  const storeys = Math.round((height - (shopGround ? SHOP_GROUND_STOREY : GROUND_STOREY) - ROOF_ALLOWANCE) / STOREY) + 1;
  return Math.min(MAX_STOREYS, Math.max(MIN_STOREYS, storeys));
}

/**
 * The storey lines of a building of `storeys` storeys, in metres above the ground: 0, the ground band's top, each storey's top above it, the last the cornice's foot. The cornice's top is the roofline
 * (`ROOFLINE` of the prefab's own height, in this building's metres), and the storeys above the ground band share what lies between them equally, so a storey is about `STOREY` tall whatever the count.
 */
export function storeyLines(storeys: number, shopGround: boolean): number[] {
  const ground = shopGround ? SHOP_GROUND_STOREY : GROUND_STOREY;
  const corniceFoot = (ROOFLINE * buildingHeight(storeys, shopGround)) / BLOCK_HEIGHT - CORNICE_DEPTH;
  const repeat = (corniceFoot - ground) / (storeys - 1);
  return [0, ...Array.from({ length: storeys }, (_, at) => ground + at * repeat)];
}

/**
 * Floors and the topmost ceiling of an interior of `storeys` storeys: a rowhome has its stoop's landing, then a floor 0.1 m over each storey line above its ground band; a shop has its own floor
 * 5 cm over the sidewalk, then the flats over it the same way. Level `k` stands in the storey whose top is line `k + 1`.
 */
export function levelsOf(kind: InteriorKind, storeys: number): { floors: readonly number[]; topCeiling: number } {
  const lines = storeyLines(storeys, hasShopGround(kind));
  const floors = Array.from({ length: storeys }, (_, level) => (level === 0 ? (kind === "rowhome" ? ROWHOME_FLOOR_Y : SHOP_FLOOR_Y) : lines[level]! + FLOOR_OVER_LINE));
  return { floors, topCeiling: lines[storeys]! - FLOOR_OVER_LINE };
}

/** A bay window's sill over its floor and its glass's height (m): a 1.5 m sash window. */
const BAY_SILL_ABOVE_FLOOR = 0.75;
const BAY_GLASS_HEIGHT = 1.5;

/** Each floor's bay window, a sash window over it: its sill and head above the ground (m). */
export function bayFloorsOf(floors: readonly number[]): readonly { sill: number; head: number }[] {
  return floors.map((floor) => ({ sill: floor + BAY_SILL_ABOVE_FLOOR, head: floor + BAY_SILL_ABOVE_FLOOR + BAY_GLASS_HEIGHT }));
}

/**
 * What the packed facade's albedo alpha says of a texel: a doorway (cut open always), a window (cut open while the room behind it is built, painted otherwise), the wall. The shader reads them
 * as thresholds halfway between, so a webp's rounding or a mip's blur never moves a texel across.
 */
export const FACADE_ALPHA = { doorway: 0, window: 128, wall: 255 } as const;
/** Over a doorway the facade's surround (transom, hood) runs this high (m): a window there is part of the door, not a room's, and stays painted. */
export const DOOR_SURROUND = 0.6;

/** The frontage bay every shopfront opening is measured in: one lot wide. */
export const BAY_WIDTH = LAYOUT.lotFrontage;

/** A doorway of a frontage bay: its centre from the bay's centre line, its width and its top above the floor (m). */
const doorway = (centre: number, width: number, top: number): Opening => ({ centre, width, sill: 0, top, kind: OPENING.door });

/**
 * The street wall's doorways per bay, cut through the facade's ground band and through the street wall alike. A doorway is at least 0.9 m wide. Its windows are not here: they are the facade
 * picture's (`facade-windows.ts`), so the room and the facade cannot disagree. A facade's u runs to the viewer's right, the plan's -across: the corner store's door (+0.9) is on the viewer's left.
 */
export const SHOPFRONT = {
  rowhome: [doorway(ROWHOME_DOOR_OFFSET, 1, 2.1)],
  coffee: [doorway(0, 1, 2.2)],
  bar: [doorway(0, 1, 2.25)],
  office: [doorway(0, 1.5, 2.4)],
  store: [doorway(0.9, 0.9, 2.1)],
} as const satisfies Record<InteriorKind, readonly Opening[]>;

/** The back door of a rowhome, into the yard. */
export const BACK_DOOR = doorway(0, 1, 2.1);

/** A person sits on the stoop's third step (the stoop is centred on the door): its top above the ground, how far out of the facade its tread's middle lies, and each sitter's offset from the door's line (m). */
export const STOOP_SEAT_HEIGHT = 0.54;
export const STOOP_SEAT_OUT = 0.92;
export const STOOP_SEAT_SPREAD = 0.4;

/** The look a floor of an interior wears: a flat over a shop is dressed as a home, whatever the shop below. */
export const lookKind = (kind: InteriorKind, level: number): InteriorKind => (level > 0 ? "rowhome" : kind);

/** Furniture's colours and the room's by interior (sRGB). */
export const ROOM_LOOK = {
  rowhome: { floor: 0x8a6a4a, wall: 0xe8dfcf, ceiling: 0xf4f0e8, trim: 0xf2eee6, wood: 0x6b4a32, accent: 0x5b7a6a, fabric: 0x7d8fa3 },
  coffee: { floor: 0x9a7650, wall: 0xdccfb8, ceiling: 0xefe8da, trim: 0xf1ede4, wood: 0x5a3d28, accent: 0x2f5d50, fabric: 0xb5653f },
  bar: { floor: 0x3a2b25, wall: 0x4a2a2e, ceiling: 0x1f1a1b, trim: 0x2b1f1e, wood: 0x4a2e1e, accent: 0xa3303c, fabric: 0x7a2432 },
  office: { floor: 0x6c7077, wall: 0xe6e9ec, ceiling: 0xf2f4f6, trim: 0xd0d5da, wood: 0x8a735a, accent: 0x2e5f8a, fabric: 0x3b4650 },
  store: { floor: 0xb9b4a8, wall: 0xeae3cf, ceiling: 0xf1eee2, trim: 0xd9d2bf, wood: 0x7a5a3a, accent: 0xc0392b, fabric: 0x2b5ea8 },
} as const satisfies Record<InteriorKind, Record<string, number>>;
