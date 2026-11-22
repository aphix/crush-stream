import { describe, expect, it } from "vitest";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import { CHEST_HEIGHT } from "../ai/civilians/civilian-crowd-constants.ts";
import { newCrowd, shownResident, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { lookAtOf, LookRay } from "../ai/civilians/civilian-look.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { OpenWorldMinds } from "./engine-openworld-minds.ts";

/** The eye stands this far (m) from the civilian, at this height. */
const STAND_BACK = 6;
const EYE_HEIGHT = 1.5;

describe("given a crowd with a civilian shown and the look panel's eye 6 m from her", () => {
  // mutation: sed -i 's/    return text === null || thought === null ? text : { title: text.title, lines: \[...text.lines, thought\] };/    return text;/' src/game/engine/engine-openworld-minds.ts
  // mutation: sed -i '/^  if (shown !== null) shown.index = about ? resident.index : -1;/d' src/game/ai/civilians/civilian-look.ts
  it("when the panel's ray meets her, then her panel ends with what she thinks; with the ray on nobody, the panel is as it was", () => {
    const crowd = newCrowd(buildFixtureMap());
    const seconds = stepUntilShown(crowd);
    const resident = shownResident(crowd);
    const minds = new OpenWorldMinds(crowd.poses.count);
    const ray = new LookRay();
    ray.eyeX = crowd.poses.x[resident]! - STAND_BACK;
    ray.eyeY = EYE_HEIGHT;
    ray.eyeZ = crowd.poses.z[resident]!;
    const rise = crowd.poses.feetY[resident]! + CHEST_HEIGHT - EYE_HEIGHT;
    const length = Math.sqrt(STAND_BACK * STAND_BACK + rise * rise);
    ray.dirX = STAND_BACK / length;
    ray.dirY = rise / length;
    ray.dirZ = 0;
    minds.frame(crowd, null, ray, false, 1 / FRAME_HZ);
    const text = lookAtOf(crowd.state, crowd.poses, tickAt(seconds), ray, minds.shown);
    expect(minds.shown.index, "the panel is about her").toBe(resident);
    const lines = text?.lines.length ?? -1;
    const thought = minds.describe(text);
    expect(thought?.lines.length, "lines on her panel").toBe(lines + 1);
    expect(thought?.lines[lines], "her thought last").toMatch(/^Thinks "/);
    ray.dirX = -1;
    ray.dirY = 0;
    const away = lookAtOf(crowd.state, crowd.poses, tickAt(seconds), ray, minds.shown);
    expect(minds.shown.index, "the ray on nobody").toBe(-1);
    expect(minds.describe(away), "the panel as it was").toBe(away);
  });
});
