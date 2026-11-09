import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import type { PathFinder } from "../civilians/walk-path.ts";
import { MAX_ROUTE_NODES } from "./crime-constants.ts";

/** Cops and suspects as struct-of-arrays walkers on the sidewalk graph: one node route each, walked at a pace. Nothing here allocates after construction. */
export class FootWalkers {
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly yaw: Float64Array;
  /** Metres walked in all: the stride phase is this times the stride's radians per metre. */
  readonly walked: Float64Array;
  /** Metres per second over the last advance. */
  readonly speed: Float64Array;
  private readonly graph: WalkGraph;
  private readonly route: Uint16Array;
  private readonly routeCount: Uint16Array;
  private readonly routeAt: Uint16Array;

  constructor(graph: WalkGraph, count: number) {
    this.graph = graph;
    this.x = new Float64Array(count);
    this.z = new Float64Array(count);
    this.yaw = new Float64Array(count);
    this.walked = new Float64Array(count);
    this.speed = new Float64Array(count);
    this.route = new Uint16Array(count * MAX_ROUTE_NODES);
    this.routeCount = new Uint16Array(count);
    this.routeAt = new Uint16Array(count);
  }

  place(walker: number, x: number, z: number): void {
    this.x[walker] = x;
    this.z[walker] = z;
    this.speed[walker] = 0;
    this.halt(walker);
  }

  /** The lowest-numbered node nearest (x, z), so a tie is the same on every peer. */
  nearestNode(x: number, z: number): number {
    const { nodeX, nodeZ } = this.graph;
    let best = 0;
    let bestGap = Infinity;
    for (let node = 0; node < nodeX.length; node++) {
      const gap = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = node;
    }
    return best;
  }

  /** Plans the cheapest walk from where `walker` stands to `toNode` under `fear`; false (route cleared) when there is none. */
  plan(walker: number, finder: PathFinder, toNode: number, fear: Float32Array, fearWeight: number): boolean {
    const first = walker * MAX_ROUTE_NODES;
    const count = finder.find(this.nearestNode(this.x[walker]!, this.z[walker]!), toNode, fear, fearWeight, this.route, first, MAX_ROUTE_NODES);
    this.routeCount[walker] = count;
    this.routeAt[walker] = count >= 2 && this.startsPastFirst(walker, first) ? 1 : 0;
    return count > 0;
  }

  /** A route of the one node `node`. */
  goToNode(walker: number, node: number): void {
    this.route[walker * MAX_ROUTE_NODES] = node;
    this.routeCount[walker] = 1;
    this.routeAt[walker] = 0;
  }

  halt(walker: number): void {
    this.routeCount[walker] = 0;
    this.routeAt[walker] = 0;
  }

  hasRoute(walker: number): boolean {
    return this.routeAt[walker]! < this.routeCount[walker]!;
  }

  /** The last node of the route, or -1 with none. */
  routeEnd(walker: number): number {
    return this.routeCount[walker]! === 0 ? -1 : this.route[walker * MAX_ROUTE_NODES + this.routeCount[walker]! - 1]!;
  }

  /** Walks `distance` metres of the route in `dt` s (the pace read off by `speed`); stands still with no route. */
  advance(walker: number, distance: number, dt: number): void {
    const { nodeX, nodeZ } = this.graph;
    const first = walker * MAX_ROUTE_NODES;
    let remaining = distance;
    let moved = 0;
    while (remaining > 0 && this.routeAt[walker]! < this.routeCount[walker]!) {
      const node = this.route[first + this.routeAt[walker]!]!;
      const dx = nodeX[node]! - this.x[walker]!;
      const dz = nodeZ[node]! - this.z[walker]!;
      const gap = hypot2(dx, dz);
      if (gap > 0) this.yaw[walker] = detAtan2(dx, dz);
      if (gap <= remaining) {
        this.x[walker] = nodeX[node]!;
        this.z[walker] = nodeZ[node]!;
        remaining -= gap;
        moved += gap;
        this.routeAt[walker]! += 1;
        continue;
      }
      const share = remaining / gap;
      this.x[walker]! += dx * share;
      this.z[walker]! += dz * share;
      moved += remaining;
      remaining = 0;
    }
    this.walked[walker]! += moved;
    this.speed[walker] = dt > 0 ? moved / dt : 0;
  }

  /** Steps `distance` metres straight toward (x, z), off the graph, for the last metres of a run. */
  moveToward(walker: number, x: number, z: number, distance: number, dt: number): void {
    const dx = x - this.x[walker]!;
    const dz = z - this.z[walker]!;
    const gap = hypot2(dx, dz);
    const step = Math.min(gap, distance);
    if (gap > 0) {
      this.x[walker]! += (dx / gap) * step;
      this.z[walker]! += (dz / gap) * step;
      this.yaw[walker] = detAtan2(dx, dz);
    }
    this.walked[walker]! += step;
    this.speed[walker] = dt > 0 ? step / dt : 0;
  }

  /** Turns `walker` to face (x, z). */
  face(walker: number, x: number, z: number): void {
    const dx = x - this.x[walker]!;
    const dz = z - this.z[walker]!;
    if (dx !== 0 || dz !== 0) this.yaw[walker] = detAtan2(dx, dz);
  }

  /** A route from the nearest node starts past it when the walker already stands nearer the second node than the first is. */
  private startsPastFirst(walker: number, first: number): boolean {
    const { nodeX, nodeZ } = this.graph;
    const start = this.route[first]!;
    const next = this.route[first + 1]!;
    return hypot2(this.x[walker]! - nodeX[next]!, this.z[walker]! - nodeZ[next]!) < hypot2(nodeX[start]! - nodeX[next]!, nodeZ[start]! - nodeZ[next]!);
  }
}
