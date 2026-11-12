import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, felled, runsDown, type FigureStrike } from "../../scenes/figure-strike.ts";
import { CAR_REACH } from "../../scenes/lawn-guard.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { COP_KO_BLOWS } from "../civilians/civilian-constants.ts";
import { punchGap } from "../civilians/civilian-contact.ts";
import { chestMet, type LookRay, type Meeting } from "../civilians/civilian-look.ts";
import type { CrowdPoses } from "../civilians/crowd-poses.ts";
import type { Obstacles } from "../obstacles.ts";
import { fillCopPoses, newCopPoses, overlaySuspects } from "./crime-poses.ts";
import { CRIME_HZ, CRIME_STEP_SECONDS, FOOT_COP_COUNT, GRID_EPSILON, HEARD_COP_DOWN_LATE_SECONDS, HEAT_CARS, HEAT_KNOCKS, HEAT_SECONDS, MAX_STEPS_PER_CALL, RED_LIGHT_SIGHT } from "./crime-constants.ts";
import { FootLaw } from "./foot-law.ts";
import type { CrossingSignals, LawPorts, LineOfSight, OffenceSource } from "./offence-source.ts";
import { PatrolCars, type PatrolCarPorts } from "./patrol-cars.ts";
import type { ArrestCars } from "./arrests.ts";

/** What the law needs of the engine. */
export interface CrimePorts extends LawPorts {
  /** The human's car `carIndex` was held slow by a patrol car long enough: what a bust of the player means is the engine's. */
  playerBusted(carIndex: number, seconds: number): void;
  /** The traffic's cars for the law to lease; null: the law is on foot. */
  cars: PatrolCarPorts | null;
  /** The cars an arrest rides in when the law has no patrol cars of its own (a client's view of the host's); null: none. */
  rides: ArrestCars | null;
  /** The course's solids the patrol cars bend round; null: they drive straight at their aim. */
  obstacles: Obstacles | null;
  /** Seconds a human is held slow beside a patrol car before the bust (Survival's hold). */
  playerBustSeconds: number;
  /** The sight lines between people past the course's buildings; null: open ground, every line clear. */
  lineOfSight: LineOfSight | null;
  /** The signals the crossings obey; null: no signals, nobody is stopped for jaywalking. */
  signals: CrossingSignals | null;
}

