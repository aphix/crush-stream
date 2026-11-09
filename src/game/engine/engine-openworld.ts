import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { SightField } from "../present/openworld-sight.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { OpenWorldMap } from "../world/openworld/walk-graph.ts";
import { ClientCrowdClock, CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import { CROWD_SEED_MASK, CROWD_TIER_SCALE, LOOK_HZ, POPULATION } from "../ai/civilians/civilian-crowd-constants.ts";
import { lookAtOf, LookRay, type LookText } from "../ai/civilians/civilian-look.ts";
import { CivilianRemote } from "../ai/civilians/civilian-remote.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import type { CrowdLink } from "../net/net-ports.ts";
import { OpenWorldLaw, type LawEnginePorts } from "./engine-openworld-law.ts";

const NO_EVENTS = new Float64Array(0);

/** The drawn crowd: `update` once a frame after the crowd's step. */
type CrowdArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: SightField, wallDt: number): void;
  dispose(): void;
};

/** What the open world needs of the engine. */
type OpenWorldPorts = {
  /** The open world's course is up (solo, or in a room's lobby). */
  inOpenWorld(): boolean;
  /** A netplay client: it hears the host's crowd instead of making its own. */
  isClient(): boolean;
  /** This run's seed: the host's and the solo player's crowd is made from it. */
  seed(): number;
  /** The population tier of this device (`POPULATION_TIER`). */
  tier(): number;
  cars(): readonly DeformableCar[];
  /** Writes where this browser's player on foot stands; false while he is in a car. */
  foot(out: { x: number; z: number }): boolean;
  /** This machine's wall clock (s). */
  now(): number;
  /** Writes where the eye is and which way it looks. */
  eye(ray: LookRay): void;
  /** A civilian run down is thrown dressed as the crowd draws them (`look`). */
  throwFigure(strike: FigureStrike, look: DriverLook): void;
  /** Calls `listener` for every solid a car meets (closing speed, contact point) until the returned function is called. */
  hookWallHits(listener: (closing: number, x: number, z: number) => void): () => void;
  makeArt(capacity: number): CrowdArt;
  /** The police's extra ports (patrol cars, the course's solids, a busted player); absent: foot cops only. */
  law?: Pick<LawEnginePorts, "patrolCars" | "solids" | "playerBusted">;
};

/**
 * The open world's society and crowd in the engine: made when the course is up and a map is given (`startOpenWorld`), stepped with the sim (host and solo) or by the host's clock (a client), drawn each frame, and gone when the
 * course is left. It is the crowd's end of the netplay crowd message (`CrowdLink`) and answers the look-at panel.
 */
export class OpenWorldDirector {
  private readonly ports: OpenWorldPorts;
  private map: OpenWorldMap | null = null;
  private crowd: CivilianCrowd | null = null;
  private art: CrowdArt | null = null;
  private law: OpenWorldLaw | null = null;
  private unhook: (() => void) | null = null;
  private crowdKey = 0;
  /** The host's (or solo player's) crowd clock: the sim's seconds since the crowd was made. */
  private seconds = 0;
  private readonly clock = new ClientCrowdClock();
  private heardKey = 0;
  private heardEvents: Float64Array = NO_EVENTS;
  private hasHeard = false;
  private readonly ray = new LookRay();
  private text: LookText | null = null;
  private lookAcc = 0;
  readonly sight: SightField = { seen: () => true };
  private readonly foot = { x: 0, z: 0 };
  private footTracked = false;
  private footLastX = 0;
  private footLastZ = 0;
  private footVelocityX = 0;
  private footVelocityZ = 0;

  constructor(ports: OpenWorldPorts) {
    this.ports = ports;
  }

  /** The map the crowd lives on; the crowd is made from it on the next frame in the open world. */
  startOpenWorld(map: OpenWorldMap): void {
    this.stop();
    this.map = map;
  }

  /** The crowd's end of the crowd message while the open world is up, else null. */
  link(): CrowdLink | null {
    return this.map !== null && this.ports.inOpenWorld() ? this : null;
  }

  /** The crowd's key (`CROWD_TIER_SCALE`): the population tier above the scene seed. A client has the host's. */
  get seed(): number {
    return this.ports.isClient() ? this.heardKey : this.hostKey();
  }

  crowdTime(): number {
    return this.crowd?.crowdSeconds ?? 0;
  }

  eventLog(): Float64Array {
    return this.crowd?.eventLog() ?? NO_EVENTS;
  }

  hear(seed: number, hostTime: number, crowdTime: number, events: Float64Array): void {
    this.heardKey = seed;
    this.heardEvents = events;
    this.hasHeard = true;
    this.clock.hear(hostTime, crowdTime, this.ports.now());
    if (this.crowd !== null && this.crowdKey === seed) this.crowd.hear(events);
  }

  /** What the look-at panel shows, null when the eye rests on nothing. */
  lookAt(): LookText | null {
    return this.text;
  }

  /** A sim step of `dt` s: the host's and the solo player's crowd takes it. */
  step(dt: number): void {
    if (this.crowd === null || this.ports.isClient()) return;
    this.seconds += dt;
    this.feedWalkers(this.crowd);
    this.crowd.step(this.seconds, this.ports.cars(), true);
    this.throwStruck(this.crowd);
    this.law?.step(this.seconds, true);
  }

