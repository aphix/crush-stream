import { hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, MAX_PATH_NODES, NEVER_TICK, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import type { CivilianCrowd } from "./civilian-crowd.ts";

/** A civilian's pace in these scenes (m/s). */
export const PACE = 1.4;

export type StreetEdge = { from: number; to: number; length: number; dirX: number; dirZ: number };

/** The first street edge of `map` at least `atLeast` m long and no crossing: room for two to meet and part on it. */
export function streetEdge(map: OpenWorldMap, atLeast: number): StreetEdge {
  const { nodeX, nodeZ, edgeStart, edgeTo, edgeLength, edgeCrossing } = map.graph;
  for (let node = 0; node < nodeX.length; node++) {
    for (let edge = edgeStart[node]!; edge < edgeStart[node + 1]!; edge++) {
      if (edgeLength[edge]! < atLeast || edgeCrossing[edge] !== 0) continue;
      const to = edgeTo[edge]!;
      const length = hypot2(nodeX[to]! - nodeX[node]!, nodeZ[to]! - nodeZ[node]!);
      return { from: node, to, length, dirX: (nodeX[to]! - nodeX[node]!) / length, dirZ: (nodeZ[to]! - nodeZ[node]!) / length };
    }
  }
  throw new Error(`the map has no street edge of ${atLeast} m`);
}

/** `count` residents of `crowd` who are living people (the list ends in spare slots no one lives in), from the first of the list or (`fromTop`) the last. */
export function people(crowd: CivilianCrowd, count: number, fromTop = false): number[] {
  const found: number[] = [];
  for (let step = 0; step < crowd.poses.count && found.length < count; step++) {
    const resident = fromTop ? crowd.poses.count - 1 - step : step;
    const row = resident * RESIDENT_INT_STRIDE;
    if (crowd.state.ints[row + RESIDENT_INT.alive] === 1 && crowd.state.ints[row + RESIDENT_INT.species] === SPECIES.person) found.push(resident);
  }
  return found;
}

/** `resident` walks straight from node `from` to node `to` of `edge` at `PACE` m/s from the first second, on the street's middle, and decides nothing more. */
export function sendAlong(crowd: CivilianCrowd, resident: number, edge: StreetEdge, from: number, to: number): void {
  const { state } = crowd;
  const first = resident * MAX_PATH_NODES;
  const intBase = resident * RESIDENT_INT_STRIDE;
  state.pathNodes[first] = from;
  state.pathNodes[first + 1] = to;
  state.pathDistance[first] = 0;
  state.pathDistance[first + 1] = edge.length;
  state.ints[intBase + RESIDENT_INT.pathCount] = 2;
  state.ints[intBase + RESIDENT_INT.departTick] = 0;
  state.ints[intBase + RESIDENT_INT.arriveTick] = Math.ceil((edge.length / PACE) * DECISION_HZ) + 1;
  state.ints[intBase + RESIDENT_INT.nextDecisionTick] = NEVER_TICK;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed] = PACE;
  state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = 0;
}

/** A push read off the log: the victim, the civilian who pushed (-1: none), and the bearing to the player who shoved (-1: none; neither is a car's nudge). */
export type Push = { victim: number; pusher: number; bearing: number };

/** The pushes of an event log (kind, subject, seconds triples): a push triple, and the `alongside` (a civilian) or `walker` (a player's bearing) triple of the same seconds after it. */
export function pushesIn(events: ArrayLike<number>): Push[] {
  const found: Push[] = [];
  for (let at = 0; at + EVENT_TRIPLE <= events.length; at += EVENT_TRIPLE) {
    if (events[at] !== EVENT_KIND.push) continue;
    const next = at + EVENT_TRIPLE;
    const follows = next + EVENT_TRIPLE <= events.length && events[next + 2] === events[at + 2];
    found.push({
      victim: events[at + 1]!,
      pusher: follows && events[next] === EVENT_KIND.alongside ? events[next + 1]! : -1,
      bearing: follows && events[next] === EVENT_KIND.walker ? events[next + 1]! : -1,
    });
  }
  return found;
}
