import type { Obstacles } from "../ai/obstacles.ts";
import { EVENT_KIND, EVENT_TRIPLE } from "../ai/civilians/civilian-constants.ts";
import type { CrowdWalkers } from "../ai/civilians/crowd-walkers.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { ChaseHud } from "../hud/hud-store.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { LookRay, Meeting } from "../ai/civilians/civilian-look.ts";
import { CrimeScene } from "../ai/openworld-crime/crime-scene.ts";
import { COP_LOOK, FACING_SPEED, FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import type { FootArrestPorts, LineOfSight } from "../ai/openworld-crime/offence-source.ts";
import { StateOffenceSource } from "../ai/openworld-crime/state-offence-source.ts";
import { TrafficPatrolPorts, type TrafficApi } from "../ai/openworld-crime/traffic-patrol-ports.ts";
import { TrafficSignals } from "../ai/openworld-crime/traffic-signals.ts";
import { ArrestRides } from "./engine-openworld-arrest-rides.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import { SURVIVAL } from "../match/survival.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { SightField } from "../present/openworld-sight.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { OpenWorldMap } from "../world/openworld/walk-graph.ts";

/** The foot cops' drawing: the crowd art over their own poses. */
type CopArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: SightField, wallDt: number): void;
  dispose(): void;
};

/** What the law takes from the engine beyond the crowd's own ports. */
export type LawEnginePorts = {
  makeArt(capacity: number): CopArt;
  throwFigure(strike: FigureStrike, look: DriverLook): void;
  /** The open world's traffic, whose pool cars patrol cars are leased from and whose red-light runners the law hears; null: the law is on foot. */
  traffic(): TrafficApi | null;
  /** The course's solids the patrol cars bend round; null: they drive straight. */
  solids(): Obstacles | null;
  /** Whether a person at (ax, az) sees one at (bx, bz) past the course's buildings. */
  lineOfSight: LineOfSight;
  /** Turns the light bar of car `carIndex` of the engine's list on or off. */
  sirens(carIndex: number, on: boolean): void;
  /** The human's car was held slow by a patrol car for Survival's bust hold. */
  playerBusted(carIndex: number, seconds: number): void;
  /** Where the player on foot stands and how fast he moves (m/s); false while he is in a car. */
  foot(out: { x: number; z: number; velocityX: number; velocityZ: number }): boolean;
  /** The player on foot was held by a cop for the bust hold: the engine's arrest of him (his walker led to a patrol car and the station, then set down). */
  footArrest: FootArrestPorts;
  /** The engine's cars, which run the foot cops down as they do civilians. */
  cars(): readonly DeformableCar[];
};

/**
 * The open world's police in the engine: the crime scene over the crowd's society, its foot cops drawn as a crowd of their own and standing in the crowd as bodies it steps round, a fighter taken
 * down or a cop run down thrown as a figure. Made with the crowd, gone with it.
 */
export class OpenWorldLaw {
  private readonly scene: CrimeScene;
  private readonly crowd: CivilianCrowd;
  private readonly ports: LawEnginePorts;
  private readonly art: CopArt;
  private readonly unlisten: (() => void) | null;
  /** A client's view of the host's patrol cars (it has no traffic); null where the law has the traffic's own. */
  private readonly rides: ArrestRides | null;
  private readonly body = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  /** The way he last moved (a unit vector): which way he faces while he stands still. */
  private facingX = 0;
  private facingZ = 1;
  private shoveSeconds = -Infinity;

  constructor(map: OpenWorldMap, crowd: CivilianCrowd, ports: LawEnginePorts, seed: number) {
    this.crowd = crowd;
    this.ports = ports;
    const traffic = ports.traffic();
    this.rides = traffic === null ? new ArrestRides(() => ports.cars()) : null;
    this.scene = new CrimeScene(
      map,
      new StateOffenceSource(crowd, map),
      {
        bust: (resident, seconds) => crowd.raiseEvent(EVENT_KIND.bust, resident, seconds),
        jaywalked: (resident, seconds) => crowd.raiseEvent(EVENT_KIND.jaywalk, resident, seconds),
        copDown: (cop, seconds) => crowd.raiseEvent(EVENT_KIND.copDown, cop, seconds),
        rode: (resident, carIndex, seconds) => this.logRide(EVENT_KIND.arrestRide, resident, carIndex, seconds),
        alighted: (resident, carIndex, seconds) => this.logRide(EVENT_KIND.arrestAlight, resident, carIndex, seconds),
        footArrest: ports.footArrest,
        // Every peer builds the signals from the layout (the traffic is the host's only), so every peer's cops see the same jaywalkers.
        signals: new TrafficSignals(buildRoadNetwork(openWorldGeometry(LAYOUT))),
        playerBusted: ports.playerBusted, cars: traffic === null ? null : new TrafficPatrolPorts(traffic, ports.sirens), rides: this.rides, obstacles: ports.solids(), playerBustSeconds: SURVIVAL.bustTime,
        lineOfSight: ports.lineOfSight,
      },
      seed,
    );
    this.unlisten = traffic?.onRedLightRun((carIndex, x, z) => void this.scene.reportRedLight(carIndex, x, z)) ?? null;
    this.art = ports.makeArt(FOOT_COP_COUNT);
    crowd.overlay = (poses, crowdSeconds, authority) => {
      this.hearCopDowns();
      this.feedFoot();
      this.hearShoves(authority);
      this.scene.step(crowdSeconds, authority, poses, ports.cars());
    };
  }

