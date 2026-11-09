import { MAX_CARS } from "../../scenes/fleet.ts";
import type { DriveInput } from "../../vehicle/car-drive.ts";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildParkingSpots, nearestFreeSpot, type ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, type RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import type { Place } from "../../world/openworld/walk-graph.ts";
import { blankAiCar, type AiCar } from "../derby-ai.ts";
import { KerbCars } from "./kerb-cars.ts";
import { MoverFleet, type DrivenCar } from "./mover-fleet.ts";
import { RedLightWatch } from "./red-light-watch.ts";
import { FEED_SECONDS } from "./traffic-constants.ts";
import { TrafficDriver } from "./traffic-driver.ts";
import { lightPhase } from "./traffic-lights.ts";
import { RESIDENT_CAPACITY, STANDING, type TrafficCar, type TrafficContext, type TrafficPorts } from "./traffic-ports.ts";
import type { CommuterFeed, TrafficSight } from "./traffic-sight.ts";

export type { DrivenCar } from "./mover-fleet.ts";

/** What the free-roam lobby asks of whoever drives its cars: once a slice the cars as they are, then per car what it does (null: nobody drives it). */
export type FreeDrivers = {
  drive(cars: readonly TrafficCar[]): void;
  inputOf(id: number, dt: number): DriveInput | null;
};

/** Called (host and solo only) when car `carIndex` at (x, z) crosses a stop bar against its signal at crowd time `seconds`. */
type RedLightListener = (carIndex: number, x: number, z: number, seconds: number) => void;

/** How many cars of each kind the open world has (`MOVER_CARS`, `KERB_CARS`, `PATROL_CARS` by device); the patrol cars are the last of the movers. */
type TrafficSize = { movers: number; kerb: number; patrol: number };

/**
 * The open world's cars: real cars of the field that drive its streets (ambient traffic, residents' commutes, patrols), stop at the signals and park in the kerb spaces, and real cars that
 * stand at the kerb near the players. Host and solo only: the cars are sim cars, so a client gets them in the host's snapshots like every other. Pool ids follow the seated cars; a peer that takes one
 * of them takes the car.
 */
export class OpenWorldTraffic {
  readonly parkingSpots: ParkingSpots;
  readonly network: RoadNetwork;
  private readonly places: readonly Place[];
  private readonly feed: CommuterFeed | null;
  private readonly context: TrafficContext;
  private readonly movers: MoverFleet;
  private readonly kerb: KerbCars;
  private readonly watch: RedLightWatch;
  private readonly listeners: RedLightListener[] = [];
  private readonly legKey = new Float64Array(RESIDENT_CAPACITY).fill(-1);
  private readonly first: number;
  private readonly total: number;
  private sinceFeed = 0;

  constructor(places: readonly Place[], ports: TrafficPorts, sight: TrafficSight, size: TrafficSize, feed: CommuterFeed | null) {
    const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
    const spots = buildParkingSpots(network);
    this.network = network;
    this.parkingSpots = spots;
    this.places = places;
    this.feed = feed;
    let first = 1;
    for (let id = 1; id < ports.cars().length; id++) if (ports.seated(id)) first = id + 1;
    const movers = Math.min(size.movers, MAX_CARS - first);
    const kerb = Math.min(size.kerb, MAX_CARS - first - movers);
    const patrol = Math.min(size.patrol, movers);
    this.first = first;
    this.total = movers + kerb;
    ports.ensureCars(first + this.total);
    for (let id = first; id < first + this.total; id++) ports.putAway(id);
    const sightBase = sight.claim(this.total + 1);
    this.context = {
      network,
      spots,
      taken: new Uint8Array(spots.count),
      standing: new Uint8Array(spots.count),
      residentSpot: new Int32Array(RESIDENT_CAPACITY).fill(-1),
      ports,
      sight,
      movers,
      sightBase,
      probe: sightBase + this.total,
      snaps: Array.from({ length: MAX_CARS }, (_, id) => ({ ...blankAiCar(id), alive: false })),
    };
    this.refreshSnaps(ports.cars());
    this.watch = new RedLightWatch(network);
    this.movers = new MoverFleet(this.context, first, movers, patrol, new TrafficDriver(network));
    if (patrol > 0) ports.markPolice(first + movers - patrol, patrol);
    this.kerb = new KerbCars(this.context, first + movers, kerb);
  }

  /** The phase and stage junction `junction` shows at crowd time `seconds` (`lightPhase`). */
  lightPhase(junction: number, seconds: number): number {
    return lightPhase(junction, seconds);
  }

  /** Calls `listener` for every car that runs a red until the returned function is called. */
  onRedLightRun(listener: RedLightListener): () => void {
    this.listeners.push(listener);
    return () => {
      const at = this.listeners.indexOf(listener);
      if (at >= 0) this.listeners.splice(at, 1);
    };
  }

  /** Every car as the drivers read it, index = the engine's car index. */
  get snaps(): readonly AiCar[] {
    return this.context.snaps;
  }

  /** The lease handle of the car on a trip as engine car `carIndex`, else null: an owner may set its `driver` (a patrol stopping a car). */
  drivenCarAt(carIndex: number): DrivenCar | null {
    return this.movers.handleAt(carIndex);
  }

  /** The resident at the wheel of engine car `carIndex`; -1 for none, a kerb car or the player. */
  residentOf(carIndex: number): number {
    return this.movers.residentAt(carIndex);
  }

