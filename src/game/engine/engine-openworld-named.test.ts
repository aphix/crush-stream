import { describe, expect, it } from "vitest";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { NAMED } from "../net/act-codec.ts";
import { NamedThings, type Placed } from "./engine-openworld-named.ts";

const car = pooledCar(0);
const crowd = createCrowdPoses(1);
const picks = { along: Infinity, x: 0, y: 0, z: 0 };
const world = { empty: false, playerSpeed: 0 };
const things = new NamedThings({
  crowd: () => crowd,
  cops: () => null,
  bodies: () => null,
  shared: () => null,
  ownCar: () => 0,
  ownFoot: () => false,
  playerPlace: (_actor, out) => (Object.assign(out, { x: 5, y: 1, z: 6, velocityX: 0, velocityZ: 0 }), true),
  cars: () => [car],
  carEmpty: () => world.empty,
  playerSpeed: () => world.playerSpeed,
  doll: { ...picks, slot: -1 },
  car: { ...picks, car: -1 },
  person: { along: Infinity, index: -1 },
  cop: { along: Infinity, index: -1 },
});
const placed: Placed = { x: 0, y: 0, z: 0, speed: 0, driven: true, slack: 0 };
/** The grace past a car's box the host allows (m), and an offset well past it. */
const SLACK_M = 0.3;
const WELL_PAST_M = 1;
const OTHER_PLAYER = 1;

/** Whether the host places a hit on the car at `offset` from its origin (the car's frame). */
function placesCar(x: number, y: number, z: number): boolean {
  return things.place(NAMED.car, 0, x, y, z, placed);
}

describe("given a car standing at the origin and a guest naming a point on it", () => {
  const { half } = car.frame;
  const middle = half.y;

  it("when the named point is on its flank, nose and roof, then the host places it; and 1 m past any of them it does not", () => {
    expect(placesCar(half.x, middle, 0), "on the flank").toBe(true);
    expect(placesCar(0, middle, half.z), "on the nose").toBe(true);
    expect(placesCar(0, 2 * half.y, 0), "on the roof").toBe(true);
    expect(placesCar(half.x + SLACK_M + WELL_PAST_M, middle, 0), "beside the flank").toBe(false);
    expect(placesCar(0, middle, half.z + SLACK_M + WELL_PAST_M), "past the nose").toBe(false);
    expect(placesCar(0, 2 * half.y + SLACK_M + WELL_PAST_M, 0), "over the roof").toBe(false);
    expect(placesCar(0, -SLACK_M - WELL_PAST_M, 0), "under the floor").toBe(false);
  });

  it("when the named point is 2 m beside its flank, where a person might stand, then the host refuses it", () => {
    expect(placesCar(half.x + 2, middle, 0)).toBe(false);
  });

  it("when the car moves at 20 m/s, then the host reads that speed with the point and the shot may fly 0.5 m past it", () => {
    car.velocity.set(0, 0, 20);
    expect(placesCar(0, middle, 0), "placed").toBe(true);
    expect(placed.speed, "the car's speed (m/s)").toBeCloseTo(20, 6);
    expect(placed.slack, "metres a shot may fly past the point").toBeCloseTo(0.5, 6);
    car.velocity.set(0, 0, 0);
  });

  it("when nobody is in the car, then it cannot speed up; with a driver it can", () => {
    world.empty = true;
    placesCar(0, middle, 0);
    expect(placed.driven, "parked").toBe(false);
    world.empty = false;
    placesCar(0, middle, 0);
    expect(placed.driven, "driven").toBe(true);
  });
});

describe("given a guest on foot another guest names, whose own records say he stands still", () => {
  it("when the host has seen him move at 7 m/s, then the point carries 7 m/s, not the 0 his record reports", () => {
    world.playerSpeed = 7;
    expect(things.place(NAMED.player, OTHER_PLAYER, 0, 1, 0, placed), "placed").toBe(true);
    expect(placed.speed, "the speed the host saw (m/s)").toBeCloseTo(7, 6);
    expect(placed.slack, "metres a shot may fly past the point").toBeCloseTo(0.35, 6);
  });
});
