import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { paint } from "../vehicle/test-support.ts";
import { DISC_GROUND, DISC_RADIUS, setGround } from "../world/ground.ts";
import { doorBlocked, doorInReach, doorSpot } from "./onfoot-doors.ts";

/** A sedan at (x, z) facing +z, nobody else on the ground. */
function carAt(x: number, z: number): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
  car.spawnFacing(x, z, 0, 0);
  car.group.updateMatrixWorld(true);
  return car;
}

const REACHED_M = 1;
const MISSED_M = 3;
/** A car in the middle of the world, and how far inside the fleet disc's edge (m) its door's spot stands: nearer than the metre of ground a door needs round it. */
const INSIDE_X = 0;
const SPOT_INSIDE_M = 0.5;

afterEach(() => setGround(null));

describe("given a car and the spot outside its driver door", () => {
  const speed = new Float64Array(1);
  const torsoCases: readonly { it: string; offset: number; expectedReach: boolean }[] = [
    { it: "when his torso stands at the spot, then the door is in reach", offset: 0, expectedReach: true },
    { it: "when his torso stands a metre from the spot, then the door is in reach", offset: REACHED_M, expectedReach: true },
    { it: "when his torso stands 3 m from the spot, then the door is out of reach", offset: MISSED_M, expectedReach: false },
  ];
  for (const testCase of torsoCases) {
    it(testCase.it, () => {
      const car = carAt(INSIDE_X, 0);
      const spot = doorSpot(car, new THREE.Vector3());
      expect(doorInReach(car, spot.clone().add(new THREE.Vector3(testCase.offset, 0, 0)), speed)).toBe(testCase.expectedReach);
    });
  }

  it("when its car has fallen off the ground, then its door is out of reach whoever stands at it", () => {
    const car = carAt(INSIDE_X, 0);
    const spot = doorSpot(car, new THREE.Vector3());
    car.falling = true;
    expect(doorInReach(car, spot, speed)).toBe(false);
  });

  it("when the car is moving, then its speed is read for the flow's refusal", () => {
    const car = carAt(INSIDE_X, 0);
    car.velocity.set(0, 0, 2.5);
    doorInReach(car, doorSpot(car, new THREE.Vector3()), speed);
    expect(Math.abs(speed[0]! - 2.5), `${speed[0]} m/s`).toBeLessThan(1e-9);
  });
});

describe("given the room the driver door needs to open", () => {
  it("when the car stands upright on open ground, then its door has room", () => {
    const car = carAt(INSIDE_X, 0);
    expect(doorBlocked([car], car, [])).toBe(false);
  });

  it("when the car lies on its side, then its door has no room", () => {
    const car = carAt(INSIDE_X, 0);
    car.group.rotation.z = Math.PI / 2;
    car.group.updateMatrixWorld(true);
    expect(doorBlocked([car], car, [])).toBe(true);
  });

  it("when another car stands at the door's spot, then its door has no room", () => {
    const car = carAt(INSIDE_X, 0);
    const spot = doorSpot(car, new THREE.Vector3());
    const other = carAt(spot.x, spot.z);
    expect(doorBlocked([car, other], car, [])).toBe(true);
  });

  it("when the spot is half a metre inside the fleet disc's edge, then its door has no room, and the same car on ground with no edge has", () => {
    const reach = doorSpot(carAt(0, 0), new THREE.Vector3()).x;
    setGround(DISC_GROUND);
    const car = carAt(DISC_RADIUS - SPOT_INSIDE_M - reach, 0);
    expect(doorBlocked([car], car, []), "a metre from the disc's edge is no room").toBe(true);
    setGround(null);
    expect(doorBlocked([car], car, []), "the same spot on open ground").toBe(false);
  });

  it("when the car stands far from the world's middle on ground with no edge, then its door has room (a race's start is not the fleet's disc)", () => {
    const car = carAt(500, -300);
    expect(doorBlocked([car], car, [])).toBe(false);
  });
});
