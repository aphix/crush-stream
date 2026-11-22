import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
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
      expect(hypot2(poses.x[medic]! - DOWN.x, poses.z[medic]! - DOWN.z), "beside them").toBeCloseTo(MEDICS.beside, 5);
      const toX = DOWN.x - poses.x[medic]!;
      const toZ = DOWN.z - poses.z[medic]!;
      expect(detSin(poses.yaw[medic]!) * toX + detCos(poses.yaw[medic]!) * toZ, "facing them").toBeCloseTo(MEDICS.beside, 5);
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

  it("when someone else is run down while the ambulance is loading and no second one is sent, then the medics stay at the first scene", () => {
    // mutation: sed -i 's/    if (sent) this.setScene(x, z);/    this.setScene(x, z);/' src/game/engine/engine-openworld-medics.ts
    const medics = new OpenWorldMedics({ update() {}, dispose() {} });
    const sight = {} as Parameters<OpenWorldMedics["frame"]>[3];
    medics.call(DOWN.x, DOWN.z, true);
    medics.call(DOWN.x + 30, DOWN.z + 30, false);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    expect((medics.poses.x[0]! + medics.poses.x[1]!) / 2, "x of the scene they kneel at").toBeCloseTo(DOWN.x, 5);
    expect(medics.poses.z[0], "z of the scene they kneel at").toBeCloseTo(DOWN.z, 5);
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

describe("given the hook has taken one of the two medics kneeling at a scene", () => {
  const sight = {} as Parameters<OpenWorldMedics["frame"]>[3];

  // mutation: sed -i 's/      else if (this.taken\[medic\] === 1) this.poses.shown\[medic\] = 0;/      else if (this.taken[medic] === 1) this.poses.shown[medic] = 1;/' src/game/engine/engine-openworld-medics.ts
  it("when the ambulance goes on loading, then he is not drawn and his partner still is", () => {
    const medics = new OpenWorldMedics({ update() {}, dispose() {} });
    medics.setScene(DOWN.x, DOWN.z);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    medics.take(1);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    expect(Array.from(medics.poses.shown), "medics drawn").toEqual([1, 0]);
  });

  // mutation: sed -i '/^      if (ambulanceState !== AMBULANCE.loading) this.taken\[medic\] = 0;/d' src/game/engine/engine-openworld-medics.ts
  it("when the ambulance has left and comes to another scene, then both medics kneel there again", () => {
    const medics = new OpenWorldMedics({ update() {}, dispose() {} });
    medics.setScene(DOWN.x, DOWN.z);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    medics.take(1);
    medics.frame(AMBULANCE.leaving, 0, 0, sight, FRAME_DT);
    medics.frame(AMBULANCE.loading, 0, 0, sight, FRAME_DT);
    expect(Array.from(medics.poses.shown), "medics drawn").toEqual([1, 1]);
  });
});
