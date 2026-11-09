import { PLACE_KIND, type OpenWorldMap, type Place, type PlaceKind, type WalkGraph } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { CROSSING_COST, FEAR_COST_FACTOR } from "./civilian-constants.ts";

/** The playable square the fixture fills: half its sides in metres, as the planner's map has them; its streets cross at these x and z, its blocks sit between (north-west block A1 first). */
const HALF_X = 204;
const HALF_Z = 132;
const STREET_X = [-192, -68, 68, 192];
const STREET_Z = [-120, -44, 44, 120];
const BLOCK_CENTRE_X = [-130, 0, 130];
const BLOCK_CENTRE_Z = [-82, 0, 82];
/** Places in one block stand this far apart (m), three to a row. */
const SLOT_STEP_X = 30;
const SLOT_STEP_Z = 14;
const STREET_COLUMNS = STREET_X.length;

type PlaceSpec = { name: string; kind: PlaceKind; block: string; sector: string; width?: number; depth?: number };

/** The blocks' places: every place the cast's stories name, a bodega, shops, eateries, homes, and two drawn-only places beyond the walls. */
const NAMED_PLACES: readonly PlaceSpec[] = [
  { name: PLACE_NAMES.deeHome, kind: PLACE_KIND.home, block: "A1", sector: "" },
  { name: PLACE_NAMES.bodega, kind: PLACE_KIND.shop, block: "A1", sector: "Commercial" },
  { name: PLACE_NAMES.salHome, kind: PLACE_KIND.home, block: "A2", sector: "" },
  { name: PLACE_NAMES.salCoop, kind: PLACE_KIND.hide, block: "A2", sector: "" },
  { name: PLACE_NAMES.tabbyAlley, kind: PLACE_KIND.hide, block: "A2", sector: "" },
  { name: "Tasker Barber", kind: PLACE_KIND.shop, block: "A2", sector: "Commercial" },
  { name: "Sal's Diner", kind: PLACE_KIND.food, block: "A2", sector: "Food" },
  { name: PLACE_NAMES.brooksHome, kind: PLACE_KIND.home, block: "A3", sector: "" },
  { name: PLACE_NAMES.okaforHome, kind: PLACE_KIND.home, block: "A3", sector: "" },
  { name: PLACE_NAMES.okaforDeck, kind: PLACE_KIND.hangout, block: "A3", sector: "" },
  { name: PLACE_NAMES.kowalskiHome, kind: PLACE_KIND.home, block: "B1", sector: "" },
  { name: PLACE_NAMES.kowalskiYard, kind: PLACE_KIND.hide, block: "B1", sector: "" },
  { name: PLACE_NAMES.vanAlley, kind: PLACE_KIND.hide, block: "B1", sector: "" },
  { name: PLACE_NAMES.mackHome, kind: PLACE_KIND.home, block: "B1", sector: "" },
  { name: "Moore Street Pizza", kind: PLACE_KIND.food, block: "B1", sector: "Food" },
  { name: PLACE_NAMES.parkCourt, kind: PLACE_KIND.hangout, block: "B2", sector: "" },
  { name: PLACE_NAMES.garden, kind: PLACE_KIND.hangout, block: "B3", sector: "" },
  { name: "Spin Cycle Laundry", kind: PLACE_KIND.shop, block: "B3", sector: "Commercial" },
  { name: PLACE_NAMES.ramosHome, kind: PLACE_KIND.home, block: "C1", sector: "" },
  { name: PLACE_NAMES.garage, kind: PLACE_KIND.work, block: "C2", sector: "Industrial", width: 24, depth: 20 },
  { name: PLACE_NAMES.bar, kind: PLACE_KIND.hangout, block: "C3", sector: "Nightlife" },
  { name: "Mifflin Mini Mart", kind: PLACE_KIND.shop, block: "C3", sector: "Commercial" },
  { name: "Taco Spot", kind: PLACE_KIND.food, block: "C3", sector: "Food" },
  { name: "Mifflin Shelter", kind: PLACE_KIND.transit, block: "C3", sector: "Transport" },
];
const BLOCKS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
/** Where the way out of the neighbourhood is: the bus stop on Moore at 10th, the west end of the third street. */
const BUS_STOP_COLUMN = 0;
const BUS_STOP_ROW = 2;
/** Places beyond the walls, drawn only: nobody lives or works there. */
const BACKDROP_PLACES: readonly { name: string; kind: PlaceKind; x: number; z: number }[] = [
  { name: "Backdrop Rowhomes", kind: PLACE_KIND.home, x: -320, z: 0 },
  { name: "Backdrop Towers", kind: PLACE_KIND.work, x: 320, z: 0 },
];

