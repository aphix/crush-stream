import { hypot2 } from "../../kernel/physics-core.js";
import { idleDrive, type DriveInput } from "../../vehicle/car-drive.ts";
import { BUST, CRAWL } from "../constants.ts";
import type { AiCar } from "../derby-ai.ts";
import type { Obstacles } from "../obstacles.ts";
import { CAREFUL_PURSUIT_SPEED, CHASE_LEAD_SECONDS, CHASE_RESUME_DISTANCE, CLOSE_PURSUIT_DISTANCE, CONVEY_GIVE_UP_SECONDS, CRIME_STREAM, HOTHEAD_RUN_SHARE, REDIRECT_SECONDS, CAR_STOP_DECEL, CAR_ARRIVE_DISTANCE, CAR_CHASE_GIVE_UP_SECONDS, CAR_LINGER_SECONDS, CAR_LOST_DISTANCE, CAR_LOST_SECONDS, CAR_STOP_GAP, IMPOUND_SECONDS, MAX_PATROL_CARS, YIELD_DISTANCE } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import type { LineOfSight } from "./offence-source.ts";
import { PursuitDriver } from "./pursuit-driver.ts";

/** A car's driver: the engine asks it each physics step and applies what it writes. */
export type CarDriver = (self: AiCar, cars: readonly AiCar[], dt: number) => DriveInput;

/** What the patrol cars need of the traffic and the engine's cars. */
export interface PatrolCarPorts {
  /** A pool car with its siren on, put on the road out of sight on an urgent trip along the streets to the kerb nearest (x, z): its handle, -1 when the pool has none free. */
  lease(toX: number, toZ: number): number;
  /** The leased car has come to the end of its trip and stands there (the traffic drove it). */
  arrived(handle: number): boolean;
  /** Re-plans the leased car's street trip from where it is to the kerb nearest (x, z); false (trip kept) when it cannot. */
  redirect(handle: number, toX: number, toZ: number): boolean;
  snap(handle: number): AiCar;
  setSirens(handle: number, on: boolean): void;
  setDriver(handle: number, driver: CarDriver | null): void;
  release(handle: number): void;
  /** Car `index` of the engine's list as the cops see it; null when there is none. */
  carSnap(index: number): AiCar | null;
  /** Hands traffic car `index` to `driver` (null: back to its own); false for a car that is not the traffic's (the player's). */
  takeTraffic(index: number, driver: CarDriver | null): boolean;
  /** Traffic car `index` is chased by the leased car `chaserHandle`: its driver runs as a racer evades a cop until `endEvade`; false for a car that is not on a street trip of the traffic's (the player's). */
  evade(index: number, chaserHandle: number): boolean;
  endEvade(index: number): void;
  /** The resident at the wheel of car `index`, -1 for none (the player). */
  driverOf(index: number): number;
}

interface PatrolHooks {
  /** The car of case `caseIndex` has come: its cop steps out at (x, z). */
  arrived(caseIndex: number, x: number, z: number): void;
  /** The driver of car `carIndex` was held slow beside a patrol car long enough: `resident` -1 for the player. */
  busted(resident: number, carIndex: number, seconds: number): void;
  /** The car of case `caseIndex` has come to the station with the suspect it carried. */
  delivered(caseIndex: number): void;
}

const YIELD = { none: 0, stopping: 1, refused: 2 } as const;
const PATROL_MODE = { free: 0, toScene: 1, atScene: 2, pursuing: 3, lingering: 4, toStation: 5 } as const;

/**
 * The law's cars, leased from the traffic's pool. One drives to a scene on foot-case calls, by the streets on the traffic's urgent trip (a hothead's run, `HOTHEAD_RUN_SHARE`, straight at it), and its cop steps out; one chases a car that ran a red light, makes a traffic car it is near pull over,
 * and busts its driver by the race rule: held slow (`BUST.kph`) within `BUST.near` of the chasing car for `BUST.time` s, or `playerBustSeconds` for a human (Survival's hold).
 */
export class PatrolCars {
  readonly mode = new Uint8Array(MAX_PATROL_CARS);
  /** Per car: 1 on a hothead's run. */
  readonly hothead = new Uint8Array(MAX_PATROL_CARS);
  /** Per car: 1 while this driver has the wheel, 0 while the traffic drives the car's trip along the streets. */
  readonly wheel = new Uint8Array(MAX_PATROL_CARS);
  private readonly redirectAt = new Float64Array(MAX_PATROL_CARS);
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
  /** Per car: whether it has been asked to pull over yet (`YIELD.none`), is pulling over (`YIELD.stopping`) or cannot be made to (`YIELD.refused`: a human's). */
  private readonly yieldState = new Uint8Array(MAX_PATROL_CARS);
  private readonly drivers: readonly CarDriver[];
  private readonly stopDriver: CarDriver;
  private readonly out: DriveInput = idleDrive();
  private readonly seed: number;
  private runs = 0;

