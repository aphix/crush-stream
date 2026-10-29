import { describe, expect, it } from "vitest";
import type { BufferAttribute } from "three";
import { type CrashWorld, FREEWHEEL, launch, makeWorld, PARKED, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { DT } from "./test-support.ts";
import { buildCar, drawnTriangles } from "./drawn-body.test-util.ts";
import { tyreClearance } from "./tyre-clearance.test-util.ts";
import type { DeformableCar } from "./car.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";
import type { CarStyleId } from "./car-variants.ts";

/** The drawn tyres stay under the drawn hood and fenders through a landing that drives the tyre up its arch (the owner: "the wheels of the truck pop up through the hood regularly"): the drawn body lifts over the wheel (`archStop`), the sim is not touched. */
const FRONT_WHEELS = [0, 1] as const;
/** The clearance (m) every drawn tyre top keeps under the skin. */
const CLEARANCE_M = 0.005;
const LANDERS = [
  { style: "coupe", cls: "muscle" },
  { style: "pickup", cls: "truck" },
] as const satisfies readonly { style: CarStyleId; cls: VehicleClassId }[];
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
    tickWorld(w, DT);
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
  for (const { style, cls } of LANDERS) {
    it(`when a ${cls} lands, then its front tyres keep ${CLEARANCE_M * 1000} mm under the drawn skin all through`, () => {
      const car = crashCar(style, cls);
      const w = makeWorld([car], false, false);
      launch(car, 0, 0, 0, 0, 0);
      car.group.position.y = 1;
      const seen = leastClearance(w, car, FRONT_WHEELS, 90);
      expect(seen.clearance, `${fmt(seen.clearance)} at frame ${seen.at}`).toBeGreaterThanOrEqual(CLEARANCE_M);
    });
  }
});

describe("given a pickup that hits something with its nose", () => {
  it("when it meets a second pickup head-on at 50 km/h, then its front tyres keep 5 mm under the drawn hood through the crush and after", () => {
    const a = crashCar("pickup", "truck");
    const b = crashCar("pickup", "truck");
    const w = makeWorld([a, b], false, false);
    w.pedals.set(a, FREEWHEEL);
    w.pedals.set(b, FREEWHEEL);
    launch(a, -5, 0, Math.PI / 2, 50 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -50 / 3.6, 0);
    const seen = leastClearance(w, a, FRONT_WHEELS, 150);
    expect(seen.clearance, `${fmt(seen.clearance)} at frame ${seen.at}`).toBeGreaterThanOrEqual(CLEARANCE_M);
  });

  it("when it drives into a parked sedan's flank at 72 km/h, then its front tyres keep 5 mm under the drawn hood through the crush and after", () => {
    const a = crashCar("pickup", "truck");
    const b = crashCar("sedan", "sedan");
    const w = makeWorld([a, b], false, false);
    w.pedals.set(a, FREEWHEEL);
    w.pedals.set(b, PARKED);
    launch(a, -12, 0, Math.PI / 2, 72 / 3.6, 0);
    launch(b, 0, 0, 0, 0, 0);
    const seen = leastClearance(w, a, FRONT_WHEELS, 150);
    expect(seen.clearance, `${fmt(seen.clearance)} at frame ${seen.at}`).toBeGreaterThanOrEqual(CLEARANCE_M);
  });
});

describe("given a pickup wrecked head-on and lying still, its skin held over its tyres", () => {
  it("when a front hub moves 1 mm the skin is held again, and when it then jitters by 5 µm the skin is left as held", () => {
    const a = crashCar("pickup", "truck");
    const b = crashCar("pickup", "truck");
    const w = makeWorld([a, b], false, false);
    launch(a, -5, 0, Math.PI / 2, 50 / 3.6, 0);
    launch(b, 5, 0, -Math.PI / 2, -50 / 3.6, 0);
    for (let f = 0; f < 90; f++) tickWorld(w, DT);
    expect(a.panelsFollow).toBeTruthy();
    const skin = a.body.geometry.getAttribute("position") as BufferAttribute;
    a.updateSkin();
    const before = skin.version;
    a.wheels[0]!.position.y += 1e-3;
    a.updateSkin();
    const held = skin.version;
    expect(held).toBeGreaterThan(before);
    a.wheels[0]!.position.y += 5e-6;
    a.updateSkin();
    expect(skin.version).toBe(held);
  });
});
