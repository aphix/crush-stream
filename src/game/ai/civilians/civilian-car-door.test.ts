import { describe, expect, it } from "vitest";
import { CAR_DOOR, carDoorSpot, type DoorSpot } from "./civilian-car-door.ts";

/** A sedan's seat: the H-point across, up and along (m, car space). */
const SEAT_FRONT = [0.41, 0.47, -0.08] as const;
const GROUND_Y = 0.3;
const CAR = { x: 10, z: 20 } as const;
const spotOf = (yaw: number): DoorSpot => {
  const out: DoorSpot = { x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 };
  carDoorSpot(CAR.x, CAR.z, yaw, GROUND_Y, SEAT_FRONT, out);
  return out;
};

describe("given a sedan standing at (10, 20) on ground 0.3 m high", () => {
  it("when it faces +z, then her spot is out on its left past the seat, behind the seat's place, and she faces the car", () => {
    const spot = spotOf(0);
    expect(spot.x, "out from the seat").toBeCloseTo(CAR.x + SEAT_FRONT[0] + CAR_DOOR.outFromSeat, 6);
    expect(spot.z, "behind the seat").toBeCloseTo(CAR.z + SEAT_FRONT[2] - CAR_DOOR.behindSeat, 6);
    expect(spot.yaw, "facing -x, toward the car").toBeCloseTo(-Math.PI / 2, 6);
  });

  it.each([0, 1, 2.5, -1.2, Math.PI])("when it faces yaw %f, then she stands the same way round it and faces across its width at it", (carYaw) => {
    const spot = spotOf(carYaw);
    const facing = [Math.sin(spot.yaw), Math.cos(spot.yaw)];
    const carRight = [-Math.cos(carYaw), Math.sin(carYaw)];
    expect(facing[0], "facing the car's right, x").toBeCloseTo(carRight[0]!, 6);
    expect(facing[1], "facing the car's right, z").toBeCloseTo(carRight[1]!, 6);
    const out = [spot.x - CAR.x, spot.z - CAR.z];
    const carLeft = [Math.cos(carYaw), -Math.sin(carYaw)];
    const carFront = [Math.sin(carYaw), Math.cos(carYaw)];
    expect(out[0]! * carLeft[0]! + out[1]! * carLeft[1]!, "across the car").toBeCloseTo(SEAT_FRONT[0] + CAR_DOOR.outFromSeat, 6);
    expect(out[0]! * carFront[0]! + out[1]! * carFront[1]!, "along the car").toBeCloseTo(SEAT_FRONT[2] - CAR_DOOR.behindSeat, 6);
  });

  it("when she stands there, then her feet are on the ground and her seat top is the H-point's height less the hip's rise over it", () => {
    const spot = spotOf(0.7);
    expect(spot.feetY).toBeCloseTo(GROUND_Y, 6);
    expect(spot.surfaceY).toBeCloseTo(GROUND_Y + SEAT_FRONT[1] - CAR_DOOR.hipOverSeat, 6);
  });
});
