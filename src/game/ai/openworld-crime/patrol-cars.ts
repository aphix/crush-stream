import { hypot2 } from "../../kernel/physics-core.js";
import { idleDrive, type DriveInput } from "../../vehicle/car-drive.ts";
import { BUST, CRAWL } from "../constants.ts";
import type { AiCar } from "../derby-ai.ts";
import type { Obstacles } from "../obstacles.ts";
import { CAR_ARRIVE_DISTANCE, CAR_CHASE_GIVE_UP_SECONDS, CAR_LINGER_SECONDS, CAR_LOST_DISTANCE, CAR_LOST_SECONDS, CAR_STOP_GAP, IMPOUND_SECONDS, MAX_PATROL_CARS, YIELD_DISTANCE } from "./crime-constants.ts";
import { PursuitDriver } from "./pursuit-driver.ts";

/** A car's driver: the engine asks it each physics step and applies what it writes. */
export type CarDriver = (self: AiCar, cars: readonly AiCar[], dt: number) => DriveInput;

/** What the patrol cars need of the traffic and the engine's cars. */
export interface PatrolCarPorts {
  /** A pool car with its siren on, put on the road out of sight to drive toward (x, z): its handle, -1 when the pool has none free. */
  lease(toX: number, toZ: number): number;
  snap(handle: number): AiCar;
  setSirens(handle: number, on: boolean): void;
  setDriver(handle: number, driver: CarDriver | null): void;
  release(handle: number): void;
  /** Car `index` of the engine's list as the cops see it; null when there is none. */
  carSnap(index: number): AiCar | null;
  /** Hands traffic car `index` to `driver` (null: back to its own); false for a car that is not the traffic's (the player's). */
  takeTraffic(index: number, driver: CarDriver | null): boolean;
  /** The resident at the wheel of car `index`, -1 for none (the player). */
  driverOf(index: number): number;
}

interface PatrolHooks {
  /** The car of case `caseIndex` has come: its cop steps out at (x, z). */
  arrived(caseIndex: number, x: number, z: number): void;
  /** The driver of car `carIndex` was held slow beside a patrol car long enough: `resident` -1 for the player. */
  busted(resident: number, carIndex: number, seconds: number): void;
}

const PATROL_MODE = { free: 0, toScene: 1, atScene: 2, pursuing: 3, lingering: 4 } as const;

/**
 * The law's cars, leased from the traffic's pool. One drives to a scene on foot-case calls and its cop steps out; one chases a car that ran a red light, makes a traffic car it is near pull over,
 * and busts its driver by the race rule: held slow (`BUST.kph`) within `BUST.near` of the chasing car for `BUST.time` s, or `playerBustSeconds` for a human (Survival's hold).
 */
export class PatrolCars {
  readonly mode = new Uint8Array(MAX_PATROL_CARS);
  private readonly ports: PatrolCarPorts;
  private readonly hooks: PatrolHooks;
  private readonly pursuit: PursuitDriver;
  private readonly playerBustSeconds: number;
  private readonly handle = new Int32Array(MAX_PATROL_CARS).fill(-1);
  private readonly caseIndex = new Int8Array(MAX_PATROL_CARS).fill(-1);
  private readonly targetCar = new Int32Array(MAX_PATROL_CARS).fill(-1);
  private readonly aimX = new Float64Array(MAX_PATROL_CARS);
  private readonly aimZ = new Float64Array(MAX_PATROL_CARS);
  private readonly heldFor = new Float64Array(MAX_PATROL_CARS);
  private readonly farFor = new Float64Array(MAX_PATROL_CARS);
  private readonly since = new Float64Array(MAX_PATROL_CARS);
  private readonly lingerUntil = new Float64Array(MAX_PATROL_CARS);
  private readonly yielded = new Uint8Array(MAX_PATROL_CARS);
  private readonly drivers: readonly CarDriver[];
  private readonly stopDriver: CarDriver;
  private readonly out: DriveInput = idleDrive();

