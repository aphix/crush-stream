import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { type RagdollSystem } from "./engine-ragdoll.ts";
import { driverLook } from "./driver-look.ts";
import { PARTS } from "./ragdoll-body.ts";
import { SLOTS } from "./ragdoll-config.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { chooseRoute, type GetUpRoute, standingBearing } from "./walker-getup.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
const WALKER = SLOTS - 1;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;
type Turn = readonly [axis: "x" | "y" | "z", radians: number];

/** The rotation of `turns` applied in order, each about the world's axis (the first is applied first). */
function rotationOf(turns: readonly Turn[]): THREE.Quaternion {
  const q = new THREE.Quaternion();
  for (const [axis, radians] of turns) q.premultiply(new THREE.Quaternion().setFromAxisAngle(AXES[axis], radians));
  return q;
}

const QUARTER = Math.PI / 2;

const routeCases: readonly { it: string; turns: readonly Turn[]; expectedRoute: GetUpRoute; expectedBearing: number }[] = [
  { it: "when he stands, then there is no get-up to do, he regrounds", turns: [], expectedRoute: "reground", expectedBearing: 0 },
  { it: "when he leans 40 degrees with his feet under him, then he regrounds", turns: [["x", 0.7]], expectedRoute: "reground", expectedBearing: 0 },
  { it: "when he lies on his stomach, head toward +z, then it is the face-down route and he will stand facing +z", turns: [["x", QUARTER]], expectedRoute: "faceDown", expectedBearing: 0 },
  { it: "when he lies on his back, head toward -z, then it is the face-up route and he will stand facing -z", turns: [["x", -QUARTER]], expectedRoute: "faceUp", expectedBearing: Math.PI },
  { it: "when he lies on his stomach turned 90 degrees, then he will stand facing the way his head points", turns: [["x", QUARTER], ["y", QUARTER]], expectedRoute: "faceDown", expectedBearing: QUARTER },
  { it: "when he lies on his side, then he takes the face-up route", turns: [["z", QUARTER]], expectedRoute: "faceUp", expectedBearing: -QUARTER },
];

describe("given a torso lying at a rotation", () => {
  for (const testCase of routeCases) {
    it(testCase.it, () => {
      const q = rotationOf(testCase.turns);
      const pose = [0, 0, 0, q.x, q.y, q.z, q.w];
      assert.equal(chooseRoute(pose, 3), testCase.expectedRoute, "route");
      const bearing = standingBearing(pose, 3, 0);
      assert.ok(Math.abs(Math.atan2(Math.sin(bearing - testCase.expectedBearing), Math.cos(bearing - testCase.expectedBearing))) < 0.05, `bearing ${bearing.toFixed(2)} for ${testCase.expectedBearing.toFixed(2)}`);
    });
  }
});

let system: RagdollSystem;

function walkerBodies() {
  return system["dolls"][WALKER]!.bodies;
}

/** Lay the walker down rigidly at `turns` with his torso at `height`, and let him go limp (`drop`), as a hard fall leaves him. */
function layDown(turns: readonly Turn[], height: number): void {
  const q = rotationOf(turns);
  const torso = PARTS[0].c;
  for (const [k, body] of walkerBodies().entries()) {
    const part = PARTS[k]!.c;
    const at = new THREE.Vector3(part[0] - torso[0], part[1] - torso[1], part[2] - torso[2]).applyQuaternion(q);
    body.setTranslation({ x: at.x, y: height + at.y, z: at.z }, true);
    body.setRotation(q, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  system.walker.drop();
}

function frames(seconds: number, each?: () => void): void {
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    each?.();
    system.update(FRAME, [], true, true, null);
  }
}

function torsoReading() {
  const body = walkerBodies()[0]!;
  const p = body.translation();
  const q = body.rotation();
  return { x: p.x, y: p.y, z: p.z, tilt: (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180) / Math.PI };
}

beforeEach(async () => {
  system = await flatSystem();
  assert.equal(system.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), WALKER, "the walker is placed in his slot");
});

afterEach(() => {
  system.dispose();
});

const lyingCases: readonly { it: string; turns: readonly Turn[]; height: number; expectedRoute: GetUpRoute }[] = [
  { it: "when he lies on his stomach and the player asks to walk, then he pushes up and stands", turns: [["x", QUARTER]], height: 0.15, expectedRoute: "faceDown" },
  { it: "when he lies on his back and the player asks to walk, then he rolls over, pushes up and stands", turns: [["x", -QUARTER]], height: 0.15, expectedRoute: "faceUp" },
  { it: "when he lies on his side and the player asks to walk, then he gets up", turns: [["z", QUARTER]], height: 0.2, expectedRoute: "faceUp" },
  { it: "when he lies on his stomach turned about, then he gets up facing the way his head pointed", turns: [["x", QUARTER], ["y", 2.4]], height: 0.15, expectedRoute: "faceDown" },
  { it: "when he lies on his back turned about, then he rolls over and gets up", turns: [["x", -QUARTER], ["y", -1.2]], height: 0.15, expectedRoute: "faceUp" },
];

describe("given a limp walker lying on the ground", () => {
  for (const testCase of lyingCases) {
    it(testCase.it, () => {
      layDown(testCase.turns, testCase.height);
      frames(1.5);
      assert.equal(system.walker.state, "down", "limp while nobody asks");
      frames(2, () => system.walker.ask());
      assert.notEqual(system.walker.state, "down", "the ask starts the get-up");
      assert.equal(system.walker.route, testCase.expectedRoute, "route");
      frames(5, () => system.walker.ask());
      const end = torsoReading();
      assert.equal(system.walker.state, "stand", "state at the end");
      assert.ok(end.tilt < 20, `upright at the end: tilt ${end.tilt.toFixed(1)} deg`);
      assert.ok(end.y > 1, `standing height at the end: ${end.y.toFixed(2)} m`);
    });
  }
});

