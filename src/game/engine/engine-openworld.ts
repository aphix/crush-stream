import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { OpenWorldMap } from "../world/openworld/walk-graph.ts";
import { ClientCrowdClock, CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import { CROWD_SEED_MASK, CROWD_TIER_SCALE, LOOK_HZ, POPULATION, POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { lookAtOf, LookRay, type LookText } from "../ai/civilians/civilian-look.ts";
import { CivilianRemote } from "../ai/civilians/civilian-remote.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { OpenWorldTraffic, type FreeDrivers } from "../ai/openworld-traffic/openworld-traffic.ts";
import { KERB_CARS, MOVER_CARS } from "../ai/openworld-traffic/traffic-constants.ts";
import { ProximitySight } from "../ai/openworld-traffic/traffic-sight.ts";
import type { TrafficPorts } from "../ai/openworld-traffic/traffic-ports.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import type { CrowdLink } from "../net/net-ports.ts";

const NO_EVENTS = new Float64Array(0);

/** The drawn crowd: `update` once a frame after the crowd's step. */
type CrowdArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number): void;
  dispose(): void;
};

/** The traffic lights drawn: `update` once a frame with the crowd's clock. */
type LightsArt = {
  update(seconds: number): void;
  dispose(): void;
};

/** What the open world's cars need of the engine: the field's cars (`TrafficPorts`), who drives the lobby's cars no human does, and the lights' drawing. */
type TrafficHostPorts = TrafficPorts & {
  setFreeDrivers(drivers: FreeDrivers | null): void;
  makeLights(): LightsArt;
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
  /** This machine's wall clock (s). */
  now(): number;
  /** Writes where the eye is and which way it looks. */
  eye(ray: LookRay): void;
  /** A civilian run down is thrown dressed as the crowd draws them (`look`). */
  throwFigure(strike: FigureStrike, look: DriverLook): void;
  /** Calls `listener` for every solid a car meets (closing speed, contact point) until the returned function is called. */
  hookWallHits(listener: (closing: number, x: number, z: number) => void): () => void;
  makeArt(capacity: number): CrowdArt;
  /** The cars and lights of the open world; a harness without them has a crowd and no traffic. */
  traffic?: TrafficHostPorts;
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
  private unhook: (() => void) | null = null;
  private traffic: OpenWorldTraffic | null = null;
  private lights: LightsArt | null = null;
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
    this.crowd.step(this.seconds, this.ports.cars(), true);
    this.throwStruck(this.crowd);
    this.traffic?.step(this.seconds, dt);
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
    if (client) {
      crowd.step(this.clock.crowdSeconds(this.ports.now(), INTERP_DELAY), this.ports.cars(), false);
      this.throwStruck(crowd);
    }
    this.ports.eye(this.ray);
    this.art!.update(crowd.poses, this.ray.eyeX, this.ray.eyeZ);
    this.lights?.update(crowd.crowdSeconds);
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
    this.stopTraffic();
    this.art?.dispose();
    this.crowd.dispose();
    this.unhook = null;
    this.art = null;
    this.crowd = null;
    this.text = null;
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
    if (client) crowd.hear(this.heardEvents);
    this.startTraffic(map, client);
  }

  /** The lights are drawn on every peer; the cars are the host's and the solo player's. */
  private startTraffic(map: OpenWorldMap, client: boolean): void {
    const host = this.ports.traffic;
    if (host === undefined) return;
    this.lights = host.makeLights();
    if (client) return;
    const phone = this.ports.tier() === POPULATION_TIER.phone;
    this.traffic = new OpenWorldTraffic(map.places, host, new ProximitySight(host), phone ? { movers: MOVER_CARS.phone, kerb: KERB_CARS.phone } : { movers: MOVER_CARS.desktop, kerb: KERB_CARS.desktop }, null);
    host.setFreeDrivers(this.traffic);
  }

  private stopTraffic(): void {
    this.ports.traffic?.setFreeDrivers(null);
    this.traffic?.dispose();
    this.traffic = null;
    this.lights?.dispose();
    this.lights = null;
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
