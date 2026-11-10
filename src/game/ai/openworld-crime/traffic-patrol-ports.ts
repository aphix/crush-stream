import { hypot2 } from "../../kernel/physics-core.js";
import type { AiCar } from "../derby-ai.ts";
import type { DoorSpot } from "../civilians/civilian-car-door.ts";
import { HOME_CARS, MAX_PATROL_CARS, PATROL_SLOTS, PATROL_START_DISTANCE } from "./crime-constants.ts";
import type { CarDriver } from "./patrol-cars.ts";

/** A car the traffic leased: its engine index and the driver slot the traffic applies when it is set (null: its own trip driver). */
export type LeasedCar = { readonly index: number; readonly arrived: boolean; driver: CarDriver | null };

/** What the law uses of the open world's traffic (`OpenWorldTraffic` has all of it). */
export type TrafficApi = {
  readonly parkingSpots: { readonly count: number; readonly x: ArrayLike<number>; readonly z: ArrayLike<number> };
  readonly snaps: readonly AiCar[];
  /** How many pool cars the law may lease. */
  readonly patrolPool: number;
  /** Where a person at the driver's door of car `carIndex` stands, into `out`; false for a car not in the field. */
  driverDoorSpotOf(carIndex: number, out: DoorSpot): boolean;
  openDriverDoor(carIndex: number, radians: number): void;
  nearestSpot(x: number, z: number): number;
  /** Calls `listener` for every car that runs a red light until the returned function is called. */
  onRedLightRun(listener: (carIndex: number, x: number, z: number, seconds: number) => void): () => void;
  spawnDrivenCar(resident: number, fromSpot: number, toSpot: number, options?: { urgent?: boolean }): LeasedCar | null;
  despawn(handle: LeasedCar): void;
  drivenCarAt(carIndex: number): LeasedCar | null;
  /** Traffic car `carIndex` runs from patrol car `chaserIndex` until `endEvade`; false for a car that is not on a street trip of the traffic's. */
  evade(carIndex: number, chaserIndex: number): boolean;
  endEvade(carIndex: number): void;
  /** Re-plans a leased car's trip along the streets from where it is to space `toSpot`; false (trip kept) when there is no way or the car is off the street. */
  redirect(handle: LeasedCar, toSpot: number): boolean;
  residentOf(carIndex: number): number;
};

/** The patrol cars' cars: leased from the traffic's pool as urgent trips from a space about `PATROL_START_DISTANCE` m from the scene to the space nearest it. */
export class TrafficPatrolPorts {
  private readonly traffic: TrafficApi;
  private readonly sirens: (carIndex: number, on: boolean) => void;
  private readonly leased: (LeasedCar | null)[] = Array.from({ length: PATROL_SLOTS }, () => null);

  /** `sirens` turns car `carIndex` of the engine's list's light bar on or off (a police body's). */
  constructor(traffic: TrafficApi, sirens: (carIndex: number, on: boolean) => void) {
    this.traffic = traffic;
    this.sirens = sirens;
  }

  /** Cars the foot cops may have of their own: the pool's cars past the ones a case calls. */
  get homeCars(): number {
    return Math.max(0, Math.min(HOME_CARS, this.traffic.patrolPool - MAX_PATROL_CARS));
  }

  doorSpot(handle: number, out: DoorSpot): boolean {
    return this.traffic.driverDoorSpotOf(this.leased[handle]!.index, out);
  }

  openDoor(handle: number, radians: number): void {
    this.traffic.openDriverDoor(this.leased[handle]!.index, radians);
  }

  lease(toX: number, toZ: number): number {
    const slot = this.leased.indexOf(null);
    const to = this.traffic.nearestSpot(toX, toZ);
    const from = this.startSpot(toX, toZ, to);
    if (slot < 0 || to < 0 || from < 0) return -1;
    const handle = this.traffic.spawnDrivenCar(-1, from, to, { urgent: true });
    if (handle === null) return -1;
    this.leased[slot] = handle;
    return slot;
  }

  arrived(handle: number): boolean {
    return this.leased[handle]!.arrived;
  }

  redirect(handle: number, toX: number, toZ: number): boolean {
    const to = this.traffic.nearestSpot(toX, toZ);
    return to >= 0 && this.traffic.redirect(this.leased[handle]!, to);
  }

  carIndex(handle: number): number {
    return this.leased[handle]!.index;
  }

  snap(handle: number): AiCar {
    return this.traffic.snaps[this.leased[handle]!.index]!;
  }

  setSirens(handle: number, on: boolean): void {
    this.sirens(this.leased[handle]!.index, on);
  }

  setDriver(handle: number, driver: CarDriver | null): void {
    this.leased[handle]!.driver = driver;
  }

  release(handle: number): void {
    this.traffic.despawn(this.leased[handle]!);
    this.leased[handle] = null;
  }

  carSnap(index: number): AiCar | null {
    return this.traffic.snaps[index] ?? null;
  }

  takeTraffic(index: number, driver: CarDriver | null): boolean {
    const handle = this.traffic.drivenCarAt(index);
    if (handle === null) return false;
    handle.driver = driver;
    return true;
  }

  evade(index: number, chaserHandle: number): boolean {
    return this.traffic.evade(index, this.leased[chaserHandle]!.index);
  }

  endEvade(index: number): void {
    this.traffic.endEvade(index);
  }

  driverOf(index: number): number {
    return this.traffic.residentOf(index);
  }

  /** The space whose distance from (x, z) is nearest `PATROL_START_DISTANCE`, other than `to`; the lower number on a tie. -1 with none. */
  private startSpot(x: number, z: number, to: number): number {
    const { parkingSpots } = this.traffic;
    let best = -1;
    let bestMiss = Infinity;
    for (let spot = 0; spot < parkingSpots.count; spot++) {
      const miss = Math.abs(hypot2(parkingSpots.x[spot]! - x, parkingSpots.z[spot]! - z) - PATROL_START_DISTANCE);
      if (spot === to || miss >= bestMiss) continue;
      bestMiss = miss;
      best = spot;
    }
    return best;
  }
}
