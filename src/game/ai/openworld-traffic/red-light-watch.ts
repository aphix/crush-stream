import { MAX_CARS } from "../../scenes/fleet.ts";
import { HEADING_COUNT, HEADING_DX, HEADING_DZ, rightX, rightZ, type RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { hypot2 } from "../../kernel/physics-core.js";
import { RED_LIGHT_REARM_SECONDS, TELEPORT_METRES } from "./traffic-constants.ts";
import { LIGHT, lightState, phaseOfApproach } from "./traffic-lights.ts";

/** Whether a car crossed a stop bar against the signal: every car the same way, the player's and the traffic's, read from where it was and is, never from what drives it. */
export class RedLightWatch {
  private readonly network: RoadNetwork;
  private readonly lastX = new Float64Array(MAX_CARS);
  private readonly lastZ = new Float64Array(MAX_CARS);
  private readonly hasLast = new Uint8Array(MAX_CARS);
  private readonly quietUntil = new Float64Array(MAX_CARS);
  /** The junction of the last run `observe` reported. */
  lastJunction = -1;

  constructor(network: RoadNetwork) {
    this.network = network;
  }

  /** Car `id` is at (x, z) at crowd time `seconds`: whether it just crossed a bar on a red, at most once per `RED_LIGHT_REARM_SECONDS`. A left-turn arrow's green is not told apart from red for a car still short of its turn. */
  observe(id: number, x: number, z: number, seconds: number): boolean {
    const hadLast = this.hasLast[id] === 1;
    const lastX = this.lastX[id]!;
    const lastZ = this.lastZ[id]!;
    this.lastX[id] = x;
    this.lastZ[id] = z;
    this.hasLast[id] = 1;
    if (!hadLast || seconds < this.quietUntil[id]! || hypot2(x - lastX, z - lastZ) > TELEPORT_METRES) return false;
    const { network } = this;
    const junction = this.nearestJunction(x, z);
    if (junction < 0) return false;
    const centreX = network.junctionX[junction]!;
    const centreZ = network.junctionZ[junction]!;
    for (let heading = 0; heading < HEADING_COUNT; heading++) {
      const dx = HEADING_DX[heading]!;
      const dz = HEADING_DZ[heading]!;
      if (network.neighbour[junction * HEADING_COUNT + ((heading + 2) % HEADING_COUNT)]! < 0) continue;
      const before = (lastX - centreX) * dx + (lastZ - centreZ) * dz;
      const now = (x - centreX) * dx + (z - centreZ) * dz;
      if (before >= -network.stopBar || now < -network.stopBar) continue;
      const lateral = (x - centreX) * rightX(heading) + (z - centreZ) * rightZ(heading);
      if (lateral < 0 || lateral > network.boxHalf) continue;
      const through = phaseOfApproach(heading, false);
      if (lightState(junction, through, seconds) !== LIGHT.red || lightState(junction, through + 1, seconds) !== LIGHT.red) continue;
      this.quietUntil[id] = seconds + RED_LIGHT_REARM_SECONDS;
      this.lastJunction = junction;
      return true;
    }
    return false;
  }

  /** The junction whose bars (x, z) is within reach of, or -1. */
  private nearestJunction(x: number, z: number): number {
    const { network } = this;
    let column = 0;
    for (let index = 1; index < network.junctionColumns; index++) {
      if (Math.abs(network.junctionX[index]! - x) < Math.abs(network.junctionX[column]! - x)) column = index;
    }
    let row = 0;
    for (let index = 1; index < network.junctionRows; index++) {
      if (Math.abs(network.junctionZ[index * network.junctionColumns]! - z) < Math.abs(network.junctionZ[row * network.junctionColumns]! - z)) row = index;
    }
    const junction = row * network.junctionColumns + column;
    const reach = network.stopBar + 2;
    return Math.abs(network.junctionX[junction]! - x) < reach && Math.abs(network.junctionZ[junction]! - z) < reach ? junction : -1;
  }
}
