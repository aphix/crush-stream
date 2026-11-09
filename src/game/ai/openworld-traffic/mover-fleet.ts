import { hypot2 } from "../../kernel/physics-core.js";
import { hash01 } from "../../kernel/scalar.ts";
import type { DriveInput } from "../../vehicle/car-drive.ts";
import type { AiCar } from "../derby-ai.ts";
import type { CarStyleId } from "../../vehicle/car-variants.ts";
import { FLIPPED_UP_Y } from "../../vehicle/constants.ts";
import { carClass, classStats, type ClassStats } from "../../vehicle/vehicle-classes.ts";
import { HEADING_DX, HEADING_DZ, rightX, rightZ } from "../../world/openworld/openworld-roads.ts";
import { BOOKKEEPING_SECONDS, COMMUTER_HOLD_SECONDS, DWELL_SECONDS, KERB_KEEP, MIN_TRIP_METRES, PRIME_PASSES, PULL_OUT_CLEAR, SIGHT_RADIUS, STUCK_SECONDS, TOW_SECONDS, TRAFFIC_SEED } from "./traffic-constants.ts";
import { AMBULANCE_COLOUR } from "./traffic-constants.ts";
import { FLEE_FAR_METRES, FLEE_NOTICE_METRES, FLEE_REPLAN_METRES } from "./traffic-constants.ts";
import { TrafficDriver } from "./traffic-driver.ts";
import { residentBody, residentColour } from "./traffic-look.ts";
import { spotUnseen, STANDING, type TrafficCar, type TrafficContext, type TrafficPorts } from "./traffic-ports.ts";
import { RoutePlanner, TripRoute } from "./trip-route.ts";

/** A car taking a trip other than the ambient traffic's: its own driver may replace traffic's. */
type CarDriver = (self: AiCar, cars: readonly AiCar[], dt: number) => DriveInput;

/** What an owner holds of a car it leased from traffic (`MoverFleet.spawn`). */
export class DrivenCar {
  readonly index: number;
  /** Set to drive the car yourself (applied through the AI wheel); null hands it back to traffic's driver. */
  driver: CarDriver | null = null;
  /** The car has come to the space it was sent to and stands in it. */
  arrived = false;
  /** The car is not (or no longer) the owner's: not leased yet, towed, or a peer took its id. */
  lost = true;
  private readonly ports: TrafficPorts;

  constructor(index: number, ports: TrafficPorts) {
    this.index = index;
    this.ports = ports;
  }

  get car(): TrafficCar {
    return this.ports.cars()[this.index]!;
  }
}

const MOVER = { free: 0, parked: 1, driving: 2 } as const;
/** What a slot is leased as: ambient traffic and residents' cars (any slot but the last few), an ambulance, or a patrol cruiser. */
export const LEASE = { ambient: 0, ambulance: 1, patrol: 2 } as const;
type LeaseKind = (typeof LEASE)[keyof typeof LEASE];
const ROLE = { ambient: 0, commuter: 1, leased: 2 } as const;
/** No paint of its own choosing: the car stands as the fleet painted it. */
const NO_COLOUR = -1;
/** No resident: the car is nobody's. */
const NO_RESIDENT = -1;
/** Spaces tried when picking where a car goes: the whole list, from a seeded start. */
const SEED_STEP = 97;
/** A car crossing sideways of the lane within this far (m) of a spot's line is in the way of its pull-out. */
const LANE_WIDTH = 3;
/** A car slower than this (m/s) behind a spot does not hold up a pull-out. */
const MOVING_SPEED = 1;
/** A car this slow (m/s) while driving is standing. */
const STANDING_SPEED = 0.5;

function isWreck(car: TrafficCar): boolean {
  return car.driverOut !== null || !car.deform.drivetrainAlive || car.group.matrixWorld.elements[5]! < FLIPPED_UP_Y;
}

/**
 * The cars that drive the streets: a pool of real cars past the seated ones, each parked in a space or on a trip to one. Ambient cars wait out a seeded dwell, pull out, drive to a free space
 * and park; leased cars (a resident's commute, a patrol) take a trip they are told. State is per slot; the bookkeeping pass runs `BOOKKEEPING_SECONDS` apart, the driving every sim step.
 */
