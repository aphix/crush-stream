import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
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
  assert.ok(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }) >= 0, "the walker is placed");
  return sys;
}

describe("given the player's walker starting where the run's dummies were in the worker's world (a track's)", () => {
  it("when he starts, then the run is in this thread's world, where he is stepped, and not the worker's", async () => {
    const sys = await standing("remote");
    assert.equal(sys["mode"], "inline");
    assert.equal(sys.walker.active, true);
  });
});

describe("given the player's walker standing where his ground patch was built", () => {
  const cases: readonly { it: string; movedM: number; expectedPatchX: number }[] = [
    { it: "when he has walked 10 m from it, then the patch stays where it is (a heightfield reaches 48 m round it)", movedM: 10, expectedPatchX: 0 },
    { it: "when he has walked 30 m from it, then the patch is built again round him there", movedM: 30, expectedPatchX: 30 },
  ];
  for (const testCase of cases) {
    it(testCase.it, async () => {
      const sys = await standing(null);
      sys["dolls"][WALKER]!.cur[0] = testCase.movedM;
      sys.update(FRAME, [], true, false, null);
      assert.equal(sys["walkerPatchX"], testCase.expectedPatchX);
    });
  }
});
