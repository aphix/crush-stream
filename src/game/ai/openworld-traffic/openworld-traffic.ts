import { hash01 } from "../../kernel/scalar.ts";
import { CAR_STYLES } from "../../vehicle/car-variants.ts";
import { carDoorSpot, type DoorSpot } from "../civilians/civilian-car-door.ts";
import { MAX_CARS } from "../../scenes/fleet.ts";
import type { DriveInput } from "../../vehicle/car-drive.ts";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildParkingSpots, driverDoorPoint, KERB_CANDIDATES, kerbSpotsNear, nearestFreeSpot, residentSpotAt, spotAt, type ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, type RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import type { Place } from "../../world/openworld/walk-graph.ts";
import { blankAiCar, type AiCar } from "../derby-ai.ts";
import { AMBULANCE, AmbulanceService } from "./ambulance.ts";
import { BodySwaps } from "./body-swaps.ts";
import { KerbCars } from "./kerb-cars.ts";
import { LEASE, MoverFleet, type DrivenCar } from "./mover-fleet.ts";
import { carPoseAtSpot, type ResidentCarPose } from "./traffic-look.ts";
import { RedLightWatch } from "./red-light-watch.ts";
import { EVERYDAY_BODIES, FEED_SECONDS, TRAFFIC_SEED } from "./traffic-constants.ts";
import { TrafficDriver } from "./traffic-driver.ts";
import { lightPhase } from "./traffic-lights.ts";
import { CARLESS, heldByHuman, RESIDENT_CAPACITY, STANDING, type TrafficCar, type TrafficContext, type TrafficPorts } from "./traffic-ports.ts";
import type { CommuterFeed, PeopleField, TrafficSight } from "./traffic-sight.ts";

export type { DrivenCar } from "./mover-fleet.ts";

/** What the free-roam lobby asks of whoever drives its cars: once a slice the cars as they are, then per car what it does (null: nobody drives it). */
export type FreeDrivers = {
  drive(cars: readonly TrafficCar[]): void;
  inputOf(id: number, dt: number): DriveInput | null;
  /** Car `id` is theirs to place and put away: the lobby never stands it on its spawn, nor wakes it. */
  owns(id: number): boolean;
};

/** Called (host and solo only) when car `carIndex` at (x, z) crosses a stop bar against its signal at crowd time `seconds`. */
type RedLightListener = (carIndex: number, x: number, z: number, seconds: number) => void;

/** How many cars of each kind the open world has (`MOVER_CARS`, `KERB_CARS`, `PATROL_CARS`, `AMBULANCE_CARS` by device); the patrol cars are the last of the movers, the ambulances just before them. */
type TrafficSize = { movers: number; kerb: number; patrol: number; ambulance: number };

