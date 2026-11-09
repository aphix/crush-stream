import { detAtan2, hypot2 } from "../../kernel/physics-core.js";
import { DECISION_HZ, LATERAL_FADE_DISTANCE, MAX_PATH_NODES, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "./civilian-constants.ts";
import type { CityState } from "./civilian-state.ts";

/** Where a walker is and which way it faces (heading 0 = +Z, positive toward +X): the out parameter of the position functions. */
export class LegPose {
  x = 0;
  z = 0;
  dirX = 0;
  dirZ = 1;
  yaw = 0;
}

/** Writes where resident `resident` stands on its leg at crowd time `seconds` into `out`; false when it is not on a leg then (not yet departed, arrived, or no leg). A pure function of the row and the time: any frame rate, no state, no allocation. */
export function legPose(state: CityState, resident: number, seconds: number, out: LegPose): boolean {
  const { ints, floats, pathNodes, pathDistance } = state;
  const { nodeX, nodeZ } = state.map.graph;
  const intBase = resident * RESIDENT_INT_STRIDE;
  const count = ints[intBase + RESIDENT_INT.pathCount]!;
  if (count === 0) return false;
  const departSeconds = ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ;
  if (seconds < departSeconds || seconds >= ints[intBase + RESIDENT_INT.arriveTick]! / DECISION_HZ) return false;
  const first = resident * MAX_PATH_NODES;
  const floatBase = resident * RESIDENT_FLOAT_STRIDE;
  const total = pathDistance[first + count - 1]!;
  const walked = Math.min(total, floats[floatBase + RESIDENT_FLOAT.speed]! * (seconds - departSeconds));
  let step = 0;
  while (step + 2 < count && pathDistance[first + step + 1]! <= walked) step++;
  const from = pathNodes[first + step]!;
  const to = pathNodes[first + Math.min(step + 1, count - 1)]!;
  const spanX = nodeX[to]! - nodeX[from]!;
  const spanZ = nodeZ[to]! - nodeZ[from]!;
  const span = hypot2(spanX, spanZ);
  const segment = pathDistance[first + Math.min(step + 1, count - 1)]! - pathDistance[first + step]!;
  const along = segment > 0 ? Math.min(1, (walked - pathDistance[first + step]!) / segment) : 0;
  if (span > 0) {
    out.dirX = spanX / span;
    out.dirZ = spanZ / span;
    out.yaw = detAtan2(out.dirX, out.dirZ);
  }
  const fade = Math.max(0, Math.min(1, walked / LATERAL_FADE_DISTANCE, (total - walked) / LATERAL_FADE_DISTANCE));
  const offset = floats[floatBase + RESIDENT_FLOAT.lateral]! * fade;
  out.x = nodeX[from]! + spanX * along + out.dirZ * offset;
  out.z = nodeZ[from]! + spanZ * along - out.dirX * offset;
  return true;
}

/** `legPose` for a walker the crowd shows: also false while the resident is dead or off the street run down (a knock hides them from its tick on, before any answer says so). */
export function legPositionAt(state: CityState, resident: number, seconds: number, out: LegPose): boolean {
  if (state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.alive] === 0) return false;
  const tick = seconds * DECISION_HZ;
  if (tick >= state.hiddenFromTick[resident]! && tick < state.hiddenUntilTick[resident]!) return false;
  return legPose(state, resident, seconds, out);
}
