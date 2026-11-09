import { afterEach, describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { PREFAB } from "../world/constants.ts";
import { propColliders, solidsOf, type Placed } from "../world/placements.ts";
import { HOOP_FENCE } from "../world/street-kit.ts";
import { armSolids } from "../world/surfaces.ts";
import { launch, makeCar, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { propContact, type PropHits } from "./prop-contact.ts";

/** The fence's distance (m) ahead of the car's origin, and how long (s) a car takes to reach it and settle at the speeds below. */
const TARGET_Z = 14;
const RUN_S = 8;
/** How far (m/s) either side of the knock speed a car closes. */
const MARGIN = 0.5;

/** A car at the origin launched along +z at `speed` m/s at a fence section lying across its way, over `RUN_S` s through `propContact`: the sections knocked loose, and how far the car got. */
function drive(speed: number): { knocks: number[]; z: number } {
  const car = makeCar("shape");
  const world = makeWorld([car], false, false);
  const fence: Placed = { prefab: PREFAB.hoopFence, x: 0, y: 0, z: TARGET_Z, yaw: Math.PI / 2, sx: 1, sy: 1, sz: 1 };
  const solids = solidsOf([], propColliders([fence]));
  const knocked = new Uint8Array(1);
  const knocks: number[] = [];
  const hits: PropHits = { knock: (index) => knocks.push(index), fx: () => {}, wall: () => {} };
  armSolids(solids);
  world.world.collide = (c, i, h) => propContact(c, i, solids, knocked, hits, h);
  launch(car, 0, 0, 0, 0, speed);
  for (let i = 0; i < RUN_S * FRAME_HZ; i++) tickWorld(world);
  return { knocks, z: car.group.position.z };
}

describe("given a section of the park's hoop fence lying across a car's way", () => {
  afterEach(() => armSolids(null));

  // mutation: sed -i 's/    knockSpeed: HOOP_FENCE.knockSpeed,//' src/game/world/catalog.ts
  it("when the car closes on it MARGIN under its knock speed, then the fence stands and the car does not pass it", () => {
    const { knocks, z } = drive(HOOP_FENCE.knockSpeed - MARGIN);
    expect(knocks.length, "sections knocked loose by a nudge").toBe(0);
    expect(z, `the car's origin passed the fence (z ${z.toFixed(2)} m)`).toBeLessThan(TARGET_Z);
  });

  // mutation: sed -i 's/export const HOOP_FENCE = { knockSpeed: 3,/export const HOOP_FENCE = { knockSpeed: 30,/' src/game/world/street-kit.ts
  it("when the car closes on it MARGIN over its knock speed, then the section breaks loose, once", () => {
    const { knocks } = drive(HOOP_FENCE.knockSpeed + MARGIN);
    expect(knocks.length, "sections knocked loose by a hard hit").toBe(1);
    expect(knocks[0], "the section's index").toBe(0);
  });
});
