import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import { DECISION_HZ, LATERAL_MAX, NEVER_TICK, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, TICKS_PER_GAME_HOUR } from "./civilian-constants.ts";
import { LegPose, legPose } from "./civilian-leg.ts";
import { computeTick } from "./civilian-tick.ts";
import { createCityState } from "./society.ts";
import { intAt } from "./society.test-util.ts";

const map = buildOpenWorldMap(layOutLots());
const FRAME_SECONDS = 1 / 60;
/** A walk step at 60 frames a second is a few centimetres; a corner of the offset that jumps is the offset itself (up to `LATERAL_MAX` m, 1.4x it at a right angle). This allows four steps of the fastest walker. */
const MOST_PER_FRAME = 0.1;
/** The legs set out in the city's first game hour. */
const TICKS = TICKS_PER_GAME_HOUR;

/** The biggest move between two frames of every leg set out in the first game hour that turns a corner, each walked at the widest lateral offset to one side: the move and whose. */
function biggestFrameMove(): { metres: number; who: string; corners: number } {
  const state = createCityState(5, map, 150);
  const pose = new LegPose();
  let metres = 0;
  let who = "";
  let corners = 0;
  for (let tick = 0; tick < TICKS; tick++) {
    computeTick(state, tick);
    for (let resident = 0; resident < state.capacity; resident++) {
      if (intAt(state, resident, RESIDENT_INT.departTick) !== tick || intAt(state, resident, RESIDENT_INT.pathCount) < 3 || intAt(state, resident, RESIDENT_INT.driveLeaveTick) !== NEVER_TICK || intAt(state, resident, RESIDENT_INT.alarmTick) !== NEVER_TICK) continue;
      state.floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.lateral] = LATERAL_MAX;
      corners++;
      let lastX = NaN;
      let lastZ = NaN;
      for (let seconds = tick / DECISION_HZ; legPose(state, resident, seconds, pose); seconds += FRAME_SECONDS) {
        const move = hypot2(pose.x - lastX, pose.z - lastZ);
        if (move > metres) [metres, who] = [move, `resident ${resident} at ${seconds.toFixed(2)} s`];
        [lastX, lastZ] = [pose.x, pose.z];
      }
    }
  }
  return { metres, who, corners };
}

describe("given everyone who sets out in the city's first game hour on a walk that turns corners, each walking as far to one side of the way as anyone does", () => {
  // mutation: sed -i 's/  if (span === 0) {/  if (span >= 0) {/' /home/aphix/worktrees/OwFix/src/game/ai/civilians/civilian-leg.ts (the offset turns with each segment at a corner)
  it("when each walk is drawn at 60 frames a second, then nobody moves more than a few walk steps between two frames: the side they keep carries through every corner", () => {
    const { metres, who, corners } = biggestFrameMove();
    expect(corners, "control: walks with a corner").toBeGreaterThan(10);
    expect(metres, `biggest move between frames (${who})`).toBeLessThanOrEqual(MOST_PER_FRAME);
  });
});
