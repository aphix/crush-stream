import { PREFAB } from "../constants.ts";
import { HEADING_COUNT, HEADING_DX, HEADING_DZ, HEADING_YAW, rightX, rightZ, type RoadNetwork } from "./openworld-roads.ts";

/**
 * The traffic lights' poles as solids a car meets. `present/traffic-lights.ts` draws them (a pole beside the curb at each stop bar, for every approach with a street behind it); here
 * the same spots stand an invisible box of the pole's size, as the stoops' and the shelters' solids do, so a car is stopped where a pole is drawn.
 */
export const SIGNAL_POLE = { fromCurb: 0.6, width: 0.18, poleHeight: 4.4 } as const;

/** A solid prop of the invisible wall's prefab: its middle, its yaw and its size (m) along the front, up and across. */
type SignalPoleProp = { prefab: typeof PREFAB.invisibleWall; x: number; z: number; yaw: number; size: [number, number, number] };

/** One solid pole for every approach of every junction that has a street behind it: at the stop bar, `boxHalf + fromCurb` to the right of the approach's line. */
export function signalPoleProps(network: RoadNetwork): SignalPoleProp[] {
  const props: SignalPoleProp[] = [];
  const out = network.boxHalf + SIGNAL_POLE.fromCurb;
  for (let junction = 0; junction < network.junctionCount; junction++) {
    for (let heading = 0; heading < HEADING_COUNT; heading++) {
      if (network.neighbour[junction * HEADING_COUNT + ((heading + 2) % HEADING_COUNT)]! < 0) continue;
      const baseX = network.junctionX[junction]! - HEADING_DX[heading]! * network.stopBar;
      const baseZ = network.junctionZ[junction]! - HEADING_DZ[heading]! * network.stopBar;
      props.push({ prefab: PREFAB.invisibleWall, x: baseX + rightX(heading) * out, z: baseZ + rightZ(heading) * out, yaw: HEADING_YAW[heading]! + Math.PI, size: [SIGNAL_POLE.width, SIGNAL_POLE.poleHeight, SIGNAL_POLE.width] });
    }
  }
  return props;
}
