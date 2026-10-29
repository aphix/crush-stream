import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** The pool slot the walker takes. */
const WALKER = SLOTS - 1;
const SETTLE_SECONDS = 1;

type Shove = "none" | "tipForward" | "tipSideways" | "tipHard" | "carHit";
type Outcome = "stands" | "falls" | "standsAfterFalling";

/** What a shove does to the torso: a twist (N·m·s) about an axis, or a straight blow (N·s) along +x at chest height. */
const SHOVES: Record<Shove, { torque: { x: number; y: number; z: number }; blow: { x: number; y: number; z: number } }> = {
  none: { torque: { x: 0, y: 0, z: 0 }, blow: { x: 0, y: 0, z: 0 } },
  tipForward: { torque: { x: 160, y: 0, z: 0 }, blow: { x: 0, y: 0, z: 0 } },
  tipSideways: { torque: { x: 0, y: 0, z: 160 }, blow: { x: 0, y: 0, z: 0 } },
  tipHard: { torque: { x: 320, y: 0, z: 0 }, blow: { x: 0, y: 0, z: 0 } },
  carHit: { torque: { x: 0, y: 0, z: 0 }, blow: { x: 1200, y: 0, z: 0 } },
};

let system: RagdollSystem;

async function stoodUp(): Promise<RagdollSystem> {
  const sys = await flatSystem();
  assert.equal(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), WALKER, "the walker is placed in his slot");
  return sys;
}

/** The torso and what it reads: height, tilt from upright (deg) and the facing angle about the vertical (rad, 0 along +z). */
function readTorso(sys: RagdollSystem) {
  const body = sys["dolls"][WALKER]!.bodies[0]!;
  const p = body.translation();
  const q = body.rotation();
  const up = 1 - 2 * (q.x * q.x + q.z * q.z);
  const forwardX = 2 * (q.x * q.z + q.w * q.y);
  const forwardZ = 1 - 2 * (q.x * q.x + q.y * q.y);
  return { x: p.x, y: p.y, z: p.z, tilt: (Math.acos(Math.max(-1, Math.min(1, up))) * 180) / Math.PI, facing: Math.atan2(forwardX, forwardZ) };
}

function frames(sys: RagdollSystem, seconds: number, each?: () => void): void {
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    each?.();
    sys.update(FRAME, [], true, true, null);
  }
}

function shove(sys: RagdollSystem, kind: Shove): void {
  const body = sys["dolls"][WALKER]!.bodies[0]!;
  const { torque, blow } = SHOVES[kind];
  body.applyTorqueImpulse(torque, true);
  body.applyImpulse(blow, true);
}

beforeEach(async () => {
  system = await stoodUp();
});

afterEach(() => {
  system.dispose();
});

const standingCases: readonly { it: string; shove: Shove; expectedOutcome: Outcome; expectedMaxTilt: number }[] = [
  { it: "when nothing touches him, then he stays up", shove: "none", expectedOutcome: "stands", expectedMaxTilt: 5 },
  { it: "when he is twisted forward, then he straightens up again", shove: "tipForward", expectedOutcome: "stands", expectedMaxTilt: 40 },
  { it: "when he is twisted sideways, then he straightens up again", shove: "tipSideways", expectedOutcome: "stands", expectedMaxTilt: 40 },
  { it: "when he is twisted hard, then he still straightens up again", shove: "tipHard", expectedOutcome: "stands", expectedMaxTilt: 60 },
  { it: "when a car's blow takes his legs out from under him, then he goes down and, the player holding a walking control, gets up again", shove: "carHit", expectedOutcome: "standsAfterFalling", expectedMaxTilt: 180 },
];

describe("given a walker standing on open ground", () => {
  for (const testCase of standingCases) {
    it(testCase.it, () => {
      frames(system, SETTLE_SECONDS);
      shove(system, testCase.shove);
      let worstTilt = 0;
      let fell = false;
      frames(system, 8, () => {
        system.walker.ask();
        const t = readTorso(system);
        worstTilt = Math.max(worstTilt, t.tilt);
        fell ||= system.walker.state !== "stand";
      });
      const end = readTorso(system);
      assert.equal(system.walker.state, "stand", "state at the end");
      assert.ok(end.tilt < 15, `upright at the end: tilt ${end.tilt.toFixed(1)} deg`);
      assert.ok(end.y > 1, `standing height at the end: ${end.y.toFixed(2)} m`);
      assert.ok(worstTilt <= testCase.expectedMaxTilt, `worst tilt ${worstTilt.toFixed(1)} deg within ${testCase.expectedMaxTilt}`);
      assert.equal(fell, testCase.expectedOutcome === "standsAfterFalling", "whether he went down");
    });
  }
});

const walkCases: readonly { it: string; command: number; headingTurn: number; expectedMinSpeed: number; expectedMaxSpeed: number }[] = [
  { it: "when he is asked to walk along +z, then he covers ground at about a walk without falling", command: WALK_SPEED, headingTurn: 0, expectedMinSpeed: 0.8, expectedMaxSpeed: 2 },
  { it: "when he is asked to run along +z, then he covers ground faster than a walk without falling", command: RUN_SPEED, headingTurn: 0, expectedMinSpeed: 1.6, expectedMaxSpeed: 3.6 },
  { it: "when he is asked to walk a quarter turn to the left of his facing, then he turns and walks that way", command: WALK_SPEED, headingTurn: Math.PI / 2, expectedMinSpeed: 0.6, expectedMaxSpeed: 2 },
];

describe("given a walker asked to go", () => {
  for (const testCase of walkCases) {
    it(testCase.it, () => {
      frames(system, SETTLE_SECONDS);
      system.walker.heading = testCase.headingTurn;
      system.walker.command = testCase.command;
      let worstTilt = 0;
      frames(system, 3);
      const from = readTorso(system);
      frames(system, 6, () => {
        worstTilt = Math.max(worstTilt, readTorso(system).tilt);
        system.walker.ask();
      });
      const to = readTorso(system);
      const speed = Math.hypot(to.x - from.x, to.z - from.z) / 6;
      assert.equal(system.walker.state, "stand", "still on his feet");
      assert.ok(worstTilt < 25, `never tipped far: ${worstTilt.toFixed(1)} deg`);
      assert.ok(speed >= testCase.expectedMinSpeed && speed <= testCase.expectedMaxSpeed, `speed ${speed.toFixed(2)} m/s within ${testCase.expectedMinSpeed}-${testCase.expectedMaxSpeed}`);
      const bearing = Math.atan2(to.x - from.x, to.z - from.z);
      assert.ok(Math.abs(bearing - testCase.headingTurn) < 0.5, `walked toward ${testCase.headingTurn.toFixed(2)} rad, went ${bearing.toFixed(2)}`);
    });
  }
});
