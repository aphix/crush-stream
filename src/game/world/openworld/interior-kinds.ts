import { LAYOUT } from "./openworld-constants.ts";
import type { InteriorKind } from "./walk-graph.ts";

/** Plan coordinates: `deep` runs from the building's street face inward, `across` along the face from its centre line (its sign follows the building's local +z). */
export type Rect = { deep0: number; across0: number; deep1: number; across1: number };

/** A solid box in plan coordinates with its heights (m above the ground). */
export type Box = Rect & { y0: number; y1: number };

/** A gap in a wall: its centre along the wall, its width, and its sill and top above the floor (m). */
export type Opening = { centre: number; width: number; sill: number; top: number };

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
  /** Drawn unlit (a lamp, a screen, a neon sign): the night's light. */
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
  neon: { ...LIGHT, ...size(1.2, 0.05, 0.4) },
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

/** A straight flight: `steps` treads of `rise` and `run` from `deep0`, climbing toward the back, on the floor of `level`. */
export type Stairs = { level: number; deep0: number; across: number; width: number; steps: number; rise: number; run: number };

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

/** Floors and the topmost ceiling by interior: a rowhome has its stoop's landing, then floors 0.1 m over the facade's storey lines (3.6 and 6.6 m: the ground band, then 3.0 m storeys), a shop one 3.75 m clear storey under a slab. */
export const LEVELS = {
  rowhome: { floors: [ROWHOME_FLOOR_Y, 3.7, 6.7], topCeiling: 9.5 },
  coffee: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  bar: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  office: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  store: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
} as const satisfies Record<InteriorKind, { floors: readonly number[]; topCeiling: number }>;

/** The frontage bay every shopfront opening is measured in: one lot wide. */
export const BAY_WIDTH = LAYOUT.lotFrontage;

type BayOpening = Opening & { door: boolean };

/** One opening of a frontage bay: its centre from the bay's centre line, its width, and its sill and top above the floor (m). */
const opening = (centre: number, width: number, sill: number, top: number, door: boolean): BayOpening => ({ centre, width, sill, top, door });

/**
 * The street wall's openings per bay, cut through the facade's ground band and through the street wall alike. A doorway is at least 0.9 m wide; openings stay at or under 2.7 m so the sign band above is whole.
 * A facade's u runs to the viewer's right, the plan's -across: the corner store's door (+0.9) is on the viewer's left.
 */
export const SHOPFRONT = {
  rowhome: [opening(ROWHOME_DOOR_OFFSET, 1, 0, 2.1, true)],
  coffee: [opening(-1.65, 1.5, 0.75, 2.3, false), opening(0, 1, 0, 2.2, true), opening(1.65, 1.5, 0.75, 2.3, false)],
  bar: [opening(-1.8, 0.9, 1.25, 2.3, false), opening(0, 1, 0, 2.25, true), opening(1.8, 0.9, 1.25, 2.3, false)],
  office: [opening(-1.8, 1.8, 0.3, 2.7, false), opening(0, 1.5, 0, 2.4, true), opening(1.8, 1.8, 0.3, 2.7, false)],
  store: [opening(0.9, 0.9, 0, 2.1, true), opening(-1.1, 2.8, 0.65, 2.4, false)],
} as const satisfies Record<InteriorKind, readonly BayOpening[]>;

/** The back door of a rowhome, into the yard. */
export const BACK_DOOR = opening(0, 1, 0, 2.1, true);

/** A person sits on the stoop's third step (the stoop is centred on the door): its top above the ground, how far out of the facade its tread's middle lies, and each sitter's offset from the door's line (m). */
export const STOOP_SEAT_HEIGHT = 0.54;
export const STOOP_SEAT_OUT = 0.92;
export const STOOP_SEAT_SPREAD = 0.4;

/** Furniture's colours and the room's by interior (sRGB). */
export const ROOM_LOOK = {
  rowhome: { floor: 0x8a6a4a, wall: 0xe8dfcf, ceiling: 0xf4f0e8, trim: 0xf2eee6, wood: 0x6b4a32, accent: 0x5b7a6a, fabric: 0x7d8fa3 },
  coffee: { floor: 0x9a7650, wall: 0xdccfb8, ceiling: 0xefe8da, trim: 0xf1ede4, wood: 0x5a3d28, accent: 0x2f5d50, fabric: 0xb5653f },
  bar: { floor: 0x3a2b25, wall: 0x4a2a2e, ceiling: 0x1f1a1b, trim: 0x2b1f1e, wood: 0x4a2e1e, accent: 0xa3303c, fabric: 0x7a2432 },
  office: { floor: 0x6c7077, wall: 0xe6e9ec, ceiling: 0xf2f4f6, trim: 0xd0d5da, wood: 0x8a735a, accent: 0x2e5f8a, fabric: 0x3b4650 },
  store: { floor: 0xb9b4a8, wall: 0xeae3cf, ceiling: 0xf1eee2, trim: 0xd9d2bf, wood: 0x7a5a3a, accent: 0xc0392b, fabric: 0x2b5ea8 },
} as const satisfies Record<InteriorKind, Record<string, number>>;