export class MoverFleet {
  readonly first: number;
  readonly size: number;
  /** The last `patrol` slots are police cruisers, and the `ambulance` before them ambulances: each leased only as what it is. */
  readonly patrol: number;
  readonly ambulance: number;
  readonly handles: DrivenCar[];
  private readonly context: TrafficContext;
  private readonly planner: RoutePlanner;
  private readonly driver: TrafficDriver;
  private readonly routes: TripRoute[];
  /** The route a re-plan is written into; it trades places with the car's on success, so a failed one leaves the car's route as it was. */
  private spareRoute = new TripRoute();
  private readonly classes: ClassStats[];
  private readonly state: Uint8Array;
  private readonly role: Uint8Array;
  private readonly urgent: Uint8Array;
  /** The space the car stands in while parked, or goes to while driving. */
  private readonly spot: Int32Array;
  private readonly resident: Int32Array;
  private readonly readyAt: Float64Array;
  /** The crowd second a leased car's rider is due at his destination (Infinity: none): a car still on the road then, that no one sees, stands in its space. */
  private readonly dueAt: Float64Array;
  /** The engine id of the patrol car chasing a slot's car (-1: none), and whether the car has noticed it and runs. */
  private readonly chaser: Int16Array;
  private readonly fleeing: Uint8Array;
  /** The paint a slot's car stands in (sRGB, `NO_COLOUR`: its own): a resident's car wears his. */
  private readonly colour: Int32Array;
  private readonly wreckedFor: Float64Array;
  private readonly stillFor: Float64Array;
  private readonly trips: Uint32Array;
  private seconds = 0;
  private sinceBookkeeping = 0;
  private spawnedThisPass = false;
  private passes = 0;

  constructor(context: TrafficContext, first: number, size: number, patrol: number, ambulance: number, driver: TrafficDriver) {
    this.context = context;
    this.first = first;
    this.size = size;
    this.patrol = patrol;
    this.ambulance = ambulance;
    this.driver = driver;
    this.planner = new RoutePlanner(context.network, context.spots);
    this.handles = Array.from({ length: size }, (_, slot) => new DrivenCar(first + slot, context.ports));
    this.routes = Array.from({ length: size }, () => new TripRoute());
    this.classes = Array.from({ length: size }, () => classStats("sedan"));
    this.state = new Uint8Array(size);
    this.role = new Uint8Array(size);
    this.urgent = new Uint8Array(size);
    this.spot = new Int32Array(size).fill(-1);
    this.resident = new Int32Array(size).fill(NO_RESIDENT);
    this.readyAt = new Float64Array(size);
    this.dueAt = new Float64Array(size).fill(Infinity);
    this.chaser = new Int16Array(size).fill(-1);
    this.fleeing = new Uint8Array(size);
    this.colour = new Int32Array(size).fill(NO_COLOUR);
    this.wreckedFor = new Float64Array(size);
    this.stillFor = new Float64Array(size);
    this.trips = new Uint32Array(size);
  }

  /** Cars on a trip now. */
  drivingCount(): number {
    let count = 0;
    for (let slot = 0; slot < this.size; slot++) if (this.state[slot] === MOVER.driving) count++;
    return count;
  }

  /** The lease handle of car `id` when it is one of the fleet's and on a trip, else null. */
  handleAt(id: number): DrivenCar | null {
    const slot = id - this.first;
    return slot >= 0 && slot < this.size && this.state[slot] === MOVER.driving ? this.handles[slot]! : null;
  }

  /** The resident at the wheel of car `id`, -1 when it is not one of the fleet's, stands put away, or is no resident's. */
  residentAt(id: number): number {
    const slot = id - this.first;
    return slot >= 0 && slot < this.size && this.state[slot] !== MOVER.free ? this.resident[slot]! : NO_RESIDENT;
  }

  /** Whether a resident's leased car is on a trip right now. */
  hasTripFor(resident: number): boolean {
    for (let slot = 0; slot < this.size; slot++) if (this.state[slot] === MOVER.driving && this.resident[slot] === resident) return true;
    return false;
  }

