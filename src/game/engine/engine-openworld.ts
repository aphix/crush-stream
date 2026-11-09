import type { CrowdSight } from "../present/civilian-art.ts";
import type { SightField } from "../present/openworld-sight.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { SignSight } from "../present/openworld-signs.ts";
import type { OpenWorldMap, Place } from "../world/openworld/walk-graph.ts";
import { ClientCrowdClock, CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import { CROWD_SEED_MASK, CROWD_TIER_SCALE, LOOK_HZ, POPULATION, POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { lookAtOf, LookRay, type LookText } from "../ai/civilians/civilian-look.ts";
import { CivilianRemote } from "../ai/civilians/civilian-remote.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { fillCommuterFeed } from "../ai/civilians/society-commuters.ts";
import { OpenWorldTraffic, type FreeDrivers } from "../ai/openworld-traffic/openworld-traffic.ts";
import type { CommuterFeed } from "../ai/openworld-traffic/traffic-sight.ts";
import { KERB_CARS, MOVER_CARS, PATROL_CARS } from "../ai/openworld-traffic/traffic-constants.ts";
import type { TrafficPorts } from "../ai/openworld-traffic/traffic-ports.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import type { CrowdLink } from "../net/net-ports.ts";
import { OpenWorldLaw, type LawEnginePorts } from "./engine-openworld-law.ts";
import { OpenWorldCulling, type OpenWorldCullPorts } from "./engine-openworld-cull.ts";

const NO_EVENTS = new Float64Array(0);

/** A player on foot: where he stands and his velocity (m, m/s). */
type FootBody = { x: number; z: number; velocityX: number; velocityZ: number };

/** The drawn crowd: `update` once a frame after the crowd's step. */
type CrowdArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number): void;
  dispose(): void;
};

/** The signage on the buildings: `update` once a frame. */
type PlaceSigns = {
  update(eyeX: number, eyeZ: number, namesOn: boolean, sight: SignSight | null): void;
  dispose(): void;
};

/** The rowhomes' bays, stoops, railings and cornices: made with the open world's course, gone when it is left. */
type FacadeArt = { dispose(): void };
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

/** The streamed interiors of the map's places: `update` once a frame with the eye, `dispose` when the course is left. */
type InteriorArt = {
  update(eyeX: number, eyeZ: number, dt: number): void;
  dispose(): void;
};
/** What the open world needs of the engine. */
export type OpenWorldPorts = {
  /** The open world's course is up (solo, or in a room's lobby). */
  inOpenWorld(): boolean;
  /** A netplay client: it hears the host's crowd instead of making its own. */
  isClient(): boolean;
  /** This run's seed: the host's and the solo player's crowd is made from it. */
  seed(): number;
  /** The population tier of this device (`POPULATION_TIER`). */
  tier(): number;
  cars(): readonly DeformableCar[];
  /** Writes where this browser's player on foot stands and how fast he moves, as the ragdoll world's last step has him (not the blended drawn torso); false while he is in a car. */
  foot(out: FootBody): boolean;
  /** This machine's wall clock (s). */
  now(): number;
  /** Writes where the eye is and which way it looks. */
  eye(ray: LookRay): void;
  /** A civilian run down is thrown dressed as the crowd draws them (`look`). */
  throwFigure(strike: FigureStrike, look: DriverLook): void;
  /** Calls `listener` for every solid a car meets (closing speed, contact point) until the returned function is called. */
  hookWallHits(listener: (closing: number, x: number, z: number) => void): () => void;
  makeArt(capacity: number): CrowdArt;
  /** The Track debug button is on: every place's name is printed on its building. */
  signsOn(): boolean;
  /** The signage of `places`, in the scene. */
  makeSigns(places: readonly Place[]): PlaceSigns;
  /** The police's extra ports (the traffic, the course's solids, a busted player); absent: foot cops only. */
  law?: Pick<LawEnginePorts, "traffic" | "solids" | "playerBusted" | "sirens">;
  /** What culling reads of the engine. */
  cull: OpenWorldCullPorts;
  /** The facade kit for the map's homes inside the walls. */
  makeFacades(map: OpenWorldMap): FacadeArt;
  /** The cars and lights of the open world; a harness without them has a crowd and no traffic. */
  traffic?: TrafficHostPorts;
  /** Absent in a director that draws no interiors (the tests'). */
  makeInteriors?(map: OpenWorldMap): InteriorArt;
};

