import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type CrashWorld, launch, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { buildCar, drawnTriangles } from "./drawn-body.test-util.ts";
import { tyreClearance } from "./tyre-clearance.test-util.ts";
import type { DeformableCar } from "./car.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";
import type { CarStyleId } from "./car-variants.ts";

/** The drawn tyres stay under the drawn hood and fenders through a landing that drives the tyre up its arch (the owner: "the wheels of the truck pop up through the hood regularly"): the drawn body lifts over the wheel (`archStop`), the sim is not touched. */
const FRAME = 1 / FRAME_HZ;
const FRONT_WHEELS = [0, 1] as const;
/** The clearance (m) every drawn tyre top keeps under the skin. */
const CLEARANCE_M = 0.005;
const LANDERS: readonly (readonly [CarStyleId, VehicleClassId])[] = [
  ["coupe", "muscle"],
  ["pickup", "truck"],
];
const SQUASH = 0.32;
const BUCKLE = 0.45;
const SEEN_EVERY = 2;

function crashCar(style: CarStyleId, cls: VehicleClassId): DeformableCar {
  const car = buildCar(style, cls);
  car.deform.squash = SQUASH;
  car.deform.buckle = BUCKLE;
  return car;
}

/** The least clearance of `wheels` of `car` over `frames` frames of `w`, every `SEEN_EVERY`th frame read (at which frame, too). */
function leastClearance(w: CrashWorld, car: DeformableCar, wheels: readonly number[], frames: number): { clearance: number; at: number } {
  let least = { clearance: Infinity, at: 0 };
  for (let f = 0; f < frames; f++) {
    tickWorld(w, FRAME);
    if (f % SEEN_EVERY) continue;
    const tris = drawnTriangles(car);
    for (const wheel of wheels) {
      const clearance = tyreClearance(car, wheel, tris);
      if (clearance < least.clearance) least = { clearance, at: f };
    }
  }
  return least;
}

const fmt = (m: number): string => `${(m * 1000).toFixed(1)} mm`;

describe("given a car let down from a metre onto flat ground, its tyres driven up their arches", () => {
  for (const [style, cls] of LANDERS) {
    it(`when a ${cls} lands, then its front tyres keep ${CLEARANCE_M * 1000} mm under the drawn skin all through`, () => {
      const car = crashCar(style, cls);
      const w = makeWorld([car], false, false);
      launch(car, 0, 0, 0, 0, 0);
      car.group.position.y = 1;
      const seen = leastClearance(w, car, FRONT_WHEELS, 90);
      assert.ok(seen.clearance >= CLEARANCE_M, `${fmt(seen.clearance)} at frame ${seen.at}`);
    });
  }
});