  /** One sim step at crowd time `seconds`: the bookkeeping pass when it is due. */
  step(seconds: number, dt: number): void {
    this.seconds = seconds;
    this.sinceBookkeeping += dt;
    if (this.sinceBookkeeping < BOOKKEEPING_SECONDS) return;
    const passDt = this.sinceBookkeeping;
    this.sinceBookkeeping = 0;
    this.passes++;
    this.spawnedThisPass = false;
    for (let slot = 0; slot < this.size; slot++) this.tend(slot, passDt);
  }

  /** What car `id` does for `dt` s when it is one of the fleet's on a trip; null leaves it to the engine's default (parked cars stand on their brakes). */
  inputOf(id: number, dt: number): DriveInput | null {
    const slot = id - this.first;
    if (slot < 0 || slot >= this.size || this.state[slot] !== MOVER.driving || this.context.ports.seated(id)) return null;
    const snaps = this.context.snaps;
    const handle = this.handles[slot]!;
    if (handle.driver !== null) return handle.driver(snaps[id]!, snaps, dt);
    return this.driver.think(snaps[id]!, this.routes[slot]!, this.classes[slot]!, snaps, this.seconds, dt, this.urgent[slot] === 1, this.fleeing[slot] === 1 ? snaps[this.chaser[slot]!]! : null);
  }

  /**
   * Patrol car `chaserId` is after traffic car `carId`: once it is within `FLEE_NOTICE_METRES` the car runs as a racer evades one (`TrafficDriver.think`'s `chaser`) along the streets to a far space, and on to another when
   * that is near, until `endEvade`. False for a car that is not traffic's, is not on a trip, is leased as a patrol or ambulance, or has a human at the wheel.
   */
  evade(carId: number, chaserId: number): boolean {
    const slot = carId - this.first;
    if (slot < 0 || slot >= this.size || this.state[slot] !== MOVER.driving || this.kindOf(slot) !== LEASE.ambient || this.context.ports.seated(carId)) return false;
    this.chaser[slot] = chaserId;
    return true;
  }

  /** The chase of car `carId` is over: it drives as traffic again (on the route it has, which ends in a space). */
  endEvade(carId: number): void {
    const slot = carId - this.first;
    if (slot < 0 || slot >= this.size) return;
    this.chaser[slot] = -1;
    this.fleeing[slot] = 0;
  }

  /** Whether car `carId` runs from a chaser now. */
  isFleeing(carId: number): boolean {
    const slot = carId - this.first;
    return slot >= 0 && slot < this.size && this.fleeing[slot] === 1;
  }

  /** The chased car's bookkeeping: it starts running when the chaser comes within `FLEE_NOTICE_METRES`, and plans a new run when little of the last is left. */
  private tendChased(slot: number): void {
    const { snaps } = this.context;
    const me = snaps[this.first + slot]!;
    const them = snaps[this.chaser[slot]!]!;
    if (this.fleeing[slot] === 0) {
      if (hypot2(them.x - me.x, them.z - me.z) > FLEE_NOTICE_METRES) return;
      this.fleeing[slot] = 1;
      this.planRun(slot, me, them);
    } else if (this.driver.remaining(this.first + slot, this.routes[slot]!) < FLEE_REPLAN_METRES) this.planRun(slot, me, them);
  }

  /** Sends the car on to the free space farthest from the chaser that is at least `FLEE_FAR_METRES` from the car; the trip it had is kept when there is none or no way. */
  private planRun(slot: number, me: AiCar, them: AiCar): void {
    const { spots, taken } = this.context;
    let best = -1;
    let bestAway = 0;
    for (let spot = 0; spot < spots.count; spot++) {
      if (spots.stays[spot] === 1 || taken[spot] === 1 || hypot2(spots.x[spot]! - me.x, spots.z[spot]! - me.z) < FLEE_FAR_METRES) continue;
      const away = hypot2(spots.x[spot]! - them.x, spots.z[spot]! - them.z);
      if (away <= bestAway) continue;
      best = spot;
      bestAway = away;
    }
    if (best >= 0) this.rerouteFrom(slot, best);
  }

