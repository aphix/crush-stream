import { hypot2 } from "../../kernel/physics-core.js";
import type { TrafficPorts } from "./traffic-ports.ts";

/** What traffic asks of the open world's sight field (`present/openworld-sight.ts`, which satisfies this shape; the ai layer cannot name it). */
export type TrafficSight = {
  /** Seconds a thing stays drawn after no eye saw it. */
  readonly hideGrace: number;
  /** Reserves `count` consecutive ids for this caller; returns the first. */
  claim(count: number): number;
  /** Whether any local eye sees a body of `radius` m at (x, z); stamps the id as seen when so. */
  observe(id: number, x: number, z: number, radius: number): boolean;
  /** Seconds since `id` was last seen (0 before it was ever observed). */
  unseenFor(id: number): number;
  reset(id: number): void;
  /** Whether a player's car is within `radius` m of (x, z). */
  near(x: number, z: number, radius: number): boolean;
};

/** Residents on a drive leg right now, filled by the society each tick: `count` entries of resident, the place they set out from, the place they drive to and the crowd second they are due there. */
export type DriveLegs = { count: number; resident: Int32Array; fromPlace: Int32Array; toPlace: Int32Array; arriveSeconds: Float64Array };

/** Residents' cars standing at a place's kerb (those not on a drive leg), filled by the society each tick. */
export type ParkedResidentCars = { count: number; resident: Int32Array; place: Int32Array };

/** What the society tells traffic of its residents' cars. */
export type CommuterFeed = { legs: DriveLegs; parked: ParkedResidentCars };

/** Sight when no field of view is known: no eye sees anything, and a player's car is near what lies within the radius of it. Stands in for the open world's sight field. */
export class ProximitySight {
  readonly hideGrace = 0;
  private claimed = 0;
  private readonly ports: TrafficPorts;

  constructor(ports: TrafficPorts) {
    this.ports = ports;
  }

  claim(count: number): number {
    const first = this.claimed;
    this.claimed += count;
    return first;
  }

  observe(): boolean {
    return false;
  }

  unseenFor(): number {
    return Infinity;
  }

  reset(): void {}

  near(x: number, z: number, radius: number): boolean {
    const cars = this.ports.cars();
    for (let id = 0; id < cars.length; id++) {
      if (!this.ports.seated(id)) continue;
      const car = cars[id]!;
      if (hypot2(car.group.position.x - x, car.group.position.z - z) < radius) return true;
    }
    return false;
  }
}
