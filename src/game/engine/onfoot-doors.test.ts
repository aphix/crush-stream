import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
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
      assert.equal(doorInReach(car, spot.clone().add(new THREE.Vector3(testCase.offset, 0, 0)), speed), testCase.expectedReach);
    });
  }

  it("when its car has fallen off the ground, then its door is out of reach whoever stands at it", () => {
    const car = carAt(INSIDE_X, 0);
    const spot = doorSpot(car, new THREE.Vector3());
    car.falling = true;
    assert.equal(doorInReach(car, spot, speed), false);
  });

  it("when the car is moving, then its speed is read for the flow's refusal", () => {
    const car = carAt(INSIDE_X, 0);
    car.velocity.set(0, 0, 2.5);
    doorInReach(car, doorSpot(car, new THREE.Vector3()), speed);
    assert.ok(Math.abs(speed[0]! - 2.5) < 1e-9, `${speed[0]} m/s`);
  });
});

describe("given the room the driver door needs to open", () => {
  it("when the car stands upright on open ground, then its door has room", () => {
    const car = carAt(INSIDE_X, 0);
    assert.equal(doorBlocked([car], car, []), false);
  });

  it("when the car lies on its side, then its door has no room", () => {
    const car = carAt(INSIDE_X, 0);
    car.group.rotation.z = Math.PI / 2;
    car.group.updateMatrixWorld(true);
    assert.equal(doorBlocked([car], car, []), true);
  });

  it("when another car stands at the door's spot, then its door has no room", () => {
    const car = carAt(INSIDE_X, 0);
    const spot = doorSpot(car, new THREE.Vector3());
    const other = carAt(spot.x, spot.z);
    assert.equal(doorBlocked([car, other], car, []), true);
  });

  it("when the spot is half a metre inside the fleet disc's edge, then its door has no room, and the same car on ground with no edge has", () => {
    const reach = doorSpot(carAt(0, 0), new THREE.Vector3()).x;
    setGround(DISC_GROUND);
    const car = carAt(DISC_RADIUS - SPOT_INSIDE_M - reach, 0);
    assert.equal(doorBlocked([car], car, []), true, "a metre from the disc's edge is no room");
    setGround(null);
    assert.equal(doorBlocked([car], car, []), false, "the same spot on open ground");
  });

  it("when the car stands far from the world's middle on ground with no edge, then its door has room (a race's start is not the fleet's disc)", () => {
    const car = carAt(500, -300);
    assert.equal(doorBlocked([car], car, []), false);
  });
});
