import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
import { driverLook } from "./driver-look.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";

const FRAME = 1 / FRAME_HZ;
const SECONDS = 3;
/** Two crates a dummy is thrown into, a cone beside his path, and ten more props 40 to 130 m away. */
const NEAR = [
  { prefab: "crate", x: 60, z: 60 },
  { prefab: "crate", x: 63, z: 61.5 },
  { prefab: "cone", x: 58, z: 57 },
] as const;
const FAR = Array.from({ length: 10 }, (_, i) => ({ prefab: (i % 2 === 0 ? "crate" : "tyre-stack") as "crate" | "tyre-stack", x: 100 + 13 * i, z: 160 - 9 * i }));

/** A dummies' world on the square course with those props, a dummy thrown into the near ones; every part's position each frame, and how many standing props are out of the world at the end. */
async function throwInto(gated: boolean): Promise<{ trace: number[]; out: number }> {
  const track = new Track(parseTrack(square({ props: [...NEAR, ...FAR].map((p) => ({ ...p, yaw: 0, scale: 1 })) })));
  const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  await sys.preload();
  setGround(track.ground());
  sys.setCourse(track, placeProps(track), null);
  sys.gateProps(gated);
  sys.update(FRAME, [], true, false, null);
  sys["spawn"]({ car: 0, p: new THREE.Vector3(50, 1.2, 59), q: new THREE.Quaternion(), v: new THREE.Vector3(14, 3, 1.5), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
  const trace: number[] = [];
  const doll = sys["dolls"][0]!;
  for (let f = 0; f < Math.round(SECONDS / FRAME); f++) {
    sys.update(FRAME, [], true, false, null);
    for (const b of doll.bodies) {
      const t = b.translation();
      trace.push(t.x, t.y, t.z);
    }
  }
  const out = (sys["props"]["bodies"] as ({ isEnabled(): boolean } | null)[]).filter((b) => b && !b.isEnabled()).length;
  sys.dispose();
  return { trace, out };
}

describe("given a dummy thrown into two crates and a cone while ten props stand 40 m and more away", () => {
  // mutation: sed -i 's/^const REACH_ON = 6;/const REACH_ON = 0.1;/' src/game/present/ragdoll-prop-reach.ts
  it("when the standing props are kept in the world only near a moving body, then every part of the dummy moves as with all of them in to within a millimetre, and the far ones were out of it", async () => {
    const all = await throwInto(false);
    const near = await throwInto(true);
    expect(all.out, "control: with every prop in, none is out").toBe(0);
    expect(near.out, "the far props are out of the world").toBeGreaterThanOrEqual(FAR.length);
    // Rapier orders its contacts by the broad phase's proxies, so fewer of them move a result by float32 rounding (measured 0.07 mm worst over the 3 s), never by a behaviour.
    const worst = near.trace.reduce((m, v, k) => Math.max(m, Math.abs(v - all.trace[k]!)), 0);
    expect(worst, "the most a part's position differs (m)").toBeLessThan(0.001);
  });
});

describe("given a crate standing 15 m from the walker's eye, with the walker 15 m from it and no other moving body near", () => {
  /** How far (m) a camera ball of 0.2 m cast from (60, 1, 46) toward +z, 30 m long, runs on the course with one crate at (60, 60), the walker standing at (60, 45) after the world has stepped. */
  async function sweep(gated: boolean): Promise<number> {
    const track = new Track(parseTrack(square({ props: [{ prefab: "crate", x: 60, z: 60, yaw: 0, scale: 1 }] })));
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    setGround(track.ground());
    sys.setCourse(track, placeProps(track), null);
    sys.gateProps(gated);
    sys.startWalker(new THREE.Vector3(60, 0, 45), 0, { cop: false, look: driverLook(0, 0) });
    for (let f = 0; f < 10; f++) sys.update(FRAME, [], true, false, null);
    // The first sweep is seen by the next frame's steps (the camera sweeps every frame): the second is the one measured.
    sys.sightClear(60, 1, 46, 0, 0, 1, 30, 0.2);
    sys.update(FRAME, [], true, false, null);
    const length = sys.sightClear(60, 1, 46, 0, 0, 1, 30, 0.2);
    sys.dispose();
    return length;
  }

  // mutation: sed -i '/^    this.props.watch(x, z, x + dx \* length, z + dz \* length);/d' src/game/present/ragdoll-throw.ts
  it("when the camera's sweep is cast through it, then it stops short of the crate, as with every prop in the world", async () => {
    const all = await sweep(false);
    expect(all, "control: with every prop in, the crate stops the sweep").toBeLessThan(15);
    expect(await sweep(true), "the sweep with the props kept near moving bodies only").toBeCloseTo(all, 6);
  });
});

describe("given a world nobody asked to gate its props", () => {
  // mutation: sed -i 's/^  private gatingOn = false;/  private gatingOn = true;/' src/game/present/ragdoll-props.ts
  it("when a dummy is thrown on a course with far props, then every standing prop stays in the world: only a phone in the open world gates", async () => {
    const track = new Track(parseTrack(square({ props: [...NEAR, ...FAR].map((p) => ({ ...p, yaw: 0, scale: 1 })) })));
    const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    await sys.preload();
    setGround(track.ground());
    sys.setCourse(track, placeProps(track), null);
    sys.update(FRAME, [], true, false, null);
    sys["spawn"]({ car: 0, p: new THREE.Vector3(50, 1.2, 59), q: new THREE.Quaternion(), v: new THREE.Vector3(14, 3, 1.5), w: new THREE.Vector3(), age: 0, cop: false, rides: true });
    for (let f = 0; f < 30; f++) sys.update(FRAME, [], true, false, null);
    const out = (sys["props"]["bodies"] as ({ isEnabled(): boolean } | null)[]).filter((b) => b && !b.isEnabled()).length;
    sys.dispose();
    expect(out).toBe(0);
  });
});
