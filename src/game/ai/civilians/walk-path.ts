import { hypot2 } from "../../kernel/physics-core.js";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import { CROSSING_COST, FEAR_COST_FACTOR } from "./civilian-constants.ts";

/** A* over the walk graph with scratch sized once: a search allocates nothing. Ties break on the lower node id, so a path is the same on every peer. */
export class PathFinder {
  /** Cost of the path found last: its metres, scaled up through feared nodes, plus a kerb wait per crossing. */
  lastCost = 0;
  private readonly graph: WalkGraph;
  private readonly cost: Float64Array;
  private readonly cameFrom: Int32Array;
  private readonly seenRound: Int32Array;
  private readonly closedRound: Int32Array;
  private readonly heapNode: Int32Array;
  private readonly heapKey: Float64Array;
  private heapSize = 0;
  private round = 0;

  constructor(graph: WalkGraph) {
    const nodeCount = graph.nodeX.length;
    this.graph = graph;
    this.cost = new Float64Array(nodeCount);
    this.cameFrom = new Int32Array(nodeCount);
    this.seenRound = new Int32Array(nodeCount);
    this.closedRound = new Int32Array(nodeCount);
    this.heapNode = new Int32Array(graph.edgeTo.length + 1);
    this.heapKey = new Float64Array(graph.edgeTo.length + 1);
  }

  /** Writes the cheapest walk's node ids into `out` from `outOffset` and returns how many; 0 when `toNode` cannot be reached or the walk is longer than `capacity` nodes. */
  find(fromNode: number, toNode: number, fear: Float32Array, fearWeight: number, out: Uint16Array, outOffset: number, capacity: number): number {
    const { nodeX, nodeZ, edgeStart, edgeTo, edgeLength, edgeCrossing } = this.graph;
    const round = ++this.round;
    this.heapSize = 0;
    this.seenRound[fromNode] = round;
    this.cost[fromNode] = 0;
    this.cameFrom[fromNode] = -1;
    this.push(fromNode, 0);
    let found = false;
    while (this.heapSize > 0) {
      const node = this.pop();
      if (this.closedRound[node] === round) continue;
      this.closedRound[node] = round;
      if (node === toNode) {
        found = true;
        break;
      }
      for (let edge = edgeStart[node]!; edge < edgeStart[node + 1]!; edge++) {
        const next = edgeTo[edge]!;
        if (this.closedRound[next] === round) continue;
        const wary = 1 + FEAR_COST_FACTOR * fearWeight * 0.5 * (fear[node]! + fear[next]!);
        const step = edgeLength[edge]! * wary + (edgeCrossing[edge]! ? CROSSING_COST : 0);
        const through = this.cost[node]! + step;
        if (this.seenRound[next] === round && through >= this.cost[next]!) continue;
        this.seenRound[next] = round;
        this.cost[next] = through;
        this.cameFrom[next] = node;
        this.push(next, through + hypot2(nodeX[next]! - nodeX[toNode]!, nodeZ[next]! - nodeZ[toNode]!));
      }
    }
    if (!found) return 0;
    this.lastCost = this.cost[toNode]!;
    let count = 0;
    for (let node = toNode; node !== -1; node = this.cameFrom[node]!) count++;
    if (count > capacity) return 0;
    let slot = outOffset + count - 1;
    for (let node = toNode; node !== -1; node = this.cameFrom[node]!) out[slot--] = node;
    return count;
  }

  private push(node: number, key: number): void {
    let child = this.heapSize++;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.before(key, node, this.heapKey[parent]!, this.heapNode[parent]!)) break;
      this.heapNode[child] = this.heapNode[parent]!;
      this.heapKey[child] = this.heapKey[parent]!;
      child = parent;
    }
    this.heapNode[child] = node;
    this.heapKey[child] = key;
  }

  private pop(): number {
    const top = this.heapNode[0]!;
    const lastNode = this.heapNode[--this.heapSize]!;
    const lastKey = this.heapKey[this.heapSize]!;
    let parent = 0;
    for (;;) {
      let child = parent * 2 + 1;
      if (child >= this.heapSize) break;
      if (child + 1 < this.heapSize && this.before(this.heapKey[child + 1]!, this.heapNode[child + 1]!, this.heapKey[child]!, this.heapNode[child]!)) child++;
      if (!this.before(this.heapKey[child]!, this.heapNode[child]!, lastKey, lastNode)) break;
      this.heapNode[parent] = this.heapNode[child]!;
      this.heapKey[parent] = this.heapKey[child]!;
      parent = child;
    }
    this.heapNode[parent] = lastNode;
    this.heapKey[parent] = lastKey;
    return top;
  }

  private before(keyA: number, nodeA: number, keyB: number, nodeB: number): boolean {
    return keyA < keyB || (keyA === keyB && nodeA < nodeB);
  }
}
