import { describe, expect, it } from "vitest";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { CAR_DOOR } from "../ai/civilians/civilian-car-door.ts";
import { NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { EVERYDAY_BODIES } from "../ai/openworld-traffic/traffic-constants.ts";
import { carPoseAtSpot, residentBody, residentCarPose, type ResidentCarPose } from "../ai/openworld-traffic/traffic-look.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildParkingSpots, KERB_CANDIDATES, kerbSpotsNear } from "../world/openworld/openworld-parking.ts";
import { buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import { carStandsNear, clientCarSpot, makeDriverDoors } from "./engine-openworld-doors.ts";

const spots = buildParkingSpots(buildRoadNetwork(openWorldGeometry(LAYOUT)));
const groundAt = (x: number, z: number): number => 0.01 * x + 0.02 * z;
/** Two doors far apart, each at a kerb space of the table, so each has spaces by it. */
const FIRST_DOOR = { doorX: spots.x[10]!, doorZ: spots.z[10]! };
const SECOND_DOOR = { doorX: spots.x[spots.count - 10]!, doorZ: spots.z[spots.count - 10]! };
const PLACES = [FIRST_DOOR, SECOND_DOOR];
const RESIDENTS = 30;
const OWNER = 3;
const HOUSEMATE = 5;
/** A door spot is within this of its car's middle: out from the H-point and back from it, plus the seat's own offset. */
const NEAR_CAR = 3;
const FAR_APART = 20;
const FLOAT_ERROR = 1e-3;

type Doors = { x: number; z: number; yaw: number; feetY: number; surfaceY: number };
const blankDoor = (): Doors => ({ x: 0, z: 0, yaw: 0, feetY: -1, surfaceY: -1 });
const blankCar = (): ResidentCarPose => ({ x: 0, z: 0, yaw: 0, groundY: 0, bodyStyle: "sedan" });

/** Rows for `RESIDENTS` residents: every one drives the car of its own number, `OWNER` has places 0 and 1 for the car before and after its trip, and `HOUSEMATE` rides in `OWNER`'s. */
function brain() {
  const ints = new Int32Array(RESIDENTS * RESIDENT_INT_STRIDE).fill(NO_PLACE);
  for (let resident = 0; resident < RESIDENTS; resident++) {
    ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner] = resident;
    ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carPlace] = 0;
    ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.carTo] = 1;
  }
  ints[HOUSEMATE * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner] = OWNER;
  return { ints };
}

