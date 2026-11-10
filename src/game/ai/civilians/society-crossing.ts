import { hypot2 } from "../../kernel/physics-core.js";
import {
  CROSS_DART_BASE,
  CROSS_DART_JUMPY,
  DECISION_HZ,
  MAX_PATH_NODES,
  MAX_WAITS,
  RESIDENT_FLOAT,
  RESIDENT_FLOAT_STRIDE,
  RESIDENT_INT,
  RESIDENT_INT_STRIDE,
  STREAM,
} from "./civilian-constants.ts";
import { residentDraws } from "./civilian-draws.ts";
import type { CityState } from "./civilian-state.ts";
import { residentNeuroticism } from "./civilian-temperament.ts";

/** Whether the way between two neighbouring nodes of the walk graph crosses a road. */
export function isCrossingBetween(state: CityState, from: number, to: number): boolean {
  const { edgeStart, edgeTo, edgeCrossing } = state.map.graph;
  for (let edge = edgeStart[from]!; edge < edgeStart[from + 1]!; edge++) if (edgeTo[edge] === to) return edgeCrossing[edge] !== 0;
  return false;
}

/** The resident's leg has no waits at kerbs. */
export function clearWaits(state: CityState, resident: number): void {
  state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.waitCount] = 0;
}

/**
 * Works out the waits at kerbs of the leg resident \`resident\` has just been given along \`state.pathNodes\` (departing at \`departTick\`, walking at their pace): each crossing a walker comes to is waited at while the cars of the
 * street have the green (\`state.signals\`), the next crossing met that much later. A walker who goes against the light (by a seeded draw for each crossing, likelier for the jumpy) waits for none. Up to \`MAX_WAITS\` are kept in the
 * row (the later crossings are walked without one); returns their total, in ticks, for the leg to be that much longer. Nothing is written, and 0 returned, without lights.
 */
export function planWaits(state: CityState, resident: number, departTick: number): number {
  const { signals } = state;
  const base = resident * RESIDENT_INT_STRIDE;
  state.ints[base + RESIDENT_INT.waitCount] = 0;
  if (signals === null) return 0;
  const first = resident * MAX_PATH_NODES;
  const count = state.ints[base + RESIDENT_INT.pathCount]!;
  const pace = state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
  const { nodeX, nodeZ } = state.map.graph;
  const draw = residentDraws(state.seed, resident, STREAM.cross, state.ints[base + RESIDENT_INT.decisionCount]!);
  const dartChance = CROSS_DART_BASE + CROSS_DART_JUMPY * residentNeuroticism(state, resident);
  let waits = 0;
  let waitedTicks = 0;
  for (let step = 0; step + 1 < count && waits < MAX_WAITS; step++) {
    const from = state.pathNodes[first + step]!;
    const to = state.pathNodes[first + step + 1]!;
    if (!isCrossingBetween(state, from, to) || draw() < dartChance) continue;
    const reach = (departTick + waitedTicks) / DECISION_HZ + state.pathDistance[first + step]! / pace;
    const crossingSeconds = hypot2(nodeX[to]! - nodeX[from]!, nodeZ[to]! - nodeZ[from]!) / pace;
    const wait = signals.waitSeconds(nodeX[from]!, nodeZ[from]!, nodeX[to]!, nodeZ[to]!, reach, crossingSeconds);
    const ticks = Math.ceil(wait * DECISION_HZ);
    if (ticks <= 0) continue;
    state.ints[base + RESIDENT_INT.waitIndex0 + waits] = step;
    state.ints[base + RESIDENT_INT.waitTicks0 + waits] = ticks;
    waits++;
    waitedTicks += ticks;
  }
  state.ints[base + RESIDENT_INT.waitCount] = waits;
  return waitedTicks;
}
