import { hypot2 } from "../../kernel/physics-core.js";
import type { BlockRef, Geometry, Lots, PathPlan, Side } from "./openworld-layout.ts";
import { PLACE_KIND, type OpenWorldMap, type Place, type WalkGraph } from "./walk-graph.ts";

/** Two path points closer than this (m) are one node. */
const SAME_POINT = 1e-3;

/** Node-and-edge lists while the map is laid out; `toGraph` freezes them into the CSR arrays. */
class GraphBuilder {
  readonly nodeX: number[] = [];
  readonly nodeZ: number[] = [];
  readonly edgeFrom: number[] = [];
  readonly edgeTo: number[] = [];
  readonly edgeCrossing: number[] = [];

  node(x: number, z: number): number {
    this.nodeX.push(Math.fround(x));
    this.nodeZ.push(Math.fround(z));
    return this.nodeX.length - 1;
  }

  /** The node at (x, z), made if none stands there: where separately computed path points meet. */
  nodeAt(x: number, z: number): number {
    for (let node = 0; node < this.nodeX.length; node++) {
      if (Math.abs(this.nodeX[node]! - x) < SAME_POINT && Math.abs(this.nodeZ[node]! - z) < SAME_POINT) return node;
    }
    return this.node(x, z);
  }

  /** An undirected edge: stored as the pair of directed edges the CSR holds. */
  edge(from: number, to: number, crossing: boolean): void {
    this.edgeFrom.push(from, to);
    this.edgeTo.push(to, from);
    this.edgeCrossing.push(crossing ? 1 : 0, crossing ? 1 : 0);
  }

  /** The CSR arrays: every node's edges in the order they were added. */
  toGraph(): WalkGraph {
    const nodeCount = this.nodeX.length;
    const edgeCount = this.edgeFrom.length;
    const edgeStart = new Int32Array(nodeCount + 1);
    for (let edge = 0; edge < edgeCount; edge++) edgeStart[this.edgeFrom[edge]! + 1]!++;
    for (let node = 0; node < nodeCount; node++) edgeStart[node + 1]! += edgeStart[node]!;
    const cursor = edgeStart.slice(0, nodeCount);
    const graph: WalkGraph = {
      nodeX: Float32Array.from(this.nodeX),
      nodeZ: Float32Array.from(this.nodeZ),
      edgeStart,
      edgeTo: new Int32Array(edgeCount),
      edgeLength: new Float32Array(edgeCount),
      edgeCrossing: new Uint8Array(edgeCount),
    };
    for (let edge = 0; edge < edgeCount; edge++) {
      const from = this.edgeFrom[edge]!;
      const to = this.edgeTo[edge]!;
      const slot = cursor[from]!++;
      graph.edgeTo[slot] = to;
      graph.edgeLength[slot] = hypot2(graph.nodeX[to]! - graph.nodeX[from]!, graph.nodeZ[to]! - graph.nodeZ[from]!);
      graph.edgeCrossing[slot] = this.edgeCrossing[edge]!;
    }
    return graph;
  }
}

/** A point on a ring side: its coordinate along the side and its node. */
type Stop = { along: number; node: number };

/** A block's sidewalk path: four corner nodes and, per side, the stops doors and paths put on it. */
type Ring = { northWest: number; northEast: number; southEast: number; southWest: number; stops: Record<Side, Stop[]>; x0: number; x1: number; z0: number; z1: number };

function startRing(builder: GraphBuilder, block: BlockRef, geometry: Geometry): Ring {
  const x0 = block.centreX - geometry.blockLength / 2 - geometry.ringOffset;
  const x1 = block.centreX + geometry.blockLength / 2 + geometry.ringOffset;
  const z0 = block.centreZ - geometry.blockDepth / 2 - geometry.ringOffset;
  const z1 = block.centreZ + geometry.blockDepth / 2 + geometry.ringOffset;
  return {
    northWest: builder.nodeAt(x0, z0),
    northEast: builder.nodeAt(x1, z0),
    southEast: builder.nodeAt(x1, z1),
    southWest: builder.nodeAt(x0, z1),
    stops: { north: [], south: [], west: [], east: [] },
    x0,
    x1,
    z0,
    z1,
  };
}

