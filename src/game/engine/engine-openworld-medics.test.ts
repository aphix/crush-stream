import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { FRAME_DT } from "./bench-frame.ts";
import { MEDICS, OpenWorldMedics, placeMedics } from "./engine-openworld-medics.ts";

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

  it("when the traffic gives them the scene the ambulance is out on, then the medics kneel at it", () => {
    // mutation: sed -i 's/    this.sceneX = x;/    this.sceneX = 0;/' src/game/engine/engine-openworld-medics.ts
    const medics = new OpenWorldMedics({ update() {}, dispose() {} });
    const sight = {} as Parameters<OpenWorldMedics["frame"]>[3];
    medics.setScene(DOWN.x, DOWN.z);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    expect((medics.poses.x[0]! + medics.poses.x[1]!) / 2, "x of the scene they kneel at").toBeCloseTo(DOWN.x, 5);
    expect(medics.poses.z[0], "z of the scene they kneel at").toBeCloseTo(DOWN.z, 5);
  });
});
