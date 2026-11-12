import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { detAcos, detAtan2, hypot2 } from "../kernel/physics-core.js";

const FRAME = 1 / FRAME_HZ;
/** The pool slot the walker takes. */
const WALKER = WALKER_SLOT;
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
  expect(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed in his slot").toBe(WALKER);
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
  return { x: p.x, y: p.y, z: p.z, tilt: (detAcos(Math.max(-1, Math.min(1, up))) * 180) / Math.PI, facing: detAtan2(forwardX, forwardZ) };
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
      expect(system.walker.state, "state at the end").toBe("stand");
      expect(end.tilt, `upright at the end: tilt ${end.tilt.toFixed(1)} deg`).toBeLessThan(15);
      expect(end.y, `standing height at the end: ${end.y.toFixed(2)} m`).toBeGreaterThan(1);
      expect(worstTilt, `worst tilt ${worstTilt.toFixed(1)} deg within ${testCase.expectedMaxTilt}`).toBeLessThanOrEqual(testCase.expectedMaxTilt);
      expect(fell, "whether he went down").toBe(testCase.expectedOutcome === "standsAfterFalling");
    });
  }

  // mutation: sed -i '/^    this.walkers\[slot\]?.stagger(share);/d' src/game/present/ragdoll-throw.ts
  it("when a standing walker is blown at 3 m/s on the chest and staggered to half, then his strength reads 0.5 or less at once and he is on his feet a frame later at 0.6 or less", () => {
    const chest = system["dolls"][WALKER]!.bodies[0]!.translation();
    system.blowWalker(WALKER, new THREE.Vector3(chest.x, chest.y, chest.z), new THREE.Vector3(0, 0.3, 1).normalize(), 3);
    system.staggerWalker(WALKER, 0.5);
    expect(system.walker.strength, "at once").toBeLessThanOrEqual(0.5);
    frames(system, FRAME);
    expect(system.walker.state, "a frame later").toBe("stand");
    expect(system.walker.strength, "a frame later").toBeLessThanOrEqual(0.6);
  });

  // mutation: sed -i '/^  blowWalker(/,/^  }/{/strikeAt(/d}' src/game/present/ragdoll-throw.ts
  it("when a standing walker is blown at 3 m/s on the chest, then his torso gains 3 m/s along the blow at once and he is on his feet a frame later", () => {
    const torso = system["dolls"][WALKER]!.bodies[0]!;
    const chest = torso.translation();
    const direction = new THREE.Vector3(0, 0.3, 1).normalize();
    const before = torso.linvel().z;
    system.blowWalker(WALKER, new THREE.Vector3(chest.x, chest.y, chest.z), direction, 3);
    expect(torso.linvel().z, "his torso's speed along +z (m/s)").toBeCloseTo(before + direction.z * 3, 4);
    frames(system, FRAME);
    expect(system.walker.state, "a frame later").toBe("stand");
  });
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
      const speed = hypot2(to.x - from.x, to.z - from.z) / 6;
      expect(system.walker.state, "still on his feet").toBe("stand");
      expect(worstTilt, `never tipped far: ${worstTilt.toFixed(1)} deg`).toBeLessThan(25);
      expect(speed >= testCase.expectedMinSpeed && speed <= testCase.expectedMaxSpeed, `speed ${speed.toFixed(2)} m/s within ${testCase.expectedMinSpeed}-${testCase.expectedMaxSpeed}`).toBeTruthy();
      const bearing = detAtan2(to.x - from.x, to.z - from.z);
      expect(Math.abs(bearing - testCase.headingTurn), `walked toward ${testCase.headingTurn.toFixed(2)} rad, went ${bearing.toFixed(2)}`).toBeLessThan(0.5);
    });
  }
});

describe("given a walker and a man standing still 2 m ahead of him", () => {
  const STANDER = 0;
  /** The player walks along +x at `command` toward a man standing at x = 2, for `seconds`. */
  function meet(command: number, seconds: number): void {
    system.startWalker(new THREE.Vector3(2, 0, 0), -Math.PI / 2, { cop: false, look: driverLook(1, 0) }, STANDER);
    frames(system, 1);
    frames(system, seconds, () => {
      system.walker.heading = Math.PI / 2;
      system.walker.command = command;
      system.walker.ask();
    });
  }

  it("when he walks into the man at 1.4 m/s, then after 2 s both are on their feet (guard)", () => {
    meet(1.4, 2);
    expect([system.walker.state, system.walkers[STANDER]!.state]).toEqual(["stand", "stand"]);
  });

  // mutation: sed -i 's/this.loco.yaw, this.command));/this.loco.yaw, 0));/' src/game/present/ragdoll-walker.ts
  it("when he walks into the man at 1.4 m/s, then he reaches him and pushes him on without felling him: his torso is past x 1.5 and the man's past x 2.1", () => {
    meet(1.4, 2);
    expect(system["dolls"][WALKER]!.bodies[0]!.translation().x, "his torso's x").toBeGreaterThan(1.5);
    expect(system["dolls"][STANDER]!.bodies[0]!.translation().x, "the man's torso's x").toBeGreaterThan(2.1);
    expect(system.walkers[STANDER]!.state, "the man pushed").toBe("stand");
  });

  // mutation: sed -i 's/^        if (!knocksDown(FIGURE_KG, closing)) continue;/        continue;/' src/game/present/ragdoll-throw.ts
  it("when he runs into the man at 3.5 m/s, then the man is knocked down and the runner is on his feet", () => {
    meet(3.5, 1.2);
    expect(system.walkers[STANDER]!.state, "the man run into").not.toBe("stand");
    expect(system.walker.state, "the runner").toBe("stand");
  });
});

describe("given a walker standing on a floor 4 m up", () => {
  // mutation: sed -i 's/height - this.floor.level < FALL_HEIGHT/height < FALL_HEIGHT/' src/game/present/ragdoll-walker.ts
  it("when his torso is half a metre over that floor, then he is fallen; at 0.9 m over it he is not", () => {
    const walker = system.walker;
    const doll = system["dolls"][WALKER]!;
    walker["floor"].level = 4;
    walker["decideState"](doll, 1, 4.9, FRAME);
    expect(walker.state, "0.9 m over his floor").toBe("stand");
    walker["decideState"](doll, 1, 4.5, FRAME);
    expect(walker.state, "0.5 m over his floor").toBe("down");
  });

  // mutation: sed -i 's/height - this.floor.level < FALL_HEIGHT - this.floor.rise/height - this.floor.level < FALL_HEIGHT/' src/game/present/ragdoll-walker.ts
  it("when one foot is planted a 0.36 m tread up and his torso is 1.1 m over the lower floor, then he is not fallen; with both feet on that tread he is", () => {
    const walker = system.walker;
    const doll = system["dolls"][WALKER]!;
    walker["floor"].level = 0.36;
    walker["floor"].rise = 0.36;
    walker["decideState"](doll, 1, 1.1, FRAME);
    expect(walker.state, "mid-step up the tread").toBe("stand");
    walker["floor"].rise = 0;
    walker["decideState"](doll, 1, 1.1, FRAME);
    expect(walker.state, "both feet on the tread, torso 0.74 m over it").toBe("down");
  });
});