  /** Plans the driving car's trip afresh from where it is to space `toSpot` and takes it over; false (the trip kept) when there is no way. */
  private rerouteFrom(slot: number, toSpot: number): boolean {
    const snap = this.context.snaps[this.first + slot]!;
    if (!this.planner.planFrom(this.spareRoute, snap.x, snap.z, snap.yaw, toSpot)) return false;
    const old = this.routes[slot]!;
    this.routes[slot] = this.spareRoute;
    this.spareRoute = old;
    const { taken } = this.context;
    taken[this.spot[slot]!] = 0;
    taken[toSpot] = 1;
    this.spot[slot] = toSpot;
    this.stillFor[slot] = 0;
    this.handles[slot]!.arrived = false;
    this.driver.forget(this.first + slot);
    return true;
  }

  /**
   * Leases a car for `resident` (-1: none) to drive from space `fromSpot` to `toSpot`: the resident's own parked car when it stands in `fromSpot`, else a free car or an ambient one parked
   * out of the way, placed there. Null when no car is free or there is no way between the spaces.
   */
  spawn(resident: number, fromSpot: number, toSpot: number, kind: LeaseKind, dueSeconds: number): DrivenCar | null {
    const body = resident === NO_RESIDENT ? null : residentBody(resident);
    const slot = this.slotFor(resident, fromSpot, kind, body);
    if (slot < 0) return null;
    const { ports, spots } = this.context;
    const id = this.first + slot;
    const paint = kind === LEASE.ambulance ? AMBULANCE_COLOUR : resident === NO_RESIDENT ? NO_COLOUR : residentColour(resident);
    if (this.state[slot] !== MOVER.parked || this.spot[slot] !== fromSpot) {
      this.release(slot);
      if (body !== null && ports.cars()[id]!.style.id !== body) ports.setBody(id, body);
      ports.place(id, spots.x[fromSpot]!, spots.z[fromSpot]!, spots.yaw[fromSpot]!, paint === NO_COLOUR ? null : paint);
      this.colour[slot] = paint;
      this.spot[slot] = fromSpot;
      this.state[slot] = MOVER.parked;
      this.context.taken[fromSpot] = 1;
      this.context.standing[fromSpot] = STANDING.mover;
    }
    if (!this.planner.plan(this.routes[slot]!, fromSpot, toSpot)) return null;
    this.role[slot] = resident === NO_RESIDENT ? ROLE.leased : ROLE.commuter;
    this.resident[slot] = resident;
    this.urgent[slot] = kind === LEASE.ambient ? 0 : 1;
    if (kind === LEASE.ambulance) ports.sirens(id, true);
    this.classes[slot] = classStats(carClass(ports.cars()[id]!));
    const handle = this.handles[slot]!;
    handle.driver = null;
    handle.lost = false;
    this.launch(slot, toSpot);
    this.dueAt[slot] = dueSeconds;
    return handle;
  }

  /**
   * Sends leased car `handle` on to space `toSpot`, keeping its urgency: a car on a trip from where it is now (no pull-out), a car that arrived out of its space. False when the car is not
   * the owner's, the space is held or a car stands in it for good, or there is no way; the car then goes on as before.
   */
  redirect(handle: DrivenCar, toSpot: number): boolean {
    const slot = handle.index - this.first;
    if (slot < 0 || slot >= this.size || handle.lost || this.state[slot] === MOVER.free) return false;
    if (toSpot === this.spot[slot]) return true;
    const { taken, spots } = this.context;
    if (toSpot < 0 || toSpot >= spots.count || spots.stays[toSpot] === 1 || taken[toSpot] === 1) return false;
    if (this.state[slot] !== MOVER.parked) return this.rerouteFrom(slot, toSpot);
    if (!this.planner.plan(this.spareRoute, this.spot[slot]!, toSpot)) return false;
    const old = this.routes[slot]!;
    this.routes[slot] = this.spareRoute;
    this.spareRoute = old;
    this.launch(slot, toSpot);
    return true;
  }

