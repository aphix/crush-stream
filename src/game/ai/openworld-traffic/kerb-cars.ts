import { hypot2 } from "../../kernel/physics-core.js";
import { hash01 } from "../../kernel/scalar.ts";
import { FLIPPED_UP_Y } from "../../vehicle/constants.ts";
import { MAX_CARS } from "../../scenes/fleet.ts";
import { rightX, rightZ } from "../../world/openworld/openworld-roads.ts";
import type { CarStyleId } from "../../vehicle/car-variants.ts";
import { BOOKKEEPING_SECONDS, KERB_EVICT_MARGIN, KERB_JITTER_SIDE, KERB_JITTER_YAW, KERB_KEEP, KERB_REACH, PRIME_PASSES, SIGHT_RADIUS, TOW_SECONDS, TRAFFIC_SEED } from "./traffic-constants.ts";
import { residentBody, residentColour } from "./traffic-look.ts";
import { RESIDENT_CAPACITY, spotUnseen, STANDING, type TrafficContext } from "./traffic-ports.ts";
import type { ParkedResidentCars } from "./traffic-sight.ts";

/** Kerb cars placed per bookkeeping pass at most: the nearest first. */
const PLACES_PER_PASS = 2;

/**
 * The cars that stand at the kerb: real cars drawn from a pool that never drives. A space where a car stands for good (`stays`) or where a resident's car is parked gets one when a player is
 * within `KERB_REACH` m and no eye sees the space (the first passes show every space in reach, so the first view is not empty); one that no eye sees and no player is near is put away again.
 */
export class KerbCars {
  readonly first: number;
  readonly size: number;
  private readonly context: TrafficContext;
  private readonly staticSpots: Int32Array;
  private readonly slotOfSpot: Int16Array;
  private readonly spotOfSlot: Int32Array;
  private readonly wreckedFor: Float64Array;
  private readonly eyeX = new Float64Array(MAX_CARS);
  private readonly eyeZ = new Float64Array(MAX_CARS);
  private eyes = 0;
  /** How far (m) the space `nearestWanted` found is from the nearest player. */
  private wantedDistance = 0;
  /** The resident whose car the space `nearestWanted` found is for; -1 for a space a car stands in for good. */
  private wantedResident = -1;
  private wantedSpot = -1;
  /** The crowd second of the last step. */
  private seconds = 0;
  /** Per slot, the resident whose car it stands as (-1: a car that stands for good there): a resident's car is never given up for another's. */
  private readonly residentOfSlot: Int32Array;
  private sinceBookkeeping = 0;
  private passes = 0;

  constructor(context: TrafficContext, first: number, size: number) {
    this.context = context;
    this.first = first;
    this.size = size;
    const { spots } = context;
    const stays: number[] = [];
    for (let spot = 0; spot < spots.count; spot++) if (spots.stays[spot] === 1) stays.push(spot);
    this.staticSpots = Int32Array.from(stays);
    this.slotOfSpot = new Int16Array(spots.count).fill(-1);
    this.spotOfSlot = new Int32Array(size).fill(-1);
    this.wreckedFor = new Float64Array(size);
    this.residentOfSlot = new Int32Array(size).fill(-1);
  }

  /** Kerb cars standing now. */
  shownCount(): number {
    let count = 0;
    for (let slot = 0; slot < this.size; slot++) if (this.spotOfSlot[slot]! >= 0) count++;
    return count;
  }

  /** The engine id of the kerb car standing in `spot`, -1 when none does. */
  carAt(spot: number): number {
    const slot = this.slotOfSpot[spot]!;
    return slot < 0 ? -1 : this.first + slot;
  }

  /** The car in `spot` leaves it (a resident drives off in a car that stood there). */
  clearSpot(spot: number): void {
    const slot = this.slotOfSpot[spot]!;
    if (slot < 0) return;
    this.context.ports.putAway(this.first + slot);
    this.vacate(slot);
  }