describe("given residents with cars parked at two doors' kerbs", () => {
  const state = brain();
  const doors = makeDriverDoors(PLACES, state, spots, groundAt, () => true);

  it("when a resident is at her driver's door getting in or out, then she stands on its driver's side, out from the seat and behind it, facing the car, her feet on the ground there and her seat top over the car's ground", () => {
    for (const code of [ACTIVITY.carIn, ACTIVITY.carOut]) {
      for (let resident = 0; resident < RESIDENTS; resident++) {
        const door = blankDoor();
        expect(doors(resident, code, door), `resident ${resident} has a car`).toBe(true);
        const car = blankCar();
        const place = code === ACTIVITY.carIn ? FIRST_DOOR : SECOND_DOOR;
        const owner = resident === HOUSEMATE ? OWNER : resident;
        expect(residentCarPose(spots, place.doorX, place.doorZ, owner, groundAt, car), "the car's pose").toBe(true);
        const seat = CAR_STYLES[car.bodyStyle].seats.front;
        const carRightX = detCos(car.yaw);
        const carRightZ = -detSin(car.yaw);
        const carAheadX = detSin(car.yaw);
        const carAheadZ = detCos(car.yaw);
        const across = (door.x - car.x) * carRightX + (door.z - car.z) * carRightZ;
        const along = (door.x - car.x) * carAheadX + (door.z - car.z) * carAheadZ;
        expect(DRIVER_SIDE * across, `resident ${resident} across`).toBeCloseTo(seat[0] + CAR_DOOR.outFromSeat, 3);
        expect(along, `resident ${resident} along`).toBeCloseTo(seat[2] - CAR_DOOR.behindSeat, 3);
        const facingRight = detSin(door.yaw) * carRightX + detCos(door.yaw) * carRightZ;
        const facingAhead = detSin(door.yaw) * carAheadX + detCos(door.yaw) * carAheadZ;
        expect(facingRight, `resident ${resident} facing across the car`).toBeCloseTo(-DRIVER_SIDE, 3);
        expect(Math.abs(facingAhead), `resident ${resident} facing along the car`).toBeLessThan(FLOAT_ERROR);
        expect(door.feetY, `resident ${resident} feet`).toBeCloseTo(groundAt(door.x, door.z), 5);
        expect(door.surfaceY, `resident ${resident} seat top`).toBeCloseTo(car.groundY + seat[1] - CAR_DOOR.hipOverSeat, 5);
        expect(car.bodyStyle, "the car's body is the owner's").toBe(residentBody(owner));
      }
    }
  });

  it("when she gets in, then it is the car at the kerb it stood at before its trip; when she gets out, then the car at the kerb of the trip's end", () => {
    const into = blankDoor();
    const out = blankDoor();
    expect(doors(OWNER, ACTIVITY.carIn, into), "carIn").toBe(true);
    expect(doors(OWNER, ACTIVITY.carOut, out), "carOut").toBe(true);
    const before = blankCar();
    const after = blankCar();
    residentCarPose(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, OWNER, groundAt, before);
    residentCarPose(spots, SECOND_DOOR.doorX, SECOND_DOOR.doorZ, OWNER, groundAt, after);
    expect(hypot2(before.x - after.x, before.z - after.z), "the two kerbs' cars are apart").toBeGreaterThan(FAR_APART);
    expect(hypot2(into.x - before.x, into.z - before.z), "getting in, from the car at the first kerb").toBeLessThan(NEAR_CAR);
    expect(hypot2(out.x - after.x, out.z - after.z), "getting out, from the car at the second kerb").toBeLessThan(NEAR_CAR);
  });

  it("when the one at the door is a housemate, then it is the owner's car she is at, not her own", () => {
    const door = blankDoor();
    expect(doors(HOUSEMATE, ACTIVITY.carIn, door), "has the owner's car").toBe(true);
    const owners = blankCar();
    residentCarPose(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, OWNER, groundAt, owners);
    expect(hypot2(door.x - owners.x, door.z - owners.z), "from the owner's car").toBeLessThan(NEAR_CAR);
  });

  it("when she has no car, or the owner's car has no kerb, then no door spot is made", () => {
    const none = brain();
    none.ints[OWNER * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner] = NO_PLACE;
    expect(makeDriverDoors(PLACES, none, spots, groundAt, () => true)(OWNER, ACTIVITY.carIn, blankDoor()), "no car").toBe(false);
    const kerbless = brain();
    kerbless.ints[OWNER * RESIDENT_INT_STRIDE + RESIDENT_INT.carTo] = NO_PLACE;
    const door = makeDriverDoors(PLACES, kerbless, spots, groundAt, () => true);
    expect(door(OWNER, ACTIVITY.carOut, blankDoor()), "no kerb to get out at").toBe(false);
    expect(door(OWNER, ACTIVITY.carIn, blankDoor()), "the kerb before the trip is still there").toBe(true);
  });

  it("when her car does not stand at its kerb space, then no door spot is made; when it does, the spot is made, and the question was asked for her car's owner at the space's pose", () => {
    const pose = blankCar();
    residentCarPose(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, OWNER, groundAt, pose);
    const asked: number[][] = [];
    const there = (answer: boolean) => (owner: number, at: ResidentCarPose): boolean => {
      asked.push([owner, at.x, at.z, at.yaw]);
      return answer;
    };
    expect(makeDriverDoors(PLACES, brain(), spots, groundAt, there(false))(HOUSEMATE, ACTIVITY.carIn, blankDoor()), "no car: no clip").toBe(false);
    expect(makeDriverDoors(PLACES, brain(), spots, groundAt, there(true))(HOUSEMATE, ACTIVITY.carIn, blankDoor()), "her car is there: a clip").toBe(true);
    expect(asked, "asked twice").toHaveLength(2);
    for (const call of asked) {
      expect(call[0], "for the owner of the car she rides in").toBe(OWNER);
      expect(call[1], "at its space: x").toBe(pose.x);
      expect(call[2], "at its space: z").toBe(pose.z);
      expect(call[3], "at its space: yaw").toBe(pose.yaw);
    }
  });

  it("when the answer moves her car's pose to a space beside the brain's pick, then her door spot is at that car, not at the pick's", () => {
    const pick = blankCar();
    residentCarPose(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, OWNER, groundAt, pick);
    const near = new Int32Array(KERB_CANDIDATES);
    const count = kerbSpotsNear(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, near);
    const other = Array.from(near.subarray(0, count)).find((spot) => hypot2(spots.x[spot]! - pick.x, spots.z[spot]! - pick.z) > FLOAT_ERROR)!;
    const moved = (owner: number, at: ResidentCarPose): boolean => {
      carPoseAtSpot(spots, other, owner, groundAt, at);
      return true;
    };
    const door = blankDoor();
    expect(makeDriverDoors(PLACES, brain(), spots, groundAt, moved)(OWNER, ACTIVITY.carIn, door), "a clip").toBe(true);
    expect(hypot2(door.x - spots.x[other]!, door.z - spots.z[other]!), "she is at the car's door, past the car's middle by no more than a door's reach (m)").toBeLessThanOrEqual(NEAR_CAR);
    expect(hypot2(door.x - spots.x[other]!, door.z - spots.z[other]!), "nearer the moved car than the pick's").toBeLessThan(hypot2(door.x - pick.x, door.z - pick.z));
  });

  it("when the answer moves her car to a space that is not one of the four by her door, then no door spot is made", () => {
    const four = new Int32Array(KERB_CANDIDATES);
    const count = kerbSpotsNear(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, four);
    const outside = Array.from({ length: spots.count }, (_, spot) => spot).find((spot) => !four.subarray(0, count).includes(spot) && spots.stays[spot] !== 1)!;
    const there = (owner: number, at: ResidentCarPose): boolean => {
      carPoseAtSpot(spots, outside, owner, groundAt, at);
      return true;
    };
    expect(makeDriverDoors(PLACES, brain(), spots, groundAt, there)(OWNER, ACTIVITY.carIn, blankDoor()), "no clip").toBe(false);
  });
});

