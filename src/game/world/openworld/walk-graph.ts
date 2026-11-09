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

/** Which interior a place has: one builder per kind, all from one shared furniture kit. */
export type InteriorKind = "rowhome" | "coffee" | "bar" | "office" | "store";

/** Floats per seat in `Place.seats`: x, z (world m, the seat's centre), yaw (the way a sitter faces, as a walking civilian's yaw: atan2(dirX, dirZ)), height (world y of the seat's top). */
export const SEAT_STRIDE = 4;
/** Floats per spot in `Place.counter`: x, z, yaw (as a seat's), counter-top height (world y). */
export const COUNTER_STRIDE = 4;

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
  /** Two spots, `COUNTER_STRIDE` floats each: where a customer stands to buy, then where the clerk stands. */
  counter?: Float32Array;
  /** Game hours the place is open, [from, to); `to` below `from` wraps past midnight. Absent: always open. */
  hours?: readonly [from: number, to: number];
};

/** `halfX`, `halfZ`: half the playable area's side along x and along z (m). Places with `doorNode = -1` lie beyond the walls; `portals` are the nodes where their residents enter and leave. */
export type OpenWorldMap = { graph: WalkGraph; places: readonly Place[]; portals: Int32Array; halfX: number; halfZ: number };
