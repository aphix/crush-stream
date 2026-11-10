import type * as THREE from "three";
import type { CrowdSight } from "../present/civilian-art.ts";
import type { Sight } from "../present/spectate-cam.ts";
import type { SightField } from "../present/openworld-sight.ts";
import { dressOfLook } from "../present/civilian-dress.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import type { ChaseHud } from "../hud/hud-store.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { SignSight } from "../present/openworld-signs.ts";
import type { OpenWorldMap, Place } from "../world/openworld/walk-graph.ts";
import { ClientCrowdClock, CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { gameHourAtMinute, gameMinuteAt, tickAt } from "../ai/civilians/civilian-clock.ts";
import { fillClosedPlaces } from "../ai/civilians/society-hours.ts";
import { CROWD_SEED_MASK, CROWD_TIER_SCALE, DOWNED_LIFE_SECONDS, LOOK_HZ, POPULATION, POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { lookAtOf, LookRay, type LookText } from "../ai/civilians/civilian-look.ts";
import { CivilianRemote } from "../ai/civilians/civilian-remote.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { fillCommuterFeed } from "../ai/civilians/society-commuters.ts";
import { makeDriverDoors, groundUnderCars } from "./engine-openworld-doors.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildParkingSpots, spotAt, type ParkingSpots } from "../world/openworld/openworld-parking.ts";
import { buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import { findWalkerStrike, WalkerStrike } from "../ai/civilians/society-activity.ts";
import { OpenWorldTraffic, type FreeDrivers } from "../ai/openworld-traffic/openworld-traffic.ts";
import type { CommuterFeed } from "../ai/openworld-traffic/traffic-sight.ts";
import { AMBULANCE_CARS, KERB_CARS, MOVER_CARS, PATROL_CARS } from "../ai/openworld-traffic/traffic-constants.ts";
import type { TrafficPorts } from "../ai/openworld-traffic/traffic-ports.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import type { CrowdLink } from "../net/net-ports.ts";
import { OpenWorldLaw, type LawEnginePorts } from "./engine-openworld-law.ts";
import { OpenWorldCulling, type OpenWorldCullPorts } from "./engine-openworld-cull.ts";
import { OpenWorldAuto } from "./engine-openworld-auto.ts";
import { AmbulanceStages, newestCalled } from "./engine-openworld-ambulance.ts";
import { OpenWorldClientDoors } from "./engine-openworld-door-clips.ts";
import { OpenWorldCarDoors } from "./engine-openworld-cars.ts";
import { BODY_COUNT, OpenWorldBodies, type BodyHost } from "./openworld-bodies.ts";
import { MEDICS, OpenWorldMedics } from "./engine-openworld-medics.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { EVENT_LOG_CAPACITY } from "../ai/civilians/civilian-crowd-constants.ts";
import { MAX_CARS } from "../scenes/fleet.ts";

const NO_EVENTS = new Float64Array(0);
/** The pursuit strip prints seconds to a tenth and its meter moves in hundredths: finer changes are not a change. */
const BUST_LEFT_STEPS = 10;
const BUST_HOLD_STEPS = 100;

/** A player on foot: where he stands and his velocity (m, m/s). */
type FootBody = { x: number; z: number; velocityX: number; velocityZ: number };

/** The drawn crowd: `update` once a frame after the crowd's step. */
type CrowdArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: CrowdSight, wallDt: number, held?: Uint8Array | null): void;
  dispose(): void;
};

/** The signage on the buildings: `update` once a frame. */
type PlaceSigns = {
  update(eyeX: number, eyeZ: number, namesOn: boolean, sight: SignSight | null, closed: Uint8Array | null): void;
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

/** Who opens the interiors' doors: the drawn crowd and the player's walker, null where there is none. */
type DoorOpeners = { poses: CrowdPoses | null; walker: FootBody | null; others: CrowdPoses[]; closed: Uint8Array | null };

/** The streamed interiors of the map's places: `update` once a frame with the eye and the sight field, `dispose` when the course is left. */
type InteriorArt = {
  update(eyeX: number, eyeZ: number, dt: number, sight: SightField, openers: DoorOpeners): void;
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
  /** `life`: sim s the body lies (default: the pool's). */
  throwFigure(strike: FigureStrike, look: DriverLook, life?: number): number;
  /** The figure `throwFigure` put in pool slot `slot`, thrown `age` sim s ago, is taken away (the one the ambulance has loaded); false when the slot no longer holds it. */
  removeFigure(slot: number, age: number): boolean;
  /** Calls `listener` for every solid a car meets (closing speed, contact point) until the returned function is called. */
  hookWallHits(listener: (closing: number, x: number, z: number) => void): () => void;
  makeArt(capacity: number): CrowdArt;
  /** The Track debug button is on: every place's name is printed on its building. */
  signsOn(): boolean;
  /** The signage of `places`, in the scene. */
  makeSigns(places: readonly Place[]): PlaceSigns;
  /** What the police need of the engine (the course's solids, a busted player, the light bars, sight lines past the buildings); absent: no police. */
  law?: Pick<LawEnginePorts, "solids" | "playerBusted" | "sirens" | "lineOfSight" | "footBusted">;
  /** What culling reads of the engine. */
  cull: OpenWorldCullPorts;
  /** The dummies' world the civilians near a player have bodies in; absent: they are drawn by the crowd's art alone. */
  bodies?: BodyHost;
  /** The facade kit for the map's homes inside the walls. */
  makeFacades(map: OpenWorldMap): FacadeArt;
  /** The stage's light follows this game hour (0-24), or the time of day again (null): called once a game minute, never a frame. */
  setDayHour(hour: number | null): void;
  /** The cars and lights of the open world; a harness without them has a crowd and no traffic. */
  traffic?: TrafficHostPorts;
  /** Absent in a director that draws no interiors (the tests'). */
  makeInteriors?(map: OpenWorldMap): InteriorArt;
  /** A civilian who turned on this browser's player on foot lands a swing: he takes the walker's knockdown, pushed along (dirX, dirZ). */
  strikeWalker(dirX: number, dirZ: number): void;
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
  private medics: OpenWorldMedics | null = null;
  /** Where the ambulance is: noted in the log by the host, read from it by a client (which has no traffic). */
  private readonly stages = new AmbulanceStages();
  /** Whether a client has put its medics at the scene of the call it is hearing. */
  private sceneHeard = false;
  /** Where each resident was last run down (the strike's spot), for a client's medics to kneel at: the call names the resident, the host's alone knows where he lay. */
  private knockX = new Float32Array(0);
  private knockZ = new Float32Array(0);
  private knockKnown = new Uint8Array(0);
  /** The driver's doors swung by the clips a client sees (the host's are the sim's: `doors`). */
  private readonly clientDoors = new OpenWorldClientDoors();
  private interiors: InteriorArt | null = null;
  private unhook: (() => void) | null = null;
  private traffic: OpenWorldTraffic | null = null;
  /** Per civilian, the pool slot the figure thrown for her lies in (-1: none) and the crowd second it was thrown: the ambulance's loading takes it away (`removeVictim`). */
  private figureSlot = new Int32Array(0);
  private figureAt = new Float64Array(0);
  private readonly sceneScratch = { x: 0, z: 0 };
  /** The civilians near this machine's eye as physical bodies (`OpenWorldBodies`), null where the engine gives no dummies' world. */
  private bodies: OpenWorldBodies | null = null;
  /** The cars' doors, swung with the residents getting into and out of them (where they stand is `crowd.driverDoors`). */
  private doors: OpenWorldCarDoors | null = null;
  /** The kerb spaces, known on every peer: a car standing in one has nobody in it (`carIsEmpty`). */
  private kerb: ParkingSpots | null = null;
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
  private bust: ChaseHud | null = null;
  private readonly bustScratch: ChaseHud = { cops: 0, hold: 0, left: 0 };
  private lookAcc = 0;
  /** The game minute the stage's day was last set for (-1: none, or it was left), so the light follows the crowd's clock once a minute. */
  private dayMinute = -1;
  private readonly foot: FootBody = { x: 0, z: 0, velocityX: 0, velocityZ: 0 };
  private readonly openers: DoorOpeners = { poses: null, walker: null, others: [], closed: null };
  /** The map's places shut now (a wreck, or outside their hours), refilled each frame from the crowd's state for the interiors. */
  private closedPlaces: Uint8Array | null = null;
  private readonly walkerStrike = new WalkerStrike();
  /** The Auto camera: wanted (`setAuto`) across crowd rebuilds, made with each crowd. */
  private autoWanted = false;
  private auto: OpenWorldAuto | null = null;

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

  /** Car `id` has nobody in it and the player may get into it: host and solo only (the cars are ours). */
  canEnter(id: number): boolean {
    return this.traffic !== null && this.traffic.isEmptyCar(id);
  }

  /** The player got into car `id` on foot: it leaves the traffic's pool for good. */
  adopt(id: number): void {
    this.traffic?.takeCar(id);
  }

  /** Car `id` (a pose is all that is read) is parked: it stands in a kerb space and no human has it, so no driver is drawn in it. The same on every peer. */
  carIsEmpty(id: number, car: { readonly group: { readonly position: { readonly x: number; readonly z: number } }; readonly yaw: number }): boolean {
    return this.kerb !== null && this.ports.traffic?.seated(id) === false && (spotAt(this.kerb, car.group.position.x, car.group.position.z, car.yaw) >= 0 || this.traffic?.isEmptyCar(id) === true);
  }

  /** Where the ambulance's call is (`AMBULANCE`): the traffic's on the host and solo, the host's as heard on a client. */
  ambulanceState(): number {
    return this.traffic?.ambulanceState() ?? this.stages.state;
  }

  /** The engine's index of the ambulance's car, -1 while none is out. */
  ambulanceCar(): number {
    return this.traffic?.ambulanceCar() ?? this.stages.car;
  }

  /** The Auto camera is up: it follows the open world's events and its bubble is the followed subject's. */
  get autoOn(): boolean {
    return this.autoWanted;
  }

  setAuto(on: boolean): void {
    if (on === this.autoWanted) return;
    if (on) this.auto?.begin();
    else this.text = null;
    this.autoWanted = on;
  }

  /** The Auto camera frames its subject in `camera`; false where it is off or has none (the regular camera keeps the view). */
  aimAuto(camera: THREE.PerspectiveCamera, sight: Sight, wallDt: number): boolean {
    return this.autoWanted && this.auto !== null && this.auto.aim(camera, sight, wallDt);
  }

  /** What the look-at panel shows, null when the eye rests on nothing. */
  lookAt(): LookText | null {
    return this.text;
  }

  /**
   * The pursuit strip for the player's car `carIndex` while patrol cars chase it: how many, and the bust hold they have run (the race's own rule). The same object while its figures read the same (the strip's
   * tenth of a second and hundredth of a hold), so the HUD sees no change; null while none chases it.
   */
  bustOf(carIndex: number): ChaseHud | null {
    if (this.law === null || !(this.law.chaseOf(carIndex, this.bustScratch) || this.law.footChaseOf(this.bustScratch))) {
      this.bust = null;
      return null;
    }
    const next = this.bustScratch;
    const kept = this.bust;
    const left = Math.round(next.left * BUST_LEFT_STEPS) / BUST_LEFT_STEPS;
    const hold = Math.round(next.hold * BUST_HOLD_STEPS) / BUST_HOLD_STEPS;
    if (kept !== null && kept.cops === next.cops && kept.left === left && kept.hold === hold) return kept;
    this.bust = { cops: next.cops, hold, left };
    return this.bust;
  }

  /** A sim step of `dt` s: the host's and the solo player's crowd takes it. */
  step(dt: number): void {
    if (this.crowd === null || this.ports.isClient()) return;
    this.seconds += dt;
    this.feedWalkers(this.crowd);
    this.crowd.step(this.seconds, this.ports.cars(), true);
    // The strikes first: a civilian the crowd has just hidden (run down) still has her body, which takes the blow.
    this.throwStruck(this.crowd);
    this.bodies?.step(this.crowd.poses, this.ray.eyeX, this.ray.eyeZ, this.seconds, dt);
    this.landWalkerStrike(this.crowd, dt);
    this.law?.throwTakedowns();
    if (this.traffic !== null && this.feed !== null) {
      fillCommuterFeed(this.crowd.state, tickAt(this.seconds), this.feed.legs, this.feed.parked);
      this.doors?.step(this.crowd.poses);
      this.traffic.step(this.seconds, dt);
      this.stages.note(this.crowd, this.traffic.ambulanceState(), this.traffic.ambulanceCar());
    }
  }

  /** A frame: the crowd is made, rebuilt on a new seed or dropped as the course comes and goes; a client steps it by the host's clock; the crowd is drawn and the look-at text kept up. */
  frame(wallDt: number): void {
    if (this.map === null || !this.ports.inOpenWorld()) {
      this.culling.stop(this.ports.cars());
      this.dropFacades();
      this.dropDay();
      this.stop();
      this.setAuto(false);
      return;
    }
    this.culling.frame(this.ports.cars(), wallDt);
    this.facades ??= this.ports.makeFacades(this.map);
    if (this.interiors === null && this.ports.makeInteriors !== undefined) this.interiors = this.ports.makeInteriors(this.map);
    this.ports.eye(this.ray);
    if (this.crowd !== null && this.closedPlaces !== null) fillClosedPlaces(this.crowd.state, tickAt(this.crowd.crowdSeconds), this.closedPlaces);
    if (this.interiors !== null) {
      this.openers.poses = this.crowd?.poses ?? null;
      this.openers.closed = this.crowd === null ? null : this.closedPlaces;
      this.openers.walker = this.ports.foot(this.foot) ? this.foot : null;
      this.interiors.update(this.ray.eyeX, this.ray.eyeZ, wallDt, this.sight, this.openers);
    }
    const client = this.ports.isClient();
    if (client && !this.hasHeard) return;
    const key = client ? this.heardKey : this.hostKey();
    if (this.crowd === null || this.crowdKey !== key) this.start(this.map, key, client);
    const crowd = this.crowd!;
    if (client) {
      this.feedWalkers(crowd);
      crowd.step(this.clock.crowdSeconds(this.ports.now(), INTERP_DELAY), this.ports.cars(), false);
      this.throwStruck(crowd);
      this.bodies?.step(crowd.poses, this.ray.eyeX, this.ray.eyeZ, crowd.crowdSeconds, wallDt);
      this.law?.throwTakedowns();
      this.hearAmbulance(crowd);
      this.clientDoors.frame(crowd.poses, this.ports.cars());
    }
    this.ports.eye(this.ray);
    this.frameSigns(this.map);
    this.art!.update(crowd.poses, this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt, this.bodies?.held ?? null);
    this.law?.frame(this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    if (this.traffic?.ambulanceScene(this.sceneScratch) === true) this.medics?.setScene(this.sceneScratch.x, this.sceneScratch.z);
    this.medics?.frame(this.ambulanceState(), this.ray.eyeX, this.ray.eyeZ, this.sight, wallDt);
    this.lights?.update(crowd.crowdSeconds);
    this.frameDay(crowd);
    this.lookAcc += wallDt;
    const cut = this.autoWanted && this.auto !== null && this.auto.step(wallDt);
    if (cut || this.lookAcc >= 1 / LOOK_HZ) {
      this.lookAcc = 0;
      this.text = this.keepIfSame(this.autoWanted && this.auto !== null ? this.auto.text() : lookAtOf(crowd.state, crowd.poses, tickAt(crowd.crowdSeconds), this.ray));
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
    this.bodies?.dispose();
    this.bodies = null;
    this.stopTraffic();
    this.art?.dispose();
    this.law?.dispose();
    this.medics?.dispose();
    this.clientDoors.release(this.ports.cars());
    this.crowd.dispose();
    this.unhook = null;
    this.art = null;
    this.law = null;
    this.medics = null;
    this.openers.others = [];
    this.auto = null;
    this.crowd = null;
    this.text = null;
    this.bust = null;
  }

  /** The player on foot is a body the crowd makes room round and can shove, as the ragdoll world's step has him: the same for every frame rate. */
  private feedWalkers(crowd: CivilianCrowd): void {
    crowd.walkers.clear();
    if (this.ports.foot(this.foot)) crowd.walkers.add(this.foot.x, this.foot.z, this.foot.velocityX, this.foot.velocityZ);
    this.law?.feedCops(crowd.walkers);
  }

  /** A civilian the player shoved and who turned on him lands a swing while he is in reach: the walker's knockdown. The host's own walker only: a client's player is in none of the host's fights. */
  private landWalkerStrike(crowd: CivilianCrowd, dt: number): void {
    const { walkers } = crowd;
    if (walkers.count === 0 || !findWalkerStrike(crowd.state, this.seconds - dt, this.seconds, walkers.x[0]!, walkers.z[0]!, this.walkerStrike)) return;
    this.ports.strikeWalker(this.walkerStrike.dirX, this.walkerStrike.dirZ);
  }

  /** The stage's day follows the crowd's clock: one call a game minute (a crowd second), whatever the frame rate. */
  private frameDay(crowd: CivilianCrowd): void {
    const minute = gameMinuteAt(crowd.crowdSeconds);
    if (minute === this.dayMinute) return;
    this.dayMinute = minute;
    this.ports.setDayHour(gameHourAtMinute(minute, crowd.state.startHour));
  }

  /** The course is left: the stage's time of day lights again. */
  private dropDay(): void {
    if (this.dayMinute < 0) return;
    this.dayMinute = -1;
    this.ports.setDayHour(null);
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
    this.signs.update(this.ray.eyeX, this.ray.eyeZ, this.ports.signsOn(), this.sight, this.crowd === null ? null : this.closedPlaces);
  }

  private start(map: OpenWorldMap, key: number, client: boolean): void {
    this.stopCrowd();
    const tier = Math.floor(key / CROWD_TIER_SCALE);
    const remote = CivilianRemote.open((err) => console.error("Crush Stream civilian worker failed", err));
    this.crowd = new CivilianCrowd(map, key & CROWD_SEED_MASK, POPULATION[tier] ?? POPULATION[0], remote, true);
    this.crowd.onAmbulanceCall = (x, z, seconds, victim) => {
      this.traffic?.callAmbulance(x, z, seconds, victim);
    };
    this.crowdKey = key;
    this.seconds = 0;
    this.stages.reset();
    this.sceneHeard = false;
    this.knockX = new Float32Array(this.crowd.state.capacity);
    this.knockZ = new Float32Array(this.crowd.state.capacity);
    this.knockKnown = new Uint8Array(this.crowd.state.capacity);
    this.auto = this.makeAuto(this.crowd, key & CROWD_SEED_MASK);
    this.art = this.ports.makeArt(this.crowd.poses.count);
    this.figureSlot = new Int32Array(this.crowd.poses.count).fill(-1);
    this.figureAt = new Float64Array(this.crowd.poses.count);
    if (this.ports.bodies !== undefined) this.bodies = new OpenWorldBodies(this.ports.bodies, map.places, this.crowd.poses.count, this.ports.tier() === POPULATION_TIER.phone ? BODY_COUNT.phone : BODY_COUNT.desktop);
    const crowd = this.crowd;
    this.unhook = this.ports.hookWallHits((closing, x, z) => crowd.noteWallHit(closing, x, z));
    this.startTraffic(map, client);
    this.doors = new OpenWorldCarDoors(crowd.state.capacity, crowd.state, () => this.traffic);
    this.closedPlaces = new Uint8Array(crowd.state.index.placeCount);
    this.law = this.makeLaw(map, crowd, key & CROWD_SEED_MASK);
    this.medics = new OpenWorldMedics(this.ports.makeArt(MEDICS.count));
    this.openers.others = this.law === null ? [this.medics.poses] : [this.law.copPoses, this.medics.poses];
    if (client) crowd.hear(this.heardEvents);
  }

  /** The lights are drawn on every peer; the cars are the host's and the solo player's. */
  private startTraffic(map: OpenWorldMap, client: boolean): void {
    const host = this.ports.traffic;
    if (host === undefined) return;
    this.lights = host.makeLights();
    this.kerb = buildParkingSpots(buildRoadNetwork(openWorldGeometry(LAYOUT)));
    this.crowd!.driverDoors = makeDriverDoors(map.places, this.crowd!.state, this.kerb, groundUnderCars);
    if (client) return;
    const phone = this.ports.tier() === POPULATION_TIER.phone;
    const capacity = this.crowd!.state.capacity;
    this.feed = {
      legs: { count: 0, resident: new Int32Array(capacity), fromPlace: new Int32Array(capacity), toPlace: new Int32Array(capacity), arriveSeconds: new Float64Array(capacity) },
      parked: { count: 0, resident: new Int32Array(capacity), place: new Int32Array(capacity) },
    };
    this.traffic = new OpenWorldTraffic(map.places, host, this.sight, phone ? { movers: MOVER_CARS.phone, kerb: KERB_CARS.phone, patrol: PATROL_CARS.phone, ambulance: AMBULANCE_CARS.phone } : { movers: MOVER_CARS.desktop, kerb: KERB_CARS.desktop, patrol: PATROL_CARS.desktop, ambulance: AMBULANCE_CARS.desktop }, this.feed);
    this.traffic.setPeople(this.crowd!.poses);
    this.traffic.onAmbulanceLoaded((victim) => this.removeVictim(victim));
    host.setFreeDrivers(this.traffic);
  }

  private stopTraffic(): void {
    this.ports.traffic?.setFreeDrivers(null);
    this.traffic?.dispose();
    this.traffic = null;
    this.doors = null;
    this.kerb = null;
    this.feed = null;
    this.lights?.dispose();
    this.lights = null;
  }

  /** The police, made after the traffic (they lease its cars); none where the engine gives no law ports. */
  private makeLaw(map: OpenWorldMap, crowd: CivilianCrowd, seed: number): OpenWorldLaw | null {
    const extra = this.ports.law;
    if (extra === undefined) return null;
    return new OpenWorldLaw(map, crowd, { makeArt: (capacity) => this.ports.makeArt(capacity), throwFigure: (strike, look) => this.ports.throwFigure(strike, look), traffic: () => this.traffic, solids: () => extra.solids(), playerBusted: (carIndex, seconds) => extra.playerBusted(carIndex, seconds), sirens: (carIndex, on) => extra.sirens(carIndex, on), lineOfSight: extra.lineOfSight, foot: (out) => this.ports.foot(out), footBusted: () => extra.footBusted(), cars: () => this.ports.cars() }, seed);
  }

  /** The Auto camera over this crowd: its cars (the traffic's drivers), its foot cops and the viewers' own cars left out. */
  private makeAuto(crowd: CivilianCrowd, seed: number): OpenWorldAuto {
    const auto = new OpenWorldAuto(
      {
        crowd: () => this.crowd,
        cops: () => this.law?.copPoses ?? null,
        residentAt: (carIndex) => this.traffic?.residentOf(carIndex) ?? -1,
        cars: () => this.ports.cars(),
        ambulanceCar: () => this.ambulanceCar(),
        ambulanceState: () => this.ambulanceState(),
        isPlayerCar: (carIndex) => this.ports.cull.playerCars().includes(this.ports.cars()[carIndex]!),
      },
      { residents: crowd.poses.count, cops: FOOT_COP_COUNT, cars: MAX_CARS, events: EVENT_LOG_CAPACITY },
      seed,
    );
    if (this.autoWanted) auto.begin();
    return auto;
  }

  private throwStruck(crowd: CivilianCrowd): void {
    const strikes = crowd.takeStrikes();
    for (let at = 0; at < strikes.length; at++) {
      const strike = strikes[at]!;
      if (this.bodies?.knock(strike) === true) {
        this.law?.noteStrike(strike);
        continue;
      }
      const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
      dressOfLook(crowd.poses.look[strike.guard]!, look);
      this.figureSlot[strike.guard] = this.ports.throwFigure(strike, look, DOWNED_LIFE_SECONDS);
      this.figureAt[strike.guard] = crowd.crowdSeconds;
      this.noteKnockSpot(strike.guard, strike.x, strike.z);
      this.law?.noteStrike(strike);
    }
  }

  /** The ambulance has loaded this civilian and is leaving: whatever lies for her (her live body, or the figure thrown for her) goes. */
  private removeVictim(victim: number): void {
    if (victim < 0 || this.crowd === null || victim >= this.figureSlot.length) return;
    if (this.bodies?.remove(victim) === true) return;
    const slot = this.figureSlot[victim]!;
    if (slot < 0) return;
    this.figureSlot[victim] = -1;
    this.ports.removeFigure(slot, this.crowd.crowdSeconds - this.figureAt[victim]!);
  }

  private noteKnockSpot(resident: number, x: number, z: number): void {
    if (resident < 0 || resident >= this.knockKnown.length) return;
    this.knockX[resident] = x;
    this.knockZ[resident] = z;
    this.knockKnown[resident] = 1;
  }

  /** A client: the ambulance as the host's log has it, and, when a call comes, the medics put where the person down lay (else beside the ambulance's car). */
  private hearAmbulance(crowd: CivilianCrowd): void {
    const log = crowd.eventLog();
    this.stages.hear(log);
    if (this.stages.state === 0) {
      this.sceneHeard = false;
      return;
    }
    if (this.sceneHeard) return;
    this.sceneHeard = true;
    const resident = newestCalled(log);
    if (resident >= 0 && resident < this.knockKnown.length && this.knockKnown[resident] === 1) {
      this.medics?.call(this.knockX[resident]!, this.knockZ[resident]!, true);
      return;
    }
    const car = this.ports.cars()[this.stages.car];
    if (car !== undefined) this.medics?.call(car.group.position.x, car.group.position.z, true);
  }

  /** The panel keeps the object it had while the text is the same, so the HUD sees no change. */
  private keepIfSame(next: LookText | null): LookText | null {
    const previous = this.text;
    if (previous === null || next === null) return next;
    return previous.title === next.title && previous.lines.length === next.lines.length && previous.lines.every((line, at) => line === next.lines[at]) ? previous : next;
  }
}