describe("given cars standing in a street", () => {
  it("when a space is asked about, then a car within 2.5 m of it stands there and one 3 m off does not", () => {
    const car = (x: number, z: number) => ({ group: { position: { x, z } } });
    expect(carStandsNear([car(40, 0), car(12, 0)], 10, 0), "2 m off").toBe(true);
    expect(carStandsNear([car(40, 0), car(13, 0)], 10, 0), "3 m off").toBe(false);
  });

  it("when a car stands 2 m off along z, then it stands there, and 40 m off along z it does not", () => {
    const car = (x: number, z: number) => ({ group: { position: { x, z } } });
    expect(carStandsNear([car(10, 2)], 10, 0), "2 m off along z").toBe(true);
    expect(carStandsNear([car(10, 40)], 10, 0), "40 m off along z").toBe(false);
  });
});

describe("given a client reading the host's cars, her car standing in a space beside the brain's pick", () => {
  const pick = blankCar();
  residentCarPose(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, OWNER, groundAt, pick);
  const near = new Int32Array(KERB_CANDIDATES);
  const nearCount = kerbSpotsNear(spots, FIRST_DOOR.doorX, FIRST_DOOR.doorZ, near);
  const pickSpot = Array.from(near.subarray(0, nearCount)).find((spot) => hypot2(spots.x[spot]! - pick.x, spots.z[spot]! - pick.z) < FLOAT_ERROR)!;
  const beside = Array.from(near.subarray(0, nearCount)).find((spot) => spot !== pickSpot)!;
  const hers = residentBody(OWNER);
  const another = EVERYDAY_BODIES.find((body) => body !== hers)!;
  type HostCar = { group: { position: { x: number; z: number } }; style: { id: typeof hers }; yaw: number; stored: boolean; velocity: { x: number; z: number } };
  /** A host car of body `body` standing in space `spot`. */
  const standing = (spot: number, body: typeof hers): HostCar => ({ group: { position: { x: spots.x[spot]!, z: spots.z[spot]! } }, style: { id: body }, yaw: spots.yaw[spot]!, stored: false, velocity: { x: 0, z: 0 } });
  const asked = (cars: HostCar[]): number => clientCarSpot(cars, spots, OWNER, FIRST_DOOR, { ...pick });

  it("when her car stands in the pick, then that is the space, whatever stands beside it", () => {
    expect(asked([standing(beside, another), standing(pickSpot, hers)]), "her car at the pick").toBe(pickSpot);
  });

  it("when another body stands in the pick and her car stands beside it, then the space is where her car stands", () => {
    expect(asked([standing(pickSpot, another), standing(beside, hers)]), "her car beside the pick").toBe(beside);
  });

  it("when only another body stands in the pick, then no clip is drawn", () => {
    expect(asked([standing(pickSpot, another)]), "no car of hers").toBe(-1);
  });

  it("when her body stands in a space that is not one of the four by the door, then no clip is drawn", () => {
    const elsewhere = Array.from({ length: spots.count }, (_, spot) => spot).find((spot) => !near.subarray(0, nearCount).includes(spot) && spots.stays[spot] !== 1)!;
    expect(asked([standing(pickSpot, another), standing(elsewhere, hers)]), "her car is not by the door").toBe(-1);
  });

  it("when a car of her body drives past a space by the door at speed, or is put away there, then it is not her car", () => {
    expect(asked([standing(pickSpot, another), { ...standing(beside, hers), velocity: { x: 9, z: 0 } }]), "driving past").toBe(-1);
    expect(asked([standing(pickSpot, another), { ...standing(beside, hers), stored: true }]), "put away").toBe(-1);
  });
});