/** Crowd seconds a clip holds the kerb car brought for it: the clip's 2.5 s and the walk off. */
const CLIP_HOLD_SECONDS = 4;

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
  private readonly driver: TrafficDriver;
  private readonly ambulance: AmbulanceService;
  private readonly listeners: RedLightListener[] = [];
  private readonly legKey = new Float64Array(RESIDENT_CAPACITY).fill(-1);
  private readonly candidates = new Int32Array(KERB_CANDIDATES);
  private readonly first: number;
  private readonly total: number;
  /** The ids of the patrol cruisers, `patrolFrom` up to `patrolEnd`. */
  private readonly patrolFrom: number;
  private readonly patrolEnd: number;
  /** How many pool cars the law may lease. */
  readonly patrolPool: number;
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
    const ambulance = Math.min(size.ambulance, movers - patrol);
    this.patrolPool = patrol;
    this.first = first;
    this.total = movers + kerb;
    ports.ensureCars(first + this.total);
    this.patrolFrom = first + movers - patrol - ambulance;
    this.patrolEnd = first + movers;
    if (patrol + ambulance > 0) ports.markPolice(this.patrolFrom, patrol + ambulance);
    this.wearEverydayBodies(ports);
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
      swaps: new BodySwaps(),
      humans: new Uint8Array(MAX_CARS),
      movers,
      sightBase,
      probe: sightBase + this.total,
      snaps: Array.from({ length: MAX_CARS }, (_, id) => ({ ...blankAiCar(id), alive: false })),
    };
    this.refreshSnaps(ports.cars());
    this.watch = new RedLightWatch(network);
    this.driver = new TrafficDriver(network);
    this.movers = new MoverFleet(this.context, first, movers, patrol, ambulance, this.driver);
    this.ambulance = new AmbulanceService(this.context, this.movers);
    this.kerb = new KerbCars(this.context, first + movers, kerb);
  }

  /** The people on the streets (the crowd's poses): every car stops for one on its way, at a crossing or in the lane; null: none are known. */
  setPeople(people: PeopleField | null): void {
    this.driver.people = people;
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

  /** Sends the ambulance to the free space nearest (x, z) for `victim` (-1: unknown), or queues the call when one is out (`AmbulanceService`); false when the pool has none, there is no way or the queue is full. */
  callAmbulance(x: number, z: number, seconds: number, victim = -1): boolean {
    return this.ambulance.call(x, z, seconds, victim);
  }

  /** Where the call the ambulance is out on was for (x, z: where the one run down lies) into `out`; false while none is out. */
  ambulanceScene(out: { x: number; z: number }): boolean {
    if (this.ambulance.state === AMBULANCE.idle) return false;
    out.x = this.ambulance.sceneX;
    out.z = this.ambulance.sceneZ;
    return true;
  }

  /** `listener` hears the victim (-1: unknown) of each call when the ambulance has loaded and leaves; one listener (the engine's). */
  onAmbulanceLoaded(listener: ((victim: number) => void) | null): void {
    this.ambulance.onLoaded = listener;
  }

  /** Whether an ambulance is out, and where (`AMBULANCE`): idle, on its way, loading at the scene, driving off. */
  ambulanceState(): number {
    return this.ambulance.state;
  }

  /** The engine's index of the ambulance's car, -1 when none is out. */
  ambulanceCar(): number {
    return this.ambulance.carIndex;
  }

  /** The space the ambulance is at or coming to, -1 when none is out. */
  ambulanceSpot(): number {
    return this.ambulance.scene;
  }

  /** Where resident `resident`'s parked car stands and which way it faces (the space's middle), the ground there and his car's body, into `out`; false when his car is not at a space. */
  carPoseOf(resident: number, out: ResidentCarPose): boolean {
    const spot = resident >= 0 && resident < RESIDENT_CAPACITY ? this.context.residentSpot[resident]! : -1;
    if (spot < 0) return false;
    carPoseAtSpot(this.parkingSpots, spot, resident, this.context.ports.groundAt, out);
    return true;
  }

  /** Opens the driver's door of resident `resident`'s parked car `radians` (0 shuts and latches it); false when no car of his stands in view of the pool. */
  setCarDoor(resident: number, radians: number): boolean {
    const id = this.carIdOf(resident);
    if (id < 0) return false;
    this.context.ports.openDoor(id, radians);
    return true;
  }

  /** Whether resident `resident`'s car stands at the kerb space at (x, z, yaw) for a get-in or get-out clip drawn now: one the traffic holds as hers there, or a kerb car brought to that space if it is empty, hers to take and unseen (`KerbCars.bring`). False: the clip is not drawn. */
  carForClip(resident: number, x: number, z: number, yaw: number, eyeX: number, eyeZ: number): boolean {
    const { residentSpot, taken } = this.context;
    const spot = spotAt(this.parkingSpots, x, z, yaw);
    if (spot < 0 || resident < 0 || resident >= RESIDENT_CAPACITY) return false;
    const own = residentSpot[resident]!;
    if (own === spot && this.carIdOf(resident) >= 0) return true;
    if (own !== spot && (own === -1 ? taken[spot] === 1 : !this.takeSpot(resident, own, spot))) return false;
    if (this.movers.hasTripFor(resident)) return false;
    if (!this.kerb.bring(spot, resident, eyeX, eyeZ, CLIP_HOLD_SECONDS)) return false;
    residentSpot[resident] = spot;
    taken[spot] = 1;
    return true;
  }

  /** Resident `resident`'s claim moves from `own` to `spot`, the space the brain puts her car in: a free space is taken, a space another resident's claim holds is swapped for `own`. Only while no car stands at either, so nothing visibly moves; false otherwise or when `spot` is a trip's reservation. */
  private takeSpot(resident: number, own: number, spot: number): boolean {
    const { residentSpot, standing, taken } = this.context;
    if (standing[own] !== STANDING.none || standing[spot] !== STANDING.none) return false;
    if (taken[spot] === 1) {
      let holder = -1;
      for (let other = 0; other < RESIDENT_CAPACITY && holder < 0; other++) if (residentSpot[other] === spot) holder = other;
      if (holder < 0) return false;
      residentSpot[holder] = own;
    } else taken[own] = 0;
    residentSpot[resident] = spot;
    taken[spot] = 1;
    return true;
  }

  /** The engine id of the pool car standing in resident `resident`'s space (a kerb car, else the mover parked for him), -1 when none does. */
  private carIdOf(resident: number): number {
    const spot = resident >= 0 && resident < RESIDENT_CAPACITY ? this.context.residentSpot[resident]! : -1;
    if (spot < 0) return -1;
    return this.kerb.carAt(spot) >= 0 ? this.kerb.carAt(spot) : this.movers.carOf(resident);
  }

  /** Where resident `resident` gets out of (and in to) the car he parked, into `out`: its driver's door. False when his car is not at a space. */
  driverDoorOf(resident: number, out: { x: number; z: number }): boolean {
    const spot = resident >= 0 && resident < RESIDENT_CAPACITY ? this.context.residentSpot[resident]! : -1;
    if (spot < 0) return false;
    driverDoorPoint(this.parkingSpots, spot, out);
    return true;
  }

  /** Where a person at the driver's door of car `carIndex` stands as it stands now, into `out`; false for a car that is not in the field. */
  driverDoorSpotOf(carIndex: number, out: DoorSpot): boolean {
    const { ports } = this.context;
    const car = ports.cars()[carIndex];
    if (car === undefined || car.stored) return false;
    carDoorSpot(car.group.position.x, car.group.position.z, car.yaw, ports.groundAt(car.group.position.x, car.group.position.z), CAR_STYLES[car.style.id].seats.front, out);
    out.feetY = ports.groundAt(out.x, out.z);
    return true;
  }

  /** Opens the driver's door of car `carIndex` `radians` (0 shuts it). */
  openDriverDoor(carIndex: number, radians: number): void {
    this.context.ports.openDoor(carIndex, radians);
  }

  /** The nearest kerb space to (x, z) no car holds. -1 when none is. */
  nearestSpot(x: number, z: number): number {
    return nearestFreeSpot(this.parkingSpots, x, z, this.context.taken);
  }

  /**
   * Leases a car for `resident` (-1: none) to drive from space `fromSpot` to `toSpot`; null when no car is free or there is no way. `urgent`: ignores the signals, drives fast. `dueSeconds`: the crowd second
   * the rider is due at the other end; a car still on its way then, with no eye on it, is stood in its space.
   */
  spawnDrivenCar(resident: number, fromSpot: number, toSpot: number, options?: { urgent?: boolean; ambulance?: boolean; dueSeconds?: number }): DrivenCar | null {
    const count = this.parkingSpots.count;
    if (fromSpot < 0 || fromSpot >= count || toSpot < 0 || toSpot >= count || fromSpot === toSpot) return null;
    if (this.context.standing[fromSpot] === STANDING.kerb) this.kerb.clearSpot(fromSpot);
    const kind = options?.ambulance === true ? LEASE.ambulance : options?.urgent === true ? LEASE.patrol : LEASE.ambient;
    return this.movers.spawn(resident, fromSpot, toSpot, kind, options?.dueSeconds ?? Infinity);
  }

  despawn(handle: DrivenCar): void {
    this.movers.despawn(handle);
  }

  /** Patrol car `chaserIndex` is after traffic car `carIndex`: the driver runs as a racer evades a cop (`MoverFleet.evade`) once it notices, until `endEvade`. False for a car that is not on a trip of traffic's. */
  evade(carIndex: number, chaserIndex: number): boolean {
    return this.movers.evade(carIndex, chaserIndex);
  }

  /** The chase of traffic car `carIndex` is over: it drives as traffic again. */
  endEvade(carIndex: number): void {
    this.movers.endEvade(carIndex);
  }

  /** Whether traffic car `carIndex` runs from a chaser now. */
  isFleeing(carIndex: number): boolean {
    return this.movers.isFleeing(carIndex);
  }

  /** Sends leased car `handle` on to free space `toSpot` from where it is, keeping its urgency (`MoverFleet.redirect`); false when there is no way or the space is held. */
  redirect(handle: DrivenCar, toSpot: number): boolean {
    return this.movers.redirect(handle, toSpot);
  }

  /** Cars on a trip and kerb cars standing, for the cost probes. */
  counts(): { driving: number; kerb: number } {
    return { driving: this.movers.drivingCount(), kerb: this.kerb.shownCount() };
  }

  /** The cars go away: every pool car no human drives is put away. */
  dispose(): void {
    const { ports, sight, sightBase } = this.context;
    sight.release(sightBase, this.total + 1);
    ports.markPolice(MAX_CARS, 0);
    for (let id = this.first; id < this.first + this.total; id++) {
      if (id >= ports.cars().length || ports.seated(id)) continue;
      ports.sirens(id, false);
      ports.putAway(id);
      ports.release(id);
    }
  }

  /** A slice's start: every car as the drivers read it. */
  drive(cars: readonly TrafficCar[]): void {
    this.refreshSnaps(cars);
  }

  inputOf(id: number, dt: number): DriveInput | null {
    return this.movers.inputOf(id, dt);
  }

  owns(id: number): boolean {
    return id >= this.first && id < this.first + this.total && !heldByHuman(this.context, id);
  }

  /** Car `id` has nobody in it: a car nobody sits in that is before the pool or the player took, one whose driver was thrown out, a pool car parked at a space, a kerb car; never one on a trip. */
  isEmptyCar(id: number): boolean {
    const car = this.context.ports.cars()[id];
    if (car === undefined || this.context.ports.seated(id)) return false;
    if (id < this.first || this.context.humans[id] === 1 || car.driverOut !== null) return true;
    return this.movers.isParked(id) || this.kerb.holds(id);
  }

  /**
   * The player takes car `id` for good (he gets into it from the street): traffic never drives, stores or paints it again, the space it stood in is free, and the resident whose car it was has no car: his trips
   * are walks no more than a hidden drive, and none is claimed for him. Returns that resident, -1 for none.
   */
  takeCar(id: number): number {
    const { humans, residentSpot } = this.context;
    if (id < 0 || id >= MAX_CARS || humans[id] === 1) return -1;
    const spot = this.movers.spotOf(id) >= 0 ? this.movers.spotOf(id) : this.kerb.spotOf(id);
    humans[id] = 1;
    let owner = -1;
    for (let resident = 0; spot >= 0 && resident < RESIDENT_CAPACITY; resident++) {
      if (residentSpot[resident] !== spot) continue;
      residentSpot[resident] = CARLESS;
      owner = resident;
    }
    if (owner >= 0) this.context.taken[spot] = 0;
    return owner;
  }

  /** A sim step at crowd time `seconds`: the cars' bookkeeping, the society's cars, and every car's crossing of a bar. */
  step(seconds: number, dt: number): void {
    const { ports } = this.context;
    if (ports.cars().length < this.first + this.total) {
      ports.ensureCars(this.first + this.total);
      this.wearEverydayBodies(ports);
    }
    this.movers.step(seconds, dt);
    this.ambulance.step(seconds);
    this.kerb.step(seconds, dt, this.feed === null ? null : this.feed.parked);
    this.sinceFeed += dt;
    if (this.feed !== null && this.sinceFeed >= FEED_SECONDS) {
      this.sinceFeed = 0;
      this.readFeed();
    }
    this.watchSignals(seconds);
  }

  /** Every pool car but the patrol cruisers (the last `patrol` of the movers) wears an everyday body: one it already wears is kept, a coupe or monster slot's is rebuilt as a seeded pick of `EVERYDAY_BODIES`. `ports` is passed in: the constructor calls this before `context` exists. */
  private wearEverydayBodies(ports: TrafficPorts): void {
    for (let id = this.first; id < this.first + this.total; id++) {
      if (id >= this.patrolFrom && id < this.patrolEnd) continue;
      const style = ports.cars()[id]!.style.id;
      if (!EVERYDAY_BODIES.includes(style)) ports.setBody(id, EVERYDAY_BODIES[Math.floor(hash01(id, TRAFFIC_SEED) * EVERYDAY_BODIES.length)]!);
    }
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
    const { residentSpot } = this.context;
    for (let index = 0; index < feed.parked.count; index++) {
      const resident = feed.parked.resident[index]!;
      if (resident >= 0 && resident < RESIDENT_CAPACITY && residentSpot[resident] === -1) residentSpot[resident] = this.claimFor(resident, feed.parked.place[index]!);
    }
    for (let index = 0; index < feed.legs.count; index++) {
      const resident = feed.legs.resident[index]!;
      const due = feed.legs.arriveSeconds[index]!;
      if (resident < 0 || resident >= RESIDENT_CAPACITY || this.legKey[resident] === due || this.movers.hasTripFor(resident)) continue;
      if (residentSpot[resident] === -1) residentSpot[resident] = this.claimFor(resident, feed.legs.fromPlace[index]!);
      const from = residentSpot[resident]!;
      if (from < 0) continue;
      const to = this.spotFor(resident, feed.legs.toPlace[index]!, from);
      if (to < 0 || this.spawnDrivenCar(resident, from, to, { dueSeconds: due }) === null) continue;
      this.legKey[resident] = due;
    }
  }

  /**
   * The free space resident `resident`'s car takes at place `place` (not `except`): of the four empty spaces nearest its door, the one he is by number, else the next; the nearest free one when all four are held. Pure in the layout while
   * they are free, so a society that wants the same space asks `kerbSpotsNear` and counts the same way. -1 when none is.
   */
  private spotFor(resident: number, place: number, except: number): number {
    const target = this.places[place];
    if (target === undefined) return -1;
    const { taken } = this.context;
    const preferred = residentSpotAt(this.parkingSpots, target.doorX, target.doorZ, resident);
    if (preferred >= 0 && taken[preferred] === 0 && preferred !== except) return preferred;
    const count = kerbSpotsNear(this.parkingSpots, target.doorX, target.doorZ, this.candidates);
    for (let step = 0; step < count; step++) {
      const spot = this.candidates[(resident + step) % count]!;
      if (taken[spot] === 0 && spot !== except) return spot;
    }
    return nearestFreeSpot(this.parkingSpots, target.doorX, target.doorZ, taken);
  }

  /** Claims the space `spotFor` finds for a resident's car; -1 when none is free. */
  private claimFor(resident: number, place: number): number {
    const spot = this.spotFor(resident, place, -1);
    if (spot >= 0) this.context.taken[spot] = 1;
    return spot;
  }
}
