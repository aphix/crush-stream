import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
import { FRAME_HZ, MAX_TETHERS, WINCH_MIN_LENGTH } from "../kernel/constants.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { RagdollRemote } from "./ragdoll-remote.ts";
import { flatSystem, loadedRagdolls } from "./ragdoll-throws.test-util.ts";
import { ROPE_FLOATS, ROPE_JOINED, ROPE_LENGTH, ROPE_NONE, ROPE_STATE, type FromWorker, type ResultMessage, type RopeEnd, type ToWorker } from "./ragdoll-wire.ts";

after(() => setGround(null));

const FRAME = 1 / FRAME_HZ;
const NONE = new THREE.Vector3();
/** The car a rope's far end is tied to drives off along +z at this speed (m/s). */
const DRIVE = 10;
/** Where on the car the rope's end is tied (its frame): a hook at bumper height. */
const HOOK: [number, number, number] = [0, 0.5, 0];

const doll = (id: number, at: [number, number, number]): RopeEnd => ({ kind: "doll", id, at });
const car = (id: number): RopeEnd => ({ kind: "car", id, at: HOOK });
const point = (x: number, y: number, z: number): RopeEnd => ({ kind: "world", at: [x, y, z] });

/** A dummy lying about from the origin, 60 s. */
function lieDown(sys: RagdollSystem, slot = 0, at = new THREE.Vector3(0, 1, 0)): void {
  sys.place(at, new THREE.Quaternion(), NONE, NONE, 60, slot);
  for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
}

/** One frame with the car (the only one) `along` m further on along +z. */
function frame(sys: RagdollSystem, vehicle: DeformableCar, along = 0): void {
  vehicle.group.position.z += along;
  sys.update(FRAME, [vehicle], true, false, null);
}

/** Frames for `seconds` with the car driving off at `DRIVE` m/s. */
function drive(sys: RagdollSystem, vehicle: DeformableCar, seconds: number): void {
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) frame(sys, vehicle, DRIVE * FRAME);
}

function record(sys: RagdollSystem, slot = 0): { state: number; length: number } {
  return { state: sys.ropeReport.floats[slot * ROPE_FLOATS + ROPE_STATE]!, length: sys.ropeReport.floats[slot * ROPE_FLOATS + ROPE_LENGTH]! };
}

const torsoZ = (sys: RagdollSystem): number => {
  const at = new THREE.Vector3();
  assert.ok(sys.torso(0, at, null), "the dummy is out");
  return at.z;
};

describe("given a dummy lying 12 m behind a car that drives off at 10 m/s", () => {
  const dragged = async (roped: boolean): Promise<{ z: number; reach: number; state: number }> => {
    const sys = await flatSystem();
    const vehicle = makeCar();
    vehicle.group.position.set(0, 0, 12);
    lieDown(sys);
    if (roped) assert.ok(sys.ropeAttach(0, doll(0, [0, 0.5, 0]), car(0)) > 0, "the world took the rope");
    drive(sys, vehicle, 3);
    const z = torsoZ(sys);
    const out = { z, reach: vehicle.group.position.z - z, state: record(sys).state };
    sys.dispose();
    return out;
  };

  it("when a rope ties him to it, then he is dragged along behind it and stays within the rope's length of its hook", async () => {
    const { z, reach, state } = await dragged(true);
    assert.equal(state, ROPE_JOINED, "the rope's state");
    assert.ok(z > 15, `he lies at z ${z.toFixed(1)} m: not dragged`);
    assert.ok(reach < 12 + 1.5, `he is ${reach.toFixed(1)} m behind the car's hook on a 12 m rope`);
  });

  it("when no rope ties him to it, then he lies where he fell", async () => {
    const { z } = await dragged(false);
    assert.ok(Math.abs(z) < 2, `he lies at z ${z.toFixed(1)} m`);
  });
});

describe("given a dummy tied by a rope to a world point 30 m off", () => {
  const reeled = async (reel: boolean): Promise<number> => {
    const sys = await flatSystem();
    lieDown(sys);
    assert.ok(sys.ropeAttach(0, doll(0, [0, 0.5, 0]), point(0, 1, 30)) > 0, "the world took the rope");
    sys.ropeReel(reel);
    for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
    const z = torsoZ(sys);
    sys.dispose();
    return z;
  };

  it("when the winch reels for a second, then he has come to within a few metres of the point", async () => {
    const z = await reeled(true);
    assert.ok(30 - z < WINCH_MIN_LENGTH + 3, `he is ${(30 - z).toFixed(1)} m from the point`);
  });

  it("when the winch is not held, then he stays where he lies", async () => {
    const z = await reeled(false);
    assert.ok(Math.abs(z) < 1, `he lies at z ${z.toFixed(1)} m`);
  });
});

