import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CarSurfaces } from "./car-surfaces.ts";
import { DT, paint } from "./test-support.ts";
import { FACES, FACE_NOSE, FACE_TOP, SPRING_YIELD } from "../deform/load-crush.ts";
import { G } from "./car-air-body.ts";

/**
 * A face a load crushes is a wreck only past its elastic range (docs/LOAD_CRUSH.md, `SPRING_YIELD`): a dent that shallow springs back whole in the
 * structure, so a belly's soft touch on a ramp's edge (1.7 mm) leaves the car as it was. The depth is the face's total over every press, whatever
 * presses: the ground, a wall, or another car's belly on a roof.
 */
/** More impulse (per unit mass) than a face carries in a slice (`room`): the contact yields. */
const MORE_THAN_CARRIED = 100;

/** One slice in which a body point presses `depth` m into the stepping car's nose, harder than the nose carries. */
function press(surfaces: CarSurfaces, car: DeformableCar, depth: number): void {
  surfaces.begin(car);
  surfaces.take(FACE_NOSE, MORE_THAN_CARRIED, G, DT);
  surfaces.note(FACE_NOSE, depth, 1);
  surfaces.commit();
}

function standing(): { car: DeformableCar; surfaces: CarSurfaces } {
  const car = new DeformableCar(paint(), new THREE.Scene());
  car.spawnFacing(0, 0, 0, 0);
  const surfaces = new CarSurfaces();
  surfaces.cars = [car];
  return { car, surfaces };
}

describe("given a car whose nose a load presses in slices, harder than the nose carries", () => {
  it("when it presses in 1.7 mm, a belly's soft touch, then the nose carries the dent and the car is no wreck", () => {
    const { car, surfaces } = standing();
    press(surfaces, car, 0.0017);
    expect(Math.abs(car.deform.crush[FACE_NOSE]! - 0.0017), `the nose is crushed ${car.deform.crush[FACE_NOSE]!.toFixed(4)} m`).toBeLessThan(1e-12);
    expect(car.crashed, "a dent under its elastic range wrecked the car").toBe(false);
  });

  it("when four presses of 4 mm follow, then the car is no wreck at 12 mm and a wreck at 16 mm: the face's depth is the total", () => {
    const { car, surfaces } = standing();
    const wrecked: boolean[] = [];
    for (let k = 0; k < 4; k++) {
      press(surfaces, car, 0.004);
      wrecked.push(car.crashed);
    }
    expect(0.012 < SPRING_YIELD && 0.016 > SPRING_YIELD, "the control: 12 mm is under the elastic range, 16 mm past it").toBeTruthy();
    expect(wrecked.join(), "crashed after each press").toBe("false,false,false,true");
  });

  it("when it presses in 40 mm in one slice, then the car is a wreck", () => {
    const { car, surfaces } = standing();
    press(surfaces, car, 0.04);
    expect(car.crashed).toBe(true);
  });
});

/** `under`'s roof pressed `depth` m by `over`'s belly in one slice, harder than the roof carries. */
function pressRoof(depth: number): { under: DeformableCar; over: DeformableCar } {
  const under = new DeformableCar(paint(), new THREE.Scene());
  const over = new DeformableCar(paint(), new THREE.Scene());
  under.spawnFacing(0, 0, 0, 0);
  over.spawnFacing(0, 0, 0, 0);
  const surfaces = new CarSurfaces();
  surfaces.cars = [over, under];
  surfaces.begin(over);
  const roof = FACES * 2 + FACE_TOP;
  surfaces.take(roof, MORE_THAN_CARRIED, G, DT);
  surfaces.note(roof, depth, 1);
  surfaces.commit();
  return { under, over };
}

describe("given a car whose roof another car's belly presses, harder than the roof carries", () => {
  it("when it presses in 1.7 mm, then the roof carries the dent and neither car is a wreck", () => {
    const { under, over } = pressRoof(0.0017);
    expect(Math.abs(under.deform.crush[FACE_TOP]! - 0.0017), `the roof is crushed ${under.deform.crush[FACE_TOP]!.toFixed(4)} m`).toBeLessThan(1e-12);
    expect(under.crashed, "a dent under its elastic range wrecked the roof's car").toBe(false);
    expect(over.crashed).toBe(false);
    expect(under.panelsFollow, "the dented roof's panels do not follow the dent").toBe(true);
  });

  it("when it presses in 20 mm, then the roof's car is a wreck and the pressing car is not", () => {
    const { under, over } = pressRoof(0.02);
    expect(under.crashed).toBe(true);
    expect(over.crashed).toBe(false);
  });
});
