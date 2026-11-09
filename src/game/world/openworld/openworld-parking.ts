import { hypot2 } from "../../kernel/physics-core.js";
import { hash01 } from "../../kernel/scalar.ts";
import { blockOnRight, HEADING_COUNT, HEADING_DX, HEADING_DZ, HEADING_YAW, laneLength, rightX, rightZ, type RoadNetwork } from "./openworld-roads.ts";

/** One parked car per 6.0 m of kerb, and 6 m clear of a junction's box (a car's length of sight line at the corner). */
const PARKING_SPACE = 6;
const PARKING_CORNER_GAP = 6;
/** A share of the spaces stand empty, so a street is not a solid row of cars. */
const EMPTY_SPACE_SHARE = 0.3;
/** Seed of which spaces hold a car for good, fixed so every peer parks alike. */
const STAYING_CARS_SEED = 0x0b10c4;

/**
 * The kerb spaces of the open world, one list for everyone who parks: the course's dressing, the cars that park, the walkers who reach a car. A spot lies on the right-hand
 * parking lane of the lane out of junction `junction[i]` heading `heading[i]`, `along[i]` m from that junction's centre, and a car in it faces the lane's way.
 */
export type ParkingSpots = {
  count: number;
  x: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  junction: Int16Array;
  heading: Uint8Array;
  along: Float32Array;
  /** 1 where a car stands for good (a `PARKING_EMPTY_SHARE` of the spaces is left empty), 0 where the space is empty. */
  stays: Uint8Array;
  /** Lane `junction * HEADING_COUNT + heading` owns the spots `laneStart[lane] .. laneStart[lane + 1]`. */
  laneStart: Int32Array;
};

/** Spaces a lane's kerb holds: between the corner gaps beyond each junction's box, whole spaces only. */
function spaceCount(network: RoadNetwork, heading: number): number {
  const usable = laneLength(network, heading) - 2 * (network.boxHalf + PARKING_CORNER_GAP);
  return Math.max(0, Math.floor(usable / PARKING_SPACE));
}

/** Distance (m) from a junction's centre to the middle of the first space of a lane heading `heading`: the whole spaces centred between the corner gaps. */
function firstSpaceMiddle(network: RoadNetwork, heading: number): number {
  const usable = laneLength(network, heading) - 2 * (network.boxHalf + PARKING_CORNER_GAP);
  const slack = usable - spaceCount(network, heading) * PARKING_SPACE;
  return network.boxHalf + PARKING_CORNER_GAP + slack / 2 + PARKING_SPACE / 2;
}

export function buildParkingSpots(network: RoadNetwork): ParkingSpots {
  const lanes = network.junctionCount * HEADING_COUNT;
  const laneStart = new Int32Array(lanes + 1);
  let total = 0;
  for (let lane = 0; lane < lanes; lane++) {
    laneStart[lane] = total;
    const junction = Math.floor(lane / HEADING_COUNT);
    const heading = lane % HEADING_COUNT;
    if (network.neighbour[lane]! >= 0 && blockOnRight(network, junction, heading)) total += spaceCount(network, heading);
  }
  laneStart[lanes] = total;
  const spots: ParkingSpots = {
    count: total,
    x: new Float32Array(total),
    z: new Float32Array(total),
    yaw: new Float32Array(total),
    junction: new Int16Array(total),
    heading: new Uint8Array(total),
    along: new Float32Array(total),
    stays: new Uint8Array(total),
    laneStart,
  };
  for (let lane = 0; lane < lanes; lane++) {
    const junction = Math.floor(lane / HEADING_COUNT);
    const heading = lane % HEADING_COUNT;
    for (let spot = laneStart[lane]!; spot < laneStart[lane + 1]!; spot++) {
      const along = firstSpaceMiddle(network, heading) + (spot - laneStart[lane]!) * PARKING_SPACE;
      spots.x[spot] = network.junctionX[junction]! + HEADING_DX[heading]! * along + rightX(heading) * network.parkingOffset;
      spots.z[spot] = network.junctionZ[junction]! + HEADING_DZ[heading]! * along + rightZ(heading) * network.parkingOffset;
      spots.yaw[spot] = HEADING_YAW[heading]!;
      spots.junction[spot] = junction;
      spots.heading[spot] = heading;
      spots.along[spot] = along;
      spots.stays[spot] = hash01(spot, STAYING_CARS_SEED) < EMPTY_SPACE_SHARE ? 0 : 1;
    }
  }
  return spots;
}

/** The lane (`junction * HEADING_COUNT + heading`) a spot lies on. */
export function laneOfSpot(spots: ParkingSpots, spot: number): number {
  return spots.junction[spot]! * HEADING_COUNT + spots.heading[spot]!;
}

/** The nearest spot to (x, z) that is empty of both a standing car and `taken` (a per-spot 0/1 of cars that have claimed it); -1 when none is. Not for the per-frame path. */
export function nearestFreeSpot(spots: ParkingSpots, x: number, z: number, taken: Uint8Array): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let spot = 0; spot < spots.count; spot++) {
    if (spots.stays[spot] === 1 || taken[spot] === 1) continue;
    const distance = hypot2(spots.x[spot]! - x, spots.z[spot]! - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = spot;
  }
  return best;
}
