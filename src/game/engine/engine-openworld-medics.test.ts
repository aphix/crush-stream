import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { FRAME_DT } from "./bench-frame.ts";
import { MEDICS, placeMedics } from "./engine-openworld-medics.ts";

const DOWN = { x: 12.5, z: -40.25 };

describe("given someone run down and an ambulance called for them", () => {
  it("when the ambulance is loading at the scene, then both medics kneel either side of where it was called to, facing them", () => {
    // mutation: sed -i 's/const atScene = ambulanceState === AMBULANCE.loading;/const atScene = false;/' src/game/engine/engine-openworld-medics.ts
    const poses = createCrowdPoses(MEDICS.count);
    placeMedics(poses, DOWN.x, DOWN.z, AMBULANCE.loading, FRAME_DT);
    for (let medic = 0; medic < MEDICS.count; medic++) {
      expect(poses.shown[medic], `medic ${medic} drawn`).toBe(1);
      expect(poses.activity[medic], "kneeling").toBe(ACTIVITY.kneel);
      expect(Math.hypot(poses.x[medic]! - DOWN.x, poses.z[medic]! - DOWN.z), "beside them").toBeCloseTo(MEDICS.beside, 5);
      const toX = DOWN.x - poses.x[medic]!;
      const toZ = DOWN.z - poses.z[medic]!;
      expect(Math.sin(poses.yaw[medic]!) * toX + Math.cos(poses.yaw[medic]!) * toZ, "facing them").toBeCloseTo(MEDICS.beside, 5);
    }
    expect(Math.sign(poses.x[0]! - DOWN.x), "one each side").toBe(-Math.sign(poses.x[1]! - DOWN.x));
  });

  it("when the ambulance is on its way or driving off, then no medic is drawn", () => {
    const poses = createCrowdPoses(MEDICS.count);
    for (const state of [AMBULANCE.idle, AMBULANCE.coming, AMBULANCE.leaving]) {
      placeMedics(poses, DOWN.x, DOWN.z, state, FRAME_DT);
      expect(Array.from(poses.shown), `state ${state}`).toEqual([0, 0]);
    }
  });
});