function nodeOf(column: number, row: number): number {
  return row * STREET_COLUMNS + column;
}

function nearestStreetNode(x: number, z: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let row = 0; row < STREET_Z.length; row++) {
    for (let column = 0; column < STREET_COLUMNS; column++) {
      const distance = Math.hypot(STREET_X[column]! - x, STREET_Z[row]! - z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = nodeOf(column, row);
    }
  }
  return best;
}

type Edge = { from: number; to: number; crossing: number };
type Layout = { nodeX: number[]; nodeZ: number[]; edges: Edge[] };

function addStreet(layout: Layout, first: number, second: number, crossing: number): void {
  layout.edges.push({ from: first, to: second, crossing }, { from: second, to: first, crossing });
}

function isInterior(column: number, row: number): boolean {
  return column > 0 && column < STREET_COLUMNS - 1 && row > 0 && row < STREET_Z.length - 1;
}

/** The sixteen street corners and the streets between them; the streets of the middle ring are zebra crossings. */
function streetLattice(): Layout {
  const layout: Layout = { nodeX: [], nodeZ: [], edges: [] };
  for (const z of STREET_Z) {
    for (const x of STREET_X) {
      layout.nodeX.push(x);
      layout.nodeZ.push(z);
    }
  }
  for (let row = 0; row < STREET_Z.length; row++) {
    for (let column = 0; column < STREET_COLUMNS; column++) {
      if (column + 1 < STREET_COLUMNS) addStreet(layout, nodeOf(column, row), nodeOf(column + 1, row), isInterior(column, row) && isInterior(column + 1, row) ? 1 : 0);
      if (row + 1 < STREET_Z.length) addStreet(layout, nodeOf(column, row), nodeOf(column, row + 1), isInterior(column, row) && isInterior(column, row + 1) ? 1 : 0);
    }
  }
  return layout;
}

/** A door node at (x, z) joined by a spur to the nearest corner; returns its node id. */
function addDoor(layout: Layout, x: number, z: number): number {
  const door = layout.nodeX.length;
  layout.nodeX.push(x);
  layout.nodeZ.push(z);
  addStreet(layout, door, nearestStreetNode(x, z), 0);
  return door;
}

function toWalkGraph(layout: Layout): WalkGraph {
  const { nodeX, nodeZ } = layout;
  const edges = layout.edges.slice().sort((first, second) => first.from - second.from || first.to - second.to);
  const edgeStart = new Int32Array(nodeX.length + 1);
  for (const edge of edges) edgeStart[edge.from + 1]!++;
  for (let node = 0; node < nodeX.length; node++) edgeStart[node + 1]! += edgeStart[node]!;
  return {
    nodeX: Float32Array.from(nodeX),
    nodeZ: Float32Array.from(nodeZ),
    edgeStart,
    edgeTo: Int32Array.from(edges, (edge) => edge.to),
    edgeLength: Float32Array.from(edges, (edge) => Math.hypot(nodeX[edge.to]! - nodeX[edge.from]!, nodeZ[edge.to]! - nodeZ[edge.from]!)),
    edgeCrossing: Uint8Array.from(edges, (edge) => edge.crossing),
  };
}

function placeSpecs(extraHomes: number): PlaceSpec[] {
  const specs: PlaceSpec[] = [...NAMED_PLACES, { name: PLACE_NAMES.busStop, kind: PLACE_KIND.transit, block: "B1", sector: "Transport" }];
  for (const block of BLOCKS) for (let count = 0; count < extraHomes; count++) specs.push({ name: `Rowhome ${block}-${count + 1}`, kind: PLACE_KIND.home, block, sector: "" });
  return specs;
}