/** The ring node at `along` on a side (the side's stops are chained into edges by `closeRing`). */
function stopOn(builder: GraphBuilder, ring: Ring, side: Side, along: number): number {
  const stops = ring.stops[side];
  const existing = stops.find((stop) => Math.abs(stop.along - along) < SAME_POINT);
  if (existing) return existing.node;
  const horizontal = side === "north" || side === "south";
  const fixed = side === "north" ? ring.z0 : side === "south" ? ring.z1 : side === "west" ? ring.x0 : ring.x1;
  const node = horizontal ? builder.node(along, fixed) : builder.node(fixed, along);
  stops.push({ along, node });
  return node;
}

function chain(builder: GraphBuilder, nodes: readonly number[]): void {
  for (let index = 1; index < nodes.length; index++) builder.edge(nodes[index - 1]!, nodes[index]!, false);
}

function byAlong(a: Stop, b: Stop): number {
  return a.along - b.along;
}

function closeRing(builder: GraphBuilder, ring: Ring): void {
  const { north, east, south, west } = ring.stops;
  chain(builder, [ring.northWest, ...north.sort(byAlong).map((stop) => stop.node), ring.northEast]);
  chain(builder, [ring.northEast, ...east.sort(byAlong).map((stop) => stop.node), ring.southEast]);
  chain(builder, [ring.southWest, ...south.sort(byAlong).map((stop) => stop.node), ring.southEast]);
  chain(builder, [ring.northWest, ...west.sort(byAlong).map((stop) => stop.node), ring.southWest]);
}

/** A path inside a block: its points chained, and each join linked to the sidewalk path beside it. */
function layPath(builder: GraphBuilder, ring: Ring, plan: PathPlan): void {
  const nodes = plan.points.map(([x, z]) => builder.nodeAt(x, z));
  chain(builder, nodes);
  for (const join of plan.joins) {
    const [x, z] = plan.points[join.point]!;
    const along = join.side === "north" || join.side === "south" ? x : z;
    builder.edge(nodes[join.point]!, stopOn(builder, ring, join.side, along), false);
  }
}

function insideWalls(geometry: Geometry, x: number, z: number): boolean {
  return Math.abs(x) <= geometry.halfX + SAME_POINT && Math.abs(z) <= geometry.halfZ + SAME_POINT;
}

/**
 * The zebra crossings of the intersection of street column `column` and street row `row`: one per arm the intersection has, each between the two
 * sidewalk path points either side of that arm (a block's corner, or a point of the outer path), where both lie inside the walls.
 */
function crossIntersection(builder: GraphBuilder, geometry: Geometry, column: number, row: number): void {
  const x = geometry.streetX[column]!;
  const z = geometry.streetZ[row]!;
  const reach = geometry.pathFromStreet;
  const cross = (fromX: number, fromZ: number, toX: number, toZ: number): void => {
    if (insideWalls(geometry, fromX, fromZ) && insideWalls(geometry, toX, toZ)) builder.edge(builder.nodeAt(fromX, fromZ), builder.nodeAt(toX, toZ), true);
  };
  if (row > 0) cross(x - reach, z - reach, x + reach, z - reach);
  if (row < geometry.rows) cross(x - reach, z + reach, x + reach, z + reach);
  if (column > 0) cross(x - reach, z - reach, x - reach, z + reach);
  if (column < geometry.columns) cross(x + reach, z - reach, x + reach, z + reach);
}