  constructor(ports: PatrolCarPorts, hooks: PatrolHooks, obstacles: Obstacles | null, playerBustSeconds: number) {
    this.ports = ports;
    this.hooks = hooks;
    this.pursuit = new PursuitDriver(obstacles);
    this.playerBustSeconds = playerBustSeconds;
    this.drivers = Array.from({ length: MAX_PATROL_CARS }, (_, slot): CarDriver => (self, _cars, dt) => this.driveSlot(slot, self, dt));
    this.stopDriver = () => this.brakeOut();
  }

  /** A car comes to (x, z) for case `caseIndex`; false when the pool has none. */
  dispatchToScene(caseIndex: number, x: number, z: number, seconds: number): boolean {
    const slot = this.begin(PATROL_MODE.toScene, x, z, seconds);
    if (slot < 0) return false;
    this.caseIndex[slot] = caseIndex;
    return true;
  }

  /** A car chases traffic car `carIndex`; false when one already does or the pool has none. */
  chase(carIndex: number, x: number, z: number, seconds: number): boolean {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) if (this.mode[slot] === PATROL_MODE.pursuing && this.targetCar[slot] === carIndex) return false;
    const slot = this.begin(PATROL_MODE.pursuing, x, z, seconds);
    if (slot < 0) return false;
    this.targetCar[slot] = carIndex;
    return true;
  }

  /** The foot case is over: its car's siren goes off and it is let go in a while. */
  finishCase(caseIndex: number, seconds: number): void {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.caseIndex[slot] === caseIndex && (this.mode[slot] === PATROL_MODE.toScene || this.mode[slot] === PATROL_MODE.atScene)) this.linger(slot, seconds, CAR_LINGER_SECONDS);
    }
  }

  /** Whether a leased patrol car on the road stands within `range` m of (x, z). */
  within(x: number, z: number, range: number): boolean {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.mode[slot] === PATROL_MODE.free) continue;
      const car = this.ports.snap(this.handle[slot]!);
      if (hypot2(car.x - x, car.z - z) <= range) return true;
    }
    return false;
  }

  /** One grid step: arrivals, the chase's hold and give-up, and letting go of cars whose time is up. */
  step(seconds: number, dt: number): void {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      switch (this.mode[slot]) {
        case PATROL_MODE.toScene:
          this.stepToScene(slot, seconds);
          break;
        case PATROL_MODE.pursuing:
          this.stepPursuit(slot, seconds, dt);
          break;
        case PATROL_MODE.lingering:
          if (seconds >= this.lingerUntil[slot]!) this.letGo(slot);
          break;
        default:
      }
    }
  }

  private begin(mode: number, x: number, z: number, seconds: number): number {
    let slot = 0;
    while (slot < MAX_PATROL_CARS && this.mode[slot] !== PATROL_MODE.free) slot++;
    if (slot === MAX_PATROL_CARS) return -1;
    const handle = this.ports.lease(x, z);
    if (handle < 0) return -1;
    this.handle[slot] = handle;
    this.mode[slot] = mode;
    this.aimX[slot] = x;
    this.aimZ[slot] = z;
    this.caseIndex[slot] = -1;
    this.targetCar[slot] = -1;
    this.heldFor[slot] = 0;
    this.farFor[slot] = 0;
    this.yielded[slot] = 0;
    this.since[slot] = seconds;
    this.ports.setSirens(handle, true);
    this.ports.setDriver(handle, this.drivers[slot]!);
    return slot;
  }

  private stepToScene(slot: number, seconds: number): void {
    const car = this.ports.snap(this.handle[slot]!);
    const arrived = hypot2(car.x - this.aimX[slot]!, car.z - this.aimZ[slot]!) <= CAR_ARRIVE_DISTANCE && hypot2(car.vx, car.vz) < CRAWL;
    if (arrived) {
      this.mode[slot] = PATROL_MODE.atScene;
      this.hooks.arrived(this.caseIndex[slot]!, car.x, car.z);
    } else if (seconds - this.since[slot]! > CAR_CHASE_GIVE_UP_SECONDS) this.linger(slot, seconds, CAR_LINGER_SECONDS);
  }

  private stepPursuit(slot: number, seconds: number, dt: number): void {
    const offender = this.ports.carSnap(this.targetCar[slot]!);
    if (offender === null || !offender.alive) {
      this.linger(slot, seconds, CAR_LINGER_SECONDS);
      return;
    }
    const cop = this.ports.snap(this.handle[slot]!);
    const gap = hypot2(offender.x - cop.x, offender.z - cop.z);
    if (this.yielded[slot] === 0 && gap <= YIELD_DISTANCE) {
      this.yielded[slot] = 1;
      this.ports.takeTraffic(this.targetCar[slot]!, this.stopDriver);
    }
    this.holdSlow(slot, offender, gap, dt);
    this.farFor[slot] = gap > CAR_LOST_DISTANCE ? this.farFor[slot]! + dt : 0;
    if (this.heldFor[slot]! >= this.holdNeeded(slot)) this.bust(slot, seconds);
    else if (this.farFor[slot]! >= CAR_LOST_SECONDS || seconds - this.since[slot]! > CAR_CHASE_GIVE_UP_SECONDS) this.linger(slot, seconds, CAR_LINGER_SECONDS);
  }

  /** The race's bust rule: unbroken seconds held under `BUST.kph` within `BUST.near` of the chasing car. */
  private holdSlow(slot: number, offender: AiCar, gap: number, dt: number): void {
    const slow = hypot2(offender.vx, offender.vz) * 3.6 < BUST.kph;
    this.heldFor[slot] = slow && gap <= BUST.near ? this.heldFor[slot]! + dt : 0;
  }

  private holdNeeded(slot: number): number {
    return this.ports.driverOf(this.targetCar[slot]!) >= 0 ? BUST.time : this.playerBustSeconds;
  }

  private bust(slot: number, seconds: number): void {
    const target = this.targetCar[slot]!;
    this.hooks.busted(this.ports.driverOf(target), target, seconds);
    this.linger(slot, seconds, IMPOUND_SECONDS);
  }

  private linger(slot: number, seconds: number, forSeconds: number): void {
    this.mode[slot] = PATROL_MODE.lingering;
    this.lingerUntil[slot] = seconds + forSeconds;
    this.ports.setSirens(this.handle[slot]!, false);
  }

  /** The car is let go; a car it held at the roadside goes back to its own driving. */
  private letGo(slot: number): void {
    if (this.targetCar[slot]! >= 0) this.ports.takeTraffic(this.targetCar[slot]!, null);
    this.ports.release(this.handle[slot]!);
    this.handle[slot] = -1;
    this.mode[slot] = PATROL_MODE.free;
  }

  private driveSlot(slot: number, self: AiCar, dt: number): DriveInput {
    if (this.mode[slot] === PATROL_MODE.toScene) {
      this.pursuit.drive(slot, self, this.aimX[slot]!, this.aimZ[slot]!, 0, 0, CAR_STOP_GAP, dt, this.out);
      return this.out;
    }
    const offender = this.mode[slot] === PATROL_MODE.pursuing ? this.ports.carSnap(this.targetCar[slot]!) : null;
    if (offender === null) return this.brakeOut();
    const crawling = hypot2(offender.vx, offender.vz) < CRAWL;
    this.pursuit.drive(slot, self, offender.x, offender.z, offender.vx, offender.vz, crawling ? CAR_STOP_GAP : 0, dt, this.out);
    return this.out;
  }

  private brakeOut(): DriveInput {
    this.out.throttle = 0;
    this.out.steer = 0;
    this.out.brake = 1;
    this.out.ebrake = false;
    this.out.boost = false;
    return this.out;
  }
}
