import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { footprintBound, footprintReach } from "./prop-contact.ts";

/** [yaw, pitch, roll] in degrees: level, nose down, on its side, on its roof, tumbling. */
const POSES = [
  [0, 0, 0],
  [37, 0, 0],
  [90, 25, 0],
  [0, 0, 90],
  [123, 0, 180],
  [61, -50, 70],
] as const;
const RAD = Math.PI / 180;

function pose(car: ReturnType<typeof makeCar>, [yaw, pitch, roll]: readonly [number, number, number]): void {
  car.spawnFacing(0, 0, yaw * RAD, 0);
  car.group.quaternion.setFromEuler(new THREE.Euler(pitch * RAD, yaw * RAD, roll * RAD, "YXZ"));
  car.group.updateMatrixWorld(true);
  car.refreshBasis();
}

describe("given each class of car posed level, pitched, on its side, on its roof and tumbling", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when the ${cls}'s footprint is measured, then the bound the prism query is asked first never falls short of its reach`, () => {
      const car = makeCar(cls);
      for (const p of POSES) {
        pose(car, p);
        expect(footprintBound(car), `${cls} at ${p.join("/")}`).toBeGreaterThanOrEqual(footprintReach(car));
      }
    });
  }
});

describe("given a wreck with one of its masses flung 5 m out of the body", () => {
  it("when the footprint is measured, then the bound reaches that mass too", () => {
    const car = makeCar("sedan");
    pose(car, POSES[1]);
    car.deform.armMasses(car.group, car.velocity, car.angular);
    const flung = car.deform.masses.find((m) => !m.hub)!;
    flung.world.x += 5;
    expect(footprintReach(car)).toBeGreaterThan(5);
    expect(footprintBound(car)).toBeGreaterThanOrEqual(footprintReach(car));
  });
});
