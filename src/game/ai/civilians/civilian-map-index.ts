import { PLACE_KIND, type OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { AREA_PER_JOB, BLOCK_COLUMNS, BLOCK_COUNT, BLOCK_ROWS, MAX_JOBS, MIN_JOBS, NORTH_IS_LOW_Z, WORKPLACE_KINDS } from "./civilian-constants.ts";
import { KIND_COUNT } from "./civilian-names.ts";

/** What the map says that never changes, for the places inside the walls (nobody lives, works or goes beyond them): places by kind, their spots, blocks, who each can employ, the way out. */
export type MapIndex = {
  placeCount: number;
  nodeCount: number;
  placeX: Float32Array;
  placeZ: Float32Array;
  doorNode: Int32Array;
  kindOf: Uint8Array;
  /** The block (0-8, A1 first) of each place, -1 for one beyond the walls. */
  blockOf: Int8Array;
  /** The places in each block (0-8). */
  placesOfBlock: readonly Int32Array[];
  /** Places of each kind with a door on the walk graph. */
  byKind: readonly Int32Array[];
  workplaces: Int32Array;
  jobCapacity: Uint16Array;
  /** Bus stops at a portal of the map: a visitor who goes there leaves the neighbourhood. */
  exitStops: Int32Array;
  placeByName: ReadonlyMap<string, number>;
};

/** The block (0-8) a point lies in: the playable square in thirds each way, A1 north-west. */
function blockOfPosition(x: number, z: number, halfX: number, halfZ: number): number {
  const column = Math.min(BLOCK_COLUMNS - 1, Math.max(0, Math.floor(((x + halfX) * BLOCK_COLUMNS) / (2 * halfX))));
  const fromLowZ = Math.min(BLOCK_ROWS - 1, Math.max(0, Math.floor(((z + halfZ) * BLOCK_ROWS) / (2 * halfZ))));
  const row = NORTH_IS_LOW_Z ? fromLowZ : BLOCK_ROWS - 1 - fromLowZ;
  return row * BLOCK_COLUMNS + column;
}

function listWhere(count: number, keep: (place: number) => boolean): Int32Array {
  const found: number[] = [];
  for (let place = 0; place < count; place++) if (keep(place)) found.push(place);
  return Int32Array.from(found);
}

export function buildMapIndex(map: OpenWorldMap): MapIndex {
  const placeCount = map.places.length;
  const placeX = new Float32Array(placeCount);
  const placeZ = new Float32Array(placeCount);
  const doorNode = new Int32Array(placeCount);
  const kindOf = new Uint8Array(placeCount);
  const blockOf = new Int8Array(placeCount);
  const jobCapacity = new Uint16Array(placeCount);
  const placeByName = new Map<string, number>();
  for (let place = 0; place < placeCount; place++) {
    const entry = map.places[place]!;
    placeX[place] = entry.x;
    placeZ[place] = entry.z;
    doorNode[place] = entry.doorNode;
    kindOf[place] = entry.kind;
    blockOf[place] = entry.doorNode < 0 ? -1 : blockOfPosition(entry.x, entry.z, map.halfX, map.halfZ);
    if (!placeByName.has(entry.name)) placeByName.set(entry.name, place);
    const employs = (WORKPLACE_KINDS as readonly number[]).includes(entry.kind) && entry.doorNode >= 0;
    jobCapacity[place] = employs ? Math.min(MAX_JOBS, Math.max(MIN_JOBS, Math.round((entry.width * entry.depth * entry.storeys) / AREA_PER_JOB))) : 0;
  }
  const portalNodes = new Set(map.portals);
  return {
    placeCount,
    nodeCount: map.graph.nodeX.length,
    placeX,
    placeZ,
    doorNode,
    kindOf,
    blockOf,
    placesOfBlock: Array.from({ length: BLOCK_COUNT }, (_, block) => listWhere(placeCount, (place) => blockOf[place] === block)),
    byKind: Array.from({ length: KIND_COUNT }, (_, kind) => listWhere(placeCount, (place) => kindOf[place] === kind && doorNode[place]! >= 0)),
    workplaces: listWhere(placeCount, (place) => jobCapacity[place]! > 0),
    jobCapacity,
    exitStops: listWhere(placeCount, (place) => kindOf[place] === PLACE_KIND.transit && portalNodes.has(doorNode[place]!)),
    placeByName,
  };
}