  /** One sim step: the bookkeeping pass when it is due; `parked` lists the residents' cars at kerbs. */
  step(seconds: number, dt: number, parked: ParkedResidentCars | null): void {
    this.seconds = seconds;
    this.sinceBookkeeping += dt;
    if (this.sinceBookkeeping < BOOKKEEPING_SECONDS) return;
    const passDt = this.sinceBookkeeping;
    this.sinceBookkeeping = 0;
    this.passes++;
    this.findEyes();
    for (let slot = 0; slot < this.size; slot++) this.tend(slot, passDt);
    for (let place = 0; place < PLACES_PER_PASS; place++) {
      const spot = this.nearestWanted(parked);
      if (spot < 0) break;
      const limit = this.wantedResident >= 0 ? 0 : this.wantedDistance + KERB_EVICT_MARGIN;
      const body = this.wantedResident < 0 ? null : residentBody(this.wantedResident);
      if (!this.show(spot) && !(this.evictFarthest(limit, body) && this.show(spot))) break;
    }
  }

  private findEyes(): void {
    const { snaps, ports } = this.context;
    this.eyes = 0;
    for (let index = 0; index < snaps.length; index++) {
      const car = snaps[index]!;
      if (!ports.seated(car.id)) continue;
      this.eyeX[this.eyes] = car.x;
      this.eyeZ[this.eyes] = car.z;
      this.eyes++;
    }
  }

  private distanceToEyes(x: number, z: number): number {
    let nearest = Infinity;
    for (let eye = 0; eye < this.eyes; eye++) nearest = Math.min(nearest, hypot2(this.eyeX[eye]! - x, this.eyeZ[eye]! - z));
    return nearest;
  }

  /** A shown car is put away when a human takes its id, when it has lain wrecked for `TOW_SECONDS`, or when no eye sees it and no player is near. */
  private tend(slot: number, passDt: number): void {
    const spot = this.spotOfSlot[slot]!;
    const { ports, sight } = this.context;
    const id = this.first + slot;
    const car = ports.cars()[id];
    if (car === undefined) return;
    if (ports.seated(id)) {
      this.vacate(slot);
      return;
    }
    if (spot < 0) {
      if (car.group.visible || !car.stored) ports.putAway(id);
      return;
    }
    const x = car.group.position.x;
    const z = car.group.position.z;
    const sightId = this.context.sightBase + this.context.movers + slot;
    sight.observe(sightId, x, z, SIGHT_RADIUS);
    const wrecked = car.driverOut !== null || !car.deform.drivetrainAlive || car.group.matrixWorld.elements[5]! < FLIPPED_UP_Y;
    this.wreckedFor[slot] = wrecked ? this.wreckedFor[slot]! + passDt : 0;
    const gone = this.wreckedFor[slot]! > TOW_SECONDS || (!sight.near(x, z, KERB_KEEP) && sight.unseenFor(sightId) >= sight.hideGrace);
    if (!gone) return;
    ports.putAway(id);
    this.vacate(slot);
  }

  /** Puts away the shown car that stands for good, past `limit` m from the players and unseen for the grace, that wears `body` (null: any) before the farthest one; false when there is none. */
  private evictFarthest(limit: number, body: CarStyleId | null): boolean {
    const { ports, sight } = this.context;
    let farthest = -1;
    let farthestDistance = limit;
    let farthestMatches = false;
    for (let slot = 0; slot < this.size; slot++) {
      if (this.spotOfSlot[slot]! < 0 || this.residentOfSlot[slot]! >= 0) continue;
      const car = ports.cars()[this.first + slot];
      if (car === undefined) continue;
      const distance = this.distanceToEyes(car.group.position.x, car.group.position.z);
      if (distance <= limit || sight.unseenFor(this.context.sightBase + this.context.movers + slot) < sight.hideGrace) continue;
      const matches = body !== null && car.style.id === body;
      if (farthest >= 0 && (farthestMatches ? !matches || distance <= farthestDistance : !matches && distance <= farthestDistance)) continue;
      farthestDistance = distance;
      farthestMatches = matches;
      farthest = slot;
    }
    if (farthest < 0) return false;
    ports.putAway(this.first + farthest);
    this.vacate(farthest);
    return true;
  }

