import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { PERSON_SPRAY } from "../match/look-data.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { PARTS } from "./ragdoll-body.ts";
import { BASE_SLOTS, SLOTS } from "./ragdoll-config.ts";
import { PURSE_BLOCK } from "./ragdoll-purse.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { DOLL_FLOATS, DOLL_HEADER, DOLL_LIVE, type ResultMessage } from "./ragdoll-wire.ts";

const FRAME = 1 / FRAME_HZ;
const UP = new THREE.Quaternion();
const STILL = new THREE.Vector3();

let sys: RagdollSystem;
afterEach(() => sys.dispose());

/** Dummy `n` standing on a 3 m grid, lying for ever, in slot `at` (-1: the pool's next); a frame passes, so the first thrown is the oldest. His slot. */
function throwDummy(n: number, at = -1): number {
  const slot = sys.place(new THREE.Vector3(3 * (n % 8), 1.2, 3 * Math.floor(n / 8)), UP, STILL, STILL, Infinity, at);
  sys.update(FRAME, [], true, false, null);
  return slot;
}

/** A pool on flat ground with the capacity `capacity`. */
async function poolOf(capacity: number): Promise<void> {
  sys = await flatSystem();
  sys.setCapacity(capacity);
}

/** The worker's answer with `BASE_SLOTS` dummy records, the one in `liveSlot` out and standing at the origin. */
function answerWith(liveSlot: number): ResultMessage {
  const dolls = new Float32Array(BASE_SLOTS * DOLL_FLOATS);
  const record = liveSlot * DOLL_FLOATS;
  dolls[record + DOLL_LIVE] = 1;
  for (let k = 0; k < PARTS.length; k++) {
    dolls[record + DOLL_HEADER + 7 * k + 6] = 1;
    dolls[record + DOLL_HEADER + 7 * (PARTS.length + k) + 6] = 1;
  }
  return { type: "result", seq: 0, epoch: 0, dolls, alpha: 1, lastSlot: liveSlot, purses: new Float32Array(BASE_SLOTS * PURSE_BLOCK), props: new Float32Array(0), propsReset: false, spawned: [], hits: [], wanted: new Uint8Array(MAX_CARS), active: true, stepMs: new Float64Array(0), colliders: 0, bodies: 0, ropes: new Float32Array(0), ropeCommand: 0 };
}

describe("given a ragdoll pool at its default capacity", () => {
  it("when it loads and a fifth dummy is thrown, then it built four slots, and the fifth takes the first one's and builds none", async () => {
    sys = await flatSystem();
    const loaded = sys.stats.bodies;
    expect(sys.builtSlots, "slots built at load").toBe(BASE_SLOTS);
    expect(Array.from({ length: BASE_SLOTS + 1 }, (_, n) => throwDummy(n)).join(), "the slots five throws took").toBe("0,1,2,3,0");
    expect(sys.builtSlots, "slots built after the fifth").toBe(BASE_SLOTS);
    expect(sys.stats.bodies, "bodies in the world after the fifth").toBe(loaded);
    expect(sys.pickMesh["sprayAtlas"].image.height / PERSON_SPRAY.h, "bitmaps the spray atlas holds").toBe(BASE_SLOTS);
  });
});

describe("given a ragdoll pool whose capacity is raised to SLOTS", () => {
  it("when dummies are thrown until 32 are out, then a slot is built only when every one built is out, each with the same bodies, and the 33rd takes the oldest's", async () => {
    await poolOf(SLOTS);
    const loaded = sys.stats.bodies;
    for (let n = 0; n < BASE_SLOTS; n++) throwDummy(n);
    expect(sys.builtSlots, "slots built with four out").toBe(BASE_SLOTS);
    expect(sys.stats.bodies, "bodies with four out").toBe(loaded);
    throwDummy(BASE_SLOTS);
    const perSlot = sys.stats.bodies - loaded;
    expect(perSlot, "a built slot adds its parts and its purse set's bodies").toBeGreaterThan(PARTS.length);
    for (let n = BASE_SLOTS + 1; n < SLOTS; n++) throwDummy(n);
    expect(sys.builtSlots, "slots built with 32 out").toBe(SLOTS);
    expect(sys["live"], "dummies out").toBe(SLOTS);
    expect(sys.stats.bodies, "bodies with 32 out").toBe(loaded + perSlot * (SLOTS - BASE_SLOTS));
    expect(throwDummy(SLOTS), "the 33rd's slot").toBe(0);
    expect(sys.builtSlots, "slots built after the 33rd").toBe(SLOTS);
    const atlas = sys.pickMesh["sprayAtlas"].image;
    expect(atlas.width / PERSON_SPRAY.w, "columns of bitmaps the spray atlas holds with 32 slots built").toBe(1);
    expect(atlas.height / PERSON_SPRAY.h, "rows of bitmaps the spray atlas holds with 32 slots built").toBe(BASE_SLOTS);
  });

  it("when the capacity is lowered again, then a dummy past it goes, the next throw takes the oldest within it, and the slots built stay", async () => {
    await poolOf(SLOTS);
    throwDummy(5, 5);
    for (let f = 0; f < 10; f++) sys.update(FRAME, [], true, false, null);
    for (let n = 0; n < BASE_SLOTS; n++) throwDummy(n);
    sys.setCapacity(BASE_SLOTS);
    expect(sys["live"], "dummies out after the drop").toBe(BASE_SLOTS);
    expect(sys.builtSlots, "slots built after the drop").toBe(BASE_SLOTS + 2);
    expect(throwDummy(6), "the slot the next throw takes").toBe(0);
  });

  it("when the player's walker is the only one out, then the draw ends after his slot: as many instances as a pool of four draws", async () => {
    await poolOf(SLOTS);
    sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(1, 0) });
    sys.update(FRAME, [], true, false, null);
    expect(sys.pickMesh.count, "instances drawn").toBe(BASE_SLOTS);
    expect(sys.builtSlots, "slots built").toBe(BASE_SLOTS);
  });
});

describe("given a ragdoll pool", () => {
  it("when a capacity outside BASE_SLOTS to SLOTS is asked, then it refuses", async () => {
    await poolOf(BASE_SLOTS);
    expect(() => sys.setCapacity(BASE_SLOTS - 1)).toThrow(RangeError);
    expect(() => sys.setCapacity(SLOTS + 1)).toThrow(RangeError);
  });

  it("when this pool built more slots than the worker's answer has records, then the answer's dummy is out here and the slots past it are not", async () => {
    await poolOf(SLOTS);
    for (let n = 0; n < BASE_SLOTS + 4; n++) throwDummy(n);
    sys.reset();
    sys["adopt"](answerWith(1));
    expect(sys["dolls"].flatMap((d, s) => (d.live ? [s] : [])).join(), "the slots out").toBe("1");
  });
});
