import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { InteriorSet } from "../present/interiors/interior-art.ts";
import type { DoorOpeners } from "../present/interiors/interior-doors.ts";
import { SIGHT_ID_CAPACITY, SightField } from "../present/openworld-sight.ts";
import { flatSystem } from "../present/ragdoll-throws.test-util.ts";
import { planInterior } from "../world/openworld/interior-plan.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { OpenWorldBodies } from "./openworld-bodies.ts";
import { RagdollBodyHost } from "./ragdoll-body-host.ts";

const FRAME = 1 / FRAME_HZ;
const map = buildOpenWorldMap(layOutLots());
const house = map.places.find((place) => place.interior === "rowhome" && place.doorNode >= 0)!;
const loneHouse = { ...map, places: [house] };
/** The eye is this far (m) from the house: past the 25 m the interiors hand their floors to the physics for, and inside the hook's 80. */
const EYE_AWAY_M = 40;
const SECONDS = 2;
/** A man standing on his floor has his torso at least this far (m) over it. */
const TORSO_OVER_FLOOR_M = 0.5;

let sys: RagdollSystem;
afterEach(() => sys.dispose());

/** The hook takes a civilian who sits at the middle of the house on its raised ground floor, the eye `EYE_AWAY_M` away; `floorFirst`: the house's floor is held before her body is stood, as the director does. Her torso's height over the floor after `SECONDS`. */
async function torsoOverFloor(floorFirst: boolean): Promise<number> {
  sys = await flatSystem();
  const host = new RagdollBodyHost(() => sys);
  const bodies = new OpenWorldBodies(host, [house], 4, 2);
  const set = new InteriorSet(loneHouse);
  set.onSolids((boxes) => sys.setFixedBoxes(boxes));
  const floor = planInterior(house).floors[0]!;
  const poses = createCrowdPoses(4);
  poses.x[0] = house.x;
  poses.z[0] = house.z;
  poses.feetY[0] = floor;
  poses.shown[0] = 1;
  poses.activity[0] = ACTIVITY.sit;
  if (floorFirst) set.holdFloorAt(house.x, house.z);
  const slot = bodies.stand(poses, 0, house.x + EYE_AWAY_M, house.z);
  expect(slot, "a body for her").toBeGreaterThanOrEqual(0);
  const pinned = { count: 0, x: new Float32Array(2), z: new Float32Array(2) };
  const who: DoorOpeners = { poses: null, walker: null, others: [], closed: null, pinned };
  const sight = new SightField([], SIGHT_ID_CAPACITY);
  const at = new THREE.Vector3();
  let seconds = 0;
  for (let frame = 0; frame < Math.round(SECONDS * FRAME_HZ); frame++) {
    seconds += FRAME;
    pinned.count = bodies.hookedSpots(pinned.x, pinned.z);
    set.update(house.x + EYE_AWAY_M, house.z, FRAME, sight, who);
    bodies.step(poses, house.x + EYE_AWAY_M, house.z, seconds, FRAME);
    sys.update(FRAME, [], true, true, null);
  }
  sys.torso(slot, at, null);
  set.dispose();
  return at.y - floor;
}

describe("given a civilian in a house's raised ground floor, the eye 40 m off, and the hook taking her", () => {
  it("when the house's floor is held before her body is stood, then 2 s later her torso is still over her floor", async () => {
    expect(await torsoOverFloor(true), "torso over the floor (m)").toBeGreaterThan(TORSO_OVER_FLOOR_M);
  });

  it("when her body is stood before the floor is held (the next frame's update lists her too late), then 2 s later her torso has sunk to the street: the reason the floor is held first", async () => {
    expect(await torsoOverFloor(false), "torso over the floor (m)").toBeLessThan(TORSO_OVER_FLOOR_M);
  });
});