  private vacate(slot: number): void {
    const spot = this.spotOfSlot[slot]!;
    if (spot >= 0) {
      this.slotOfSpot[spot] = -1;
      if (this.context.standing[spot] === STANDING.kerb) this.context.standing[spot] = STANDING.none;
    }
    this.spotOfSlot[slot] = -1;
    this.residentOfSlot[slot] = -1;
    this.wreckedFor[slot] = 0;
  }

  /** The nearest space in reach of a player that wants a kerb car and shows none, a resident's car's before a car that stands for good; during the first passes any, else only those no eye sees. -1 when none. */
  private nearestWanted(parked: ParkedResidentCars | null): number {
    const prime = this.passes <= PRIME_PASSES;
    this.wantedDistance = KERB_REACH;
    this.wantedSpot = -1;
    this.wantedResident = -1;
    if (parked !== null) for (let index = 0; index < parked.count; index++) this.consider(this.residentCarSpot(parked.resident[index]!), parked.resident[index]!, prime);
    if (this.wantedSpot < 0) for (let index = 0; index < this.staticSpots.length; index++) this.consider(this.staticSpots[index]!, -1, prime);
    return this.wantedSpot;
  }

  /** Space `spot` (for resident `resident`, -1 for none) is the wanted one if it is empty, nearer a player than the best so far, and unseen (unless it is the first passes). */
  private consider(spot: number, resident: number, prime: boolean): void {
    const { spots, standing } = this.context;
    if (spot < 0 || standing[spot] !== STANDING.none) return;
    const distance = this.distanceToEyes(spots.x[spot]!, spots.z[spot]!);
    if (distance >= this.wantedDistance || (!prime && !spotUnseen(this.context, spot))) return;
    this.wantedDistance = distance;
    this.wantedSpot = spot;
    this.wantedResident = resident;
  }

  private residentCarSpot(resident: number): number {
    return resident >= 0 && resident < RESIDENT_CAPACITY ? this.context.residentSpot[resident]! : -1;
  }

  /** Stands a pooled car in `spot`, nudged a little off true so a row of them does not look stamped; false when the pool is all out. */
  private show(spot: number): boolean {
    const { ports, spots, standing, sight } = this.context;
    const body = this.wantedResident < 0 ? null : residentBody(this.wantedResident);
    let slot = -1;
    for (let candidate = 0; candidate < this.size; candidate++) {
      if (this.spotOfSlot[candidate]! >= 0 || ports.seated(this.first + candidate)) continue;
      if (slot < 0) slot = candidate;
      if (body === null || ports.cars()[this.first + candidate]!.style.id === body) {
        slot = candidate;
        break;
      }
    }
    if (slot < 0) return false;
    if (body !== null && ports.cars()[this.first + slot]!.style.id !== body && this.context.swaps.allows(this.seconds) && spotUnseen(this.context, spot)) {
      this.context.swaps.note(this.seconds);
      ports.setBody(this.first + slot, body);
    }
    const heading = spots.heading[spot]!;
    const side = (hash01(spot, TRAFFIC_SEED) - 0.5) * 2 * KERB_JITTER_SIDE;
    const turn = (hash01(spot, TRAFFIC_SEED + 1) - 0.5) * 2 * KERB_JITTER_YAW;
    ports.place(this.first + slot, spots.x[spot]! + rightX(heading) * side, spots.z[spot]! + rightZ(heading) * side, spots.yaw[spot]! + turn, this.wantedResident < 0 ? null : residentColour(this.wantedResident));
    sight.reset(this.context.sightBase + this.context.movers + slot);
    this.spotOfSlot[slot] = spot;
    this.slotOfSpot[spot] = slot;
    this.residentOfSlot[slot] = this.wantedResident;
    standing[spot] = STANDING.kerb;
    return true;
  }
}