function placeAt(spec: PlaceSpec, doorNode: number, layout: Layout, spot: { x: number; z: number }): Place {
  return { kind: spec.kind, name: spec.name, doorNode, doorX: layout.nodeX[doorNode]!, doorZ: layout.nodeZ[doorNode]!, yaw: 0, x: spot.x, z: spot.z, width: spec.width ?? 12, depth: spec.depth ?? 14, storeys: 2, style: "rowbrick", sector: spec.sector };
}

/**
 * A small hand-built neighbourhood: sixteen street corners in a four by four lattice (crossings on the middle ring), a door spur for every place inside the walls, the places the cast needs by name in their blocks,
 * `extraHomes` plain rowhomes per block on top, a bus stop on the third street's west end as the only portal, and two places beyond the walls with no door on the graph.
 */
export function buildFixtureMap(extraHomes = 2): OpenWorldMap {
  const layout = streetLattice();
  const slotsUsed = new Map<string, number>();
  const places: Place[] = [];
  const portals: number[] = [];
  for (const spec of placeSpecs(extraHomes)) {
    const blockIndex = BLOCKS.indexOf(spec.block);
    const slot = slotsUsed.get(spec.block) ?? 0;
    slotsUsed.set(spec.block, slot + 1);
    const spot = { x: BLOCK_CENTRE_X[blockIndex % 3]! + ((slot % 3) - 1) * SLOT_STEP_X, z: BLOCK_CENTRE_Z[Math.floor(blockIndex / 3)]! + (Math.floor(slot / 3) - 1) * SLOT_STEP_Z };
    if (spec.name === PLACE_NAMES.busStop) portals.push(nodeOf(BUS_STOP_COLUMN, BUS_STOP_ROW));
    const door = spec.name === PLACE_NAMES.busStop ? nodeOf(BUS_STOP_COLUMN, BUS_STOP_ROW) : addDoor(layout, spot.x, spot.z);
    places.push(placeAt(spec, door, layout, spec.name === PLACE_NAMES.busStop ? { x: layout.nodeX[door]!, z: layout.nodeZ[door]! } : spot));
  }
  for (const backdrop of BACKDROP_PLACES) places.push({ kind: backdrop.kind, name: backdrop.name, doorNode: -1, doorX: backdrop.x, doorZ: backdrop.z, yaw: 0, x: backdrop.x, z: backdrop.z, width: 30, depth: 30, storeys: 6, style: "glassinfill", sector: "Commercial" });
  return { graph: toWalkGraph(layout), places, portals: Int32Array.from(portals), halfX: HALF_X, halfZ: HALF_Z };
}

/** The index of the place called `name` in a map, or a throw naming it. */
export function placeNamed(map: OpenWorldMap, name: string): number {
  const index = map.places.findIndex((place) => place.name === name);
  if (index === -1) throw new Error(`fixture has no place called ${name}`);
  return index;
}

/** The edge from `from` to `to`, or -1. */
export function edgeBetween(graph: WalkGraph, from: number, to: number): number {
  for (let edge = graph.edgeStart[from]!; edge < graph.edgeStart[from + 1]!; edge++) if (graph.edgeTo[edge] === to) return edge;
  return -1;
}

/** What walking `nodes` costs under `fear` at `weight`: the same per-edge cost the path finder minimises, summed. */
export function costOfWalk(graph: WalkGraph, nodes: readonly number[], fear: Float32Array, weight: number): number {
  let cost = 0;
  for (let step = 1; step < nodes.length; step++) {
    const edge = edgeBetween(graph, nodes[step - 1]!, nodes[step]!);
    cost += graph.edgeLength[edge]! * (1 + FEAR_COST_FACTOR * weight * 0.5 * (fear[nodes[step - 1]!]! + fear[nodes[step]!]!)) + (graph.edgeCrossing[edge] ? CROSSING_COST : 0);
  }
  return cost;
}
