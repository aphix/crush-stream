import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { NO_PERSON_PICK } from "../match/look-data.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { SLOTS } from "../present/ragdoll-config.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const WALKER = SLOTS - 1;
/** The feet's parts, left then right (`PARTS`). */
const FEET = [10, 11] as const;
/** The far cars wait this far out (m), clear of his walk. */
const PARKED_AT = 30;
/** He has this long (s) after the control is released to come to rest, and is watched this long (s) after. */
const SETTLE_S = 1;
const WATCH_S = 3;
/** A resting foot lifts (its sole's lowest point rises) or drifts across the ground by no more than this (m). */
const STILL_LIFT_M = 0.01;
const STILL_DRIFT_M = 0.02;

type Stillness = { steps: number; rise: number[]; drift: number[]; standing: boolean };

/** The lowest point of foot part `k` (m): its sole's lowest corner. */
function soleHeight(rig: OnFootRig, k: number): number {
  const body = rig.engine["ragdolls"]["dolls"][WALKER]!.bodies[k]!;
  const at = body.translation();
  const r = body.rotation();
  const turn = new THREE.Quaternion(r.x, r.y, r.z, r.w);
  const [hx, hy, hz] = PARTS[k]!.h;
  let lowest = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) lowest = Math.min(lowest, at.y + new THREE.Vector3(sx * hx, sy * hy, sz * hz).applyQuaternion(turn).y);
  return lowest;
}

/** `seconds` of zero input: how often a foot was lifted, how far each sole's lowest point moved up and down and each foot across the ground. */
function watchStill(rig: OnFootRig, seconds: number): Stillness {
  const walker = rig.walker();
  const bodies = rig.engine["ragdolls"]["dolls"][WALKER]!.bodies;
  const first = FEET.map((k) => bodies[k]!.translation());
  const low = FEET.map((k) => [soleHeight(rig, k), soleHeight(rig, k)]);
  const out: Stillness = { steps: 0, rise: [0, 0], drift: [0, 0], standing: false };
  let planted = [walker.gait.planted[0]!, walker.gait.planted[1]!];
  for (let t = 0; t < seconds; t += FRAME) {
    rig.run(FRAME);
    for (const [f, k] of FEET.entries()) {
      if (planted[f] === 1 && walker.gait.planted[f] === 0) out.steps++;
      const at = bodies[k]!.translation();
      const h = soleHeight(rig, k);
      low[f] = [Math.min(low[f]![0]!, h), Math.max(low[f]![1]!, h)];
      out.rise[f] = low[f]![1]! - low[f]![0]!;
      out.drift[f] = Math.max(out.drift[f]!, Math.hypot(at.x - first[f]!.x, at.z - first[f]!.z));
    }
    planted = [walker.gait.planted[0]!, walker.gait.planted[1]!];
  }
  out.standing = walker.gait.standing;
  return out;
}

const cases: readonly { it: string; key: string; seconds: number; resetMidWalk: boolean }[] = [
  { it: "when he taps forward for 0.2 s and lets go", key: "KeyW", seconds: 0.2, resetMidWalk: false },
  { it: "when he taps sideways (away from his car) for 0.5 s and lets go", key: "KeyA", seconds: 0.5, resetMidWalk: false },
  { it: "when he walks forward for 2 s and lets go", key: "KeyW", seconds: 2, resetMidWalk: false },
  { it: "when he walks, the scene is reset mid-stride and he gets out again", key: "KeyW", seconds: 1.3, resetMidWalk: true },
];

/** One engine for the file: a second `CrashEngine` in the same process never resolves `ready`. */
describe("given the real engine in the fleet, his player out of the car at zero input", () => {
  let rig: OnFootRig;
  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.run(FRAME);
  });
  afterAll(() => rig.dispose());

  /** The scene put back (as a reset does it) with his player a woman or a man, and him out at the door. */
  function getOutAs(woman: boolean): void {
    rig.normalTime();
    rig.engine.setPersonPick({ ...NO_PERSON_PICK, woman });
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    rig.place(0, 0, 0);
    for (let i = 1; i < rig.cars().length; i++) rig.place(i, PARKED_AT * (i % 2 === 0 ? 1 : -1), -PARKED_AT + 4 * i);
    rig.sit(0);
    rig.run(0.2);
    rig.getOut();
  }

  for (const woman of [true, false]) {
    for (const testCase of cases) {
      it(`${woman ? "a woman" : "a man"}: ${testCase.it}, then no foot steps or lifts at zero input after ${SETTLE_S} s`, () => {
        getOutAs(woman);
        rig.hold(testCase.key, testCase.seconds);
        if (testCase.resetMidWalk) getOutAs(woman);
        rig.run(SETTLE_S);
        const still = watchStill(rig, WATCH_S);
        const walker = rig.walker();
        const seen = `steps ${still.steps}, rise ${still.rise.map((v) => (v * 100).toFixed(1))} cm, drift ${still.drift.map((v) => (v * 100).toFixed(1))} cm, standing ${still.standing}, ${walker.state}, speed ${walker.loco.speed.toFixed(2)}, turn ${walker.loco.turnRate.toFixed(2)}, planted ${[...walker.gait.planted]}, pivot ${[...walker.gait.pivot]}`;
        expect(still.steps, `no foot lifted: ${seen}`).toBe(0);
        expect(still.rise.every((v) => v <= STILL_LIFT_M), `no sole rose: ${seen}`).toBeTruthy();
        expect(still.drift.every((v) => v <= STILL_DRIFT_M), `no foot drifted: ${seen}`).toBeTruthy();
        expect(still.standing, `the gait is parked: ${seen}`).toBeTruthy();
      });
    }
  }
});
