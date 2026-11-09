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

/** One row per piece of furniture (m): size, height, whether it blocks, its seats. */
export const FURNISHING = {
  counter: { ...BARE, width: 2, depth: 0.7, height: 1.1 },
  backShelf: { ...BARE, width: 2, depth: 0.35, height: 2.1 },
  gondola: { ...BARE, width: 1.6, depth: 0.5, height: 1.8 },
  fridge: { ...BARE, width: 0.75, depth: 0.7, height: 1.8 },
  cabinet: { ...BARE, width: 0.6, depth: 0.6, height: 0.9 },
  stove: { ...BARE, width: 0.75, depth: 0.65, height: 0.9 },
  sink: { ...BARE, width: 1.2, depth: 0.6, height: 0.9 },
  table: { ...BARE, width: 0.9, depth: 0.9, height: 0.75 },
  desk: { ...BARE, width: 1.4, depth: 0.7, height: 0.75 },
  bed: { ...BARE, width: 1.5, depth: 2, height: 0.55 },
  dresser: { ...BARE, width: 1, depth: 0.5, height: 0.9 },
  bathtub: { ...BARE, width: 1.7, depth: 0.75, height: 0.55 },
  toilet: { ...BARE, width: 0.4, depth: 0.7, height: 0.7 },
  basin: { ...BARE, width: 0.5, depth: 0.4, height: 0.85 },
  tvUnit: { ...BARE, width: 1.4, depth: 0.45, height: 0.5 },
  poolTable: { ...BARE, width: 2.4, depth: 1.3, height: 0.85 },
  jukebox: { ...BARE, width: 0.8, depth: 0.6, height: 1.5 },
  rail: { ...BARE, width: 3, depth: 0.06, height: 1 },
  sofa: { solid: true, seats: 2, glow: false, width: 1.9, depth: 0.9, height: 0.85, seatHeight: 0.44 },
  armchair: { solid: true, seats: 1, glow: false, width: 0.8, depth: 0.8, height: 0.85, seatHeight: 0.44 },
  bench: { solid: true, seats: 2, glow: false, width: 1.4, depth: 0.55, height: 0.9, seatHeight: 0.46 },
  stool: { ...SEAT, width: 0.4, depth: 0.4, height: 0.7, seatHeight: 0.7 },
  chair: { ...SEAT, width: 0.45, depth: 0.45, height: 0.9, seatHeight: 0.46 },
  deskChair: { ...SEAT, width: 0.55, depth: 0.55, height: 0.95, seatHeight: 0.5 },
  plant: { solid: false, seats: 0, seatHeight: 0, glow: false, width: 0.45, depth: 0.45, height: 1.2 },
  lamp: { solid: false, seats: 0, seatHeight: 0, glow: true, width: 0.45, depth: 0.45, height: 0.3 },
  neon: { solid: false, seats: 0, seatHeight: 0, glow: true, width: 1.2, depth: 0.05, height: 0.4 },
  screen: { solid: false, seats: 0, seatHeight: 0, glow: true, width: 1, depth: 0.05, height: 0.6 },
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

/** Floors and the topmost ceiling by interior: a rowhome has three 3.2 m storeys over its stoop, a shop one 3.75 m clear storey under a slab. */
export const LEVELS = {
  rowhome: { floors: [ROWHOME_FLOOR_Y, 3.7, 6.9], topCeiling: 9.9 },
  coffee: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  bar: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  office: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
  store: { floors: [SHOP_FLOOR_Y], topCeiling: 3.75 },
} as const satisfies Record<InteriorKind, { floors: readonly number[]; topCeiling: number }>;

/** The frontage bay every shopfront opening is measured in: one lot wide. */
export const BAY_WIDTH = LAYOUT.lotFrontage;

type BayOpening = Opening & { door: boolean };

/**
 * The street wall's openings per bay (centres from the bay's centre line; sill and top above the floor, m), cut through the facade's ground band and through the
 * street wall alike. A doorway is at least 0.9 m wide; openings stay at or under 2.7 m so the sign band above is whole.
 */
export const SHOPFRONT = {
  rowhome: [{ centre: ROWHOME_DOOR_OFFSET, width: 1, sill: 0, top: 2.1, door: true }],
  coffee: [
    { centre: -1.65, width: 1.5, sill: 0.75, top: 2.3, door: false },
    { centre: 0, width: 1, sill: 0, top: 2.2, door: true },
    { centre: 1.65, width: 1.5, sill: 0.75, top: 2.3, door: false },
  ],
  bar: [
    { centre: -1.8, width: 0.9, sill: 1.25, top: 2.3, door: false },
    { centre: 0, width: 1, sill: 0, top: 2.25, door: true },
    { centre: 1.8, width: 0.9, sill: 1.25, top: 2.3, door: false },
  ],
  office: [
    { centre: -1.8, width: 1.8, sill: 0.3, top: 2.7, door: false },
    { centre: 0, width: 1.5, sill: 0, top: 2.4, door: true },
    { centre: 1.8, width: 1.8, sill: 0.3, top: 2.7, door: false },
  ],
  store: [
    { centre: 0.9, width: 0.9, sill: 0, top: 2.1, door: true },
    { centre: -1.1, width: 2.8, sill: 0.65, top: 2.4, door: false },
  ],
} as const satisfies Record<InteriorKind, readonly BayOpening[]>;

/** The back door of a rowhome, into the yard. */
export const BACK_DOOR: BayOpening = { centre: 0, width: 1, sill: 0, top: 2.1, door: true };

/** A person sits on the stoop's third step: its top above the ground, how far out of the facade its tread's middle lies, and each sitter's offset from the door's line (m); the stoop is centred on the door. */
export const STOOP_SEAT = { height: 0.54, out: 0.92, spread: 0.4 } as const;

/** Furniture's colours and the room's by interior (sRGB). */
export const ROOM_LOOK = {
  rowhome: { floor: 0x8a6a4a, wall: 0xe8dfcf, ceiling: 0xf4f0e8, trim: 0xf2eee6, wood: 0x6b4a32, accent: 0x5b7a6a, fabric: 0x7d8fa3 },
  coffee: { floor: 0x9a7650, wall: 0xdccfb8, ceiling: 0xefe8da, trim: 0xf1ede4, wood: 0x5a3d28, accent: 0x2f5d50, fabric: 0xb5653f },
  bar: { floor: 0x3a2b25, wall: 0x4a2a2e, ceiling: 0x1f1a1b, trim: 0x2b1f1e, wood: 0x4a2e1e, accent: 0xa3303c, fabric: 0x7a2432 },
  office: { floor: 0x6c7077, wall: 0xe6e9ec, ceiling: 0xf2f4f6, trim: 0xd0d5da, wood: 0x8a735a, accent: 0x2e5f8a, fabric: 0x3b4650 },
  store: { floor: 0xb9b4a8, wall: 0xeae3cf, ceiling: 0xf1eee2, trim: 0xd9d2bf, wood: 0x7a5a3a, accent: 0xc0392b, fabric: 0x2b5ea8 },
} as const satisfies Record<InteriorKind, Record<string, number>>;
