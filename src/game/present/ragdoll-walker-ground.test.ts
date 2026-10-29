import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
const WALKER = SLOTS - 1;

let system: RagdollSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
});

/** A system with the player's walker standing at the origin, the run's world named `mode` before he starts. */
async function standing(mode: "inline" | "remote" | null): Promise<RagdollSystem> {
  const sys = await flatSystem();
  system = sys;
  sys["mode"] = mode;
  expect(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed").toBeGreaterThanOrEqual(0);
  return sys;
}

describe("given the player's walker starting where the run's dummies were in the worker's world (a track's)", () => {
  it("when he starts, then the run is in this thread's world, where he is stepped, and not the worker's", async () => {
    const sys = await standing("remote");
    expect(sys["mode"]).toBe("inline");
    expect(sys.walker.active).toBe(true);
  });
});

describe("given the player's walker standing where the ground beneath him was built", () => {
  const cases: readonly { it: string; movedM: number; expectedPatchX: number }[] = [
    { it: "when he has walked 10 m from it, then the ground stays where it was built (it reaches 48 m round it)", movedM: 10, expectedPatchX: 0 },
    { it: "when he has walked 30 m from it, then the ground is built again round him there", movedM: 30, expectedPatchX: 30 },
  ];
  for (const testCase of cases) {
    it(testCase.it, async () => {
      const sys = await standing(null);
      sys["dolls"][WALKER]!.cur[0] = testCase.movedM;
      sys.update(FRAME, [], true, false, null);
      expect(sys["walkerPatchX"]).toBe(testCase.expectedPatchX);
    });
  }
});
