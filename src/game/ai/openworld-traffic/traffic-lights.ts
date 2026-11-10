import { alongX } from "../../world/openworld/openworld-roads.ts";
import { ALL_RED_SECONDS, LEFT_GREEN_SECONDS, LIGHT_STAGGER_SECONDS, THROUGH_GREEN_SECONDS, YELLOW_SECONDS } from "./traffic-constants.ts";

/** Which approaches a phase serves: through and right turns, or left turns, of one street. Each pair of opposite approaches shares a phase, so no two turns meet. */
export const SIGNAL_PHASE = { northSouthThrough: 0, northSouthLeft: 1, eastWestThrough: 2, eastWestLeft: 3 } as const;
const PHASE_COUNT = 4;

export const LIGHT = { green: 0, yellow: 1, red: 2 } as const;
type LightState = (typeof LIGHT)[keyof typeof LIGHT];

/** A phase's stages in order; `lightPhase` packs phase * STAGE_COUNT + stage. */
const STAGE = { green: 0, yellow: 1, allRed: 2 } as const;
const STAGE_COUNT = 3;

const PHASE_GREEN = [THROUGH_GREEN_SECONDS, LEFT_GREEN_SECONDS, THROUGH_GREEN_SECONDS, LEFT_GREEN_SECONDS] as const;
/** Seconds a junction's four phases take, green, yellow and all red each, before they come round again. */
export const CYCLE_SECONDS = PHASE_GREEN.reduce((sum, green) => sum + green + YELLOW_SECONDS + ALL_RED_SECONDS, 0);

/** The phase and stage junction `junction` shows at crowd time `seconds`, packed as `phase * STAGE_COUNT + stage`: a pure function of the two, the same on every peer. */
export function lightPhase(junction: number, seconds: number): number {
  let time = (seconds + junction * LIGHT_STAGGER_SECONDS) % CYCLE_SECONDS;
  if (time < 0) time += CYCLE_SECONDS;
  for (let phase = 0; phase < PHASE_COUNT; phase++) {
    const green = PHASE_GREEN[phase]!;
    if (time < green) return phase * STAGE_COUNT + STAGE.green;
    time -= green;
    if (time < YELLOW_SECONDS) return phase * STAGE_COUNT + STAGE.yellow;
    time -= YELLOW_SECONDS;
    if (time < ALL_RED_SECONDS) return phase * STAGE_COUNT + STAGE.allRed;
    time -= ALL_RED_SECONDS;
  }
  return (PHASE_COUNT - 1) * STAGE_COUNT + STAGE.allRed;
}

/** The phase that serves a car on approach `heading`: its through phase, or its left phase when it turns left. */
export function phaseOfApproach(heading: number, leftTurn: boolean): number {
  const through = alongX(heading) ? SIGNAL_PHASE.eastWestThrough : SIGNAL_PHASE.northSouthThrough;
  return leftTurn ? through + 1 : through;
}

/** What the lamp for `phase` shows at crowd time `seconds`. */
export function lightState(junction: number, phase: number, seconds: number): LightState {
  const packed = lightPhase(junction, seconds);
  if (Math.floor(packed / STAGE_COUNT) !== phase) return LIGHT.red;
  const stage = packed % STAGE_COUNT;
  return stage === STAGE.green ? LIGHT.green : stage === STAGE.yellow ? LIGHT.yellow : LIGHT.red;
}