/**
 * The open world's police: foot cops and patrol cars answering the crimes and fights the society holds against its residents, the red lights cars run and the walkers who cross against them. `step` once per sim step on the host and solo player, once
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
  /** Per foot cop: the crowd second of the latest knock heard or found (the host's event), and one waiting for this peer's clock (-1 none). */
  private readonly copDownAt = new Float64Array(FOOT_COP_COUNT).fill(-1);
  private readonly copDownDue = new Float64Array(FOOT_COP_COUNT).fill(-1);
  private readonly copBlows = new Uint8Array(FOOT_COP_COUNT);
  private copStrikes: FigureStrike[] = [];
  /** The share of the grid step after the last one taken that the poses were drawn at. */
  drawShare = 0;

  constructor(map: OpenWorldMap, source: OffenceSource, ports: CrimePorts, seed: number) {
    this.ports = ports;
    this.law = new FootLaw(map, source, ports, { opened: (caseIndex, x, z) => this.patrol?.dispatchToScene(caseIndex, x, z, this.law.seconds), closed: (caseIndex) => this.patrol?.finishCase(caseIndex, this.law.seconds), cars: () => this.patrol, rides: () => this.patrol ?? ports.rides }, seed, { lineOfSight: ports.lineOfSight, signals: ports.signals, otherCopsSee: (x, z, range) => this.patrol?.sees(x, z, range, ports.lineOfSight) ?? false }, ports.playerBustSeconds);
    this.patrol = ports.cars === null ? null : new PatrolCars(ports.cars, { arrived: (caseIndex, x, z) => this.law.carCopArrived(caseIndex, x, z), busted: (resident, carIndex, seconds) => this.bustDriver(resident, carIndex, seconds), delivered: (slot) => this.law.carDelivered(slot) }, ports.obstacles, ports.playerBustSeconds, seed);
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

  /**
   * Advances to crowd time `crowdSeconds` on the fixed grid, then writes the cops' poses and the suspects' over `crowdPoses` (the crowd's, just stepped), blended between the last two grid
   * steps; on the host, a car whose path meets a drawn cop runs him down (`cars`, the engine's).
   */
  step(crowdSeconds: number, authority: boolean, crowdPoses: CrowdPoses, cars: readonly DeformableCar[]): void {
    this.authority = authority;
    this.law.authority = authority;
    if (!authority) this.law.player.body.present = false;
    const target = Math.floor(crowdSeconds * CRIME_HZ + GRID_EPSILON);
    if (target - this.law.steps > MAX_STEPS_PER_CALL) this.law.fastForward(target - MAX_STEPS_PER_CALL);
    while (this.law.steps < target) {
      this.law.advance();
      this.patrol?.step(this.law.seconds, CRIME_STEP_SECONDS);
    }
    this.applyDueCopDowns(cars);
    this.drawShare = Math.min(1, Math.max(0, (crowdSeconds - this.law.seconds) * CRIME_HZ));
    overlaySuspects(this.law, crowdPoses, this.drawShare);
    fillCopPoses(this.law, this.copPoses, this.drawShare);
    if (authority) this.findCopHits(cars, crowdSeconds);
  }

  /** The host's knock of foot cop `cop` at crowd second `seconds`, heard (a client) or its own echoed back: applied once, when this peer's clock reaches it. */
  hearCopDown(cop: number, seconds: number): void {
    if (cop < 0 || cop >= FOOT_COP_COUNT || seconds <= this.copDownAt[cop]!) return;
    this.copDownAt[cop] = seconds;
    this.copDownDue[cop] = seconds;
  }

  /** The cops run down since the last call (the host's own hits, a client's heard ones): the engine throws them dressed as police. */
  takeCopStrikes(): readonly FigureStrike[] {
    if (this.copStrikes.length === 0) return this.copStrikes;
    const out = this.copStrikes;
    this.copStrikes = [];
    return out;
  }

  /** The host's hit test, the crowd's own (`runsDown` within `CAR_REACH`) on each drawn cop: a hit throws him and is the host's event. */
  private findCopHits(cars: readonly DeformableCar[], seconds: number): void {
    const poses = this.copPoses;
    const ground = activeGround();
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (poses.shown[cop] === 0) continue;
      const x = poses.x[cop]!;
      const z = poses.z[cop]!;
      for (let carIndex = 0; carIndex < cars.length; carIndex++) {
        const car = cars[carIndex]!;
        if (hypot2(car.group.position.x - x, car.group.position.z - z) > CAR_REACH) continue;
        const groundY = ground.heightAt(x, z);
        if (!runsDown(car, x, z, groundY)) continue;
        this.runCopDown(cop, car, carIndex, groundY, seconds);
        break;
      }
    }
  }

  /** Car `carIndex` ran cop `cop` down where he was drawn: thrown by it, down in the law, hidden, and the host's event raised. */
  private runCopDown(cop: number, car: DeformableCar, carIndex: number, groundY: number, seconds: number): void {
    const poses = this.copPoses;
    this.downCop(cop, fell(car, carIndex, cop, poses.x[cop]!, groundY, poses.z[cop]!, detSin(poses.yaw[cop]!), detCos(poses.yaw[cop]!), blankStrike()), seconds);
  }

  /** Cop `cop` is down at crowd second `seconds`, thrown by `strike`: down in the law, hidden, and the host's event raised. */
  private downCop(cop: number, strike: FigureStrike, seconds: number): void {
    this.copStrikes.push(strike);
    this.copDownAt[cop] = seconds;
    this.law.knockCop(cop, seconds);
    this.copPoses.shown[cop] = 0;
    this.ports.copDown(cop, seconds);
  }

  /** The player's punch from (x, z) along (dirX, dirZ): the nearest shown foot cop in reach and arc takes it, the law knows of the fight at once, and his `COP_KO_BLOWS`th blow puts the cop down. False when no cop was hit, or without authority. */
  punchCop(x: number, z: number, dirX: number, dirZ: number, seconds: number): boolean {
    if (!this.authority) return false;
    const poses = this.copPoses;
    let nearest = -1;
    let nearestGap = Infinity;
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (poses.shown[cop] === 0) continue;
      const gap = punchGap(x, z, dirX, dirZ, poses.x[cop]!, poses.z[cop]!);
      if (gap < 0 || gap >= nearestGap) continue;
      nearestGap = gap;
      nearest = cop;
    }
    if (nearest < 0) return false;
    this.law.player.fightKnown(seconds);
    if (++this.copBlows[nearest]! >= COP_KO_BLOWS) {
      this.copBlows[nearest] = 0;
      this.downCop(nearest, felled(nearest, poses.x[nearest]!, activeGround().heightAt(poses.x[nearest]!, poses.z[nearest]!), poses.z[nearest]!, dirX, dirZ, blankStrike()), seconds);
    }
    return true;
  }

  /** The player on foot started a fight at crowd second `seconds`: the law knows at once. */
  playerFought(seconds: number): void {
    this.law.player.fightKnown(seconds);
  }

  /** The shown foot cop whose chest the ray passes within `radius` m, nearer than `reach` (`chestMet`). */
  copMet(ray: LookRay, radius: number, reach: number, out: Meeting): Meeting {
    return chestMet(this.copPoses, FOOT_COP_COUNT, null, ray, radius, reach, out);
  }

  /** A bullet takes foot cop `cop`: down as a car's knock puts him, thrown along the shot. Authority only. */
  shootCop(cop: number, dirX: number, dirZ: number, seconds: number): void {
    if (!this.authority || this.copPoses.shown[cop] === 0) return;
    const poses = this.copPoses;
    this.downCop(cop, felled(cop, poses.x[cop]!, activeGround().heightAt(poses.x[cop]!, poses.z[cop]!), poses.z[cop]!, dirX, dirZ, blankStrike()), seconds);
  }

  /** A heard knock whose time this peer's clock has reached: the cop goes down, thrown by the car nearest him when it is fresh (as a heard civilian's knock is). */
  private applyDueCopDowns(cars: readonly DeformableCar[]): void {
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      const due = this.copDownDue[cop]!;
      if (due < 0 || this.law.seconds < due) continue;
      this.copDownDue[cop] = -1;
      if (!this.law.cops.onStreet(cop)) continue;
      this.law.knockCop(cop, due);
      if (this.law.seconds - due <= HEARD_COP_DOWN_LATE_SECONDS) this.throwFromNearest(cop, cars);
    }
  }

  private throwFromNearest(cop: number, cars: readonly DeformableCar[]): void {
    const { walkers } = this.law;
    const x = walkers.x[cop]!;
    const z = walkers.z[cop]!;
    let nearest = -1;
    let nearestGap = Infinity;
    for (let carIndex = 0; carIndex < cars.length; carIndex++) {
      const gap = hypot2(cars[carIndex]!.group.position.x - x, cars[carIndex]!.group.position.z - z);
      if (gap >= nearestGap) continue;
      nearestGap = gap;
      nearest = carIndex;
    }
    if (nearest < 0) return;
    this.copStrikes.push(fell(cars[nearest]!, nearest, cop, x, activeGround().heightAt(x, z), z, detSin(walkers.yaw[cop]!), detCos(walkers.yaw[cop]!), blankStrike()));
  }

  /** A car ran a red light at (x, z). A cop who saw it (in range and in sight past the buildings, on foot or in a car) sends a patrol car after it; true when one was sent. */
  reportRedLight(carIndex: number, x: number, z: number): boolean {
    if (this.patrol === null) return false;
    if (!this.law.copSees(x, z, RED_LIGHT_SIGHT) && !this.patrol.sees(x, z, RED_LIGHT_SIGHT, this.ports.lineOfSight)) return false;
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

  /** The player on foot, from the engine: where he stands, which way he faces and how fast he moves; judged only on the host and the solo player. */
  setFoot(present: boolean, x: number, z: number, dirX: number, dirZ: number, speed: number): void {
    this.law.player.set(present, x, z, dirX, dirZ, speed);
  }

  /** The player on foot shoved a civilian at crowd second `seconds`. */
  playerShoved(seconds: number): void {
    this.law.player.shoved(seconds);
  }

  /** The pursuit strip's numbers for the player on foot: see `PlayerLaw.chaseOf`. */
  footChaseOf(out: { cops: number; hold: number; left: number }): boolean {
    return this.law.player.chaseOf(out);
  }

  /** The pursuit strip's numbers for car `carIndex`: see `PatrolCars.chaseOf`. */
  chaseOf(carIndex: number, out: { cops: number; hold: number; left: number }): boolean {
    return this.patrol !== null && this.patrol.chaseOf(carIndex, out);
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
