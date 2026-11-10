import { hypot2 } from "../../kernel/physics-core.js";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildRoadNetwork, type RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { CYCLE_SECONDS, LIGHT, lightState, SIGNAL_PHASE } from "../openworld-traffic/traffic-lights.ts";

/** Seconds between the moments a wait for a walk light is tried: a light changes on a half second at the finest. */
const WAIT_STEP_SECONDS = 0.5;

/** What the brain asks of a city's traffic lights: how long a walker at one kerb waits before it may cross. */
export interface PedestrianSignals {
  /** Seconds from crowd time \`seconds\` until a walker at (fromX, fromZ) may start across to (toX, toZ) and be over in \`crossingSeconds\` without a car having the green over it; 0 when it may go now. */
  waitSeconds(fromX: number, fromZ: number, toX: number, toZ: number, seconds: number, crossingSeconds: number): number;
}

/** The open world's traffic lights as the crossings see them: the walkers cross a street while the lamps of its cars are red, at the junction nearest the crossing (the law's `TrafficSignals` reads the same lamps to book those who do not). Pure in (place, crowd time): the same on every peer. */
class RoadSignals implements PedestrianSignals {
  private readonly network: RoadNetwork;

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  waitSeconds(fromX: number, fromZ: number, toX: number, toZ: number, seconds: number, crossingSeconds: number): number {
    const junction = this.nearestJunction((fromX + toX) / 2, (fromZ + toZ) / 2);
    if (junction < 0) return 0;
    // Walking along x crosses a north or south arm, whose cars run along z.
    const crossed = Math.abs(toX - fromX) >= Math.abs(toZ - fromZ) ? SIGNAL_PHASE.northSouthThrough : SIGNAL_PHASE.eastWestThrough;
    for (let wait = 0; wait < CYCLE_SECONDS; wait += WAIT_STEP_SECONDS) {
      if (!this.hasGreen(junction, crossed, seconds + wait) && !this.hasGreen(junction, crossed, seconds + wait + crossingSeconds)) return wait;
    }
    return 0;
  }

  private hasGreen(junction: number, crossed: number, seconds: number): boolean {
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

let shared: PedestrianSignals | null = null;

/** The open world's lights for its crossings, built once: the main thread's mirror and the worker's brain each make their own, from the same layout. */
export function openWorldSignals(): PedestrianSignals {
  shared ??= new RoadSignals(buildRoadNetwork(openWorldGeometry(LAYOUT)));
  return shared;
}