  /** Per space, 1 where a car that drives (or is on its way) holds it. */
  get claimedSpots(): Uint8Array {
    return this.context.taken;
  }

  /** The nearest kerb space to (x, z) no car holds. -1 when none is. */
  nearestSpot(x: number, z: number): number {
    return nearestFreeSpot(this.parkingSpots, x, z, this.context.taken);
  }

  /** Leases a car for `resident` (-1: none) to drive from space `fromSpot` to `toSpot`; null when no car is free or there is no way. `urgent`: ignores the signals, drives fast. */
  spawnDrivenCar(resident: number, fromSpot: number, toSpot: number, options?: { urgent?: boolean }): DrivenCar | null {
    const count = this.parkingSpots.count;
    if (fromSpot < 0 || fromSpot >= count || toSpot < 0 || toSpot >= count || fromSpot === toSpot) return null;
    if (this.context.standing[fromSpot] === STANDING.kerb) this.kerb.clearSpot(fromSpot);
    return this.movers.spawn(resident, fromSpot, toSpot, options?.urgent === true);
  }

  despawn(handle: DrivenCar): void {
    this.movers.despawn(handle);
  }

  /** Cars on a trip and kerb cars standing, for the cost probes. */
  counts(): { driving: number; kerb: number } {
    return { driving: this.movers.drivingCount(), kerb: this.kerb.shownCount() };
  }

  /** The cars go away: every pool car no human drives is put away. */
  dispose(): void {
    const { ports } = this.context;
    ports.markPolice(MAX_CARS, 0);
    for (let id = this.first; id < this.first + this.total; id++) {
      if (id < ports.cars().length && !ports.seated(id)) ports.putAway(id);
    }
  }

  /** A slice's start: every car as the drivers read it. */
  drive(cars: readonly TrafficCar[]): void {
    this.refreshSnaps(cars);
  }

  inputOf(id: number, dt: number): DriveInput | null {
    return this.movers.inputOf(id, dt);
  }

  /** A sim step at crowd time `seconds`: the cars' bookkeeping, the society's cars, and every car's crossing of a bar. */
  step(seconds: number, dt: number): void {
    const { ports } = this.context;
    if (ports.cars().length < this.first + this.total) ports.ensureCars(this.first + this.total);
    this.movers.step(seconds, dt);
    this.kerb.step(dt, this.feed === null ? null : this.feed.parked);
    this.sinceFeed += dt;
    if (this.feed !== null && this.sinceFeed >= FEED_SECONDS) {
      this.sinceFeed = 0;
      this.readFeed();
    }
    this.watchSignals(seconds);
  }

  private refreshSnaps(cars: readonly TrafficCar[]): void {
    const snaps = this.context.snaps;
    for (let id = 0; id < cars.length; id++) {
      const car = cars[id]!;
      const snap = snaps[id]!;
      snap.x = car.group.position.x;
      snap.z = car.group.position.z;
      snap.yaw = car.yaw;
      snap.vx = car.velocity.x;
      snap.vz = car.velocity.z;
      snap.alive = car.deform.drivetrainAlive;
      snap.crashed = car.crashed;
    }
  }

  private watchSignals(seconds: number): void {
    const cars = this.context.ports.cars();
    for (let id = 0; id < cars.length; id++) {
      const car = cars[id]!;
      if (car.stored || !car.group.visible) continue;
      const x = car.group.position.x;
      const z = car.group.position.z;
      if (!this.watch.observe(id, x, z, seconds)) continue;
      for (let at = 0; at < this.listeners.length; at++) this.listeners[at]!(id, x, z, seconds);
    }
  }

  /** The society's residents: those parked get their space, those newly on a drive leg get a car sent from their space to one near where they are going. */
  private readFeed(): void {
    const feed = this.feed!;
    const { residentSpot, taken, spots } = this.context;
    for (let index = 0; index < feed.parked.count; index++) {
      const resident = feed.parked.resident[index]!;
      if (resident >= 0 && resident < RESIDENT_CAPACITY && residentSpot[resident] === -1) residentSpot[resident] = this.claimNear(feed.parked.place[index]!);
    }
    for (let index = 0; index < feed.legs.count; index++) {
      const resident = feed.legs.resident[index]!;
      const due = feed.legs.arriveSeconds[index]!;
      if (resident < 0 || resident >= RESIDENT_CAPACITY || this.legKey[resident] === due || this.movers.hasTripFor(resident)) continue;
      if (residentSpot[resident] === -1) residentSpot[resident] = this.claimNear(feed.legs.fromPlace[index]!);
      const from = residentSpot[resident]!;
      const place = this.places[feed.legs.toPlace[index]!];
      if (from < 0 || place === undefined) continue;
      const to = nearestFreeSpot(spots, place.doorX, place.doorZ, taken);
      if (to < 0 || this.spawnDrivenCar(resident, from, to) === null) continue;
      this.legKey[resident] = due;
    }
  }

  /** Claims the space nearest the door of place `place` for a resident's car; -1 when none is free. */
  private claimNear(place: number): number {
    const target = this.places[place];
    if (target === undefined) return -1;
    const spot = nearestFreeSpot(this.parkingSpots, target.doorX, target.doorZ, this.context.taken);
    if (spot >= 0) this.context.taken[spot] = 1;
    return spot;
  }
}