/**
 * The open world's society and crowd in the engine: made when the course is up and a map is given (`startOpenWorld`), stepped with the sim (host and solo) or by the host's clock (a client), drawn each frame, and gone when the
 * course is left. It is the crowd's end of the netplay crowd message (`CrowdLink`) and answers the look-at panel.
 */
export class OpenWorldDirector {
  private readonly ports: OpenWorldPorts;
  private readonly culling: OpenWorldCulling;
  private map: OpenWorldMap | null = null;
  private crowd: CivilianCrowd | null = null;
  private art: CrowdArt | null = null;
  private signs: PlaceSigns | null = null;
  private facades: FacadeArt | null = null;
  private law: OpenWorldLaw | null = null;
  private interiors: InteriorArt | null = null;
  private unhook: (() => void) | null = null;
  private traffic: OpenWorldTraffic | null = null;
  private lights: LightsArt | null = null;
  /** The residents' drives and parked cars, written by the society before each traffic step (host and solo). */
  private feed: CommuterFeed | null = null;
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
  private readonly foot: FootBody = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };

  constructor(ports: OpenWorldPorts) {
    this.ports = ports;
    this.culling = new OpenWorldCulling(ports.cull);
  }

  /** The map the crowd lives on; the crowd is made from it on the next frame in the open world. */
  startOpenWorld(map: OpenWorldMap): void {
    this.stop();
    this.dropFacades();
    this.map = map;
  }

  /** The crowd's end of the crowd message while the open world is up, else null. */
  link(): CrowdLink | null {
    return this.map !== null && this.ports.inOpenWorld() ? this : null;
  }

  /** What the local eyes see of the open world: everything that draws or streams asks it before it spends anything. */
  get sight(): SightField {
    return this.culling.sight;
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
    this.law?.throwTakedowns();
    if (this.traffic !== null && this.feed !== null) {
      fillCommuterFeed(this.crowd.state, tickAt(this.seconds), this.feed.legs, this.feed.parked);
      this.traffic.step(this.seconds, dt);
    }
  }

  /** A frame: the crowd is made, rebuilt on a new seed or dropped as the course comes and goes; a client steps it by the host's clock; the crowd is drawn and the look-at text kept up. */
  frame(wallDt: number): void {
    if (this.map === null || !this.ports.inOpenWorld()) {
      this.culling.stop(this.ports.cars());
      this.dropFacades();
      this.stop();
      return;
    }
    this.culling.frame(this.ports.cars(), wallDt);
    this.facades ??= this.ports.makeFacades(this.map);
    if (this.interiors === null && this.ports.makeInteriors !== undefined) this.interiors = this.ports.makeInteriors(this.map);
    this.ports.eye(this.ray);
    this.interiors?.update(this.ray.eyeX, this.ray.eyeZ, wallDt);
    const client = this.ports.isClient();
    if (client && !this.hasHeard) return;
    const key = client ? this.heardKey : this.hostKey();
    if (this.crowd === null || this.crowdKey !== key) this.start(this.map, key, client);
    const crowd = this.crowd!;
    if (client) {
      this.feedWalkers(crowd);
      crowd.step(this.clock.crowdSeconds(this.ports.now(), INTERP_DELAY), this.ports.cars(), false);
      this.throwStruck(crowd);
      this.law?.throwTakedowns();
    }
    this.ports.eye(this.ray);
    this.frameSigns(this.map);
    this.art!.update(crowd.poses, this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    this.law?.frame(this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    this.lights?.update(crowd.crowdSeconds);
    this.lookAcc += wallDt;
    if (this.lookAcc >= 1 / LOOK_HZ) {
      this.lookAcc = 0;
      this.text = this.keepIfSame(lookAtOf(crowd.state, crowd.poses, tickAt(crowd.crowdSeconds), this.ray));
    }
  }

  /** The crowd, its drawing, its worker and the signage are gone, and the interiors with them. */
  stop(): void {
    this.stopCrowd();
    this.signs?.dispose();
    this.signs = null;
    this.interiors?.dispose();
    this.interiors = null;
  }

  private stopCrowd(): void {
    if (this.crowd === null) return;
    this.unhook?.();
    this.stopTraffic();
    this.art?.dispose();
    this.law?.dispose();
    this.crowd.dispose();
    this.unhook = null;
    this.art = null;
    this.law = null;
    this.crowd = null;
    this.text = null;
  }

  /** The player on foot is a body the crowd makes room round and can shove, as the ragdoll world's step has him: the same for every frame rate. */
  private feedWalkers(crowd: CivilianCrowd): void {
    crowd.walkers.clear();
    if (this.ports.foot(this.foot)) crowd.walkers.add(this.foot.x, this.foot.z, this.foot.velocityX, this.foot.velocityZ);
  }

  private dropFacades(): void {
    this.facades?.dispose();
    this.facades = null;
  }

  private hostKey(): number {
    return (this.ports.tier() * CROWD_TIER_SCALE + (this.ports.seed() & CROWD_SEED_MASK)) >>> 0;
  }

  /** The signage is made on the first frame and shows names while the Track debug button is on. */
  private frameSigns(map: OpenWorldMap): void {
    this.signs ??= this.ports.makeSigns(map.places);
    this.signs.update(this.ray.eyeX, this.ray.eyeZ, this.ports.signsOn(), this.sight);
  }

  private start(map: OpenWorldMap, key: number, client: boolean): void {
    this.stopCrowd();
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
    this.startTraffic(map, client);
  }

  /** The lights are drawn on every peer; the cars are the host's and the solo player's. */
  private startTraffic(map: OpenWorldMap, client: boolean): void {
    const host = this.ports.traffic;
    if (host === undefined) return;
    this.lights = host.makeLights();
    if (client) return;
    const phone = this.ports.tier() === POPULATION_TIER.phone;
    const capacity = this.crowd!.state.capacity;
    this.feed = {
      legs: { count: 0, resident: new Int32Array(capacity), fromPlace: new Int32Array(capacity), toPlace: new Int32Array(capacity), arriveSeconds: new Float64Array(capacity) },
      parked: { count: 0, resident: new Int32Array(capacity), place: new Int32Array(capacity) },
    };
    this.traffic = new OpenWorldTraffic(map.places, host, this.sight, phone ? { movers: MOVER_CARS.phone, kerb: KERB_CARS.phone, patrol: PATROL_CARS.phone } : { movers: MOVER_CARS.desktop, kerb: KERB_CARS.desktop, patrol: PATROL_CARS.desktop }, this.feed);
    host.setFreeDrivers(this.traffic);
  }

  private stopTraffic(): void {
    this.ports.traffic?.setFreeDrivers(null);
    this.traffic?.dispose();
    this.traffic = null;
    this.feed = null;
    this.lights?.dispose();
    this.lights = null;
  }

  private makeLaw(map: OpenWorldMap, crowd: CivilianCrowd, seed: number): OpenWorldLaw {
    const extra = this.ports.law;
    return new OpenWorldLaw(map, crowd, { makeArt: (capacity) => this.ports.makeArt(capacity), throwFigure: (strike, look) => this.ports.throwFigure(strike, look), traffic: () => extra?.traffic() ?? null, solids: () => extra?.solids() ?? null, playerBusted: (carIndex, seconds) => extra?.playerBusted(carIndex, seconds), sirens: (carIndex, on) => extra?.sirens(carIndex, on) }, seed);
  }

  private throwStruck(crowd: CivilianCrowd): void {
    const strikes = crowd.takeStrikes();
    for (let at = 0; at < strikes.length; at++) {
      const strike = strikes[at]!;
      const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
      dressOfLook(crowd.poses.look[strike.guard]!, look);
      this.ports.throwFigure(strike, look);
      this.law?.noteStrike(strike);
    }
  }

  /** The panel keeps the object it had while the text is the same, so the HUD sees no change. */
  private keepIfSame(next: LookText | null): LookText | null {
    const previous = this.text;
    if (previous === null || next === null) return next;
    return previous.title === next.title && previous.lines.length === next.lines.length && previous.lines.every((line, at) => line === next.lines[at]) ? previous : next;
  }
}
