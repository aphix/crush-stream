import type { FigureStrike } from "../../scenes/figure-strike.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import type { CrowdPoses } from "../civilians/crowd-poses.ts";
import type { Obstacles } from "../obstacles.ts";
import { fillCopPoses, newCopPoses, overlaySuspects } from "./crime-poses.ts";
import { CRIME_HZ, CRIME_STEP_SECONDS, GRID_EPSILON, HEAT_CARS, HEAT_KNOCKS, HEAT_SECONDS, MAX_STEPS_PER_CALL, RED_LIGHT_SIGHT } from "./crime-constants.ts";
import { FootLaw } from "./foot-law.ts";
import type { LawPorts, OffenceSource } from "./offence-source.ts";
import { PatrolCars, type PatrolCarPorts } from "./patrol-cars.ts";

/** What the law needs of the engine. */
export interface CrimePorts extends LawPorts {
  /** The human's car `carIndex` was held slow by a patrol car long enough: what a bust of the player means is the engine's. */
  playerBusted(carIndex: number, seconds: number): void;
  /** The traffic's cars for the law to lease; null: the law is on foot. */
  cars: PatrolCarPorts | null;
  /** The course's solids the patrol cars bend round; null: they drive straight at their aim. */
  obstacles: Obstacles | null;
  /** Seconds a human is held slow beside a patrol car before the bust (Survival's hold). */
  playerBustSeconds: number;
}

/**
 * The open world's police: foot cops and patrol cars answering the crimes and fights the society holds against its residents, and the red lights run. `step` once per sim step on the host and solo player, once
 * a frame on a client (which raises no events); then `copPoses` and the overlay on the crowd's poses are ready to draw.
 */
export class CrimeScene {
  readonly copPoses: CrowdPoses = newCopPoses();
  private readonly law: FootLaw;
  private readonly patrol: PatrolCars | null;
  private readonly ports: CrimePorts;
  private authority = false;
  /** Per car: the civilians it ran down in the current minute and when that minute began. */
  private readonly heatKnocks = new Uint8Array(HEAT_CARS);
  private readonly heatSince = new Float64Array(HEAT_CARS);

  constructor(map: OpenWorldMap, source: OffenceSource, ports: CrimePorts, seed: number) {
    this.ports = ports;
    this.law = new FootLaw(map, source, ports, { opened: (caseIndex, x, z) => this.patrol?.dispatchToScene(caseIndex, x, z, this.law.seconds), closed: (caseIndex) => this.patrol?.finishCase(caseIndex, this.law.seconds) }, seed);
    this.patrol = ports.cars === null ? null : new PatrolCars(ports.cars, { arrived: (caseIndex, x, z) => this.law.carCopArrived(caseIndex, x, z), busted: (resident, carIndex, seconds) => this.bustDriver(resident, carIndex, seconds) }, ports.obstacles, ports.playerBustSeconds);
  }

  get stats(): FootLaw["stats"] {
    return this.law.stats;
  }

  /** Whether patrol cars are available (the traffic's cars were given). */
  get patrolling(): boolean {
    return this.patrol !== null;
  }

  /** The law's foot side, for what reads it (the drawn cops' look, rows). */
  get foot(): FootLaw {
    return this.law;
  }

  /** Advances to crowd time `crowdSeconds` on the fixed grid, then writes the cops' poses and the suspects' over `crowdPoses` (the crowd's, just stepped). */
  step(crowdSeconds: number, authority: boolean, crowdPoses: CrowdPoses): void {
    this.authority = authority;
    this.law.authority = authority;
    const target = Math.floor(crowdSeconds * CRIME_HZ + GRID_EPSILON);
    if (target - this.law.steps > MAX_STEPS_PER_CALL) this.law.fastForward(target - MAX_STEPS_PER_CALL);
    while (this.law.steps < target) {
      this.law.advance();
      this.patrol?.step(this.law.seconds, CRIME_STEP_SECONDS);
    }
    overlaySuspects(this.law, crowdPoses);
    fillCopPoses(this.law, this.copPoses);
  }

  /** A car ran a red light at (x, z). A cop who saw it (one in sight, on foot or in a car) sends a patrol car after it; true when one was sent. */
  reportRedLight(carIndex: number, x: number, z: number): boolean {
    if (this.patrol === null) return false;
    if (!this.law.copWithin(x, z, RED_LIGHT_SIGHT) && !this.patrol.within(x, z, RED_LIGHT_SIGHT)) return false;
    return this.patrol.chase(carIndex, x, z, this.law.seconds);
  }

  /** Car `carIndex` ran a civilian down at (x, z): the third in a minute sends a patrol car after it, whoever saw it. True when one was sent. The host's call only. */
  noteKnock(carIndex: number, x: number, z: number): boolean {
    if (this.patrol === null || !this.authority || carIndex < 0 || carIndex >= HEAT_CARS) return false;
    const now = this.law.seconds;
    if (now - this.heatSince[carIndex]! > HEAT_SECONDS || this.heatKnocks[carIndex] === 0) {
      this.heatSince[carIndex] = now;
      this.heatKnocks[carIndex] = 0;
    }
    this.heatKnocks[carIndex]! += 1;
    if (this.heatKnocks[carIndex]! < HEAT_KNOCKS) return false;
    this.heatKnocks[carIndex] = 0;
    return this.patrol.chase(carIndex, x, z, now);
  }

  /** The fighters taken down since the last call: the engine throws them as figures. */
  takeStrikes(): readonly FigureStrike[] {
    return this.law.takeStrikes();
  }

  private bustDriver(resident: number, carIndex: number, seconds: number): void {
    if (!this.authority) return;
    if (resident >= 0) this.ports.bust(resident, seconds);
    else this.ports.playerBusted(carIndex, seconds);
  }
}
