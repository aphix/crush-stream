import type { Obstacles } from "../ai/obstacles.ts";
import { EVENT_KIND } from "../ai/civilians/civilian-constants.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { CrimeScene } from "../ai/openworld-crime/crime-scene.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { StateOffenceSource } from "../ai/openworld-crime/state-offence-source.ts";
import { TrafficPatrolPorts, type TrafficApi } from "../ai/openworld-crime/traffic-patrol-ports.ts";
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
  /** Turns the light bar of car `carIndex` of the engine's list on or off. */
  sirens(carIndex: number, on: boolean): void;
  /** The human's car was held slow by a patrol car for Survival's bust hold. */
  playerBusted(carIndex: number, seconds: number): void;
};

/** The open world's police in the engine: the crime scene over the crowd's society, its foot cops drawn as a crowd of their own, a fighter taken down thrown as a figure. Made with the crowd, gone with it. */
export class OpenWorldLaw {
  private readonly scene: CrimeScene;
  private readonly crowd: CivilianCrowd;
  private readonly ports: LawEnginePorts;
  private readonly art: CopArt;
  private readonly unlisten: (() => void) | null;

  constructor(map: OpenWorldMap, crowd: CivilianCrowd, ports: LawEnginePorts, seed: number) {
    this.crowd = crowd;
    this.ports = ports;
    const traffic = ports.traffic();
    this.scene = new CrimeScene(
      map,
      new StateOffenceSource(crowd, map),
      { bust: (resident, seconds) => crowd.raiseEvent(EVENT_KIND.bust, resident, seconds), playerBusted: ports.playerBusted, cars: traffic === null ? null : new TrafficPatrolPorts(traffic, ports.sirens), obstacles: ports.solids(), playerBustSeconds: SURVIVAL.bustTime },
      seed,
    );
    this.unlisten = traffic?.onRedLightRun((carIndex, x, z) => void this.scene.reportRedLight(carIndex, x, z)) ?? null;
    this.art = ports.makeArt(FOOT_COP_COUNT);
  }

  /** After the crowd's step at crowd time `crowdSeconds`: the law advances, overlays the crowd's poses and throws the fighters it took down. */
  step(crowdSeconds: number, authority: boolean): void {
    this.scene.step(crowdSeconds, authority, this.crowd.poses);
    const strikes = this.scene.takeStrikes();
    for (let at = 0; at < strikes.length; at++) {
      const strike = strikes[at]!;
      const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
      dressOfLook(this.crowd.poses.look[strike.guard]!, look);
      this.ports.throwFigure(strike, look);
    }
  }

  /** Draws the foot cops. */
  frame(eyeX: number, eyeZ: number, sight: SightField, wallDt: number): void {
    this.art.update(this.scene.copPoses, eyeX, eyeZ, sight, wallDt);
  }

  /** A civilian a car ran down (the crowd's strike): the third in a minute by one car has a patrol car sent after it. */
  noteStrike(strike: FigureStrike): void {
    if (!strike.loose) this.scene.noteKnock(strike.car, strike.x, strike.z);
  }

  dispose(): void {
    this.unlisten?.();
    this.art.dispose();
  }
}
