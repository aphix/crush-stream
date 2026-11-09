import { hypot2 } from "../../kernel/physics-core.js";
import { hash01, wrapPi } from "../../kernel/scalar.ts";
import { blockOnRight, HEADING_COUNT, HEADING_DX, HEADING_DZ, HEADING_YAW, laneLength, rightX, rightZ, type RoadNetwork } from "./openworld-roads.ts";

/** One parked car per 6.0 m of kerb, and 6 m clear of a junction's box (a car's length of sight line at the corner). */
const PARKING_SPACE = 6;
const PARKING_CORNER_GAP = 6;
/** A share of the spaces stand empty, so a street is not a solid row of cars. */
const EMPTY_SPACE_SHARE = 0.3;
/** Seed of which spaces hold a car for good, fixed so every peer parks alike. */
const STAYING_CARS_SEED = 0x0b10c4;

/** A car standing within this far (m) of a space's middle, facing within `SPOT_YAW_REACH` of its way, stands in it. */
const SPOT_REACH = 1.5;
const SPOT_YAW_REACH = 0.4;
/** Cell side (m) of the lookup grid: one space, so a car's space is among the 9 cells round it. */
const GRID_CELL = PARKING_SPACE;
/** The empty spaces `kerbSpotsNear` offers: a resident's car takes one of the nearest four to a door, by who he is. */
export const KERB_CANDIDATES = 4;
/** The driver's door: this far (m) out from the car's centre line on the street side, and this far ahead of its middle (the front seat). */
const DRIVER_DOOR_SIDE = 1.25;
const DRIVER_DOOR_AHEAD = 0.5;

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
  /** The lookup grid (`spotAt`): cells of `GRID_CELL` m from (`gridX`, `gridZ`), `gridColumns` by `gridRows`; cell `c` holds the spots `cellSpots[cellStart[c] .. cellStart[c + 1]]`. */
  gridX: number;
  gridZ: number;
  gridColumns: number;
  gridRows: number;
  cellStart: Int32Array;
  cellSpots: Int32Array;
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
    gridX: 0,
    gridZ: 0,
    gridColumns: 0,
    gridRows: 0,
    cellStart: new Int32Array(0),
    cellSpots: new Int32Array(0),
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
  buildGrid(spots);
  return spots;
}

/** Fills the lookup grid of `spots` (every spot lies in one cell): counted, then laid out in cell order. */
function buildGrid(spots: ParkingSpots): void {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let spot = 0; spot < spots.count; spot++) {
    minX = Math.min(minX, spots.x[spot]!);
    minZ = Math.min(minZ, spots.z[spot]!);
    maxX = Math.max(maxX, spots.x[spot]!);
    maxZ = Math.max(maxZ, spots.z[spot]!);
  }
  spots.gridX = minX;
  spots.gridZ = minZ;
  spots.gridColumns = Math.floor((maxX - minX) / GRID_CELL) + 1;
  spots.gridRows = Math.floor((maxZ - minZ) / GRID_CELL) + 1;
  const cells = spots.gridColumns * spots.gridRows;
  spots.cellStart = new Int32Array(cells + 1);
  spots.cellSpots = new Int32Array(spots.count);
  const cellOf = new Int32Array(spots.count);
  for (let spot = 0; spot < spots.count; spot++) {
    cellOf[spot] = Math.floor((spots.z[spot]! - minZ) / GRID_CELL) * spots.gridColumns + Math.floor((spots.x[spot]! - minX) / GRID_CELL);
    spots.cellStart[cellOf[spot]! + 1]!++;
  }
  for (let cell = 0; cell < cells; cell++) spots.cellStart[cell + 1]! += spots.cellStart[cell]!;
  const fill = spots.cellStart.slice(0, cells);
  for (let spot = 0; spot < spots.count; spot++) spots.cellSpots[fill[cellOf[spot]!]!++] = spot;
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

/** The space a car at (x, z) facing `yaw` stands in (within `SPOT_REACH` of its middle, facing along it), -1 when it is in none. No allocation. */
export function spotAt(spots: ParkingSpots, x: number, z: number, yaw: number): number {
  const column = Math.floor((x - spots.gridX) / GRID_CELL);
  const row = Math.floor((z - spots.gridZ) / GRID_CELL);
  for (let cellRow = Math.max(0, row - 1); cellRow <= Math.min(spots.gridRows - 1, row + 1); cellRow++) {
    for (let cellColumn = Math.max(0, column - 1); cellColumn <= Math.min(spots.gridColumns - 1, column + 1); cellColumn++) {
      const cell = cellRow * spots.gridColumns + cellColumn;
      for (let at = spots.cellStart[cell]!; at < spots.cellStart[cell + 1]!; at++) {
        const spot = spots.cellSpots[at]!;
        if (hypot2(spots.x[spot]! - x, spots.z[spot]! - z) <= SPOT_REACH && Math.abs(wrapPi(yaw - spots.yaw[spot]!)) <= SPOT_YAW_REACH) return spot;
      }
    }
  }
  return -1;
}

const nearestDistance = new Float64Array(KERB_CANDIDATES);

/** The `KERB_CANDIDATES` empty spaces (no car stands there for good) nearest (x, z), nearest first, ties by index, into `out`; how many there are. Pure in the layout. */
export function kerbSpotsNear(spots: ParkingSpots, x: number, z: number, out: Int32Array): number {
  let found = 0;
  for (let spot = 0; spot < spots.count; spot++) {
    if (spots.stays[spot] === 1) continue;
    const distance = hypot2(spots.x[spot]! - x, spots.z[spot]! - z);
    let at = found;
    while (at > 0 && nearestDistance[at - 1]! > distance) at--;
    if (at >= KERB_CANDIDATES) continue;
    for (let move = Math.min(found, KERB_CANDIDATES - 1); move > at; move--) {
      nearestDistance[move] = nearestDistance[move - 1]!;
      out[move] = out[move - 1]!;
    }
    nearestDistance[at] = distance;
    out[at] = spot;
    found = Math.min(found + 1, KERB_CANDIDATES);
  }
  return found;
}

const residentNearest = new Int32Array(KERB_CANDIDATES);

/** The space resident `resident`'s car takes at a place whose door is at (doorX, doorZ): of the four empty spaces nearest it, the one he is by number (`resident % count`). -1 when there is none. Pure in the layout: the brain, the crowd's standing pose and traffic all count the same. */
export function residentSpotAt(spots: ParkingSpots, doorX: number, doorZ: number, resident: number): number {
  const count = kerbSpotsNear(spots, doorX, doorZ, residentNearest);
  return count === 0 ? -1 : residentNearest[resident % count]!;
}

/** Where the driver's door of a car standing in space `spot` is, into `out`: out from the car's centre line on the street side (its left), level with the front seat. */
export function driverDoorPoint(spots: ParkingSpots, spot: number, out: { x: number; z: number }): void {
  const heading = spots.heading[spot]!;
  out.x = spots.x[spot]! - rightX(heading) * DRIVER_DOOR_SIDE + HEADING_DX[heading]! * DRIVER_DOOR_AHEAD;
  out.z = spots.z[spot]! - rightZ(heading) * DRIVER_DOOR_SIDE + HEADING_DZ[heading]! * DRIVER_DOOR_AHEAD;
}
