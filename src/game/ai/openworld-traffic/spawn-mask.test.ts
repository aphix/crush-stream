import { describe, expect, it } from "vitest";
import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { spawnSeats } from "../../world/openworld/openworld-spawn.ts";
import { KERB_JITTER_SIDE } from "./traffic-constants.ts";
import { Clock, FakeField, makeTraffic, runSeconds } from "./traffic-world.test-util.ts";

/** Where a seat's driver steps out and how far from it another car's middle must stay (`doorSpot`, `CAR_CLEARANCE` in engine/onfoot-doors.ts). */
const DOOR_OUT_M = 1.75;
const DOOR_ALONG_M = 0.15;
const CAR_CLEARANCE_M = 2.6;
/** A parked car's half length and half width (m), generously: the longest style's box. */
const CAR_HALF_LENGTH_M = 2.45;
const CAR_HALF_WIDTH_M = 1;
/** The kerb pool of a desktop: the most cars it stands at once. */
const DESKTOP_KERB = 10;

const geometry = openWorldGeometry(LAYOUT);
const seats = spawnSeats(geometry);

/** The seats' doors' exit spots, both sides of every seat. */
const doorSpots = seats.flatMap((seat) => [1, -1].map((side) => ({ x: seat.x + side * DOOR_OUT_M * detCos(seat.yaw) + DOOR_ALONG_M * detSin(seat.yaw), z: seat.z - side * DOOR_OUT_M * detSin(seat.yaw) + DOOR_ALONG_M * detCos(seat.yaw) })));

/** A start seat's car and a parking space's car as boxes along an axis: whether they meet, the space's inflated by the kerb nudge. */
function carsMeet(seat: { x: number; z: number; yaw: number }, spaceX: number, spaceZ: number, spaceYaw: number): boolean {
  const seatAlongX = Math.abs(detSin(seat.yaw)) > 0.5;
  const spaceAlongX = Math.abs(detSin(spaceYaw)) > 0.5;
  const seatHalfX = seatAlongX ? CAR_HALF_LENGTH_M : CAR_HALF_WIDTH_M;
  const seatHalfZ = seatAlongX ? CAR_HALF_WIDTH_M : CAR_HALF_LENGTH_M;
  const spaceHalfX = (spaceAlongX ? CAR_HALF_LENGTH_M : CAR_HALF_WIDTH_M) + KERB_JITTER_SIDE;
  const spaceHalfZ = (spaceAlongX ? CAR_HALF_WIDTH_M : CAR_HALF_LENGTH_M) + KERB_JITTER_SIDE;
  return Math.abs(seat.x - spaceX) < seatHalfX + spaceHalfX && Math.abs(seat.z - spaceZ) < seatHalfZ + spaceHalfZ;
}

/** Whether a car in parking space `space` of `spots` would block a seat's door or touch a seat's car. */
function beside(spots: { x: Float32Array; z: Float32Array; yaw: Float32Array }, space: number): boolean {
  for (const door of doorSpots) if (hypot2(spots.x[space]! - door.x, spots.z[space]! - door.z) < CAR_CLEARANCE_M + KERB_JITTER_SIDE) return true;
  return seats.some((seat) => carsMeet(seat, spots.x[space]!, spots.z[space]!, spots.yaw[space]!));
}

describe("given the start seats and the open world's parking spaces", () => {
  it("when the spaces the kerb may use are read, then none lies within a door's clearance of any seat's door spot or meets a seat's car, and some spaces are masked", () => {
    const traffic = makeTraffic(new FakeField(), { movers: 0, kerb: DESKTOP_KERB });
    const spots = traffic.parkingSpots;
    const { taken } = traffic["context"];
    let masked = 0;
    for (let space = 0; space < spots.count; space++) {
      if (taken[space] === 1) {
        masked++;
        continue;
      }
      expect(beside(spots, space), `a car in space ${space} blocks a seat's door or touches its car`).toBe(false);
    }
    expect(masked, "spaces masked").toBe(traffic.maskedSpaces);
    expect(masked, "spaces masked: some, and only the few beside the formation").toBeGreaterThan(0);
    expect(masked, "spaces masked: only the few beside the formation").toBeLessThan(spots.count / 10);
  });

  it("when the player stands at seat 0 and the kerb's first passes have run, then cars stand in the nearby spaces and none stands in a masked one", () => {
    const field = new FakeField();
    const traffic = makeTraffic(field, { movers: 0, kerb: DESKTOP_KERB });
    field.cars[0]!.stand(seats[0]!.x, seats[0]!.z, seats[0]!.yaw);
    runSeconds(field, traffic, new Clock(), 4);
    const spots = traffic.parkingSpots;
    let standing = 0;
    for (let id = 1; id < field.cars.length; id++) {
      const car = field.cars[id]!;
      if (car.stored) continue;
      standing++;
      for (let space = 0; space < spots.count; space++) {
        if (!beside(spots, space)) continue;
        expect(hypot2(car.group.position.x - spots.x[space]!, car.group.position.z - spots.z[space]!), `car ${id} to masked space ${space} (m)`).toBeGreaterThan(KERB_JITTER_SIDE + 1);
      }
    }
    expect(standing, "kerb cars stand near the seats").toBeGreaterThan(DESKTOP_KERB / 2);
  });
});