/** The outer sidewalk path round the whole grid: its four corners and every crossing's landing on it, chained side by side; returns its nodes. */
function layOuterPath(builder: GraphBuilder, geometry: Geometry): number[] {
  const { outerX, outerZ } = geometry;
  const corners = [builder.nodeAt(-outerX, -outerZ), builder.nodeAt(outerX, -outerZ), builder.nodeAt(outerX, outerZ), builder.nodeAt(-outerX, outerZ)];
  const x = (node: number): number => builder.nodeX[node]!;
  const z = (node: number): number => builder.nodeZ[node]!;
  const onSide = (fixed: (node: number) => number, value: number, along: (node: number) => number): number[] => {
    const nodes: number[] = [];
    for (let node = 0; node < builder.nodeX.length; node++) if (Math.abs(fixed(node) - value) < SAME_POINT) nodes.push(node);
    return nodes.sort((a, b) => along(a) - along(b));
  };
  const sides = [onSide(z, -outerZ, x), onSide(x, outerX, z), onSide(z, outerZ, x), onSide(x, -outerX, z)];
  for (const nodes of sides) chain(builder, nodes);
  return [...new Set([...corners, ...sides.flat()])];
}

/** Where residents from beyond the walls come in: the outer sidewalk path, else the corners of the blocks on the grid's outer edge. */
function edgeNodes(rings: readonly Ring[], blocks: readonly BlockRef[], geometry: Geometry): number[] {
  const nodes = new Set<number>();
  for (const [index, block] of blocks.entries()) {
    const ring = rings[index]!;
    if (block.column === 0) nodes.add(ring.northWest).add(ring.southWest);
    if (block.column === geometry.columns - 1) nodes.add(ring.northEast).add(ring.southEast);
    if (block.row === 0) nodes.add(ring.northWest).add(ring.northEast);
    if (block.row === geometry.rows - 1) nodes.add(ring.southWest).add(ring.southEast);
  }
  return [...nodes];
}

/** The door node of every place: a spur from the door to the sidewalk path where the link names a side, else the interior path point the door stands on. */
function attachDoors(builder: GraphBuilder, lots: Lots, rings: readonly Ring[]): number[] {
  const doorNodes = lots.places.map(() => -1);
  for (const link of lots.links) {
    const place = lots.places[link.place]!;
    if (link.side === null) {
      doorNodes[link.place] = builder.nodeAt(place.doorX, place.doorZ);
      continue;
    }
    const door = builder.node(place.doorX, place.doorZ);
    const along = link.side === "north" || link.side === "south" ? place.doorX : place.doorZ;
    builder.edge(door, stopOn(builder, rings[link.block]!, link.side, along), false);
    doorNodes[link.place] = door;
  }
  return doorNodes;
}

/** The map the open world is built from: places, walk graph, portals. Pure and unseeded: every peer builds the same one from the same layout. */
export function buildOpenWorldMap(lots: Lots): OpenWorldMap {
  const geometry = lots.geometry;
  const builder = new GraphBuilder();
  const rings = lots.blocks.map((block) => startRing(builder, block, geometry));
  for (const plan of lots.paths) layPath(builder, rings[plan.block]!, plan);
  const doorNodes = attachDoors(builder, lots, rings);
  for (const ring of rings) closeRing(builder, ring);
  for (let row = 0; row <= geometry.rows; row++) for (let column = 0; column <= geometry.columns; column++) crossIntersection(builder, geometry, column, row);
  const entrances = geometry.outerPath ? layOuterPath(builder, geometry) : edgeNodes(rings, lots.blocks, geometry);
  const stops = lots.places.flatMap((place, index) => (place.kind === PLACE_KIND.transit && doorNodes[index]! >= 0 ? [doorNodes[index]!] : []));
  const places: Place[] = lots.places.map((place, index) => ({ ...place, doorNode: doorNodes[index]! }));
  return { graph: builder.toGraph(), places, portals: Int32Array.from([...stops, ...entrances]), halfX: geometry.halfX, halfZ: geometry.halfZ };
}