  constructor(ports: PatrolCarPorts, hooks: PatrolHooks, obstacles: Obstacles | null, playerBustSeconds: number, seed: number) {
    this.seed = seed;
    this.ports = ports;
    this.hooks = hooks;
    this.pursuit = new PursuitDriver(obstacles);
    this.playerBustSeconds = playerBustSeconds;
    this.drivers = Array.from({ length: MAX_PATROL_CARS }, (_, slot): CarDriver => (self, cars, dt) => this.driveSlot(slot, self, cars, dt));
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

  /** The car of case `caseIndex`, stopped at its scene, takes the suspect cuffed aboard to (x, z) along the streets; false (it stays) when it is not there or finds no way. */
  convey(caseIndex: number, x: number, z: number, seconds: number): boolean {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.caseIndex[slot] !== caseIndex || this.mode[slot] !== PATROL_MODE.atScene) continue;
      if (!this.ports.redirect(this.handle[slot]!, x, z)) return false;
      this.wheel[slot] = 0;
      this.ports.setDriver(this.handle[slot]!, null);
      this.mode[slot] = PATROL_MODE.toStation;
      this.since[slot] = seconds;
      return true;
    }
    return false;
  }

  /** The foot case is over: its car's siren goes off and it is let go in a while. */
  finishCase(caseIndex: number, seconds: number): void {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.caseIndex[slot] === caseIndex && (this.mode[slot] === PATROL_MODE.toScene || this.mode[slot] === PATROL_MODE.atScene)) this.linger(slot, seconds, CAR_LINGER_SECONDS);
    }
  }

  /**
   * The pursuit strip's numbers for traffic car `carIndex` (a human's, whose hold is `playerBustSeconds`): how many patrol cars chase it, and the longest unbroken hold they have run on it as a share of the
   * bust hold (`hold`) and the seconds left of it (`left`): the race's own rule, `BUST`. False, `out` untouched, when none chases it.
   */
  chaseOf(carIndex: number, out: { cops: number; hold: number; left: number }): boolean {
    let cops = 0;
    let held = 0;
    let needed = this.playerBustSeconds;
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.mode[slot] !== PATROL_MODE.pursuing || this.targetCar[slot] !== carIndex) continue;
      cops++;
      if (this.heldFor[slot]! < held) continue;
      held = this.heldFor[slot]!;
      needed = this.holdNeeded(slot);
    }
    if (cops === 0) return false;
    out.cops = cops;
    out.hold = Math.min(1, held / needed);
    out.left = Math.max(0, needed - held);
    return true;
  }

  /** Whether a leased patrol car on the road within `range` m of (x, z) sees it (`lineOfSight` null: every line is clear). */
  sees(x: number, z: number, range: number, lineOfSight: LineOfSight | null): boolean {
    for (let slot = 0; slot < MAX_PATROL_CARS; slot++) {
      if (this.mode[slot] === PATROL_MODE.free) continue;
      const car = this.ports.snap(this.handle[slot]!);
      if (hypot2(car.x - x, car.z - z) <= range && (lineOfSight === null || lineOfSight(car.x, car.z, x, z))) return true;
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
        case PATROL_MODE.toStation:
          this.stepToStation(slot, seconds);
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
    this.yieldState[slot] = YIELD.none;
    this.since[slot] = seconds;
    this.hothead[slot] = crimeDraw(this.seed, CRIME_STREAM.hothead, 0, this.runs) < HOTHEAD_RUN_SHARE ? 1 : 0;
    this.runs++;
    this.ports.setSirens(handle, true);
    // A careful run is the traffic's own trip along the streets (a chase takes the wheel for its close-in stretch); a hothead's run is this driver's from the start.
    this.wheel[slot] = this.hothead[slot];
    this.redirectAt[slot] = seconds + REDIRECT_SECONDS;
    this.ports.setDriver(handle, this.wheel[slot] === 1 ? this.drivers[slot]! : null);
    return slot;
  }

  private stepToScene(slot: number, seconds: number): void {
    const car = this.ports.snap(this.handle[slot]!);
    const arrived = this.ports.arrived(this.handle[slot]!) || (hypot2(car.x - this.aimX[slot]!, car.z - this.aimZ[slot]!) <= CAR_ARRIVE_DISTANCE && hypot2(car.vx, car.vz) < CRAWL);
    if (arrived) {
      this.mode[slot] = PATROL_MODE.atScene;
      this.hooks.arrived(this.caseIndex[slot]!, car.x, car.z);
    } else if (seconds - this.since[slot]! > CAR_CHASE_GIVE_UP_SECONDS) this.linger(slot, seconds, CAR_LINGER_SECONDS);
  }

  private stepToStation(slot: number, seconds: number): void {
    if (!this.ports.arrived(this.handle[slot]!) && seconds - this.since[slot]! <= CONVEY_GIVE_UP_SECONDS) return;
    this.linger(slot, seconds, CAR_LINGER_SECONDS);
    this.hooks.delivered(this.caseIndex[slot]!);
  }

  private stepPursuit(slot: number, seconds: number, dt: number): void {
    const offender = this.ports.carSnap(this.targetCar[slot]!);
    if (offender === null || !offender.alive) {
      this.linger(slot, seconds, CAR_LINGER_SECONDS);
      return;
    }
    const cop = this.ports.snap(this.handle[slot]!);
    const gap = hypot2(offender.x - cop.x, offender.z - cop.z);
    if (this.hothead[slot] === 0) this.followStreets(slot, offender, gap, seconds);
    if (this.yieldState[slot] === YIELD.none) this.ports.evade(this.targetCar[slot]!, this.handle[slot]!);
    if (this.yieldState[slot] === YIELD.none && gap <= YIELD_DISTANCE) this.yieldState[slot] = this.ports.takeTraffic(this.targetCar[slot]!, this.stopDriver) ? YIELD.stopping : YIELD.refused;
    this.holdSlow(slot, offender, gap, dt);
    this.farFor[slot] = gap > CAR_LOST_DISTANCE ? this.farFor[slot]! + dt : 0;
    if (this.heldFor[slot]! >= this.holdNeeded(slot)) this.bust(slot, seconds);
    else if (this.farFor[slot]! >= CAR_LOST_SECONDS || seconds - this.since[slot]! > CAR_CHASE_GIVE_UP_SECONDS) this.linger(slot, seconds, CAR_LINGER_SECONDS);
  }

  /**
   * A careful chase drives the streets to the kerb nearest where the offender will be, re-aimed every `REDIRECT_SECONDS` and at once when the car has come to its space. Parked within `BUST.near` of the offender it
   * waits (the bust hold runs); come to a stop `CLOSE_PURSUIT_DISTANCE` m or less from one that is not that near (it left the road), this driver takes the wheel for the last metres, and gives it back once the
   * offender is `CHASE_RESUME_DISTANCE` off.
   */
  private followStreets(slot: number, offender: AiCar, gap: number, seconds: number): void {
    const handle = this.handle[slot]!;
    const arrived = this.wheel[slot] === 0 && this.ports.arrived(handle);
    if (arrived && gap <= CLOSE_PURSUIT_DISTANCE && gap > BUST.near) {
      this.wheel[slot] = 1;
      this.ports.setDriver(handle, this.drivers[slot]!);
      return;
    }
    if (arrived && gap <= BUST.near) return;
    if (this.wheel[slot] === 1 && gap <= CHASE_RESUME_DISTANCE) return;
    if (seconds < this.redirectAt[slot]! && !arrived) return;
    this.redirectAt[slot] = seconds + REDIRECT_SECONDS;
    if (!this.ports.redirect(handle, offender.x + offender.vx * CHASE_LEAD_SECONDS, offender.z + offender.vz * CHASE_LEAD_SECONDS)) return;
    this.wheel[slot] = 0;
    this.ports.setDriver(handle, null);
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
    if (this.targetCar[slot]! >= 0) this.ports.endEvade(this.targetCar[slot]!);
  }

  /** The car is let go; a car it held at the roadside goes back to its own driving. */
  private letGo(slot: number): void {
    if (this.targetCar[slot]! >= 0) this.ports.takeTraffic(this.targetCar[slot]!, null);
    this.ports.release(this.handle[slot]!);
    this.handle[slot] = -1;
    this.wheel[slot] = 0;
    this.mode[slot] = PATROL_MODE.free;
  }

  private driveSlot(slot: number, self: AiCar, cars: readonly AiCar[], dt: number): DriveInput {
    if (this.mode[slot] === PATROL_MODE.toScene) {
      this.pursuit.drive(slot, self, cars, -1, this.aimX[slot]!, this.aimZ[slot]!, 0, 0, CAR_STOP_GAP, Infinity, dt, this.out);
      return this.out;
    }
    const offender = this.mode[slot] === PATROL_MODE.pursuing ? this.ports.carSnap(this.targetCar[slot]!) : null;
    if (offender === null) return this.brakeOut();
    const crawling = this.yieldState[slot] === YIELD.stopping || hypot2(offender.vx, offender.vz) < CRAWL;
    // A careful car brakes ahead of the close-in stretch so it enters it at the street's pace.
    const beyond = Math.max(0, hypot2(offender.x - self.x, offender.z - self.z) - CLOSE_PURSUIT_DISTANCE);
    const cap = this.hothead[slot] === 0 ? Math.sqrt(CAREFUL_PURSUIT_SPEED * CAREFUL_PURSUIT_SPEED + 2 * CAR_STOP_DECEL * beyond) : Infinity;
    this.pursuit.drive(slot, self, cars, this.targetCar[slot]!, offender.x, offender.z, offender.vx, offender.vz, crawling ? CAR_STOP_GAP : 0, cap, dt, this.out);
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
