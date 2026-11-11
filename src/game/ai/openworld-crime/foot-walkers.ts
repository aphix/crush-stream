import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import { wrapPi } from "../../kernel/scalar.ts";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import type { LineOfSight } from "./offence-source.ts";
import { RUN_STRIDES_PER_SECOND, STRIDE_RADIANS_PER_METRE } from "../civilians/civilian-crowd-constants.ts";
import type { PathFinder } from "../civilians/walk-path.ts";
import { MAX_ROUTE_NODES } from "./crime-constants.ts";

/**
 * Cops and suspects as struct-of-arrays walkers on the sidewalk graph: one node route each, walked at a pace. Each grid step keeps where it began (`snapshot`), so the
 * drawing blends between the last two steps at any frame rate. Nothing here allocates after construction.
 */
export class FootWalkers {
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly yaw: Float64Array;
  /** The stride's phase (rad, a whole stride per 2π): the civilians' per metre at a walk, never faster than `RUN_STRIDES_PER_SECOND`. */
  readonly stride: Float64Array;
  /** Metres per second over the last advance. */
  readonly speed: Float64Array;
  private readonly graph: WalkGraph;
  private readonly clear: LineOfSight | null;
  private readonly route: Uint16Array;
  private readonly routeCount: Uint16Array;
  private readonly routeAt: Uint16Array;
  private readonly fromX: Float64Array;
  private readonly fromZ: Float64Array;
  private readonly fromYaw: Float64Array;
  private readonly fromStride: Float64Array;

  /** `clear`: whether a person at one point sees one at another past the buildings (null: open ground): a walker leaves the graph only along a line it holds. */
  constructor(graph: WalkGraph, count: number, clear: LineOfSight | null) {
    this.graph = graph;
    this.clear = clear;
    this.x = new Float64Array(count);
    this.z = new Float64Array(count);
    this.yaw = new Float64Array(count);
    this.stride = new Float64Array(count);
    this.fromX = new Float64Array(count);
    this.fromZ = new Float64Array(count);
    this.fromYaw = new Float64Array(count);
    this.fromStride = new Float64Array(count);
    this.speed = new Float64Array(count);
    this.route = new Uint16Array(count * MAX_ROUTE_NODES);
    this.routeCount = new Uint16Array(count);
    this.routeAt = new Uint16Array(count);
  }

  /** Stands `walker` at (x, z) at once: the drawing does not slide it there. */
  place(walker: number, x: number, z: number): void {
    this.x[walker] = x;
    this.z[walker] = z;
    this.fromX[walker] = x;
    this.fromZ[walker] = z;
    this.speed[walker] = 0;
    this.halt(walker);
  }

  /** The start of a grid step: every walker's place, heading and stride now are what the drawing blends from. */
  snapshot(): void {
    this.fromX.set(this.x);
    this.fromZ.set(this.z);
    this.fromYaw.set(this.yaw);
    this.fromStride.set(this.stride);
  }

  /** Where `walker` is drawn `share` (0 to 1) of the way through the step after the last one taken. */
  drawnX(walker: number, share: number): number {
    return this.fromX[walker]! + (this.x[walker]! - this.fromX[walker]!) * share;
  }

  drawnZ(walker: number, share: number): number {
    return this.fromZ[walker]! + (this.z[walker]! - this.fromZ[walker]!) * share;
  }

  drawnYaw(walker: number, share: number): number {
    return this.fromYaw[walker]! + wrapPi(this.yaw[walker]! - this.fromYaw[walker]!) * share;
  }

  drawnStride(walker: number, share: number): number {
    return this.fromStride[walker]! + (this.stride[walker]! - this.fromStride[walker]!) * share;
  }

  /** `walker` covered `metres` in `dt` s: its pace, and its stride on by the metres at the stride length that pace takes. */
  carry(walker: number, metres: number, dt: number): void {
    const speed = dt > 0 ? metres / dt : 0;
    this.speed[walker] = speed;
    this.stride[walker]! += metres * (speed > 0 ? Math.min(STRIDE_RADIANS_PER_METRE, (2 * Math.PI * RUN_STRIDES_PER_SECOND) / speed) : STRIDE_RADIANS_PER_METRE);
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

  /** Whether nothing solid stands between (ax, az) and (bx, bz): a walker may step straight from one to the other. */
  straightClear(ax: number, az: number, bx: number, bz: number): boolean {
    return this.clear === null || this.clear(ax, az, bx, bz);
  }

  /** The nearest node (the lowest on a tie) a straight step from (x, z) reaches without crossing a building; the plain nearest node when none is in the clear. */
  nearestSeenNode(x: number, z: number): number {
    if (this.clear === null) return this.nearestNode(x, z);
    const { nodeX, nodeZ } = this.graph;
    let seen = -1;
    let seenGap = Infinity;
    let any = 0;
    let anyGap = Infinity;
    for (let node = 0; node < nodeX.length; node++) {
      const gap = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
      if (gap < anyGap) {
        anyGap = gap;
        any = node;
      }
      if (gap >= seenGap || !this.clear(x, z, nodeX[node]!, nodeZ[node]!)) continue;
      seenGap = gap;
      seen = node;
    }
    return seen >= 0 ? seen : any;
  }

  /** Plans the cheapest walk from where `walker` stands to `toNode` under `fear`; false (route cleared) when there is none. */
  plan(walker: number, finder: PathFinder, toNode: number, fear: Float32Array, fearWeight: number): boolean {
    const first = walker * MAX_ROUTE_NODES;
    const count = finder.find(this.nearestSeenNode(this.x[walker]!, this.z[walker]!), toNode, fear, fearWeight, this.route, first, MAX_ROUTE_NODES);
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
    this.carry(walker, moved, dt);
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
    this.carry(walker, step, dt);
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
