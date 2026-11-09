import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CarDetail } from "../present/car-detail.ts";
import { HIDE_GRACE, SIGHT_ID_CAPACITY, type SightPlayer } from "../present/openworld-sight.ts";
import { occluder, type Occluder } from "../present/spectate-cam.ts";
import { OpenWorldCulling } from "./engine-openworld-cull.ts";

const EYE_HEIGHT_M = 1.6;
const BUILDING = occluder(0, 30, 0, 10, 4, false, 0, 10);
const PERSON_M = 0.5;
const FRAME_S = 0.1;
/** Long enough for a car behind the building to be hidden. */
const SETTLED_S = HIDE_GRACE + 1;
/** The ladder's rung a desktop starts on, and how many the open world moves it. */
const FIRST_RUNG = 0;
const OPEN_WORLD_RUNG = 3;
const street = new THREE.PerspectiveCamera(60, 1.6, 0.1, 400);
street.position.set(0, EYE_HEIGHT_M, 0);
street.lookAt(0, EYE_HEIGHT_M, 100);

/** Culling over a street camera whose course has no solids until `course.solids` is set, with one player's car at the origin and one traffic car parked 60 m down the street. */
function culling() {
  const course: { solids: readonly Occluder[] } = { solids: [] };
  const detail = new CarDetail(FIRST_RUNG);
  const player = { group: { position: { x: 0, z: 0 }, visible: true } };
  const parked = { group: { position: { x: 0, z: 60 }, visible: true } };
  const cars = [player, parked];
  const onFoot: { walker: SightPlayer | null } = { walker: null };
  const made = new OpenWorldCulling({ eyes: () => [street], solids: () => course.solids, playerCars: () => [player], walker: () => onFoot.walker, detail: () => detail, followed: () => player, replaying: () => false });
  return {
    course,
    onFoot,
    made,
    detail,
    cars,
    parked,
    run(seconds: number): void {
      for (let frame = 0; frame <= Math.round(seconds / FRAME_S); frame++) made.frame(cars, FRAME_S);
    },
  };
}

describe("given the open world's culling, its course still loading", () => {
  it("when the course's solids arrive on a later frame, then a person behind a building is unseen from then on", () => {
    const { course, made, cars } = culling();
    made.frame(cars, FRAME_S);
    expect(made.sight.seen(0, 50, PERSON_M), "seen before the solids").toBe(true);
    course.solids = [BUILDING];
    made.frame(cars, FRAME_S);
    expect(made.sight.seen(0, 50, PERSON_M), "seen once the building is known").toBe(false);
  });

  it("when the open world is left, then the buildings and the claimed ids are given back", () => {
    const { course, made, cars } = culling();
    course.solids = [BUILDING];
    made.frame(cars, FRAME_S);
    expect(() => made.sight.claim(SIGHT_ID_CAPACITY), "claiming every id with the cars' already taken").toThrow(RangeError);
    made.stop(cars);
    expect(made.sight.seen(0, 50, PERSON_M), "seen with no building left").toBe(true);
    expect(made.sight.claim(SIGHT_ID_CAPACITY), "every id after the stop").toBe(0);
  });
});

describe("given the course's building between the street camera and a traffic car", () => {
  it("when the car has been out of sight for the grace, then it is not drawn, and the open world's rung of detail is in force", () => {
    const world = culling();
    world.course.solids = [BUILDING];
    world.run(HIDE_GRACE + FRAME_S);
    expect(world.parked.group.visible, "the traffic car behind the building").toBe(false);
    expect(world.cars[0]!.group.visible, "the followed player's car").toBe(true);
    expect(world.detail.level, "rung of the distance detail").toBe(OPEN_WORLD_RUNG);
  });

  it("when culling is switched off, then the car is drawn and the ladder is back on its own rung, and when it is switched on the car goes after the grace again", () => {
    const world = culling();
    world.course.solids = [BUILDING];
    world.run(SETTLED_S);
    world.made.sight.enabled = false;
    world.made.frame(world.cars, FRAME_S);
    expect(world.parked.group.visible, "the car with culling off").toBe(true);
    expect(world.detail.level, "rung with culling off").toBe(FIRST_RUNG);
    world.made.sight.enabled = true;
    world.run(HIDE_GRACE + FRAME_S);
    expect(world.parked.group.visible, "the car after the grace with culling on again").toBe(false);
  });
});

describe("given the player on foot beside a parked car the street camera cannot see", () => {
  const BESIDE_THE_CAR = { group: { position: { x: 3, z: 60 } } };

  it("when the walker stands within the door's reach of it, then the car stays drawn and can be entered, and when he walks away it is hidden again", () => {
    const world = culling();
    world.course.solids = [BUILDING];
    world.onFoot.walker = BESIDE_THE_CAR;
    world.run(SETTLED_S);
    expect(world.parked.group.visible, "the car the walker stands beside").toBe(true);
    world.onFoot.walker = null;
    world.run(HIDE_GRACE + FRAME_S);
    expect(world.parked.group.visible, "the car once he has gone").toBe(false);
  });
});
