import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { hypot3 } from "../kernel/physics-core.js";
import { blankStrike } from "../scenes/figure-strike.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";

const FRAME = 1 / FRAME_HZ;
const HEAD = 1;
const PART_FLOATS = 7;
const LAIN_STILL_SECONDS = 2;
const HAUL_SPEED = 2;
const HAUL_SECONDS = 1;
const SHIFT_M = 5;
/** A head's offset from the torso that moved by more than this (0.1 mm) has moved: a still body's reads under it, a hauled one's over. */
const HEAD_MOVED_M = 1e-4;
const STILL_SECONDS = 0.5;

function frames(sys: RagdollSystem, seconds: number, each?: () => void): void {
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    each?.();
    sys.update(FRAME, [], true, true, null);
  }
}

/** A walker on flat ground knocked limp by a push of 2 m/s along +z, then left to lie for `LAIN_STILL_SECONDS`. */
async function lyingWalker(): Promise<RagdollSystem> {
  const sys = await flatSystem();
  sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) });
  frames(sys, 1);
  const torso = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation();
  const strike = blankStrike();
  strike.guard = -1;
  strike.car = -1;
  strike.x = torso.x;
  strike.y = torso.y;
  strike.z = torso.z;
  strike.vz = 2;
  sys.knockWalker(strike);
  frames(sys, LAIN_STILL_SECONDS);
  return sys;
}

/** The torso's place and velocity as `dollMotion` reads them. */
function motionOf(sys: RagdollSystem): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
  const motion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  expect(sys.dollMotion(WALKER_SLOT, motion), "the walker's body is out").toBe(true);
  return motion;
}

/** Where the head stands from the torso (m, world axes), as the drawn pose has it, into `out`. */
function headOffsetInto(sys: RagdollSystem, out: Float64Array): void {
  const cur = sys["dolls"][WALKER_SLOT]!.cur;
  for (let axis = 0; axis < 3; axis++) out[axis] = cur[PART_FLOATS * HEAD + axis]! - cur[axis]!;
}

describe("given a walker knocked limp that has lain still for 2 s", () => {
  it("when its torso is asked to move at 2 m/s along +x every frame for 1 s, then it has gone 2 m along x within 0.3 m and its head's offset from its torso changed on the way; and when it is then shifted 5 m along z, then every part stands 5 m further along z within 1 mm, in the pose drawn a frame later too", async () => {
    const sys = await lyingWalker();
    expect(sys["walkers"][WALKER_SLOT]!.state, "control: he lies").not.toBe("stand");
    const headBefore = new Float64Array(3);
    const headNow = new Float64Array(3);
    headOffsetInto(sys, headBefore);
    let stillMostChange = 0;
    frames(sys, STILL_SECONDS, () => {
      headOffsetInto(sys, headNow);
      stillMostChange = Math.max(stillMostChange, hypot3(headNow[0]! - headBefore[0]!, headNow[1]! - headBefore[1]!, headNow[2]! - headBefore[2]!));
    });
    expect(stillMostChange, "control: how much the head's offset changes while nothing hauls him (m)").toBeLessThan(HEAD_MOVED_M);
    const before = motionOf(sys);
    expect(hypot3(before.vx, before.vy, before.vz), "control: he lies still (m/s)").toBeLessThan(0.2);
    headOffsetInto(sys, headBefore);
    let headMostChange = 0;
    frames(sys, HAUL_SECONDS, () => {
      sys.dragDoll(WALKER_SLOT, HAUL_SPEED, 0, 0);
      headOffsetInto(sys, headNow);
      headMostChange = Math.max(headMostChange, hypot3(headNow[0]! - headBefore[0]!, headNow[1]! - headBefore[1]!, headNow[2]! - headBefore[2]!));
    });
    const after = motionOf(sys);
    expect(after.x - before.x, "metres hauled along x").toBeGreaterThan(HAUL_SPEED * HAUL_SECONDS - 0.3);
    expect(after.x - before.x, "metres hauled along x, at most").toBeLessThan(HAUL_SPEED * HAUL_SECONDS + 0.3);
    expect(headMostChange, "how much the head's offset from the torso changed on the way (m)").toBeGreaterThan(HEAD_MOVED_M);
    frames(sys, LAIN_STILL_SECONDS);
    const bodies = sys["dolls"][WALKER_SLOT]!.bodies;
    const zBefore = bodies.map((body) => body.translation().z);
    sys.shiftDoll(WALKER_SLOT, 0, 0, SHIFT_M);
    for (let k = 0; k < bodies.length; k++) expect(bodies[k]!.translation().z - zBefore[k]!, `part ${k}: metres shifted along z`).toBeCloseTo(SHIFT_M, 3);
    frames(sys, FRAME);
    const cur = sys["dolls"][WALKER_SLOT]!.cur;
    for (let k = 0; k < bodies.length; k++) expect(Math.abs(cur[PART_FLOATS * k + 2]! - zBefore[k]! - SHIFT_M), `part ${k}: drawn pose a frame later (m off the shift)`).toBeLessThan(0.001);
  });
});

/** The torso's speed along x (m/s) one world step after `calls` haul calls at `HAUL_SPEED`, on a body that lay still. */
async function speedAfterCalls(calls: number): Promise<number> {
  const sys = await lyingWalker();
  for (let call = 0; call < calls; call++) sys.dragDoll(WALKER_SLOT, HAUL_SPEED, 0, 0);
  frames(sys, FRAME);
  const speed = motionOf(sys).vx;
  sys.dispose();
  return speed;
}

/** How far (m/s) a speed may differ from the one-call speed: the hauls are one and the same push. */
const SAME_PUSH_MPS = 0.05;

describe("given a limp walker that lay still, hauled at 2 m/s by one, two and four calls before the world's next step", () => {
  it("when each has been stepped once, then the two and four calls leave the torso at the one call's speed, and that speed is the haul's", async () => {
    const one = await speedAfterCalls(1);
    expect(one, "control: one call gets the body going at about the haul's speed (m/s)").toBeGreaterThan(HAUL_SPEED / 2);
    expect(Math.abs((await speedAfterCalls(2)) - one), "two calls: speed off the one call's (m/s)").toBeLessThan(SAME_PUSH_MPS);
    expect(Math.abs((await speedAfterCalls(4)) - one), "four calls: speed off the one call's (m/s)").toBeLessThan(SAME_PUSH_MPS);
  });
});
