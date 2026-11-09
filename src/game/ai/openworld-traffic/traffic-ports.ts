import { hypot2 } from "../../kernel/physics-core.js";
import type { DeformableCar } from "../../vehicle/car.ts";
import type { RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import type { ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import type { AiCar } from "../derby-ai.ts";
import { SIGHT_RADIUS, SPAWN_CLEAR } from "./traffic-constants.ts";
import type { TrafficSight } from "./traffic-sight.ts";

/** What traffic needs of the engine: the field's cars (index = car id) and a few things only it can do to one. */
export type TrafficPorts = {
  cars(): readonly DeformableCar[];
  /** Grows the field to at least `count` cars. */
  ensureCars(count: number): void;
  /** A human drives car `id` (this browser's player, or a peer). */
  seated(id: number): boolean;
  /** Stands `car` on (x, z) facing `yaw`, repaired and at rest, drawn and simulated. */
  place(car: DeformableCar, x: number, z: number, yaw: number): void;
  /** Puts `car` (id `id`) away: hidden, still, and not simulated. */
  putAway(car: DeformableCar, id: number): void;
};

/** What a space holds: nothing, a car that drives (parked for now), or a kerb car that only stands. */
export const STANDING = { none: 0, mover: 1, kerb: 2 } as const;

/** Most residents the open world's society has: the size of the per-resident tables. */
export const RESIDENT_CAPACITY = 1024;

/** What the parts of traffic share: the roads and spaces, which spaces a car has claimed (a per-space 0/1) and what stands in each, where each resident's car stands, the engine, the sight field and every car as the drivers see it. */
export type TrafficContext = {
  network: RoadNetwork;
  spots: ParkingSpots;
  taken: Uint8Array;
  standing: Uint8Array;
  residentSpot: Int32Array;
  ports: TrafficPorts;
  sight: TrafficSight;
  /** Cars that drive (the mover pool's size), the first sight id traffic claimed (movers, then kerb cars) and the one it tests spaces with. */
  movers: number;
  sightBase: number;
  probe: number;
  snaps: AiCar[];
};

/** Whether space `spot` is a place a car may appear: no player's car within `SPAWN_CLEAR` m of it and no eye sees it. */
export function spotUnseen(context: TrafficContext, spot: number): boolean {
  const { spots, sight } = context;
  const x = spots.x[spot]!;
  const z = spots.z[spot]!;
  for (let index = 0; index < context.snaps.length; index++) {
    const car = context.snaps[index]!;
    if (context.ports.seated(car.id) && hypot2(car.x - x, car.z - z) < SPAWN_CLEAR) return false;
  }
  return !sight.observe(context.probe, x, z, SIGHT_RADIUS);
}