  /** A frame: the crowd is made, rebuilt on a new seed or dropped as the course comes and goes; a client steps it by the host's clock; the crowd is drawn and the look-at text kept up. */
  frame(wallDt: number): void {
    if (this.map === null || !this.ports.inOpenWorld()) {
      this.stop();
      return;
    }
    const client = this.ports.isClient();
    if (client && !this.hasHeard) return;
    const key = client ? this.heardKey : this.hostKey();
    if (this.crowd === null || this.crowdKey !== key) this.start(this.map, key, client);
    const crowd = this.crowd!;
    this.trackFoot(wallDt);
    if (client) {
      this.feedWalkers(crowd);
      crowd.step(this.clock.crowdSeconds(this.ports.now(), INTERP_DELAY), this.ports.cars(), false);
      this.throwStruck(crowd);
      this.law?.step(crowd.crowdSeconds, false);
    }
    this.ports.eye(this.ray);
    this.art!.update(crowd.poses, this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    this.law?.frame(this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    this.lookAcc += wallDt;
    if (this.lookAcc >= 1 / LOOK_HZ) {
      this.lookAcc = 0;
      this.text = this.keepIfSame(lookAtOf(crowd.state, crowd.poses, tickAt(crowd.crowdSeconds), this.ray));
    }
  }

  /** The crowd, its drawing and its worker are gone. */
  stop(): void {
    if (this.crowd === null) return;
    this.unhook?.();
    this.art?.dispose();
    this.law?.dispose();
    this.crowd.dispose();
    this.unhook = null;
    this.art = null;
    this.law = null;
    this.crowd = null;
    this.text = null;
  }

  /** Once a frame: where the player on foot stands and how fast he moves (how far he went since the last frame). */
  private trackFoot(wallDt: number): void {
    const wasTracked = this.footTracked;
    this.footTracked = this.ports.foot(this.foot);
    if (!this.footTracked) return;
    const moving = wasTracked && wallDt > 0;
    this.footVelocityX = moving ? (this.foot.x - this.footLastX) / wallDt : 0;
    this.footVelocityZ = moving ? (this.foot.z - this.footLastZ) / wallDt : 0;
    this.footLastX = this.foot.x;
    this.footLastZ = this.foot.z;
  }

  /** The player on foot is a body the crowd makes room round and can shove. */
  private feedWalkers(crowd: CivilianCrowd): void {
    crowd.walkers.clear();
    if (this.footTracked) crowd.walkers.add(this.foot.x, this.foot.z, this.footVelocityX, this.footVelocityZ);
  }

  private hostKey(): number {
    return (this.ports.tier() * CROWD_TIER_SCALE + (this.ports.seed() & CROWD_SEED_MASK)) >>> 0;
  }

  private start(map: OpenWorldMap, key: number, client: boolean): void {
    this.stop();
    const tier = Math.floor(key / CROWD_TIER_SCALE);
    const remote = CivilianRemote.open((err) => console.error("Crush Stream civilian worker failed", err));
    this.crowd = new CivilianCrowd(map, key & CROWD_SEED_MASK, POPULATION[tier] ?? POPULATION[0], remote);
    this.crowdKey = key;
    this.seconds = 0;
    this.art = this.ports.makeArt(this.crowd.poses.count);
    const crowd = this.crowd;
    this.unhook = this.ports.hookWallHits((closing, x, z) => crowd.noteWallHit(closing, x, z));
    this.law = this.makeLaw(map, crowd, key & CROWD_SEED_MASK);
    if (client) crowd.hear(this.heardEvents);
  }

  /** A car ran a red light at (x, z): the traffic's event, a cop who saw it sends a patrol car after it. */
  reportRedLight(carIndex: number, x: number, z: number): void {
    this.law?.reportRedLight(carIndex, x, z);
  }

  private makeLaw(map: OpenWorldMap, crowd: CivilianCrowd, seed: number): OpenWorldLaw {
    const extra = this.ports.law;
    return new OpenWorldLaw(map, crowd, { makeArt: (capacity) => this.ports.makeArt(capacity), throwFigure: (strike, look) => this.ports.throwFigure(strike, look), patrolCars: () => extra?.patrolCars() ?? null, solids: () => extra?.solids() ?? null, playerBusted: (carIndex, seconds) => extra?.playerBusted(carIndex, seconds) }, seed);
  }

  private throwStruck(crowd: CivilianCrowd): void {
    const strikes = crowd.takeStrikes();
    for (let at = 0; at < strikes.length; at++) {
      const strike = strikes[at]!;
      const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
      dressOfLook(crowd.poses.look[strike.guard]!, look);
      this.ports.throwFigure(strike, look);
    }
  }

  /** The panel keeps the object it had while the text is the same, so the HUD sees no change. */
  private keepIfSame(next: LookText | null): LookText | null {
    const previous = this.text;
    if (previous === null || next === null) return next;
    return previous.title === next.title && previous.lines.length === next.lines.length && previous.lines.every((line, at) => line === next.lines[at]) ? previous : next;
  }
}
