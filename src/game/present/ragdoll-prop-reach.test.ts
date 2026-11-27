import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
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
  if (!gated) sys["props"].gate = () => {};
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
