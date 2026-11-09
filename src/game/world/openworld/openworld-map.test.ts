import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { buildOpenWorldMap } from "./openworld-map.ts";
import { fixtureLots } from "./openworld-lots.test-util.ts";
import { PLACE_KIND } from "./walk-graph.ts";

/** A front door within 3 m of a path node: the accessibility floor. */
const DOOR_REACH = 3;
/** Float noise on a node's coordinates (m). */
const TOLERANCE = 1e-3;

/** The walls stand on the outer streets' far property line (outer sidewalk inside), or on their far curb (none). */
const WALL_CASES = [
  { it: "walls on the outer streets' far property line", wallReach: 8, outerPath: true },
  { it: "walls on the outer streets' far curb", wallReach: 5, outerPath: false },
] as const;

for (const wallCase of WALL_CASES) {
  describe(`given the walk graph of a layout with ${wallCase.it}`, () => {
    const lots = fixtureLots(wallCase.wallReach);
    const geometry = lots.geometry;
    const map = buildOpenWorldMap(lots);
    const graph = map.graph;
    const nodeCount = graph.nodeX.length;
    const playable = map.places.filter((place) => place.doorNode >= 0);

    const reachableFrom = (start: number): Uint8Array => {
      const seen = new Uint8Array(nodeCount);
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const node = stack.pop()!;
        for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
          const next = graph.edgeTo[edge]!;
          if (seen[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      return seen;
    };
    const nodeNear = (x: number, z: number): number => {
      for (let node = 0; node < nodeCount; node++) if (Math.abs(graph.nodeX[node]! - x) < TOLERANCE && Math.abs(graph.nodeZ[node]! - z) < TOLERANCE) return node;
      return -1;
    };
    const edgeBetween = (from: number, to: number): number => {
      for (let edge = graph.edgeStart[from]!; edge < graph.edgeStart[from + 1]!; edge++) if (graph.edgeTo[edge] === to) return edge;
      return -1;
    };
    /** Whether (x, z) is on the carriageway of any street (each runs the grid's whole length, out to the outermost streets' edge). */
    const onCarriageway = (x: number, z: number): boolean => {
      const half = geometry.carriageway / 2 - TOLERANCE;
      const reachX = geometry.streetX[geometry.streetX.length - 1]! + geometry.carriageway / 2;
      const reachZ = geometry.streetZ[geometry.streetZ.length - 1]! + geometry.carriageway / 2;
      return geometry.streetX.some((street) => Math.abs(x - street) < half && Math.abs(z) < reachZ) || geometry.streetZ.some((street) => Math.abs(z - street) < half && Math.abs(x) < reachX);
    };
    const inside = (x: number, z: number): boolean => Math.abs(x) <= geometry.halfX + TOLERANCE && Math.abs(z) <= geometry.halfZ + TOLERANCE;

    /** Every zebra crossing the grid calls for: one across each arm of each intersection whose two path points are inside the walls. */
    const legs: { from: [number, number]; to: [number, number] }[] = [];
    const reach = geometry.pathFromStreet;
    for (let row = 0; row <= geometry.rows; row++) {
      for (let column = 0; column <= geometry.columns; column++) {
        const x = geometry.streetX[column]!;
        const z = geometry.streetZ[row]!;
        const arms: { from: [number, number]; to: [number, number] }[] = [];
        if (row > 0) arms.push({ from: [x - reach, z - reach], to: [x + reach, z - reach] });
        if (row < geometry.rows) arms.push({ from: [x - reach, z + reach], to: [x + reach, z + reach] });
        if (column > 0) arms.push({ from: [x - reach, z - reach], to: [x - reach, z + reach] });
        if (column < geometry.columns) arms.push({ from: [x + reach, z - reach], to: [x + reach, z + reach] });
        legs.push(...arms.filter((arm) => inside(...arm.from) && inside(...arm.to)));
      }
    }

    // mutation: sed -i 's/^    builder.edge(door, stopOn(builder, rings\[link.block\]!, link.side, along), false);/    void along;/' src/game/world/openworld/openworld-map.ts
    it("when a person walks from the first node, then every node can be reached", () => {
      const reached = reachableFrom(0).reduce((sum, seen) => sum + seen, 0);
      expect(nodeCount, "nodes in the graph").toBeGreaterThan(200);
      expect(reached, "nodes reached from node 0").toBe(nodeCount);
    });

    // mutation: sed -i 's/^    builder.edge(nodes\[join.point\]!, stopOn(builder, ring, join.side, along), false);/    void along;/' src/game/world/openworld/openworld-map.ts
    it("when a person walks from each portal, then the door of every place inside the walls can be reached", () => {
      expect(map.portals.length, "portals").toBeGreaterThan(8);
      const unreachable: string[] = [];
      for (const portal of map.portals) {
        const reached = reachableFrom(portal);
        for (const place of playable) if (!reached[place.doorNode]) unreachable.push(`${place.name} from node ${portal}`);
      }
      expect(playable.length, "places with a door").toBeGreaterThan(100);
      expect(unreachable.slice(0, 3).join("; "), "doors not reachable from a portal").toBe("");
    });

    // mutation: sed -i 's/const entrances = geometry.outerPath ? layOuterPath(builder, geometry) : edgeNodes(rings, lots.blocks, geometry);/const entrances = [0];/' src/game/world/openworld/openworld-map.ts
    it("when the portals are read, then each is a sidewalk node on the grid's outer edge or a bus stop's door", () => {
      const stopDoor = map.places.find((place) => place.kind === PLACE_KIND.transit)!.doorNode;
      const edgeX = wallCase.outerPath ? geometry.outerX : ((geometry.columns - 1) / 2) * geometry.pitchX + geometry.blockLength / 2 + geometry.ringOffset;
      const edgeZ = wallCase.outerPath ? geometry.outerZ : ((geometry.rows - 1) / 2) * geometry.pitchZ + geometry.blockDepth / 2 + geometry.ringOffset;
      const onEdge = (portal: number): boolean => Math.abs(Math.abs(graph.nodeX[portal]!) - edgeX) < TOLERANCE || Math.abs(Math.abs(graph.nodeZ[portal]!) - edgeZ) < TOLERANCE;
      const inland = [...map.portals].filter((portal) => portal !== stopDoor && !onEdge(portal));
      expect(inland.slice(0, 3).join(", "), "portals inland of the grid's edge").toBe("");
      expect(map.portals.includes(stopDoor), "the bus stop's door is a portal").toBe(true);
      expect([...map.portals].filter(onEdge).length, "portals on the edge").toBeGreaterThanOrEqual(8);
    });

    // mutation: sed -i 's/const doorNodes = lots.places.map(() => -1);/const doorNodes = lots.places.map(() => 0);/' src/game/world/openworld/openworld-map.ts
    it("when the places are read, then each lies inside the walls with a door node or beyond them with none", () => {
      const wrong = map.places.filter((place) => (place.doorNode >= 0 ? !inside(place.x, place.z) : inside(place.x, place.z)));
      expect(wrong.slice(0, 3).map((place) => place.name).join("; "), "places on the wrong side of the walls").toBe("");
      expect(map.places.length - playable.length, "places beyond the walls").toBeGreaterThan(0);
      expect(map.halfX, "half the play area along x").toBe(geometry.halfX);
      expect(map.halfZ, "half the play area along z").toBe(geometry.halfZ);
    });

    // mutation: sed -i 's/^  if (row > 0) cross(/  if (row > 99) cross(/' src/game/world/openworld/openworld-map.ts
    it("when every street arm inside the walls is crossed on foot, then a zebra crossing joins the two sidewalk points either side of it", () => {
      const missing: string[] = [];
      for (const leg of legs) {
        const from = nodeNear(...leg.from);
        const to = nodeNear(...leg.to);
        const edge = from < 0 || to < 0 ? -1 : edgeBetween(from, to);
        if (edge < 0 || graph.edgeCrossing[edge] !== 1 || Math.abs(graph.edgeLength[edge]! - hypot2(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1])) > TOLERANCE) missing.push(`${leg.from} to ${leg.to}`);
      }
      expect(legs.length, "street arms inside the walls").toBeGreaterThanOrEqual(24);
      expect(missing.slice(0, 3).join("; "), "arms without a crossing").toBe("");
    });

    // mutation: sed -i 's/outerPath: pathFromStreet < dimensions.wallReach,/outerPath: true,/' src/game/world/openworld/openworld-layout.ts
    it("when the outer sidewalk is looked for, then it is there exactly when the walls stand beyond it", () => {
      const outerNode = nodeNear(-geometry.outerX, -geometry.outerZ);
      expect(geometry.outerPath, "outer sidewalk inside the walls").toBe(wallCase.outerPath);
      expect(outerNode >= 0, "a node at the outer sidewalk's corner").toBe(wallCase.outerPath);
      expect(map.portals.length, "portals").toBeGreaterThan(0);
    });

    // mutation: sed -i 's/builder.nodeAt(toX, toZ), true)/builder.nodeAt(toX, toZ), false)/' src/game/world/openworld/openworld-map.ts
    it("when a person walks anywhere that is not a zebra crossing, then they never step onto a carriageway", () => {
      const onStreet: string[] = [];
      let crossingsOnStreet = 0;
      for (let node = 0; node < nodeCount; node++) {
        for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
          const next = graph.edgeTo[edge]!;
          const crossing = graph.edgeCrossing[edge] === 1;
          const midX = (graph.nodeX[node]! + graph.nodeX[next]!) / 2;
          const midZ = (graph.nodeZ[node]! + graph.nodeZ[next]!) / 2;
          if (crossing && onCarriageway(midX, midZ)) crossingsOnStreet++;
          if (!crossing && (onCarriageway(midX, midZ) || onCarriageway(graph.nodeX[node]!, graph.nodeZ[node]!))) onStreet.push(`${node} to ${next}`);
        }
      }
      expect(crossingsOnStreet, "crossing edges whose middle is on a carriageway").toBeGreaterThan(2 * legs.length - 1);
      expect(onStreet.slice(0, 3).join("; "), "plain edges on a carriageway").toBe("");
    });

    // mutation: sed -i 's/this.edgeCrossing.push(crossing ? 1 : 0, crossing ? 1 : 0);/this.edgeCrossing.push(crossing ? 1 : 0, 0);/' src/game/world/openworld/openworld-map.ts
    it("when every edge is read back, then it has a twin with the same crossing flag and each length is its nodes' distance", () => {
      const bad: string[] = [];
      for (let node = 0; node < nodeCount; node++) {
        for (let edge = graph.edgeStart[node]!; edge < graph.edgeStart[node + 1]!; edge++) {
          const next = graph.edgeTo[edge]!;
          const twin = edgeBetween(next, node);
          const distance = hypot2(graph.nodeX[next]! - graph.nodeX[node]!, graph.nodeZ[next]! - graph.nodeZ[node]!);
          if (next === node || twin < 0) bad.push(`${node} to ${next} has no twin`);
          else if (graph.edgeCrossing[twin] !== graph.edgeCrossing[edge]) bad.push(`${node} to ${next} crossing flag differs`);
          else if (Math.abs(graph.edgeLength[edge]! - distance) > TOLERANCE || distance <= 0) bad.push(`${node} to ${next} length ${graph.edgeLength[edge]} is not ${distance}`);
        }
      }
      expect(graph.edgeTo.length, "directed edges").toBeGreaterThan(400);
      expect(bad.slice(0, 3).join("; "), "edges out of step with the arrays").toBe("");
    });

    // mutation: sed -i 's/edgeStart\[node + 1\]! += edgeStart\[node\]!;/edgeStart[node + 1]! += 0;/' src/game/world/openworld/openworld-map.ts
    it("when the edge starts are read, then they rise node by node and end at the edge count", () => {
      let falls = 0;
      for (let node = 0; node < nodeCount; node++) if (graph.edgeStart[node + 1]! < graph.edgeStart[node]!) falls++;
      expect(graph.edgeStart.length, "edge starts").toBe(nodeCount + 1);
      expect(graph.edgeStart[0], "first edge start").toBe(0);
      expect(graph.edgeStart[nodeCount], "last edge start").toBe(graph.edgeTo.length);
      expect(falls, "nodes whose edges start before the previous node's").toBe(0);
      expect(graph.edgeLength.length, "edge lengths").toBe(graph.edgeTo.length);
      expect(graph.edgeCrossing.length, "crossing flags").toBe(graph.edgeTo.length);
    });

    // mutation: sed -i 's/stopOn(builder, rings\[link.block\]!, link.side, along)/stopOn(builder, rings[link.block]!, "north", along)/' src/game/world/openworld/openworld-map.ts
    it("when each building's front door is measured against the other path nodes, then one is within 3 m", () => {
      const far: string[] = [];
      const withBuilding = playable.filter((place) => place.style !== "");
      for (const place of withBuilding) {
        let nearest = Infinity;
        for (let node = 0; node < nodeCount; node++) if (node !== place.doorNode) nearest = Math.min(nearest, hypot2(graph.nodeX[node]! - place.doorX, graph.nodeZ[node]! - place.doorZ));
        if (nearest > DOOR_REACH) far.push(`${place.name} ${nearest.toFixed(2)} m`);
      }
      expect(withBuilding.length, "doors measured").toBeGreaterThan(100);
      expect(far.slice(0, 3).join("; "), "doors further than 3 m from a path").toBe("");
    });
  });
}
