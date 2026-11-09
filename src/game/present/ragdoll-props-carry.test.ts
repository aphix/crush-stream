import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import { placeProps } from "../world/placements.ts";
import { Track } from "../world/track.ts";
import { parseTrack } from "../world/track-schema.ts";
import { square } from "../world/track.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { GRACE } from "./ragdoll-pool.ts";

const FRAME = 1 / FRAME_HZ;
/** Where the prop lies and which way the car drives: along +z from 12 m short of it. */
const PROP_AT = { x: 60, z: 60 };
const RUN_UP_M = 12;
/** The car's bumper reaches the prop this far (m) ahead of its middle; the knock is the race's rule (`prop-contact.ts`): 1.1 times the car's speed and 1.5 m/s on, 2 m/s and a quarter of its speed up. */
const BUMPER_M = 2.3;
const KICK = { alongPerSpeed: 1.1, alongPlus: 1.5, upPlus: 2, upPerSpeed: 0.25 } as const;
/** A prop counts as riding the car while its middle is this near (m) its middle plan-wise, along and across (a sedan's footprint), moving within this of its velocity (m/s). */
const FOOTPRINT_ALONG = 2.6;
const FOOTPRINT_ACROSS = 1.3;
const WITH_THE_CAR_MPS = 3;
/** The run's length (s), and the slack (s) on how long a prop may ride the car: the knock leaves it in the car for `GRACE` s, the car then carries it along for `GRACE` more, and a few frames' detection. */
const RUN_S = 4;
const CARRY_SLACK_S = 0.2;
/** The knockable furniture and the props the race has: the fence section is the long thin one. */
const PROPS: readonly PrefabId[] = [PREFAB.hoopFence, PREFAB.bench, PREFAB.litterBin, PREFAB.newsBox, PREFAB.bikeRack, PREFAB.crate, PREFAB.cone, PREFAB.hayBale];

/** A car along +z at `speed` m/s through prop `prefab` lying broadside across its way, knocked as its bumper reaches it: the seconds the prop spends moving with the car inside its footprint over the next `RUN_S` s. */
async function secondsCarried(prefab: PrefabId, speed: number): Promise<number> {
  const track = new Track(parseTrack(square({ props: [{ prefab, x: PROP_AT.x, z: PROP_AT.z, yaw: Math.PI / 2, scale: 1 }] })));
  const sys = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  await sys.preload();
  setGround(track.ground());
  sys.setCourse(track, placeProps(track), null);
  sys.update(FRAME, [], true, false, null);
  const car = makeCar();
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  let knocked = false;
  let frames = 0;
  for (let f = 0; f < Math.round(RUN_S / FRAME); f++) {
    const z = PROP_AT.z - RUN_UP_M + speed * f * FRAME;
    launch(car, PROP_AT.x, z, 0, 0, speed);
    if (!knocked && z + BUMPER_M >= PROP_AT.z) {
      sys.knockProp(0, 0, 0, KICK.upPlus + speed * KICK.upPerSpeed, speed * KICK.alongPerSpeed + KICK.alongPlus);
      knocked = true;
    }
    sys.update(FRAME, [car], true, false, null);
    if (!knocked || !sys.propAt(0, p, v)) continue;
    const inFootprint = Math.abs(p.z - z) < FOOTPRINT_ALONG && Math.abs(p.x - PROP_AT.x) < FOOTPRINT_ACROSS;
    if (inFootprint && Math.hypot(v.x, v.z - speed) < WITH_THE_CAR_MPS) frames++;
  }
  sys.dispose();
  return frames * FRAME;
}

describe("given a car driving through a prop it knocks over, lying broadside across its way", () => {
  // mutation: sed -i 's/    return this.carry\[i\]! >= this.grace;/    return false;/' src/game/present/ragdoll-props.ts
  // mutation: sed -i 's/        this.drop(i);//' src/game/present/ragdoll-props.ts
  it("when the car goes on at 8 and at 14 m/s, then no prop rides along with it for longer than twice the car's grace (the knock's, then the carry's): a fence section, a bench, a bin, a news box, a bike rack, a crate, a cone and a hay bale are all left behind", async () => {
    const carried: string[] = [];
    for (const speed of [8, 14]) {
      for (const prefab of PROPS) {
        const seconds = await secondsCarried(prefab, speed);
        if (seconds > 2 * GRACE + CARRY_SLACK_S) carried.push(`${prefab} at ${speed} m/s ${seconds.toFixed(2)} s`);
      }
    }
    expect(carried.join("; "), "props carried along with the car").toBe("");
  }, 60000);
});