  /** The owner is done with the car: it goes on as ambient traffic from where it is; a patrol car or an ambulance is put away. */
  despawn(handle: DrivenCar): void {
    const slot = handle.index - this.first;
    if (slot < 0 || slot >= this.size || handle.lost) return;
    handle.lost = true;
    handle.driver = null;
    if (this.kindOf(slot) !== LEASE.ambient) {
      this.release(slot);
      this.context.ports.sirens(this.first + slot, false);
      this.context.ports.putAway(this.first + slot);
      this.driver.forget(this.first + slot);
      return;
    }
    this.role[slot] = ROLE.ambient;
    this.resident[slot] = NO_RESIDENT;
    this.urgent[slot] = 0;
    if (this.state[slot] === MOVER.parked) this.readyAt[slot] = this.seconds + this.dwell(slot);
  }

  private tend(slot: number, passDt: number): void {
    const { ports } = this.context;
    const id = this.first + slot;
    const car = ports.cars()[id];
    if (car === undefined) return;
    if (ports.seated(id)) {
      this.handOverToHuman(slot);
      return;
    }
    const state = this.state[slot];
    if (state !== MOVER.free) this.context.sight.observe(this.context.sightBase + slot, car.group.position.x, car.group.position.z, SIGHT_RADIUS);
    if (state === MOVER.free) this.fill(slot, car, id);
    else if (state === MOVER.parked) this.tendParked(slot, car, passDt);
    else this.tendDriving(slot, car, passDt);
  }

  private fill(slot: number, car: TrafficCar, id: number): void {
    const { ports } = this.context;
    if (car.group.visible || !car.stored) {
      ports.putAway(id);
      this.driver.forget(id);
    }
    if (this.spawnedThisPass || this.role[slot] !== ROLE.ambient || this.kindOf(slot) !== LEASE.ambient) return;
    const spot = this.chooseSpot(slot, -1, this.passes > PRIME_PASSES);
    if (spot < 0) return;
    const { spots } = this.context;
    ports.place(id, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, null);
    this.spot[slot] = spot;
    this.state[slot] = MOVER.parked;
    this.context.taken[spot] = 1;
    this.context.standing[spot] = STANDING.mover;
    this.readyAt[slot] = this.seconds + hash01(slot + 100, TRAFFIC_SEED) * DWELL_SECONDS.most;
    this.classes[slot] = classStats(carClass(car));
    this.driver.forget(this.first + slot);
    this.wreckedFor[slot] = 0;
    this.spawnedThisPass = true;
  }

  private tendParked(slot: number, car: TrafficCar, passDt: number): void {
    this.wreckedFor[slot] = isWreck(car) ? this.wreckedFor[slot]! + passDt : 0;
    if (this.wreckedFor[slot]! > TOW_SECONDS) {
      this.tow(slot);
      return;
    }
    if (this.seconds < this.readyAt[slot]!) return;
    if (this.role[slot] === ROLE.commuter) {
      if (this.unseenAndFar(slot, car)) this.shelve(slot);
      return;
    }
    if (this.role[slot] !== ROLE.ambient) return;
    if (!this.laneClear(slot)) {
      this.readyAt[slot] = this.seconds + 1;
      return;
    }
    const destination = this.chooseSpot(slot, this.spot[slot]!, false);
    if (destination < 0 || !this.planner.plan(this.routes[slot]!, this.spot[slot]!, destination)) {
      this.readyAt[slot] = this.seconds + 5;
      return;
    }
    this.launch(slot, destination);
  }

  private tendDriving(slot: number, car: TrafficCar, passDt: number): void {
    const id = this.first + slot;
    this.wreckedFor[slot] = isWreck(car) ? this.wreckedFor[slot]! + passDt : 0;
    const speed = hypot2(car.velocity.x, car.velocity.z);
    this.stillFor[slot] = speed < STANDING_SPEED ? this.stillFor[slot]! + passDt : 0;
    if (this.wreckedFor[slot]! > TOW_SECONDS || this.stillFor[slot]! > STUCK_SECONDS) {
      this.tow(slot);
      return;
    }
    if (this.chaser[slot]! >= 0) this.tendChased(slot);
    if (this.seconds > this.dueAt[slot]! && this.unseenAndFar(slot, car)) this.standInSpace(slot);
    else if (!this.driver.arrived(id, this.routes[slot]!, speed)) return;
    this.park(slot);
  }

