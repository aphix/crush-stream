import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { PREFABS } from "../world/catalog.ts";
import { DISC_GROUND, setGround } from "../world/ground.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { PARTS } from "./ragdoll-body.ts";
import { BASE_SLOTS, SLOTS } from "./ragdoll-config.ts";
import { PURSE_BODIES } from "./ragdoll-purse.ts";
import { driverLook } from "./driver-look.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { SHOWCASE_PROPS, SHOWCASE_THROWN } from "./showcase-art.ts";

const FRAME = 1 / FRAME_HZ;
const UP = new THREE.Quaternion();
const STILL = new THREE.Vector3();
const DUMMIES = 8;

let sys: RagdollSystem;
afterEach(() => {
  sys.dispose();
  setGround(null);
});

/** Dummy `n` standing on a 3 m grid, lying for ever, in the pool's next slot; a frame passes. */
function throwDummy(n: number): void {
  sys.place(new THREE.Vector3(3 * (n % 8), 1.2, 3 * Math.floor(n / 8)), UP, STILL, STILL, Infinity, -1);
  sys.update(FRAME, [], true, false, null);
}

describe("given the showcase's world: its disc, its props and room for 32 dummies", () => {
  it(`when the scene is set and ${DUMMIES} dummies are thrown, then the ground is in the world before the first and the world gains only the colliders of the slots built for them: one patch serves them all`, async () => {
    setGround(DISC_GROUND);
    sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    sys.setCapacity(SLOTS);
    const bare = sys.stats.colliders;
    sys.setSolids(DISC_GROUND, [], SHOWCASE_PROPS, null);
    expect(sys.stats.colliders - bare, "colliders the scene's ground added when it was set").toBeGreaterThan(0);
    sys.update(FRAME, [], true, false, null);
    const idle = sys.stats.colliders;
    throwDummy(0);
    expect(sys.stats.colliders - idle, "colliders the first dummy added: his slot was built at load").toBe(0);
    const first = { colliders: sys.stats.colliders, slots: sys.builtSlots };
    for (let n = 1; n < DUMMIES; n++) throwDummy(n);
    expect(first.slots, "the control: the first dummy took a slot of the base pool").toBe(BASE_SLOTS);
    expect(sys.builtSlots, "the control: slots were built for the rest").toBeGreaterThan(first.slots);
    expect(sys.stats.colliders - first.colliders, "colliders the other dummies added").toBe((sys.builtSlots - first.slots) * (PARTS.length + PURSE_BODIES));
  });
});

describe("given the player's walker standing in a scene", () => {
  it("when he has gone 30 m from where he started, then his ground is not built again: the scene's one patch is under him", async () => {
    setGround(DISC_GROUND);
    sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    sys.setSolids(DISC_GROUND, [], SHOWCASE_PROPS, null);
    expect(sys.startWalker(new THREE.Vector3(0, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed in his slot").toBe(WALKER_SLOT);
    sys.update(FRAME, [], true, false, null);
    const before = sys.stats.colliders;
    sys["dolls"][WALKER_SLOT]!.cur[0] = 30;
    sys.update(FRAME, [], true, false, null);
    expect(sys.stats.colliders - before, "colliders his walk added").toBe(0);
  });
});

describe("given the dummies' world with the showcase's thrown props standing in it", () => {
  it("when two of them stand within each other's footprints, then the broad phase pairs them every step: none does", () => {
    const crowded: string[] = [];
    for (const [i, a] of SHOWCASE_THROWN.entries()) {
      for (const b of SHOWCASE_THROWN.slice(i + 1)) {
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < PREFABS[a.prefab].foot + PREFABS[b.prefab].foot) crowded.push(`${a.prefab} and ${b.prefab} at ${a.x}, ${a.z}`);
      }
    }
    expect(crowded.slice(0, 3), `${crowded.length} pairs of the ${SHOWCASE_THROWN.length} stand within each other's footprints`).toEqual([]);
  });
});
