import { describe, expect, it } from "vitest";
import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { NAMED } from "../net/act-codec.ts";
import { addBodyRecord, BODY_KIND, BODY_POSTURE, makeBodyFrame } from "../net/body-codec.ts";
import { NamedThings, type Placed } from "./engine-openworld-named.ts";
import { DRAWN, OpenWorldShared } from "./openworld-shared.ts";
import { personOf } from "./people-index.ts";

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

describe("given the host's own people as it draws them: only the players pass through the shared people, the crowd's civilians stay in the crowd's table", () => {
  const CAPACITY = 8;
  const RUNNER = 3;
  const RUNNING_MPS = 4;
  const SPRINTING_MPS = 7;
  const NO_DUMMIES = { lookOf: () => {}, throwFigure: () => -1, removeFigure: () => false, spawnOf: () => 0 };
  const civilians = createCrowdPoses(CAPACITY);
  const players = createCrowdPoses(CAPACITY);
  const shared = new OpenWorldShared(CAPACITY, { bodies: null, host: null, tables: [civilians, players, null, null], sight: { seen: () => true }, floors: null, ports: NO_DUMMIES });
  const hostThings = new NamedThings({
    crowd: () => civilians,
    cops: () => null,
    bodies: () => null,
    shared: () => shared,
    ownCar: () => 0,
    ownFoot: () => false,
    playerPlace: (_actor, out) => (Object.assign(out, { x: 20, y: 1, z: 8, velocityX: 0, velocityZ: 0 }), true),
    cars: () => [],
    carEmpty: () => false,
    playerSpeed: () => SPRINTING_MPS,
    doll: { ...picks, slot: -1 },
    car: { ...picks, car: -1 },
    person: { along: Infinity, index: -1 },
    cop: { along: Infinity, index: -1 },
  });

  // A guard: the speed of a civilian the crowd draws is her pose row's, and she is never a figure of the shared people on the host (it records players only).
  it("when the host places a named point on a civilian running at 4 m/s along its crowd table, then the point carries 4 m/s", () => {
    civilians.shown[RUNNER] = 1;
    civilians.x[RUNNER] = 10;
    civilians.z[RUNNER] = 5;
    civilians.speed[RUNNER] = RUNNING_MPS;
    const frame = makeBodyFrame();
    frame.crowdTime = 0;
    shared.hear(frame, 0);
    shared.bodyRecords(shared.frame, 1 << BODY_KIND.player, -1, 0, 0, 0);
    expect(shared.drawnAt(RUNNER, { x: 0, z: 0 }), "she is drawn by the crowd's own table, not as one of the shared people").toBe(DRAWN.none);
    expect(hostThings.place(NAMED.civilian, RUNNER, 0, 1, 0, placed), "placed").toBe(true);
    expect(placed.speed, "the speed the point carries (m/s)").toBeCloseTo(RUNNING_MPS, 6);
  });

  // A guard: a player drawn as a figure on the host (record velocity 0) is placed at the speed the host saw him move.
  it("when the host draws another guest as a figure from a record that says he stands still and places a named point on him, then the point carries the 7 m/s the host saw", () => {
    const frame = makeBodyFrame();
    const at = addBodyRecord(frame, BODY_KIND.player, OTHER_PLAYER, BODY_POSTURE.stand);
    frame.pos.set([20, 1, 8], 3 * at);
    frame.crowdTime = 0;
    shared.hear(frame, 0);
    shared.bodyRecords(shared.frame, 1 << BODY_KIND.player, -1, 0, 0, 0);
    expect(shared.drawnAt(personOf(BODY_KIND.player, OTHER_PLAYER, CAPACITY), { x: 0, z: 0 }), "he is drawn as a figure").toBe(DRAWN.figure);
    expect(hostThings.place(NAMED.player, OTHER_PLAYER, 0, 1, 0, placed), "placed").toBe(true);
    expect(placed.speed, "the speed the host saw (m/s)").toBeCloseTo(SPRINTING_MPS, 6);
  });
});
