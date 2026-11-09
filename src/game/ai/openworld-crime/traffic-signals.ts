import { hypot2 } from "../../kernel/physics-core.js";
import type { RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { LIGHT, lightState, SIGNAL_PHASE } from "../openworld-traffic/traffic-lights.ts";

/** The open world's traffic lights as the crossings obey them: a walker crosses against the signal while the cars of the street they cross have green (through or left), at the junction nearest them. Pure in (place, crowd time): the same on every peer. */
export class TrafficSignals {
  private readonly network: RoadNetwork;

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  againstSignal(x: number, z: number, dirX: number, dirZ: number, seconds: number): boolean {
    const junction = this.nearestJunction(x, z);
    if (junction < 0) return false;
    // Walking along x crosses a north or south arm, whose cars run along z.
    const crossed = Math.abs(dirX) >= Math.abs(dirZ) ? SIGNAL_PHASE.northSouthThrough : SIGNAL_PHASE.eastWestThrough;
    return lightState(junction, crossed, seconds) === LIGHT.green || lightState(junction, crossed + 1, seconds) === LIGHT.green;
  }

  /** The junction whose centre is nearest (x, z), the lower number on a tie; -1 with none. */
  private nearestJunction(x: number, z: number): number {
    const { junctionCount, junctionX, junctionZ } = this.network;
    let best = -1;
    let bestGap = Infinity;
    for (let junction = 0; junction < junctionCount; junction++) {
      const gap = hypot2(junctionX[junction]! - x, junctionZ[junction]! - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = junction;
    }
    return best;
  }
}
