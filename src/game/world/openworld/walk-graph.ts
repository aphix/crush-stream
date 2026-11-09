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
};

/** `halfX`, `halfZ`: half the playable area's side along x and along z (m). Places with `doorNode = -1` lie beyond the walls; `portals` are the nodes where their residents enter and leave. */
export type OpenWorldMap = { graph: WalkGraph; places: readonly Place[]; portals: Int32Array; halfX: number; halfZ: number };
