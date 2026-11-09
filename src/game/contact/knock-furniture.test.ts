import { afterEach, describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { propColliders, solidsOf, type Placed } from "../world/placements.ts";
import { HOOP_FENCE, KNOCKABLE } from "../world/street-kit.ts";
import { armSolids } from "../world/surfaces.ts";
import { launch, makeCar, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { propContact, type PropHits } from "./prop-contact.ts";

/** The prop's distance (m) ahead of the car's origin, and how long (s) a car takes to reach it and settle at the speeds below. */
const TARGET_Z = 14;
const RUN_S = 8;
/** How far (m/s) either side of the knock speed a car closes. */
const MARGIN = 0.5;
/** The furniture a car knocks over, with the closing speed (m/s) at or under which it holds. */
const KNOCKABLES: readonly { prefab: PrefabId; knockSpeed: number }[] = [
  { prefab: PREFAB.hoopFence, knockSpeed: HOOP_FENCE.knockSpeed },
  { prefab: PREFAB.litterBin, knockSpeed: KNOCKABLE.litterBin.knockSpeed },
  { prefab: PREFAB.bench, knockSpeed: KNOCKABLE.bench.knockSpeed },
  { prefab: PREFAB.newsBox, knockSpeed: KNOCKABLE.newsBox.knockSpeed },
  { prefab: PREFAB.bikeRack, knockSpeed: KNOCKABLE.bikeRack.knockSpeed },
];

/** A car at the origin launched along +z at `speed` m/s at `prefab` lying across its way, over `RUN_S` s through `propContact`: the props knocked loose, and how far the car got. */
function drive(prefab: PrefabId, speed: number): { knocks: number[]; z: number; met: number } {
  const car = makeCar("shape");
  // No drive input: the default one (idle) brakes the launched car to a stop within its first metre.
  const world = makeWorld([car], false, false, null);
  const prop: Placed = { prefab, x: 0, y: 0, z: TARGET_Z, yaw: Math.PI / 2, sx: 1, sy: 1, sz: 1 };
  const solids = solidsOf([], propColliders([prop]));
  const knocked = new Uint8Array(1);
  const knocks: number[] = [];
  let met = 0;
  const hits: PropHits = { knock: (index) => knocks.push(index), fx: () => {}, wall: () => met++ };
  armSolids(solids);
  world.world.collide = (c, i, h) => propContact(c, i, solids, knocked, hits, h);
  launch(car, 0, 0, 0, 0, speed);
  for (let i = 0; i < RUN_S * FRAME_HZ; i++) tickWorld(world);
  return { knocks, z: car.group.position.z, met };
}

describe("given street furniture a car knocks over, lying across its way", () => {
  afterEach(() => armSolids(null));

  for (const { prefab, knockSpeed } of KNOCKABLES) {
    // mutation: sed -i 's/    knockSpeed: HOOP_FENCE.knockSpeed,//' src/game/world/catalog.ts
    // mutation: sed -i 's/  return { body: "knock", collider: colliders, foot: reach, size: \[size\[0\], size\[1\], size\[2\]\], mass: massKg, knockSpeed, material };/  return { body: "knock", collider: colliders, foot: reach, size: [size[0], size[1], size[2]], mass: massKg, material };/' src/game/world/catalog.ts
    it(`when the car closes on the ${prefab} MARGIN under its knock speed, then it stands and the car does not pass it`, () => {
      const { knocks, z, met } = drive(prefab, knockSpeed - MARGIN);
      expect(met, `the car met the ${prefab} as a solid`).toBeGreaterThan(0);
      expect(knocks.length, `${prefab}s knocked loose by a nudge`).toBe(0);
      expect(z, `the car's origin passed the ${prefab} (z ${z.toFixed(2)} m)`).toBeLessThan(TARGET_Z);
    });

    // mutation: sed -i 's/    knockSpeed: HOOP_FENCE.knockSpeed,/    knockSpeed: 10 * HOOP_FENCE.knockSpeed,/' src/game/world/catalog.ts
    // mutation: sed -i 's/mass: massKg, knockSpeed, material };/mass: massKg, knockSpeed: 10 * knockSpeed, material };/' src/game/world/catalog.ts
    it(`when the car closes on the ${prefab} MARGIN over its knock speed, then it breaks loose, once`, () => {
      const { knocks } = drive(prefab, knockSpeed + MARGIN);
      expect(knocks.length, `${prefab}s knocked loose by a hard hit`).toBe(1);
      expect(knocks[0], "the prop's index").toBe(0);
    });
  }
});
