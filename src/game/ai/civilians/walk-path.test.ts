import { describe, expect, it } from "vitest";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import { PLACE_NAMES } from "./civilian-cast.ts";
import { CROSSING_COST, MAX_PATH_NODES } from "./civilian-constants.ts";
import { buildFixtureMap, costOfWalk, edgeBetween, placeNamed } from "./civilian-graph.test-util.ts";
import { PathFinder } from "./walk-path.ts";

const map = buildFixtureMap();
const doors = map.places.filter((place) => place.doorNode >= 0).map((place) => place.doorNode);

/** Cheapest cost from `source` to every node by plain Dijkstra over the same edge costs (no fear). */
function cheapestCosts(graph: WalkGraph, source: number): Float64Array {
  const cost = new Float64Array(graph.nodeX.length).fill(Infinity);
  const done = new Uint8Array(graph.nodeX.length);
  cost[source] = 0;
  for (let round = 0; round < cost.length; round++) {
    let node = -1;
    for (let candidate = 0; candidate < cost.length; candidate++) if (!done[candidate] && (node === -1 || cost[candidate]! < cost[node]!)) node = candidate;
    done[node] = 1;
    for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
      const through = cost[node]! + graph.edgeLength[edge]! + (graph.edgeCrossing[edge] ? CROSSING_COST : 0);
      if (through < cost[graph.edgeTo[edge]!]!) cost[graph.edgeTo[edge]!] = through;
    }
  }
  return cost;
}

function pathBetween(finder: PathFinder, from: number, to: number, fear: Float32Array, weight = 1): number[] {
  const out = new Uint16Array(MAX_PATH_NODES);
  const count = finder.find(from, to, fear, weight, out, 0, MAX_PATH_NODES);
  return Array.from(out.subarray(0, count));
}

describe("given the streets and doors of the fixture neighbourhood", () => {
  const finder = new PathFinder(map.graph);
  const calm = new Float32Array(map.graph.nodeX.length);

  it("when a walk is asked between any two doors, then it follows the streets from the first door to the second at the cheapest cost", () => {
    let walks = 0;
    for (const from of doors) {
      const reference = cheapestCosts(map.graph, from);
      for (const to of doors) {
        const nodes = pathBetween(finder, from, to, calm);
        expect(nodes[0], `first node of ${from} to ${to}`).toBe(from);
        expect(nodes[nodes.length - 1], `last node of ${from} to ${to}`).toBe(to);
        for (let step = 1; step < nodes.length; step++) expect(edgeBetween(map.graph, nodes[step - 1]!, nodes[step]!), `street from ${nodes[step - 1]} to ${nodes[step]}`).toBeGreaterThanOrEqual(0);
        expect(finder.lastCost, `cost of ${from} to ${to}`).toBeCloseTo(reference[to]!, 3);
        walks++;
      }
    }
    expect(walks, "walks checked").toBeGreaterThan(400);
  });

  it("when a street the walk would take is feared, then the walk goes round it and the old one would have cost more", () => {
    const from = map.places[placeNamed(map, PLACE_NAMES.bodega)]!.doorNode;
    const to = map.places[placeNamed(map, "Taco Spot")]!.doorNode;
    const direct = pathBetween(finder, from, to, calm);
    const feared = direct[2]!;
    const fear = new Float32Array(calm.length);
    fear[feared] = 1;
    const detour = pathBetween(finder, from, to, fear);
    expect(direct.length, "a walk with a middle to fear").toBeGreaterThan(4);
    expect(detour, "walk round the feared corner").not.toContain(feared);
    expect(costOfWalk(map.graph, direct, fear, 1), "cost of the old walk through the corner").toBeGreaterThan(finder.lastCost);
  });
});

describe("given a street graph with a corner nobody can walk to", () => {
  const nodeX = Float32Array.of(0, 10, 20, 500);
  const nodeZ = new Float32Array(4);
  const graph: WalkGraph = {
    nodeX,
    nodeZ,
    edgeStart: Int32Array.of(0, 1, 3, 4, 4),
    edgeTo: Int32Array.of(1, 0, 2, 1),
    edgeLength: Float32Array.of(10, 10, 10, 10),
    edgeCrossing: Uint8Array.of(0, 0, 0, 0),
  };
  const finder = new PathFinder(graph);
  const calm = new Float32Array(4);

  it("when a walk is asked to the lonely corner, then none is found", () => {
    expect(pathBetween(finder, 0, 3, calm), "walk to the unreachable corner").toHaveLength(0);
    expect(pathBetween(finder, 0, 2, calm), "walk along the connected streets").toHaveLength(3);
  });

  it("when a walk is longer than the room given for it, then none is found", () => {
    const out = new Uint16Array(8);
    expect(finder.find(0, 2, calm, 1, out, 0, 2), "walk of three nodes in room for two").toBe(0);
    expect(finder.find(0, 2, calm, 1, out, 0, 3), "walk of three nodes in room for three").toBe(3);
  });
});
