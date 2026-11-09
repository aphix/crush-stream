import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { LAYOUT } from "./openworld-constants.ts";
import { openWorldGeometry } from "./openworld-layout.ts";
import { buildParkingSpots, driverDoorPoint, KERB_CANDIDATES, kerbSpotsNear, spotAt } from "./openworld-parking.ts";
import { buildRoadNetwork, HEADING, HEADING_COUNT, junctionIndex, laneLength } from "./openworld-roads.ts";

const geometry = openWorldGeometry(LAYOUT);
const network = buildRoadNetwork(geometry);
const spots = buildParkingSpots(network);

/** A space's lane heading as the unit step it faces, from its yaw (yaw 0 faces +z). */
function facing(spot: number): { x: number; z: number } {
  return { x: Math.sin(spots.yaw[spot]!), z: Math.cos(spots.yaw[spot]!) };
}

describe("given the open world's streets as a graph", () => {
  // mutation: sed -i 's/nextRow < 0 || nextRow >= junctionRows/nextRow < -1 || nextRow >= junctionRows/' src/game/world/openworld/openworld-roads.ts
  it("when the junctions are counted, then every street crossing of the 3 x 3 blocks is one and its neighbours are the next crossings along each street", () => {
    expect(network.junctionCount).toBe((LAYOUT.columns + 1) * (LAYOUT.rows + 1));
    const interior = junctionIndex(network, 1, 1);
    for (let heading = 0; heading < HEADING_COUNT; heading++) expect(network.neighbour[interior * HEADING_COUNT + heading]!, `heading ${heading}`).toBeGreaterThanOrEqual(0);
    const corner = junctionIndex(network, 0, 0);
    expect(network.neighbour[corner * HEADING_COUNT + HEADING.north]).toBe(-1);
    expect(network.neighbour[corner * HEADING_COUNT + HEADING.west]).toBe(-1);
    const east = network.neighbour[interior * HEADING_COUNT + HEADING.east]!;
    expect(hypot2(network.junctionX[east]! - network.junctionX[interior]!, network.junctionZ[east]! - network.junctionZ[interior]!)).toBeCloseTo(laneLength(network, HEADING.east), 3);
  });
});

describe("given the kerb spaces laid along the streets", () => {
  // mutation: sed -i 's/const PARKING_SPACE = 6;/const PARKING_SPACE = 3;/' src/game/world/openworld/openworld-parking.ts
  it("when two spaces are compared, then no two stand closer than a car's length and a gap (they never overlap)", () => {
    for (let a = 0; a < spots.count; a++) {
      for (let b = a + 1; b < spots.count; b++) expect(hypot2(spots.x[a]! - spots.x[b]!, spots.z[a]! - spots.z[b]!), `spaces ${a} and ${b}`).toBeGreaterThanOrEqual(5.99);
    }
  });

  // mutation: sed -i 's/if (heading === HEADING.west) return row > 0;/if (heading === HEADING.west) return true;/' src/game/world/openworld/openworld-roads.ts
  it("when every space is looked at, then a block stands on the kerb side of it, the car faces with the traffic and it is clear of the junction's box", () => {
    const west = geometry.streetX[0]!;
    const east = geometry.streetX[geometry.streetX.length - 1]!;
    const north = geometry.streetZ[0]!;
    const south = geometry.streetZ[geometry.streetZ.length - 1]!;
    const reach = geometry.sidewalk + 1;
    expect(spots.count).toBeGreaterThan(300);
    for (let spot = 0; spot < spots.count; spot++) {
      const face = facing(spot);
      const kerbX = spots.x[spot]! - face.z * reach;
      const kerbZ = spots.z[spot]! + face.x * reach;
      expect(kerbX > west && kerbX < east && kerbZ > north && kerbZ < south, `space ${spot}: nothing but the outer street's far side lies beside it`).toBe(true);
      const junction = spots.junction[spot]!;
      const box = network.boxHalf;
      for (let other = 0; other < network.junctionCount; other++) {
        const away = Math.max(Math.abs(spots.x[spot]! - network.junctionX[other]!), Math.abs(spots.z[spot]! - network.junctionZ[other]!));
        expect(away, `space ${spot} against junction ${other} (its own is ${junction})`).toBeGreaterThan(box + 5);
      }
    }
  });

  // mutation: sed -i 's/parkingOffset: boxHalf - geometry.parkingLane \/ 2,/parkingOffset: boxHalf,/' src/game/world/openworld/openworld-roads.ts
  it("when a space's car is read, then it stands where a travel lane's right-hand parking lane is (the lane it faces along, offset by the parking lane)", () => {
    for (let spot = 0; spot < spots.count; spot += 7) {
      const junction = spots.junction[spot]!;
      const face = facing(spot);
      const along = (spots.x[spot]! - network.junctionX[junction]!) * face.x + (spots.z[spot]! - network.junctionZ[junction]!) * face.z;
      const side = (spots.x[spot]! - network.junctionX[junction]!) * -face.z + (spots.z[spot]! - network.junctionZ[junction]!) * face.x;
      expect(along, `space ${spot} along`).toBeCloseTo(spots.along[spot]!, 3);
      expect(side, `space ${spot} side`).toBeCloseTo(network.parkingOffset, 3);
    }
  });
});

