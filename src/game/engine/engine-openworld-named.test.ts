import { describe, expect, it } from "vitest";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { NAMED } from "../net/act-codec.ts";
import { NamedThings, type Placed } from "./engine-openworld-named.ts";

const car = pooledCar(0);
const crowd = createCrowdPoses(1);
const picks = { along: Infinity, x: 0, y: 0, z: 0 };
const things = new NamedThings({
  crowd: () => crowd,
  cops: () => null,
  bodies: () => null,
  shared: () => null,
  ownCar: () => 0,
  ownFoot: () => false,
  playerPlace: () => false,
  cars: () => [car],
  doll: { ...picks, slot: -1 },
  car: { ...picks, car: -1 },
  person: { along: Infinity, index: -1 },
  cop: { along: Infinity, index: -1 },
});
const placed: Placed = { x: 0, y: 0, z: 0, speed: 0 };
/** The grace past a car's box the host allows (m), and an offset well past it. */
const SLACK_M = 0.3;
const WELL_PAST_M = 1;

/** Whether the host places a hit on the car at `offset` from its origin (the car's frame). */
function placesCar(x: number, y: number, z: number): boolean {
  return things.place(NAMED.car, 0, x, y, z, placed);
}

describe("given a car standing at the origin and a guest naming a point on it", () => {
  const { half, centre } = car.frame;

  it("when the named point is on its flank, nose and roof, then the host places it; and 1 m past any of them it does not", () => {
    expect(placesCar(centre.x + half.x, centre.y, centre.z), "on the flank").toBe(true);
    expect(placesCar(centre.x, centre.y, centre.z + half.z), "on the nose").toBe(true);
    expect(placesCar(centre.x, centre.y + half.y, centre.z), "on the roof").toBe(true);
    expect(placesCar(centre.x + half.x + SLACK_M + WELL_PAST_M, centre.y, centre.z), "beside the flank").toBe(false);
    expect(placesCar(centre.x, centre.y, centre.z + half.z + SLACK_M + WELL_PAST_M), "past the nose").toBe(false);
    expect(placesCar(centre.x, centre.y + half.y + SLACK_M + WELL_PAST_M, centre.z), "over the roof").toBe(false);
  });

  it("when the named point is 2 m beside its flank, where a person might stand, then the host refuses it", () => {
    expect(placesCar(centre.x + half.x + 2, centre.y, centre.z)).toBe(false);
  });

  it("when the car moves at 20 m/s, then the host reads that speed with the point", () => {
    car.velocity.set(0, 0, 20);
    expect(placesCar(centre.x, centre.y, centre.z), "placed").toBe(true);
    expect(placed.speed, "the car's speed (m/s)").toBeCloseTo(20, 6);
    car.velocity.set(0, 0, 0);
  });
});
