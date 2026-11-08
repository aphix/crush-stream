import { describe, expect, it } from "vitest";
import { FLAT_GROUND } from "../world/ground.ts";
import { CarCover } from "./car-cover.ts";
import { hidingSight, occluder, type Occluder, type Sight } from "./spectate-cam.ts";

/** The eye stands at the origin looking down +z over a 20 m wide, 10 m deep, 30 m high building 20 m ahead; the car is a sphere of `RADIUS` m 60 m ahead, or 40 m to the side of that. */
const EYE_Y = 1.5;
const RADIUS = 3.5;
const CAR_Y = 0.6;
const BEHIND = [0, 60] as const;
const BESIDE = [40, 60] as const;
const BUILDING = occluder(0, 20, 0, 10, 5, false, 0, 30);
/** The eye moves this far (m) between two reads: under the cover's eye bound, then over it. */
const EYE_STILL_M = 0.05;
const EYE_MOVED_M = 0.3;
/** A cut: the eye jumps this far (m) back, still with the building between it and the car. */
const CUT_BACK_M = 30;
/** More cars than a frame's test budget, all behind the building. */
const CROWD = 12;

function sightOf(...occ: Occluder[]): Sight {
  return { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ };
}

function aimed(cover: CarCover, z: number): void {
  cover.aim(0, EYE_Y, z, 0, 0, 1, true);
}

function ask(cover: CarCover, sight: Sight, at: readonly [number, number] = BEHIND, car = 0): boolean {
  return cover.hidden(car, sight, at[0], CAR_Y, at[1], RADIUS);
}

describe("given a car 60 m down the road behind a building, and a camera at the other side of it", () => {
  const sight = hidingSight(sightOf(BUILDING));

  it("when its cover is asked, then it is hidden, and a nudge of the eye under the bound is not tested again", () => {
    const cover = new CarCover();
    aimed(cover, 0);
    expect(ask(cover, sight), "the car is behind the building").toBe(true);
    expect(cover.tests, "one test").toBe(1);
    expect(cover.samples, "the sight lines took samples").toBeGreaterThan(0);
    aimed(cover, EYE_STILL_M);
    expect(ask(cover, sight)).toBe(true);
    expect(cover.tests, "the verdict stood").toBe(1);
  });

  it("when the eye moves past the bound, then the car is tested again, and when the car drives out from behind the building, then it is visible that frame", () => {
    const cover = new CarCover();
    aimed(cover, 0);
    ask(cover, sight);
    aimed(cover, EYE_MOVED_M);
    expect(ask(cover, sight), "still behind it").toBe(true);
    expect(cover.tests, "tested again").toBe(2);
    aimed(cover, EYE_MOVED_M * 2);
    expect(ask(cover, sight, BESIDE), "beside the building").toBe(false);
  });

  it("when the camera cuts to another view of the same hidden car, then every car counts visible that frame and the verdict is found again the next", () => {
    const cover = new CarCover();
    aimed(cover, 0);
    ask(cover, sight);
    aimed(cover, -CUT_BACK_M);
    expect(ask(cover, sight), "the cut frame: visible, its hold is laid").toBe(false);
    aimed(cover, -CUT_BACK_M);
    expect(ask(cover, sight), "the next frame: behind the building again").toBe(true);
  });

  it("when more cars are asked in a frame than it tests, then the rest count visible and are tested the next frame", () => {
    const cover = new CarCover();
    aimed(cover, 0);
    let hidden = 0;
    for (let i = 0; i < CROWD; i++) hidden += Number(ask(cover, sight, BEHIND, i));
    expect(cover.tests, "tests are capped a frame").toBeLessThan(CROWD);
    expect(hidden, "the cars past the budget are visible").toBe(cover.tests);
    aimed(cover, 0);
    for (let i = 0; i < CROWD; i++) ask(cover, sight, BEHIND, i);
    expect(cover.tests, "the next frame tests the rest").toBe(CROWD);
  });

  it("when a car in view is asked again the next frame with the eye moved, then it is taken for visible without a test", () => {
    const cover = new CarCover();
    aimed(cover, 0);
    expect(ask(cover, sight, BESIDE), "beside the building").toBe(false);
    aimed(cover, EYE_MOVED_M);
    expect(ask(cover, sight, BESIDE)).toBe(false);
    expect(cover.tests, "the visible verdict stood").toBe(1);
  });
});

describe("given three lamp posts 20 m out, one on each of the sight lines to the middle and both sides of a car 60 m down the road", () => {
  // A sight line to a side of the sphere crosses z = 20 a third of the way out: x = ±RADIUS / 3.
  const posts = (round: boolean): Occluder[] => [-RADIUS / 3, 0, RADIUS / 3].map((x) => occluder(x, 20, 0, 0.45, 0.45, round, 0, 9));
  // mutation: sed -i 's/^const THIN_PROP_M = 1;/const THIN_PROP_M = 0;/' src/game/present/spectate-cam.ts  (round posts kept as solids: the car reads hidden, red)
  it("when the cover is asked over the sight the cars' solids make, then the car is visible: lamp posts hide nothing, while square posts of that size would", () => {
    const asked = (round: boolean): boolean => {
      const cover = new CarCover();
      aimed(cover, 0);
      return ask(cover, hidingSight(sightOf(...posts(round))));
    };
    expect(asked(false), "the control: square posts on the three lines block every sight line").toBe(true);
    expect(asked(true), "the round lamp posts").toBe(false);
  });
});