describe("given a walker who has got up", () => {
  it("when he is asked to walk, then he walks on at about a walk", () => {
    layDown([["x", -QUARTER]], 0.15);
    frames(1.5);
    frames(8, () => system.walker.ask());
    assert.equal(system.walker.state, "stand", "he is up");
    system.walker.heading = system.walker.facing;
    system.walker.command = WALK_SPEED;
    frames(2);
    const from = torsoReading();
    frames(5, () => system.walker.ask());
    const to = torsoReading();
    const speed = Math.hypot(to.x - from.x, to.z - from.z) / 5;
    assert.equal(system.walker.state, "stand", "still on his feet");
    assert.ok(speed > 0.6 && speed < 2.2, `walked at ${speed.toFixed(2)} m/s`);
  });
});

const timeCases: readonly { it: string; turns: readonly Turn[]; height: number; expectedMaxSeconds: number }[] = [
  { it: "when he lies on his stomach and the player asks at once, then he is on his feet within 3.8 s of going down", turns: [["x", QUARTER]], height: 0.15, expectedMaxSeconds: 3.8 },
  { it: "when he lies on his back and the player asks at once, then he is on his feet within 4.6 s of going down", turns: [["x", -QUARTER]], height: 0.15, expectedMaxSeconds: 4.6 },
  { it: "when he lies on his side and the player asks at once, then he is on his feet within 4.6 s of going down", turns: [["z", QUARTER]], height: 0.2, expectedMaxSeconds: 4.6 },
  { it: "when he lies on his stomach turned about and the player asks at once, then he is on his feet within 3.8 s of going down", turns: [["x", QUARTER], ["y", 2.4]], height: 0.15, expectedMaxSeconds: 3.8 },
];

describe("given a limp walker the player asks to get up at once", () => {
  for (const testCase of timeCases) {
    it(testCase.it, () => {
      layDown(testCase.turns, testCase.height);
      let upAt = Infinity;
      for (let f = 1; f <= 8 * FRAME_HZ && upAt === Infinity; f++) {
        system.walker.ask();
        system.update(FRAME, [], true, true, null);
        const reading = torsoReading();
        if (system.walker.state === "stand" && reading.tilt < 20 && reading.y > 1) upAt = f * FRAME;
      }
      assert.ok(upAt <= testCase.expectedMaxSeconds, `on his feet after ${upAt.toFixed(2)} s within ${testCase.expectedMaxSeconds}`);
      system.walker.heading = system.walker.facing;
      system.walker.command = RUN_SPEED;
      let running = Infinity;
      for (let f = 1; f <= 3 * FRAME_HZ && running === Infinity; f++) {
        system.walker.ask();
        system.update(FRAME, [], true, true, null);
        if (system.walker.loco.speed >= 0.9 * RUN_SPEED) running = f * FRAME;
      }
      assert.ok(running <= 0.6, `running ${running.toFixed(2)} s after he is up (a movable state, not a wobbling one)`);
      assert.equal(system.walker.state, "stand", "still on his feet");
    });
  }
});

const strikeCases: readonly { it: string; mps: number; expectedStruck: boolean }[] = [
  { it: "when a car at 3 m/s reaches him, then it does not run him down", mps: 3, expectedStruck: false },
  { it: "when a car at 4.5 m/s runs him down, then he is knocked down and gets up once the player asks", mps: 4.5, expectedStruck: true },
  { it: "when a car at 10 m/s runs him down, then he is flung and goes ragdoll, and gets up once the player asks", mps: 10, expectedStruck: true },
  { it: "when a car at 18 m/s runs him down, then he is flung and goes ragdoll, and gets up once the player asks", mps: 18, expectedStruck: true },
];

/** A sedan at `mps` m/s along +z, its nose 0.25 m short of the walker's feet, and the strike it makes on him. */
function carAt(mps: number) {
  const car = makeCar();
  launch(car, 0.3, -2.35, 0, 0, mps);
  return car;
}

describe("given a car coming at a walker standing on open ground", () => {
  for (const testCase of strikeCases) {
    it(testCase.it, () => {
      frames(1);
      const car = carAt(testCase.mps);
      assert.equal(runsDown(car, 0, 0, 0), testCase.expectedStruck, "the car's footprint meets him at this speed");
      if (!testCase.expectedStruck) return;
      system.knockWalker(fell(car, 0, -1, 0, 0, 0, 0, 1, blankStrike()));
      assert.equal(system.walker.state, "down", "limp at once");
      assert.ok(system.walker.sinceStruck < 0.1, "marked as struck");
      const flying = new THREE.Vector3();
      system.torso(WALKER, new THREE.Vector3(), flying);
      assert.ok(flying.length() > testCase.mps * 0.5, `flung at ${flying.length().toFixed(1)} m/s`);
      frames(2.5);
      assert.equal(system.walker.state, "down", "limp while nobody asks");
      frames(8, () => system.walker.ask());
      const end = torsoReading();
      assert.equal(system.walker.state, "stand", "on his feet again");
      assert.ok(end.tilt < 20 && end.y > 1, `upright at the end: tilt ${end.tilt.toFixed(1)} deg, height ${end.y.toFixed(2)} m`);
    });
  }
});