describe("given a dummy tied by a rope that is about to leave", () => {
  const afterwards = async (cut: () => void, sys: RagdollSystem): Promise<void> => {
    cut();
    for (let f = 0; f < 3 * FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
  };

  it("when he is put away, then the rope is gone with him and the world has no rope out", async () => {
    const sys = await flatSystem();
    lieDown(sys);
    sys.ropeAttach(0, doll(0, [0, 0.5, 0]), point(0, 1, 30));
    await afterwards(() => sys["despawn"](0), sys);
    assert.equal(record(sys).state, ROPE_NONE, "the rope's state");
    assert.equal(sys["ropes"].count, 0, "ropes out");
    assert.equal(sys["dolls"][0]!.ropes, 0, "ropes on him");
    sys.dispose();
  });

  it("when the rope is cut, then it is gone and he lies on", async () => {
    const sys = await flatSystem();
    lieDown(sys);
    sys.ropeAttach(0, doll(0, [0, 0.5, 0]), point(0, 1, 30));
    await afterwards(() => sys.ropeCut(0), sys);
    assert.equal(record(sys).state, ROPE_NONE, "the rope's state");
    assert.equal(sys.dollOut(0), true, "he is out");
    sys.dispose();
  });

  it("when a rope is told to tie a dummy who is not out, then no rope is made", async () => {
    const sys = await flatSystem();
    sys.ropeAttach(0, doll(3, [0, 0.5, 0]), point(0, 1, 30));
    sys.update(FRAME, [], true, false, null);
    assert.equal(record(sys).state, ROPE_NONE, "the rope's state");
    sys.dispose();
  });
});

describe("given a dummy who would lie about for 1 s", () => {
  const lives = async (roped: boolean): Promise<boolean> => {
    const sys = await flatSystem();
    sys.place(new THREE.Vector3(0, 1, 0), new THREE.Quaternion(), NONE, NONE, 1, 0);
    if (roped) sys.ropeAttach(0, doll(0, [0, 0.5, 0]), point(0, 1, 30));
    for (let f = 0; f < 3 * FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
    const out = sys.dollOut(0);
    sys.dispose();
    return out;
  };

  it("when a rope holds him, then he is still out after 3 s", async () => {
    assert.equal(await lives(true), true);
  });

  it("when no rope holds him, then he is put away", async () => {
    assert.equal(await lives(false), false);
  });
});

describe("given a cone standing on a course behind a car that drives off beside it", () => {
  const CONE_AT = 60;
  /** How far (m) to the side of the cone the car drives: clear of its box, so only the rope can move the cone. */
  const PASS_BY = 6;
  const coneRun = async (roped: boolean): Promise<{ x: number; state: number }> => {
    const track = new Track(parseTrack(square({ props: [{ prefab: "cone", x: CONE_AT, z: CONE_AT, yaw: 0, scale: 1 }] })));
    setGround(track.ground());
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    sys.setCourse(track, placeProps(track), null);
    sys.update(FRAME, [], true, false, null);
    const vehicle = makeCar();
    vehicle.group.position.set(CONE_AT + 12, 0, CONE_AT + PASS_BY);
    vehicle.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    if (roped) assert.ok(sys.ropeAttach(0, { kind: "prop", id: 0, at: [CONE_AT, 0.3, CONE_AT] }, car(0)) > 0, "the world took the rope");
    for (let f = 0; f < 1.5 * FRAME_HZ; f++) {
      vehicle.group.position.x += DRIVE * FRAME;
      sys.update(FRAME, [vehicle], true, false, null);
    }
    const at = new THREE.Vector3();
    sys.propAt(0, at, new THREE.Vector3());
    const out = { x: at.x, state: record(sys).state };
    sys.dispose();
    return out;
  };

  it("when a rope ties it to the car, then it is knocked loose and dragged along behind it", async () => {
    const { x, state } = await coneRun(true);
    assert.equal(state, ROPE_JOINED, "the rope's state");
    assert.ok(x > CONE_AT + 5, `the cone is at x ${x.toFixed(1)}`);
  });

  it("when no rope ties it, then it stands where it was put", async () => {
    const { x } = await coneRun(false);
    assert.ok(x === 0 || Math.abs(x - CONE_AT) < 0.5, `the cone is at x ${x.toFixed(1)}`);
  });
});

describe("given a box and a dummy, each a rope's end", () => {
  it("when a box is tied to a car that drives off, then the box is dragged after it", async () => {
    const sys = await flatSystem();
    sys.setBoxes([{ x: 0, y: 0.5, z: 0, yaw: 0, width: 1, height: 1, depth: 1 }]);
    sys.update(FRAME, [], true, false, null);
    const vehicle = makeCar();
    vehicle.group.position.set(0, 0, 12);
    assert.ok(sys.ropeAttach(0, { kind: "box", id: 0, at: [0, 0.5, 0] }, car(0)) > 0, "the world took the rope");
    drive(sys, vehicle, 2);
    const poses = new Float32Array(7);
    sys.copyBoxPoses(poses);
    sys.dispose();
    assert.ok(poses[2]! > 8, `the box is at z ${poses[2]!.toFixed(1)}`);
  });

  it("when a dummy is tied to a box 8 m off and the winch reels, then they come together and the rope keeps them within its length", async () => {
    const sys = await flatSystem();
    sys.setBoxes([{ x: 0, y: 0.5, z: 8, yaw: 0, width: 1, height: 1, depth: 1 }]);
    lieDown(sys);
    sys.ropeAttach(0, doll(0, [0, 0.5, 0]), { kind: "box", id: 0, at: [0, 0.5, 8] });
    sys.update(FRAME, [], true, false, null);
    const length = record(sys).length;
    for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
    sys.ropeReel(true);
    for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, false, null);
    const poses = new Float32Array(7);
    sys.copyBoxPoses(poses);
    const gap = poses[2]! - torsoZ(sys);
    sys.dispose();
    assert.ok(length > 7 && length < 9.5, `the rope was ${length.toFixed(1)} m`);
    assert.ok(gap < WINCH_MIN_LENGTH + 2, `the dummy and the box are ${gap.toFixed(1)} m apart`);
  });
});

/** A Worker that records what is posted to it and says only what the test has it say. */
class ScriptedWorker {
  static last: ScriptedWorker;
  readonly posted: ToWorker[] = [];
  onmessage: ((event: { data: FromWorker }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor() {
    ScriptedWorker.last = this;
  }

  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }

  terminate(): void {}

  say(message: FromWorker): void {
    this.onmessage!({ data: message });
  }
}

describe("given the dummies' world in a worker", () => {
  it("when a rope is tied, then the command goes to the worker with a number, and the report the worker answers with is what the tether reads", async () => {
    Object.assign(globalThis, { Worker: ScriptedWorker });
    const sys = await loadedRagdolls();
    const worker = ScriptedWorker.last;
    worker.say({ type: "ready" });
    sys["mode"] = "remote";
    const a = doll(0, [1, 2, 3]);
    const b = car(0);
    assert.equal(sys.ropeAttach(1, a, b), 1, "the first command's number");
    sys.ropeReel(true);
    sys.ropeCut(1);
    const rope = worker.posted.find((m) => m.type === "rope");
    assert.ok(rope?.type === "rope" && rope.command === 1 && rope.slot === 1 && rope.a === a && rope.b === b, "the rope command as sent");
    assert.deepEqual(
      worker.posted.filter((m) => m.type === "ropeReel" || m.type === "ropeCut").map((m) => m.command),
      [2, 3],
      "the winch and the cut are numbered after it",
    );
    const floats = new Float32Array(MAX_TETHERS * ROPE_FLOATS);
    floats[ROPE_FLOATS + ROPE_STATE] = ROPE_JOINED;
    floats[ROPE_FLOATS + ROPE_LENGTH] = 12;
    const answer: ResultMessage = {
      type: "result", seq: 1, epoch: 0, dolls: new Float32Array(0), alpha: 0, lastSlot: 0, purses: new Float32Array(0), props: new Float32Array(0), propsReset: false, spawned: [], hits: [],
      wanted: new Uint8Array(32), active: true, stepMs: new Float64Array(0), colliders: 0, bodies: 0, ropes: floats, ropeCommand: 3,
    };
    worker.say(answer);
    sys.update(FRAME, [], true, false, null);
    assert.equal(sys.ropeReport.command, 3, "commands the world has heard");
    assert.equal(record(sys, 1).state, ROPE_JOINED, "the rope's state");
    assert.equal(record(sys, 1).length, 12, "the rope's length");
    sys.dispose();
    Reflect.deleteProperty(globalThis, "Worker");
  });

  it("when the tether talks to a remote, then the frames keep going out while the rope is out", () => {
    Object.assign(globalThis, { Worker: ScriptedWorker });
    const remote = RagdollRemote.open(() => assert.fail("the worker failed"))!;
    ScriptedWorker.last.say({ type: "ready" });
    remote.rope({ type: "ropeReel", command: 1, on: true });
    remote.post(FRAME, [makeCar()], true, false, 0, null);
    assert.ok(ScriptedWorker.last.posted.some((m) => m.type === "frame"), "a frame went out after the command");
    remote.dispose();
    Reflect.deleteProperty(globalThis, "Worker");
  });
});