  /** The car, late for the walker waiting at its space, stands in the space (no one sees it happen). */
  private standInSpace(slot: number): void {
    const { ports, spots } = this.context;
    const spot = this.spot[slot]!;
    ports.place(this.first + slot, spots.x[spot]!, spots.z[spot]!, spots.yaw[spot]!, this.colour[slot] === NO_COLOUR ? null : this.colour[slot]!);
    this.driver.forget(this.first + slot);
  }

  /** The car has come to its space: parked, held by whose it is, and a resident's car is his for his next drive. */
  private park(slot: number): void {
    this.state[slot] = MOVER.parked;
    this.dueAt[slot] = Infinity;
    this.chaser[slot] = -1;
    this.fleeing[slot] = 0;
    this.context.standing[this.spot[slot]!] = STANDING.mover;
    this.handles[slot]!.arrived = true;
    if (this.role[slot] === ROLE.commuter) this.context.residentSpot[this.resident[slot]!] = this.spot[slot]!;
    this.readyAt[slot] = this.role[slot] === ROLE.ambient ? this.seconds + this.dwell(slot) : this.role[slot] === ROLE.commuter ? this.seconds + COMMUTER_HOLD_SECONDS : Infinity;
  }

  /** The car leaves its space (if it stands in one) for the route planned into `destination`. */
  private launch(slot: number, destination: number): void {
    const { taken, standing, residentSpot } = this.context;
    const from = this.spot[slot]!;
    if (from >= 0 && this.state[slot] === MOVER.parked) {
      taken[from] = 0;
      standing[from] = STANDING.none;
    }
    if (this.role[slot] === ROLE.commuter) residentSpot[this.resident[slot]!] = -1;
    taken[destination] = 1;
    this.spot[slot] = destination;
    this.state[slot] = MOVER.driving;
    this.trips[slot]!++;
    this.stillFor[slot] = 0;
    this.dueAt[slot] = Infinity;
    this.handles[slot]!.arrived = false;
    this.driver.forget(this.first + slot);
  }

  private dwell(slot: number): number {
    return DWELL_SECONDS.least + hash01(slot * SEED_STEP + this.trips[slot]!, TRAFFIC_SEED) * (DWELL_SECONDS.most - DWELL_SECONDS.least);
  }

  /** A free space picked from a seeded start (not the one at `from`, and `MIN_TRIP_METRES` off it when `from` is given); when `unseen`, one no eye sees. -1 when none. */
  private chooseSpot(slot: number, from: number, unseen: boolean): number {
    const { spots, taken } = this.context;
    const start = Math.floor(hash01(slot * SEED_STEP + this.trips[slot]! + this.passes, TRAFFIC_SEED) * spots.count);
    for (let step = 0; step < spots.count; step++) {
      const spot = (start + step) % spots.count;
      if (spots.stays[spot] === 1 || taken[spot] === 1) continue;
      if (from >= 0 && hypot2(spots.x[spot]! - spots.x[from]!, spots.z[spot]! - spots.z[from]!) < MIN_TRIP_METRES) continue;
      if (unseen && !spotUnseen(this.context, spot)) continue;
      return spot;
    }
    return -1;
  }

  /** No car moving up the lane behind the space within `PULL_OUT_CLEAR` m. */
  private laneClear(slot: number): boolean {
    const { spots, snaps } = this.context;
    const spot = this.spot[slot]!;
    const heading = spots.heading[spot]!;
    for (let index = 0; index < snaps.length; index++) {
      const other = snaps[index]!;
      if (other.id === this.first + slot || !other.alive || hypot2(other.vx, other.vz) < MOVING_SPEED) continue;
      const dx = other.x - spots.x[spot]!;
      const dz = other.z - spots.z[spot]!;
      const along = dx * HEADING_DX[heading]! + dz * HEADING_DZ[heading]!;
      const side = dx * rightX(heading) + dz * rightZ(heading);
      if (along < 0 && along > -PULL_OUT_CLEAR && Math.abs(side) < LANE_WIDTH) return false;
    }
    return true;
  }