describe("given a car in the open world's streets", () => {
  const MIDDLE_SPOT = 40;

  // mutation: sed -i 's/Math.abs(wrapPi(yaw - spots.yaw\[spot\]!)) <= SPOT_YAW_REACH) return spot;/true) return spot;/' src/game/world/openworld/openworld-parking.ts
  it("when it stands in a space's middle facing the lane's way, then it is in that space; turned across it, or in the travel lane, then in none", () => {
    const spot = MIDDLE_SPOT;
    expect(spotAt(spots, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!), "in its space").toBe(spot);
    expect(spotAt(spots, spots.x[spot]! + 0.5, spots.z[spot]! + 0.5, spots.yaw[spot]! + 0.1), "nudged in it").toBe(spot);
    expect(spotAt(spots, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]! + Math.PI / 2), "across the space").toBe(-1);
    const toLane = network.parkingOffset - network.laneOffset;
    const leftX = Math.cos(spots.yaw[spot]!);
    const leftZ = -Math.sin(spots.yaw[spot]!);
    expect(spotAt(spots, spots.x[spot]! + leftX * toLane, spots.z[spot]! + leftZ * toLane, spots.yaw[spot]!), "in the travel lane beside it").toBe(-1);
  });

  // mutation: sed -i 's/    if (spots.stays\[spot\] === 1) continue;/    if (false) continue;/' src/game/world/openworld/openworld-parking.ts
  it("when the nearest empty spaces to a door are asked, then they are the four nearest, nearest first, none of them a space a car stands in for good", () => {
    const out = new Int32Array(KERB_CANDIDATES);
    const near = kerbSpotsNear(spots, 0, -45, out);
    expect(near).toBe(KERB_CANDIDATES);
    let last = -1;
    for (let at = 0; at < near; at++) {
      expect(spots.stays[out[at]!], `candidate ${at}`).toBe(0);
      const distance = hypot2(spots.x[out[at]!]! - 0, spots.z[out[at]!]! + 45);
      expect(distance, `candidate ${at} is no nearer than the one before`).toBeGreaterThanOrEqual(last);
      last = distance;
    }
    for (let spot = 0; spot < spots.count; spot++) {
      if (spots.stays[spot] === 1 || out.includes(spot)) continue;
      expect(hypot2(spots.x[spot]!, spots.z[spot]! + 45), `space ${spot} is no nearer than the fourth`).toBeGreaterThanOrEqual(last - 1e-9);
    }
  });

  // mutation: sed -i 's/spots.x\[spot\]! - rightX(heading) \* DRIVER_DOOR_SIDE/spots.x[spot]! + rightX(heading) * DRIVER_DOOR_SIDE/' src/game/world/openworld/openworld-parking.ts
  it("when the driver's door of a parked car is asked, then it is out from the car on the street side (left of its way), a car's half width and a hand off the body", () => {
    const door = { x: 0, z: 0 };
    for (let spot = 0; spot < spots.count; spot += 11) {
      driverDoorPoint(spots, spot, door);
      const forwardX = Math.sin(spots.yaw[spot]!);
      const forwardZ = Math.cos(spots.yaw[spot]!);
      const side = (door.x - spots.x[spot]!) * forwardZ - (door.z - spots.z[spot]!) * forwardX;
      const ahead = (door.x - spots.x[spot]!) * forwardX + (door.z - spots.z[spot]!) * forwardZ;
      expect(side, `space ${spot}: the door is to the car's left (positive: left of the way)`).toBeGreaterThan(1);
      expect(side, `space ${spot}: not far from the body`).toBeLessThan(1.6);
      expect(ahead, `space ${spot}: level with the front seat`).toBeGreaterThan(0);
    }
  });
});
