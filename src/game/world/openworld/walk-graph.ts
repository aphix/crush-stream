export const PLACE_KIND = { home: 0, work: 1, food: 2, shop: 3, hangout: 4, hide: 5, transit: 6 } as const;
export type PlaceKind = (typeof PLACE_KIND)[keyof typeof PLACE_KIND];

/** Pedestrian paths as CSR arrays: node n's edges are `edgeTo[edgeStart[n] .. edgeStart[n + 1]]`; `edgeCrossing` marks a zebra crossing. */
export type WalkGraph = {
  nodeX: Float32Array;
  nodeZ: Float32Array;
  edgeStart: Int32Array;
  edgeTo: Int32Array;
  edgeLength: Float32Array;
  edgeCrossing: Uint8Array;
};

/** What a place's trade is called: `Place.sector`, one spelling for every file that reads or writes it. */
export const SECTOR = {
  retail: "retail",
  services: "services",
  food: "food",
  cafe: "cafe",
  office: "office",
  nightlife: "nightlife",
  auto: "auto",
  grocery: "grocery",
  recreation: "recreation",
  hideout: "hideout",
  transit: "transit",
  residential: "residential",
  worship: "worship",
  police: "police",
} as const;

/** Which interior a place has: one builder per kind, all from one shared furniture kit. */
export type InteriorKind = "rowhome" | "coffee" | "bar" | "office" | "store";

/** Floats per seat in `Place.seats`: x, z (world m, the seat's centre), yaw (the way a sitter faces, as a walking civilian's yaw: atan2(dirX, dirZ)), height (world y of the seat's top). */
export const SEAT_STRIDE = 4;
/** Floats per spot in `Place.counter`: x, z, yaw (as a seat's), counter-top height (world y). */
export const COUNTER_STRIDE = 4;
/** Floats per node in `Place.aisle`: x, z (world m), the index of the node it is reached from (-1 for the first), and the heading from it to that node (a walking civilian's yaw; 0 for the first). */
export const AISLE_STRIDE = 4;
/**
 * Standing spots of a venue with a counter (`Place.standSpots`), for those who have no seat: `STAND_COLUMNS` buying lanes where those who stop to buy without a spot of their own stand (along the counter's front, then further back),
 * `STAND_SPOTS` for customers behind them and `CLERK_SPOTS` for staff along the clerk's side, `STAND_SPACING` m apart in rows `STAND_ROW_DEPTH` m deep, every one clear of the room's walls and furniture. Customers' and clerks' spots number
 * after the venue's seats in the same owner table: one holder to each.
 */
export const STAND_SPOTS = 10;
export const CLERK_SPOTS = 3;
export const STAND_COLUMNS = 5;
export const STAND_SPACING = 0.8;
export const STAND_ROW_DEPTH = 0.8;

/** A lot people go to: its door is `doorNode` on the walk graph; `style` names its facade, `sector` its trade. */
export type Place = {
  kind: PlaceKind;
  name: string;
  doorNode: number;
  doorX: number;
  doorZ: number;
  yaw: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  storeys: number;
  style: string;
  sector: string;
  interior?: InteriorKind;
  /** Every seat of the interior (and a stoop's): `SEAT_STRIDE` floats each, in a stable order that is a seat's identity. */
  seats?: Float32Array;
  /** How many of the leading seats are on the stoop (a home's front steps); the rest are indoors. */
  stoopSeats?: number;
  /** Two spots, `COUNTER_STRIDE` floats each: where a customer stands to buy, then where the clerk stands. */
  counter?: Float32Array;
  /** With a counter: its buying lanes, then customers' standing spots, then clerks' (`counterStandSpots` counts), as world x, z pairs. */
  standSpots?: Float32Array;
  /** The ground-floor room's walkable floor as a tree from just inside the street door (`AISLE_STRIDE` floats a node, the door's first): where a customer walks between the door, the counter and her spot. Absent: nobody is walked inside. */
  aisle?: Float32Array;
  /** The `aisle` nodes a customer stands at when every seat and standing spot is taken: on the customers' side of the counter, clear of the furniture, a metre apart. */
  standRoom?: Uint16Array;
  /** Its building's sides with no building against them (`OPEN_SIDE` bits), whose facade shows windows a room behind must look out of. Absent: none. */
  openSides?: number;
  /** Game hours the place is open, [from, to); `to` below `from` wraps past midnight. Absent: always open. */
  hours?: readonly [from: number, to: number];
};

/**
 * `place` at `doorNode` with every field present (an absent one undefined) in one order: the map's places share one hidden class,
 * so a hot loop's reads of their numbers stay unboxed (built by conditional spreads they came in nine shapes, and a scan allocated per read).
 */
export function placeRecord(place: Place, doorNode: number): Place {
  return {
    kind: place.kind,
    name: place.name,
    doorNode,
    doorX: place.doorX,
    doorZ: place.doorZ,
    yaw: place.yaw,
    x: place.x,
    z: place.z,
    width: place.width,
    depth: place.depth,
    storeys: place.storeys,
    style: place.style,
    sector: place.sector,
    interior: place.interior,
    seats: place.seats,
    stoopSeats: place.stoopSeats,
    counter: place.counter,
    aisle: place.aisle,
    standRoom: place.standRoom,
    standSpots: place.standSpots,
    openSides: place.openSides,
    hours: place.hours,
  };
}

/** `halfX`, `halfZ`: half the playable area's side along x and along z (m). Places with `doorNode = -1` lie beyond the walls; `portals` are the nodes where their residents enter and leave. */
export type OpenWorldMap = { graph: WalkGraph; places: readonly Place[]; portals: Int32Array; halfX: number; halfZ: number };
