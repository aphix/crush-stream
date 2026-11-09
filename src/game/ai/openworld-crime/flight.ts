import { hypot2 } from "../../kernel/physics-core.js";
import { PLACE_KIND, type OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import type { PathFinder } from "../civilians/walk-path.ts";
import type { CaseTable } from "./case-table.ts";
import { COPS_PER_CASE, DANGER_RADIUS, DANGER_WEIGHT, FLEE_GAP_CAP, FLEE_REACH, FLEE_TRAVEL_WEIGHT, FOOT_COP_COUNT, HIDE_LEAD } from "./crime-constants.ts";
import type { FootWalkers } from "./foot-walkers.ts";

/** Where a suspect runs: to a hiding place they reach well before the cops, by streets the cops are not on; with none such, to the street corner farthest from the cops. */
export class Flight {
  private readonly map: OpenWorldMap;
  private readonly walkers: FootWalkers;
  private readonly finder: PathFinder;
  private readonly table: CaseTable;
  private readonly danger: Float32Array;
  private readonly hideNodes: Int32Array;

  constructor(map: OpenWorldMap, walkers: FootWalkers, finder: PathFinder, table: CaseTable) {
    this.map = map;
    this.walkers = walkers;
    this.finder = finder;
    this.table = table;
    this.danger = new Float32Array(map.graph.nodeX.length);
    const hides: number[] = [];
    for (const place of map.places) if (place.kind === PLACE_KIND.hide && place.doorNode >= 0) hides.push(place.doorNode);
    this.hideNodes = Int32Array.from(hides);
  }

  /** Plans the run of the suspect in subject slot `slot` of case `caseIndex` and records the hiding place it ends at (-1: none). False when no route exists. */
  plan(caseIndex: number, slot: number): boolean {
    const walker = FOOT_COP_COUNT + slot;
    const x = this.walkers.x[walker]!;
    const z = this.walkers.z[walker]!;
    this.fillDanger(caseIndex);
    const hide = this.hideAhead(caseIndex, x, z);
    this.table.hideNode[slot] = hide;
    return this.walkers.plan(walker, this.finder, hide >= 0 ? hide : this.farCorner(caseIndex, x, z), this.danger, DANGER_WEIGHT);
  }

  /** The distance (m) from (x, z) to the nearest cop of the case, `Infinity` with none. */
  copGap(caseIndex: number, x: number, z: number): number {
    let nearest = Infinity;
    for (let index = 0; index < COPS_PER_CASE; index++) {
      const cop = this.table.copAt(caseIndex, index);
      if (cop < 0) continue;
      nearest = Math.min(nearest, hypot2(this.walkers.x[cop]! - x, this.walkers.z[cop]! - z));
    }
    return nearest;
  }

  /** Each node's fear: 1 at a cop of the case, falling to 0 at `DANGER_RADIUS`. */
  private fillDanger(caseIndex: number): void {
    const { nodeX, nodeZ } = this.map.graph;
    for (let node = 0; node < nodeX.length; node++) this.danger[node] = Math.max(0, 1 - this.copGap(caseIndex, nodeX[node]!, nodeZ[node]!) / DANGER_RADIUS);
  }

  /** The nearest hiding place's door that the suspect reaches `HIDE_LEAD` m ahead of the nearest cop; -1 with none. */
  private hideAhead(caseIndex: number, x: number, z: number): number {
    const { nodeX, nodeZ } = this.map.graph;
    let best = -1;
    let bestGap = Infinity;
    for (let at = 0; at < this.hideNodes.length; at++) {
      const node = this.hideNodes[at]!;
      const own = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
      if (own >= bestGap || own + HIDE_LEAD > this.copGap(caseIndex, nodeX[node]!, nodeZ[node]!)) continue;
      bestGap = own;
      best = node;
    }
    return best;
  }

  /** The node within `FLEE_REACH` m that is farthest from the cops, a metre of travel costing `FLEE_TRAVEL_WEIGHT` m of lead. */
  private farCorner(caseIndex: number, x: number, z: number): number {
    const { nodeX, nodeZ } = this.map.graph;
    let best = this.walkers.nearestNode(x, z);
    let bestScore = -Infinity;
    for (let node = 0; node < nodeX.length; node++) {
      const travel = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
      if (travel > FLEE_REACH) continue;
      const score = Math.min(FLEE_GAP_CAP, this.copGap(caseIndex, nodeX[node]!, nodeZ[node]!)) - FLEE_TRAVEL_WEIGHT * travel;
      if (score <= bestScore) continue;
      bestScore = score;
      best = node;
    }
    return best;
  }
}
