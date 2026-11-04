import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { solidsOf, type PropCollider } from "../world/placements.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { centreY } from "../vehicle/car-cage-rig.ts";
import { propContact, type PropHits } from "./prop-contact.ts";
import { FINE_HZ } from "../kernel/constants.ts";

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
const NO_HITS: PropHits = { knock: () => {}, fx: () => {}, wall: () => {} };

function pose(car: ReturnType<typeof makeCar>, [yaw, pitch, roll]: readonly [number, number, number]): void {
  car.spawnFacing(0, 0, yaw * RAD, 0);
  car.group.quaternion.setFromEuler(new THREE.Euler(pitch * RAD, yaw * RAD, roll * RAD, "YXZ"));
  car.group.updateMatrixWorld(true);
  car.refreshBasis();
}

/**
 * The radii (m) `propContact` asks the prism query for `car`: first the bound's, then, once a prism is in it, the measured reach's (both
 * plus the same door margin). The one prism stands at the car's middle, far above any body, so it is found and never touched.
 */
function queriedRadii(car: ReturnType<typeof makeCar>): number[] {
  const pos = car.group.position;
  const high: PropCollider = { index: 0, prefab: "lamp", body: "solid", x: pos.x, z: pos.z, yaw: 0, kind: "circle", r: 0.1, hx: 0.1, hz: 0.1, mass: 0, base: 100, top: 101, ends: 3 };
  const solids = solidsOf([], [high]);
  const near = vi.spyOn(solids, "prismsNear");
  propContact(car, 0, solids, new Uint8Array(0), NO_HITS, 1 / FINE_HZ);
  return near.mock.calls.map((c) => c[2]);
}

describe("given each class of car posed level, pitched, on its side, on its roof and tumbling", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when the ${cls}'s footprint is measured, then the bound the prism query is asked first never falls short of its reach`, () => {
      const car = makeCar(cls);
      for (const p of POSES) {
        pose(car, p);
        const [bound, reach = NaN] = queriedRadii(car);
        expect(bound, `${cls} at ${p.join("/")}`).toBeGreaterThanOrEqual(reach);
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
    const [bound, reach = NaN] = queriedRadii(car);
    expect(reach).toBeGreaterThan(5);
    expect(bound).toBeGreaterThanOrEqual(reach);
  });
});

describe("given an intact sedan leaning 30 degrees, yawed 45 degrees to a long thin wall that stands between its origin and its centre of mass", () => {
  it("when it is met, then the wall pushes it to the side its centre of mass is on, not its origin", () => {
    const car = makeCar("sedan");
    pose(car, [45, 0, -30]);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(car.group.quaternion);
    const com = up.x * centreY(car);
    // Origin at x 0, centre of mass at `com`: the wall's midplane halfway, its length (hz) far past the footprint so only the wall's own axis can win.
    expect(Math.abs(com), "the lean puts the centre of mass off the origin in plan").toBeGreaterThan(0.1);
    const wall: PropCollider = { index: 0, prefab: null, body: "solid", x: com / 2, z: 0, yaw: 0, kind: "box", r: 20, hx: 0.04, hz: 20, mass: 0, base: 0, top: 4.4, ends: 3 };
    let nx = NaN;
    const hits: PropHits = { knock: () => {}, fx: () => {}, wall: (_i, _car, _closing, _x, _z, hitNx) => (nx = hitNx) };
    propContact(car, 0, solidsOf([], [wall]), new Uint8Array(1), hits, 1 / FINE_HZ);
    expect(nx, "the wall's push points to the centre of mass's side").toBe(Math.sign(com));
  });
});
