import { hypot2 } from "../../kernel/physics-core.js";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import { CROSSING_ALIGNMENT, CROSSING_HALF_WIDTH, CROSSING_KERB_SHARE } from "./crime-constants.ts";
import type { Walk } from "./offence-source.ts";

/** The walk graph's zebra crossings as segments (each once, from its lower node): which one a walker is out on, going along it. */
export class CrossingWatch {
  readonly count: number;
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  private readonly fromX: Float64Array;
  private readonly fromZ: Float64Array;
  private readonly length: Float64Array;

  constructor(graph: WalkGraph) {
    const { nodeX, nodeZ, edgeStart, edgeTo, edgeCrossing } = graph;
    const from: number[] = [];
    const to: number[] = [];
    for (let node = 0; node < nodeX.length; node++) {
      for (let edge = edgeStart[node]!; edge < edgeStart[node + 1]!; edge++) {
        if (edgeCrossing[edge] !== 1 || edgeTo[edge]! <= node) continue;
        from.push(node);
        to.push(edgeTo[edge]!);
      }
    }
    this.count = from.length;
    this.fromX = Float64Array.from(from, (node) => nodeX[node]!);
    this.fromZ = Float64Array.from(from, (node) => nodeZ[node]!);
    this.length = Float64Array.from(from, (node, at) => hypot2(nodeX[to[at]!]! - nodeX[node]!, nodeZ[to[at]!]! - nodeZ[node]!));
    this.dirX = Float64Array.from(from, (node, at) => (nodeX[to[at]!]! - nodeX[node]!) / Math.max(this.length[at]!, 1));
    this.dirZ = Float64Array.from(from, (node, at) => (nodeZ[to[at]!]! - nodeZ[node]!) / Math.max(this.length[at]!, 1));
  }

  /** The crossing `walk` stands out on (off both kerbs, within its width) heading along it, -1 for none; the lowest on a tie. */
  crossingOf(walk: Walk): number {
    for (let crossing = 0; crossing < this.count; crossing++) {
      const dirX = this.dirX[crossing]!;
      const dirZ = this.dirZ[crossing]!;
      const offsetX = walk.x - this.fromX[crossing]!;
      const offsetZ = walk.z - this.fromZ[crossing]!;
      const along = offsetX * dirX + offsetZ * dirZ;
      const length = this.length[crossing]!;
      if (along < length * CROSSING_KERB_SHARE || along > length * (1 - CROSSING_KERB_SHARE)) continue;
      if (Math.abs(offsetX * dirZ - offsetZ * dirX) > CROSSING_HALF_WIDTH) continue;
      if (Math.abs(walk.dirX * dirX + walk.dirZ * dirZ) < CROSSING_ALIGNMENT) continue;
      return crossing;
    }
    return -1;
  }
}
