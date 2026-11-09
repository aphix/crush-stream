import { ROAD_DECAL_ASSET } from "../scenery-assets/types.ts";
import { PLACE_KIND, type PlaceKind } from "./walk-graph.ts";

/** Seed of the street fabric's choices (where on a face a hydrant stands, a manhole cover's turn): fixed so every peer lays the same street. */
export const FABRIC_SEED = 0x0fab51;

/** The scenery assets the fabric lays, by id (`world/scenery-assets`); the road paint's two are the scenery service's own rows. */
export const ASSET = {
  manhole: ROAD_DECAL_ASSET.manhole,
  crosswalk: ROAD_DECAL_ASSET.crosswalk,
  hydrant: "street-fire-hydrant",
  litterBin: "street-litter-bin",
  bench: "street-park-bench",
  bikeRack: "street-bike-rack",
  newspaperBox: "street-newspaper-box",
  parkingMeter: "street-parking-meter",
  busShelter: "street-bus-shelter",
  busStopSign: "street-bus-stop-sign",
  nameSign: "street-name-sign",
  cafeTable: "street-cafe-table",
} as const;

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

/** A street-name sign's pole stands this far (m) off both property lines of a block corner: 0.6 m in from each curb, so its card turned to the corner (reach 0.56 m) stays in the sidewalk's furniture strip. */
export const CORNER_POCKET = 3;

/** One piece of a business's frontage kit: its asset, where it stands along the face from the door (m, + toward the face's far end), its turn off facing the street (rad), and where in the furniture strip (0 at the curb, 1 at the clear path). */
export type KitItem = { asset: string; offset: number; turn: number; stripShare: number };

/** No turn: the card faces the street, as a bench or a bike rack stands. */
const SQUARE_ON = 0;
/** A small card turned 45 degrees shows its width to a driver and to a walker along the sidewalk alike. */
const ANGLED = Math.PI / 4;
/** A card turned a quarter faces along the street, where a bus driver reads it. */
const ALONG_STREET = Math.PI / 2;
/** Shares of the furniture strip's width from the curb: the middle, and a hand's breadth in from the curb for a hydrant or a meter. */
const MIDDLE = 0.5;
const NEAR_CURB = 0.3;
/** How far (m) from a door the first and the second piece of a kit stand: a bin or table beside the door, a rack or meter at the edge of the frontage. */
const BIN_REACH = 2.6;
const FAR_REACH = 5.2;

/** What stands in front of each kind of place, in the order it is tried: a shop its newspaper box, bin and a meter, a food place its bin, a table and a bike rack, a bar a bench and a bin, a workplace a bin and two meters, the bus stop its shelter, sign and bin. */
export const FRONTAGE_KITS: Partial<Record<PlaceKind, readonly KitItem[]>> = {
  [PLACE_KIND.shop]: [
    { asset: ASSET.newspaperBox, offset: -BIN_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
    { asset: ASSET.litterBin, offset: BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { asset: ASSET.parkingMeter, offset: FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
  ],
  [PLACE_KIND.food]: [
    { asset: ASSET.litterBin, offset: -BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { asset: ASSET.cafeTable, offset: BIN_REACH + 0.3, turn: SQUARE_ON, stripShare: MIDDLE },
    { asset: ASSET.bikeRack, offset: -FAR_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
  ],
  [PLACE_KIND.hangout]: [
    { asset: ASSET.bench, offset: BIN_REACH, turn: SQUARE_ON, stripShare: MIDDLE },
    { asset: ASSET.litterBin, offset: -BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { asset: ASSET.bikeRack, offset: FAR_REACH + 1, turn: SQUARE_ON, stripShare: MIDDLE },
  ],
  [PLACE_KIND.work]: [
    { asset: ASSET.litterBin, offset: BIN_REACH, turn: ANGLED, stripShare: MIDDLE },
    { asset: ASSET.parkingMeter, offset: -FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
    { asset: ASSET.parkingMeter, offset: FAR_REACH, turn: ANGLED, stripShare: NEAR_CURB },
  ],
  [PLACE_KIND.transit]: [
    { asset: ASSET.busShelter, offset: 0, turn: SQUARE_ON, stripShare: MIDDLE },
    { asset: ASSET.busStopSign, offset: BIN_REACH + 0.4, turn: ALONG_STREET, stripShare: MIDDLE },
    { asset: ASSET.litterBin, offset: -(BIN_REACH + 0.4), turn: ANGLED, stripShare: MIDDLE },
  ],
};

/** The hydrant at a face: angled so a walker along the sidewalk and a driver on the street both see its card's width. */
export const HYDRANT_ITEM: KitItem = { asset: ASSET.hydrant, offset: 0, turn: ANGLED, stripShare: NEAR_CURB };
