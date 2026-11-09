import type { PrefabId } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { ROAD_DECAL_ASSET } from "../scenery-assets/types.ts";
import { PLACE_KIND, type PlaceKind } from "./walk-graph.ts";

/** Seed of the street fabric's choices (where on a face a hydrant stands, a manhole cover's turn): fixed so every peer lays the same street. */
export const FABRIC_SEED = 0x0fab51;

/** The scenery assets the fabric lays, by id (`world/scenery-assets`): the road paint (the scenery service's own rows). */
export const ASSET = {
  manhole: ROAD_DECAL_ASSET.manhole,
  crosswalk: ROAD_DECAL_ASSET.crosswalk,
  drain: "ground-drain-grate",
} as const;

/** A piece of street furniture: a street kit prefab. */
export type FurniturePiece = { prefab: PrefabId };

export const PIECE = {
  hydrant: { prefab: PREFAB.hydrant },
  litterBin: { prefab: PREFAB.litterBin },
  bench: { prefab: PREFAB.bench },
  bikeRack: { prefab: PREFAB.bikeRack },
  parkingMeter: { prefab: PREFAB.parkingMeter },
  busShelter: { prefab: PREFAB.busShelter },
  busStopSign: { prefab: PREFAB.busStopSign },
  cafeSet: { prefab: PREFAB.cafeSet },
  newspaperBox: { prefab: PREFAB.newsBox },
} as const satisfies Record<string, FurniturePiece>;

/** The bus shelter's back panel is solid (an invisible-wall box under the drawn glass): this far (m) behind the shelter's middle, this thick, tall and long. */
export const SHELTER_WALL = { back: 0.5, thickness: 0.1, height: 2.4, length: 4 } as const;

/** A marked crossing is 2.4 to 3.0 m deep; its bars run with the traffic. */
export const CROSSWALK_DEPTH = 3;
/** The two ends of a crossing leg lie on one axis when they differ by less than this (m). */
export const CROSSING_AXIS_TOLERANCE = 1e-3;
/** A quarter turn: the yaw of a flat asset whose local z runs along x. */
export const QUARTER_TURN = Math.PI / 2;

/** A hydrant stands at a seeded share of a face between these two: clear of the corners and not in the same place on every face. */
export const HYDRANT_SHARE = { min: 0.2, max: 0.8 } as const;

/** Nothing stands this near (m) a face's end: the corner's curb ramp and the crossing's landing stay open. */
export const FURNITURE_CORNER_CLEAR = 3;
/** Clear room (m) between two neighbours along a face. */
export const FURNITURE_GAP = 0.25;
/** A lamp pole and a street tree's crown (0.88 m round at the street trees' scale) keep furniture this far (m) off their middle. */
export const LAMP_CLEARANCE = 0.8;
export const TREE_CROWN_CLEARANCE = 0.9;
/** A piece that does not fit where it is wanted slides along its face in steps of this (m), up to `KIT_SLIDE` for a business's kit (a hydrant and a bus shelter slide the whole face). */
export const SLIDE_STEP = 0.3;
export const KIT_SLIDE = 4;

/** A street sign's pole stands this far (m) off both property lines of a block corner: 0.6 m in from each curb, so its blades (reach 0.45 m) stay over the sidewalk. */
export const CORNER_POCKET = 3;

/** At the two block corners of an intersection that have no street sign: brown iron bollards round the corner's curb, each this far (m) past the two property lines (out of the crossings' landings, 1.5 m out), and a storm drain grate in the gutter. */
export const BOLLARD_SPOTS: readonly (readonly [number, number])[] = [
  [3.3, 2.2],
  [3.1, 3.1],
  [2.2, 3.3],
];
/** A storm drain grate lies in the gutter, this far (m) from the corner along the long face, and its middle this far (m) past the curb so its 0.6 m width lies 0.05 m to 0.65 m out. */
export const DRAIN_FROM_CORNER = 2.5;
export const DRAIN_PAST_CURB = 0.35;

/** A share of the rowhomes have steel cellar doors in the sidewalk before the house: beside the stoop (this far, m, from the door to the doors' middle, past the bay's flank), their near edge this far (m) past the property line, clear of the bay's foot. */
export const CELLAR = { share: 0.3, along: 2, fromLine: 0.05 } as const;
/** Seed of which rowhomes have cellar doors, and on which side of the stoop. */
export const CELLAR_SEED = 0x0ce11a;

/** One piece of a business's frontage kit: what it is, where it stands along the face from the door (m, + toward the face's far end), its turn off facing the street (rad), and where in the furniture strip (0 at the curb, 1 at the clear path). */
export type KitItem = { piece: FurniturePiece; offset: number; turn: number; stripShare: number };

/** No turn: the piece faces the street, as a bench or a bike rack stands. */
const SQUARE_ON = 0;
/** A small piece turned 45 degrees: a bin's or a meter's face shows to a driver and to a walker along the sidewalk alike. */
const ANGLED = Math.PI / 4;
/** A sign turned a quarter faces along the street, where a bus driver reads it. */
const ALONG_STREET = Math.PI / 2;
/** Shares of the furniture strip's width from the curb: the middle, and a hand's breadth in from the curb for a hydrant or a meter. */
const MIDDLE = 0.5;
const NEAR_CURB = 0.3;
/** How far (m) from a door the first and the second piece of a kit stand: a bin or table beside the door, a rack or meter at the edge of the frontage. */
const BIN_REACH = 2.6;
const FAR_REACH = 5.2;

/** What stands in front of each kind of place, in the order it is tried: a shop its newspaper box, bin and a meter, a food place its bin, a table and chairs under a parasol, and a bike rack, a bar a bench and a bin, a workplace a bin and two meters, the bus stop its shelter, sign and bin. */
export const FRONTAGE_KITS: Partial<Record<PlaceKind, readonly KitItem[]>> = {
  [PLACE_KIND.shop]: [
    { piece: PIECE.newspaperBox, offset: -BIN_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
    { piece: PIECE.litterBin, offset: BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { piece: PIECE.parkingMeter, offset: FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
  ],
  [PLACE_KIND.food]: [
    { piece: PIECE.litterBin, offset: -BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { piece: PIECE.cafeSet, offset: BIN_REACH + 0.3, turn: SQUARE_ON, stripShare: MIDDLE },
    { piece: PIECE.bikeRack, offset: -FAR_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
  ],
  [PLACE_KIND.hangout]: [
    { piece: PIECE.bench, offset: BIN_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
    { piece: PIECE.litterBin, offset: -BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { piece: PIECE.bikeRack, offset: FAR_REACH + 1, turn: SQUARE_ON, stripShare: MIDDLE },
  ],
  [PLACE_KIND.work]: [
    { piece: PIECE.litterBin, offset: BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { piece: PIECE.parkingMeter, offset: -FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
    { piece: PIECE.parkingMeter, offset: FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
  ],
  [PLACE_KIND.transit]: [
    { piece: PIECE.busShelter, offset: 0, turn: SQUARE_ON, stripShare: MIDDLE },
    { piece: PIECE.busStopSign, offset: BIN_REACH + 0.4, turn: ALONG_STREET, stripShare: MIDDLE },
    { piece: PIECE.litterBin, offset: -(BIN_REACH + 0.4), turn: ANGLED, stripShare: MIDDLE },
  ],
};

/** The hydrant at a face: its outlets angled to the street and the sidewalk. */
export const HYDRANT_ITEM: KitItem = { piece: PIECE.hydrant, offset: 0, turn: ANGLED, stripShare: NEAR_CURB };
