import type { Geometry } from "./openworld-layout.ts";

/** Ways a car travels, as indices into the tables below: yaw 0 is +z, so east is a quarter turn and a right turn is the next index. */
export const HEADING = { east: 0, south: 1, west: 2, north: 3 } as const;
export const HEADING_COUNT = 4;
export const HEADING_DX = [1, 0, -1, 0] as const;
export const HEADING_DZ = [0, 1, 0, -1] as const;
export const HEADING_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI] as const;

/** Zebra stripes span this far (m) either side of the sidewalk path's line along the street. */
const CROSSWALK_HALF_WIDTH = 1.5;
/** Gap (m) between a stop bar and the crosswalk's near edge. */
const STOP_BAR_CLEARANCE = 1;

/** Where the right-hand side of a car heading `heading` lies: the unit step to its right. */
export function rightX(heading: number): number {
  return -HEADING_DZ[heading]!;
}

export function rightZ(heading: number): number {
  return HEADING_DX[heading]!;
}

/** Whether `heading` runs along x (east or west). */
export function alongX(heading: number): boolean {
  return (heading & 1) === 0;
}

/**
 * The streets as a grid of junctions with a two-way carriageway between neighbours, traffic on the right. Every distance is measured from a street's centre line
 * (lanes) or from a junction's centre (stop bars, the box a turn crosses).
 */
export type RoadNetwork = {
  junctionColumns: number;
  junctionRows: number;
  junctionCount: number;
  junctionX: Float32Array;
  junctionZ: Float32Array;
  /** The junction reached from junction `j` heading `h` (`j * HEADING_COUNT + h`), -1 where the street ends at the playable edge. */
  neighbour: Int16Array;
  /** Centre to centre distance (m) between neighbours along x and along z. */
  pitchX: number;
  pitchZ: number;
  /** Half the carriageway: the box a turn crosses reaches this far from a junction's centre. */
  boxHalf: number;
  /** A travel lane's centre from the street's centre line, to the right of its direction. */
  laneOffset: number;
  /** A parking lane's centre from the street's centre line, to the right of its direction. */
  parkingOffset: number;
  /** How far a stop bar stands from the junction's centre, short of the crosswalk. */
  stopBar: number;
};

export function junctionIndex(network: RoadNetwork, column: number, row: number): number {
  return row * network.junctionColumns + column;
}

function junctionColumn(network: RoadNetwork, junction: number): number {
  return junction % network.junctionColumns;
}

function junctionRow(network: RoadNetwork, junction: number): number {
  return Math.floor(junction / network.junctionColumns);
}

/** The metres between neighbouring junctions heading `heading`. */
export function laneLength(network: RoadNetwork, heading: number): number {
  return alongX(heading) ? network.pitchX : network.pitchZ;
}

export function buildRoadNetwork(geometry: Geometry): RoadNetwork {
  const junctionColumns = geometry.streetX.length;
  const junctionRows = geometry.streetZ.length;
  const junctionCount = junctionColumns * junctionRows;
  const junctionX = new Float32Array(junctionCount);
  const junctionZ = new Float32Array(junctionCount);
  const neighbour = new Int16Array(junctionCount * HEADING_COUNT).fill(-1);
  for (let row = 0; row < junctionRows; row++) {
    for (let column = 0; column < junctionColumns; column++) {
      const junction = row * junctionColumns + column;
      junctionX[junction] = geometry.streetX[column]!;
      junctionZ[junction] = geometry.streetZ[row]!;
      for (let heading = 0; heading < HEADING_COUNT; heading++) {
        const nextColumn = column + HEADING_DX[heading]!;
        const nextRow = row + HEADING_DZ[heading]!;
        if (nextColumn < 0 || nextColumn >= junctionColumns || nextRow < 0 || nextRow >= junctionRows) continue;
        neighbour[junction * HEADING_COUNT + heading] = nextRow * junctionColumns + nextColumn;
      }
    }
  }
  const boxHalf = geometry.carriageway / 2;
  return {
    junctionColumns,
    junctionRows,
    junctionCount,
    junctionX,
    junctionZ,
    neighbour,
    pitchX: geometry.pitchX,
    pitchZ: geometry.pitchZ,
    boxHalf,
    laneOffset: geometry.travelLane / 2,
    parkingOffset: boxHalf - geometry.parkingLane / 2,
    stopBar: geometry.pathFromStreet + CROSSWALK_HALF_WIDTH + STOP_BAR_CLEARANCE,
  };
}

/** Whether a block lies on the right-hand side of lane `heading` out of junction `junction`: the outer streets have none on their outward side, so no one parks there. */
export function blockOnRight(network: RoadNetwork, junction: number, heading: number): boolean {
  const column = junctionColumn(network, junction);
  const row = junctionRow(network, junction);
  if (heading === HEADING.east) return row < network.junctionRows - 1;
  if (heading === HEADING.west) return row > 0;
  if (heading === HEADING.south) return column > 0;
  return column < network.junctionColumns - 1;
}
