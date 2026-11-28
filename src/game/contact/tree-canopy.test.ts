import { afterEach, describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { frame } from "../vehicle/ground-probe.test-util.ts";
import { setGround } from "../world/ground.ts";
import { fallFrom, FREE_FALL_SLACK, treeWorld } from "./tree-canopy.test-util.ts";

const KINDS = ["plane", "linden", "young", "cherry", "parkPlane", "parkLinden"] as const;
/** The smallest and the largest drawn size a street tree takes (variations 0 and 15). */
const VARIATIONS = [0, 15] as const;
const STREET_STYLE = (kind: string, variation = 0): string => `street-tree:${kind}:north:${variation}`;

afterEach(() => setGround(null));

describe("given a street tree of each kind and size with a car above its trunk", () => {
  for (const kind of KINDS) {
    for (const variation of VARIATIONS) {
      it(`when a car falls through the ${kind}'s crown at variation ${variation}, then it falls as it does with no tree: the leaves give way`, () => {
        const style = STREET_STYLE(kind, variation);
        const from = treeWorld(style).top - 0.5;
        const bare = fallFrom(from, undefined, false);
        const withTree = fallFrom(from, style);
        const worst = Math.max(...withTree.map((y, at) => Math.abs(y - bare[at]!)));
        expect(worst, `${kind}: the most the fall differs from free fall (m)`).toBeLessThan(FREE_FALL_SLACK);
      });
    }
  }

  it("when a car is driven at 15 m/s into the trunk, then it stops short of it", () => {
    const { car, world } = treeWorld(STREET_STYLE("plane"));
    car.spawnFacing(-8, 0, Math.PI / 2, 0);
    car.velocity.set(15, 0, 0);
    const state = { acc: 0 };
    for (let f = 0; f < FRAME_HZ; f++) frame(world, null, state);
    expect(Math.abs(car.velocity.x), "speed after a second (m/s)").toBeLessThan(1);
    expect(car.group.position.x, "the car's middle stays on its own side of the trunk (m)").toBeLessThan(-1);
  });
});

describe("given a tree with no street style", () => {
  it("when a car falls onto its conifer crown, then the crown still holds it up", () => {
    const heights = fallFrom(10, undefined);
    expect(heights[heights.length - 1]!, "height after the free-fall time (m)").toBeGreaterThan(1);
  });
});
