import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CarDetail } from "../present/car-detail.ts";
import { SIGHT_ID_CAPACITY } from "../present/openworld-sight.ts";
import { occluder, type Occluder } from "../present/spectate-cam.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { OpenWorldCulling } from "./engine-openworld-cull.ts";

const EYE_HEIGHT_M = 1.6;
const BUILDING = occluder(0, 30, 0, 10, 4, false, 0, 10);
const PERSON_M = 0.5;
const street = new THREE.PerspectiveCamera(60, 1.6, 0.1, 400);
street.position.set(0, EYE_HEIGHT_M, 0);
street.lookAt(0, EYE_HEIGHT_M, 100);

/** Culling over a street camera whose course has no solids until `course.solids` is set. */
function culling() {
  const course: { solids: readonly Occluder[] } = { solids: [] };
  const detail = new CarDetail();
  const cars: DeformableCar[] = [];
  const made = new OpenWorldCulling({ eyes: () => [street], solids: () => course.solids, playerCars: () => [], detail: () => detail, followed: () => null, replaying: () => false });
  return { course, made, cars };
}

describe("given the open world's culling, its course still loading", () => {
  it("when the course's solids arrive on a later frame, then a person behind a building is unseen from then on", () => {
    const { course, made, cars } = culling();
    made.frame(cars, 0);
    expect(made.sight.seen(0, 50, PERSON_M), "seen before the solids").toBe(true);
    course.solids = [BUILDING];
    made.frame(cars, 1);
    expect(made.sight.seen(0, 50, PERSON_M), "seen once the building is known").toBe(false);
  });

  it("when the open world is left, then the buildings and the claimed ids are given back", () => {
    const { course, made, cars } = culling();
    course.solids = [BUILDING];
    made.frame(cars, 0);
    expect(() => made.sight.claim(SIGHT_ID_CAPACITY), "claiming every id with the cars' already taken").toThrow(RangeError);
    made.stop(cars);
    expect(made.sight.seen(0, 50, PERSON_M), "seen with no building left").toBe(true);
    expect(made.sight.claim(SIGHT_ID_CAPACITY), "every id after the stop").toBe(0);
  });
});
