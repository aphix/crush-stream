import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { NO_LOOSE } from "./ragdoll-loose.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { packBoxes, type ToWorker, unpackBoxes } from "./ragdoll-wire.ts";
import type { FloorBox } from "./walker-floor.ts";

const FRAME = 1 / FRAME_HZ;
const UPRIGHT = new THREE.Quaternion();
const STILL = new THREE.Vector3();
/** An interior's floor slab: 6 m square, its top 0.9 m over the street. */
const SLAB_TOP = 0.9;
const SLAB: FloorBox = { x0: -3, z0: -3, x1: 3, z1: 3, y0: 0.5, y1: SLAB_TOP };
/** Seconds a thrown dummy is given to come to rest. */
const LAND_S = 4;
/** The stepping after a stream-out (frames). */
const OUT_FRAMES = 300;

const open: RagdollSystem[] = [];

afterEach(() => {
  for (const sys of open.splice(0)) sys.dispose();
  Reflect.deleteProperty(globalThis, "Worker");
  setGround(null);
});

/** Every part's centre height (m) of the dummy in slot `slot`, the lowest of them. */
function lowestPart(sys: RagdollSystem, slot: number): number {
  const cur = sys["dolls"][slot]!.cur;
  let lowest = Infinity;
  for (let k = 0; k < cur.length / 7; k++) lowest = Math.min(lowest, cur[k * 7 + 1]!);
  return lowest;
}

function dropDummy(sys: RagdollSystem): number {
  const slot = sys.place(new THREE.Vector3(0, 2.5, 0), UPRIGHT, STILL, STILL, Infinity, -1);
  expect(slot, "a dummy is placed").toBeGreaterThanOrEqual(0);
  return slot;
}

function frames(sys: RagdollSystem, count: number): void {
  for (let f = 0; f < count; f++) sys.update(FRAME, [], true, true, null);
}

async function flat(): Promise<RagdollSystem> {
  const sys = await flatSystem();
  open.push(sys);
  return sys;
}

describe("given a floor box streamed into the dummies' world in this thread", () => {
  it("when a dummy is thrown over it, then he lies on it, not on the street under it", async () => {
    const sys = await flat();
    sys.setFixedBoxes([SLAB]);
    const slot = dropDummy(sys);
    frames(sys, LAND_S * FRAME_HZ);
    expect(lowestPart(sys, slot), `lowest part ${lowestPart(sys, slot).toFixed(2)} m, over the slab's top ${SLAB_TOP} m`).toBeGreaterThan(SLAB_TOP);
  });

  it("when the box is streamed out under the dummy lying on it and the world steps 300 frames, then it does not throw and he has fallen to the street", async () => {
    const sys = await flat();
    sys.setFixedBoxes([SLAB]);
    const slot = dropDummy(sys);
    frames(sys, LAND_S * FRAME_HZ);
    sys.setFixedBoxes([]);
    expect(sys["boxBuilt"].length, "no collider of it is left").toBe(0);
    expect(sys.walker.floor.boxes.length, "the walker's floor is without it").toBe(0);
    frames(sys, OUT_FRAMES);
    expect(lowestPart(sys, slot), `lowest part ${lowestPart(sys, slot).toFixed(2)} m, the street's 0`).toBeLessThan(SLAB_TOP - 0.3);
  });

  it("when a box is empty or not a number, then the call throws and the boxes before stand", async () => {
    const sys = await flat();
    sys.setFixedBoxes([SLAB]);
    expect(() => sys.setFixedBoxes([{ ...SLAB, x1: SLAB.x0 }]), "an empty box").toThrow(RangeError);
    expect(() => sys.setFixedBoxes([{ ...SLAB, y1: NaN }]), "a box with NaN").toThrow(RangeError);
    expect(sys["boxBuilt"].length, "the slab still stands").toBe(1);
    expect(sys.walker.floor.boxes.length, "and the walker still reads it").toBe(1);
  });

  it("when the boxes are set before Rapier has loaded, then they are in the world once it has", async () => {
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    open.push(sys);
    sys.setFixedBoxes([SLAB]);
    await sys.preload();
    setGround(null);
    sys.update(FRAME, [], true, false, null);
    const slot = dropDummy(sys);
    frames(sys, LAND_S * FRAME_HZ);
    expect(lowestPart(sys, slot), "on the slab").toBeGreaterThan(SLAB_TOP);
  });
});

/** A Worker that records what is posted to it (the page's, in node: `ragdoll-remote.test.ts`'s double). */
class RecordingWorker {
  static last: RecordingWorker;
  readonly posted: ToWorker[] = [];
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;

  constructor() {
    RecordingWorker.last = this;
  }

  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }

  terminate(): void {}
}

function boxesPosted(worker: RecordingWorker): Float64Array[] {
  const out: Float64Array[] = [];
  for (const message of worker.posted) if (message.type === "boxes") out.push(message.boxes);
  return out;
}

describe("given the dummies' world in a worker", () => {
  it("when boxes are streamed in and then out, then the worker is sent each whole list as a typed array", async () => {
    Object.assign(globalThis, { Worker: RecordingWorker });
    const sys = await flat();
    sys.setFixedBoxes([SLAB]);
    sys.setFixedBoxes([]);
    const sent = boxesPosted(RecordingWorker.last);
    expect(sent.length, "two lists posted").toBe(2);
    expect(firstMismatch(Array.from(sent[0]!), Array.from(packBoxes([SLAB]))), "the slab, six floats").toBeUndefined();
    expect(sent[1]!.length, "then none").toBe(0);
  });

  it("when boxes were set before the world loaded, then the worker is sent them as it opens", async () => {
    Object.assign(globalThis, { Worker: RecordingWorker });
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    open.push(sys);
    sys.setFixedBoxes([SLAB]);
    await sys.preload();
    expect(boxesPosted(RecordingWorker.last).length, "one list posted at open").toBe(1);
  });

  it("when the worker's own world is given the list it was sent, then a dummy thrown there lies on the box, and it is gone after the empty list", async () => {
    const hosted = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    open.push(hosted);
    hosted.host();
    await hosted.preload();
    setGround(null);
    hosted.setFixedBoxes(unpackBoxes(packBoxes([SLAB])));
    const slot = dropDummy(hosted);
    for (let f = 0; f < LAND_S * FRAME_HZ; f++) hosted.stepWorld(FRAME, [], true, true, null, NO_LOOSE);
    expect(lowestPart(hosted, slot), "on the slab in the worker's world").toBeGreaterThan(SLAB_TOP);
    hosted.setFixedBoxes(unpackBoxes(packBoxes([])));
    for (let f = 0; f < OUT_FRAMES; f++) hosted.stepWorld(FRAME, [], true, true, null, NO_LOOSE);
    expect(lowestPart(hosted, slot), "and on the street after the empty list").toBeLessThan(SLAB_TOP - 0.3);
  });
});