  /** Whether the police have the traffic's cars to patrol in (false: they are on foot). */
  /** The foot cops' poses, as drawn: where each is, what he is doing. */
  get copPoses(): CrowdPoses {
    return this.scene.copPoses;
  }

  get patrolling(): boolean {
    return this.scene.patrolling;
  }

  /** After the crowd's step (the law advanced and overlaid the crowd's poses inside it, before the cars' hits): throws the fighters it took down, in their own clothes, and the cops run down, in uniform. */
  throwTakedowns(): void {
    const strikes = this.scene.takeStrikes();
    for (let at = 0; at < strikes.length; at++) this.throwDressed(strikes[at]!, this.crowd.poses.look[strikes[at]!.guard]!);
    const copStrikes = this.scene.takeCopStrikes();
    for (let at = 0; at < copStrikes.length; at++) this.throwDressed(copStrikes[at]!, COP_LOOK);
  }

  /** Before each crowd step: every foot cop on the street is a body the civilians step round (he gives no way and shoves nobody), where he was drawn last. */
  feedCops(walkers: CrowdWalkers): void {
    const poses = this.scene.copPoses;
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (poses.shown[cop] === 0) continue;
      const speed = poses.speed[cop]!;
      walkers.addBody(poses.x[cop]!, poses.z[cop]!, detSin(poses.yaw[cop]!) * speed, detCos(poses.yaw[cop]!) * speed);
    }
  }

  /** Before the law's step: where the player on foot is, for it to judge (the host's and the solo player's only: a client's walker is nobody's to judge here). */
  private feedFoot(): void {
    const body = this.body;
    const there = this.ports.foot(body);
    const speed = hypot2(body.velocityX, body.velocityZ);
    if (speed > FACING_SPEED) {
      this.facingX = body.velocityX / speed;
      this.facingZ = body.velocityZ / speed;
    }
    this.scene.setFoot(there, body.x, body.z, this.facingX, this.facingZ, speed);
  }

  /** The crowd's log's shoves by the player on foot (a `walker` triple follows the push it belongs to) since the last one this law answered: a cop who sees one comes for him. */
  private hearShoves(authority: boolean): void {
    const log = this.crowd.eventLog();
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      if (log[at] !== EVENT_KIND.walker || log[at + 2]! <= this.shoveSeconds) continue;
      this.shoveSeconds = log[at + 2]!;
      if (authority) this.scene.playerShoved(this.shoveSeconds);
    }
  }

  private throwDressed(strike: FigureStrike, lookWord: number): void {
    const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
    dressOfLook(lookWord, look);
    this.ports.throwFigure(strike, look);
  }

  /** The host's knocks of foot cops in the crowd's event log (heard on a client, its own on the host), for the scene to apply once each. */
  private hearCopDowns(): void {
    const log = this.crowd.eventLog();
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      if (log[at] === EVENT_KIND.copDown) this.scene.hearCopDown(log[at + 1]!, log[at + 2]!);
    }
  }

  /** A client, once a frame: the host's patrol car rides and alightings in the crowd's log, which seat and unseat the pairs its own law is walking to the station. */
  hearRides(): void {
    this.rides?.hear(this.crowd.eventLog(), this.scene.foot.arrests, this.scene.foot.seconds);
  }

  /** The host's ride or alighting in the crowd's log: the arrested resident, then the car (two entries of `kind` at one crowd second), which a client pairs. */
  private logRide(kind: number, resident: number, carIndex: number, seconds: number): void {
    this.crowd.raiseEvent(kind, resident, seconds);
    this.crowd.raiseEvent(kind, carIndex, seconds);
  }

  /** Draws the foot cops. */
  frame(eyeX: number, eyeZ: number, sight: SightField, wallDt: number): void {
    this.art.update(this.scene.copPoses, eyeX, eyeZ, sight, wallDt);
  }

  /** The pursuit strip's numbers for the player on foot into `out`: see `PlayerLaw.chaseOf`. */
  footChaseOf(out: ChaseHud): boolean {
    return this.scene.footChaseOf(out);
  }

  /** The pursuit strip's numbers for car `carIndex` into `out`: see `PatrolCars.chaseOf`. */
  chaseOf(carIndex: number, out: ChaseHud): boolean {
    return this.scene.chaseOf(carIndex, out);
  }

  /** A civilian a car ran down (the crowd's strike): the third in a minute by one car has a patrol car sent after it. */
  noteStrike(strike: FigureStrike): void {
    if (!strike.loose) this.scene.noteKnock(strike.car, strike.x, strike.z);
  }

  /** The player's punch lands on a foot cop (the scene refuses without authority). */
  punchCop(x: number, z: number, dirX: number, dirZ: number, seconds: number): boolean {
    return this.scene.punchCop(x, z, dirX, dirZ, seconds);
  }

  /** His punch landed on a civilian: the law hears a shove, or (`grave`, a knock-out) knows of the fight at once. */
  playerStruck(seconds: number, grave: boolean): void {
    if (grave) this.scene.playerFought(seconds);
    else this.scene.playerShoved(seconds);
  }

  copMet(ray: LookRay, radius: number, reach: number, out: Meeting): Meeting {
    return this.scene.copMet(ray, radius, reach, out);
  }

  shootCop(cop: number, dirX: number, dirZ: number, seconds: number): void {
    this.scene.shootCop(cop, dirX, dirZ, seconds);
  }

  /** A shot was fired: the law knows at once, seen or not. */
  playerFired(seconds: number): void {
    this.scene.playerFought(seconds);
  }

  dispose(): void {
    this.crowd.overlay = null;
    this.unlisten?.();
    this.art.dispose();
  }
}