  private kindOf(slot: number): LeaseKind {
    return slot >= this.size - this.patrol ? LEASE.patrol : slot >= this.size - this.patrol - this.ambulance ? LEASE.ambulance : LEASE.ambient;
  }

  /** The engine id of the car standing parked for resident `resident`, -1 when none does. */
  carOf(resident: number): number {
    for (let slot = 0; slot < this.size; slot++) if (this.resident[slot] === resident && this.state[slot] === MOVER.parked && this.role[slot] === ROLE.commuter) return this.first + slot;
    return -1;
  }

  /** A slot to lease for a trip out of `fromSpot`: the resident's own car standing there, a free one, or an ambient one parked (taken off its space); an urgent trip takes a patrol car, any other never does. -1 when none. */
  private slotFor(resident: number, fromSpot: number, kind: LeaseKind, body: CarStyleId | null): number {
    for (let slot = 0; slot < this.size; slot++) {
      if (resident !== NO_RESIDENT && this.resident[slot] === resident && this.state[slot] === MOVER.parked && this.spot[slot] === fromSpot) return slot;
    }
    let free = -1;
    let freeMatch = -1;
    let ambient = -1;
    let ambientMatch = -1;
    for (let slot = 0; slot < this.size; slot++) {
      if (this.context.ports.seated(this.first + slot) || this.kindOf(slot) !== kind) continue;
      const matches = body !== null && this.context.ports.cars()[this.first + slot]!.style.id === body;
      if (this.state[slot] === MOVER.free) {
        if (free < 0) free = slot;
        if (matches && freeMatch < 0) freeMatch = slot;
      } else if (this.state[slot] === MOVER.parked && this.role[slot] === ROLE.ambient) {
        if (ambient < 0) ambient = slot;
        if (matches && ambientMatch < 0) ambientMatch = slot;
      }
    }
    return freeMatch >= 0 ? freeMatch : free >= 0 ? free : ambientMatch >= 0 ? ambientMatch : ambient;
  }

  /** Lets go of the space a slot holds (parked in it, or on the way to it) and of what the slot's owner had. */
  private release(slot: number): void {
    const { taken, standing, residentSpot } = this.context;
    const spot = this.spot[slot]!;
    if (spot >= 0) {
      const own = this.role[slot] === ROLE.commuter && residentSpot[this.resident[slot]!] === spot;
      if (!own) taken[spot] = 0;
      if (standing[spot] === STANDING.mover) standing[spot] = STANDING.none;
    }
    this.spot[slot] = -1;
    this.colour[slot] = NO_COLOUR;
    this.chaser[slot] = -1;
    this.fleeing[slot] = 0;
    this.state[slot] = MOVER.free;
    if (this.handles[slot]!.lost === false) this.handles[slot]!.lost = true;
    this.role[slot] = ROLE.ambient;
    this.resident[slot] = NO_RESIDENT;
    this.urgent[slot] = 0;
  }

  /** No eye sees the car and no player is near it. */
  private unseenAndFar(slot: number, car: TrafficCar): boolean {
    const { sight, sightBase } = this.context;
    return !sight.near(car.group.position.x, car.group.position.z, KERB_KEEP) && sight.unseenFor(sightBase + slot) >= sight.hideGrace;
  }

  /** A resident's car left standing where its owner parked it: put away, the space still the resident's; the kerb stream shows it again when a player comes near. */
  private shelve(slot: number): void {
    this.release(slot);
    this.context.ports.putAway(this.first + slot);
    this.driver.forget(this.first + slot);
  }

  private tow(slot: number): void {
    this.release(slot);
    this.context.ports.putAway(this.first + slot);
    this.driver.forget(this.first + slot);
    this.wreckedFor[slot] = 0;
  }

  /** A peer took the car's id: it is theirs, not traffic's; the slot waits for the id to come free, and its car is put away then. */
  private handOverToHuman(slot: number): void {
    if (this.state[slot] === MOVER.free) return;
    this.release(slot);
    this.driver.forget(this.first + slot);
  }
}
