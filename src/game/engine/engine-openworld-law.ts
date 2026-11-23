import type { Obstacles } from "../ai/obstacles.ts";
import { actorOfCopSubject, copOfCopSubject, EVENT_KIND, EVENT_TRIPLE, PLAYER_ACTORS, playerCopSubject } from "../ai/civilians/civilian-constants.ts";
import type { CrowdWalkers } from "../ai/civilians/crowd-walkers.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { ChaseHud } from "../hud/hud-store.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { LookRay, Meeting } from "../ai/civilians/civilian-look.ts";
import { CrimeScene } from "../ai/openworld-crime/crime-scene.ts";
import { COP_LOOK, FACING_SPEED, FOOT_COP_COUNT, MAX_HELD, MAX_SUBJECTS } from "../ai/openworld-crime/crime-constants.ts";
import { addHidden, BODY_KIND, type BodyFrame } from "../net/body-codec.ts";
import { writePoseRows, type OpenWorldShared } from "./openworld-shared.ts";
import { personOf } from "./people-index.ts";
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

/** Where an actor on foot stands (m, the ground's height included), which way he faces (rad) and how he moves (m/s: his walker's own velocity, which the law judges his pace by). */
export type ActorPlace = { x: number; y: number; z: number; heading: number; velocityX: number; velocityZ: number };

/** The foot cops' drawing: the crowd art over their own poses. */
type CopArt = {
  update(poses: CrowdPoses, eyeX: number, eyeZ: number, sight: SightField, wallDt: number): void;
  dispose(): void;
};

/** What the law takes from the engine beyond the crowd's own ports. */
export type LawEnginePorts = {
  /** The open world's shared people (null before the crowd's start): a guest draws the host's cops and people in hand from its frame. */
  shared(): OpenWorldShared | null;
  /** The wall clock (s) this machine's frames are heard on. */
  now(): number;
  makeArt(capacity: number): CopArt;
  /** The pool slot the figure was thrown into, -1 where none is known (the worker's world, or Rapier not up yet). */
  throwFigure(strike: FigureStrike, look: DriverLook): number;
  /** The dummy in pool slot `slot` was thrown for person `person`: the engine's table of dummies records it. */
  threw(person: number, slot: number): void;
  /** Whether a player's car or walker, or this machine's eye, is within the art's range of (x, z): no ragdoll is thrown for a knock nobody could see. */
  anyoneNear(x: number, z: number): boolean;
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
  /** Where actor `actor` (a car index) stands on foot into `out`; false while he is in a car, or is not known on this machine. */
  actorPlace(actor: number, out: ActorPlace): boolean;
  /** The actor (car index) this machine's own player is. */
  ownActor(): number;
  /** The host puts actor `actor`'s car fresh on the road nearest (x, z), facing `yaw`: where the law sets a released player down. False where there is no clear spot. */
  placeCarNear(actor: number, x: number, z: number, yaw: number): boolean;
  /** What the engine does for this machine's own player once the cops have him (his walker led to a patrol car and the station, then set down): the host's own, or a guest's by the host's events. */
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
  private readonly place: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
  /** Per actor, the way he last moved (a unit vector): which way he faces while he stands still. */
  private readonly facingX = new Float64Array(PLAYER_ACTORS);
  private readonly facingZ = new Float64Array(PLAYER_ACTORS).fill(1);
  private shoveSeconds = -Infinity;
  /** The crowd second of the last overlay: the stride of a drawn cop advances by the time since. */
  private lastOverlay = 0;

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
        footChased: (actor, cop, seconds) => crowd.raiseEvent(EVENT_KIND.footChase, playerCopSubject(actor, cop), seconds),
        footArrested: (actor, cop, seconds) => crowd.raiseEvent(EVENT_KIND.footArrest, playerCopSubject(actor, cop), seconds),
        self: () => ports.ownActor(),
        placeCarNear: (actor, x, z, yaw) => ports.placeCarNear(actor, x, z, yaw),
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
      this.hearSpared();
      this.hearFootEvents(authority);
      this.feedFoot();
      this.hearShoves(authority);
      const shared = ports.shared();
      const heard = !authority && shared !== null && shared.fresh(ports.now());
      this.scene.heardPoses = heard;
      this.scene.step(crowdSeconds, authority, poses, ports.cars());
      if (heard) {
        const dt = Math.max(0, crowdSeconds - this.lastOverlay);
        shared.poseRows(shared.frame, BODY_KIND.civilian, poses, false, crowdSeconds, dt);
        shared.poseRows(shared.frame, BODY_KIND.cop, this.scene.copPoses, true, crowdSeconds, dt);
        shared.hide(shared.frame, poses);
      }
      this.lastOverlay = crowdSeconds;
    };
  }

  /** Host: the foot cops, the people in their hands and the civilians drawn by nobody written into `out` as pose records and the hidden list (`MSG.bodies`). */
  writePoses(out: BodyFrame, crowdPoses: CrowdPoses): void {
    writePoseRows(out, BODY_KIND.cop, this.scene.copPoses, null, 0);
    const { table } = this.scene.foot;
    writePoseRows(out, BODY_KIND.civilian, crowdPoses, table.resident, MAX_SUBJECTS);
    for (let at = 0; at < MAX_SUBJECTS; at++) {
      const resident = table.resident[at]!;
      if (resident >= 0 && crowdPoses.shown[resident] === 0) addHidden(out, resident);
    }
    for (let at = 0; at < MAX_HELD; at++) {
      const held = table.heldResident[at]!;
      if (held >= 0) addHidden(out, held);
    }
  }

  /** The foot cops' poses, as drawn: where each is, what he is doing. */
  get copPoses(): CrowdPoses {
    return this.scene.copPoses;
  }

  /** Whether the police have the traffic's cars to patrol in (false: they are on foot). */
  get patrolling(): boolean {
    return this.scene.patrolling;
  }

  /** After the crowd's step (the law advanced and overlaid the crowd's poses inside it, before the cars' hits): throws the fighters it took down, in their own clothes, and the cops run down, in uniform. */
  throwTakedowns(): void {
    const strikes = this.scene.takeStrikes();
    const copStrikes = this.scene.takeCopStrikes();
    // A guest with the host's frame throws none: the host's ragdolls come in its records (lists still drained).
    if (this.scene.heardPoses) return;
    for (let at = 0; at < strikes.length; at++) this.throwDressed(strikes[at]!, this.crowd.poses.look[strikes[at]!.guard]!, personOf(BODY_KIND.civilian, strikes[at]!.guard, this.crowd.poses.count));
    for (let at = 0; at < copStrikes.length; at++) this.throwDressed(copStrikes[at]!, COP_LOOK, personOf(BODY_KIND.cop, copStrikes[at]!.guard, this.crowd.poses.count));
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

  /** Before the law's step: where each actor on foot stands and moves (`actorPlace`, his walker's own velocity: a displacement over the crowd's step is cut unevenly by the physics slices), for the law to judge on the host and to follow the host's events elsewhere. */
  private feedFoot(): void {
    const { place, facingX, facingZ } = this;
    for (let actor = 0; actor < PLAYER_ACTORS; actor++) {
      const there = this.ports.actorPlace(actor, place);
      const speed = hypot2(place.velocityX, place.velocityZ);
      if (there && speed > FACING_SPEED) {
        facingX[actor] = place.velocityX / speed;
        facingZ[actor] = place.velocityZ / speed;
      }
      this.scene.setFoot(there, place.x, place.z, facingX[actor]!, facingZ[actor]!, there ? speed : 0, actor);
    }
  }

  /** The crowd's log's shoves by players on foot (a `walker` triple follows the push it belongs to) since the last one this law answered: a cop who sees one comes for the one who shoved. */
  private hearShoves(authority: boolean): void {
    const log = this.crowd.eventLog();
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      if (log[at] !== EVENT_KIND.walker || log[at + 2]! <= this.shoveSeconds) continue;
      this.shoveSeconds = log[at + 2]!;
      if (authority) this.scene.playerShoved(this.shoveSeconds, this.shoverOf(log, at));
    }
  }

  /** The actor who shoved the civilian the push before the `walker` triple at `at` names: the one on foot nearest her, else this machine's own. */
  private shoverOf(log: Float64Array, at: number): number {
    const poses = this.crowd.poses;
    const victim = at >= EVENT_TRIPLE && log[at - EVENT_TRIPLE] === EVENT_KIND.push ? log[at - EVENT_TRIPLE + 1]! : -1;
    const near = victim >= 0 && victim < poses.count ? this.scene.footActorNear(poses.x[victim]!, poses.z[victim]!) : -1;
    return near >= 0 ? near : this.scene.ownActor();
  }

  /** The host's chases and arrests of players on foot in the crowd's event log, for the scene of every peer but the host to apply once each. */
  private hearFootEvents(authority: boolean): void {
    if (authority) return;
    const log = this.crowd.eventLog();
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      const kind = log[at]!;
      if (kind !== EVENT_KIND.footChase && kind !== EVENT_KIND.footArrest) continue;
      const subject = log[at + 1]!;
      if (kind === EVENT_KIND.footChase) this.scene.hearFootChase(actorOfCopSubject(subject), copOfCopSubject(subject), log[at + 2]!);
      else this.scene.hearFootArrest(actorOfCopSubject(subject), copOfCopSubject(subject), log[at + 2]!);
    }
  }

  /** A dummy for `strike` dressed from `lookWord`, reported to the engine as person `person`'s (`LawEnginePorts.threw`); its slot, -1 for none. */
  private throwDressed(strike: FigureStrike, lookWord: number, person: number): number {
    if (!this.ports.anyoneNear(strike.x, strike.z)) return -1;
    const look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
    dressOfLook(lookWord, look);
    const slot = this.ports.throwFigure(strike, look);
    if (slot >= 0) this.ports.threw(person, slot);
    return slot;
  }

  /** Player `actor` takes shown foot cop `cop` with the hook at crowd second `seconds`: he is downed where he stands (`CrimeScene.hookCop`) and thrown down at once in uniform, so a rope can tie to him; his pool slot, -1 where he is not hookable (not shown, no authority) or no slot is known. */
  hookCop(cop: number, seconds: number, actor = this.ports.ownActor()): number {
    if (!this.scene.hookCop(cop, seconds, actor)) return -1;
    let slot = -1;
    const strikes = this.scene.takeCopStrikes();
    for (let at = 0; at < strikes.length; at++) {
      const thrown = this.throwDressed(strikes[at]!, COP_LOOK, personOf(BODY_KIND.cop, strikes[at]!.guard, this.crowd.poses.count));
      if (strikes[at]!.guard === cop) slot = thrown;
    }
    return slot;
  }

  /** The hook took `resident` from the police: the host logs it (`EVENT_KIND.spared`), and every peer's law, this one too, lets her go from the log (`hearSpared`): an arrest is broken off, and the law's next poll, finding her still wanted, sends a cop after her. Nothing on a client. */
  releaseSuspect(resident: number): void {
    this.crowd.raiseEvent(EVENT_KIND.spared, resident, this.crowd.crowdSeconds);
  }

  /** The host's releases in the crowd's event log, for the scene to apply once each. */
  private hearSpared(): void {
    const log = this.crowd.eventLog();
    for (let at = 0; at + EVENT_TRIPLE <= log.length; at += EVENT_TRIPLE) {
      if (log[at] === EVENT_KIND.spared) this.scene.hearSpared(log[at + 1]!, log[at + 2]!);
    }
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

  /** The pursuit strip's numbers for player `actor` on foot into `out`: see `PlayerLaw.chaseOf`. */
  footChaseOf(out: ChaseHud, actor = this.ports.ownActor()): boolean {
    return this.scene.footChaseOf(out, actor);
  }

  /** The pursuit strip's numbers for car `carIndex` into `out`: see `PatrolCars.chaseOf`. */
  chaseOf(carIndex: number, out: ChaseHud): boolean {
    return this.scene.chaseOf(carIndex, out);
  }

  /** A civilian the crowd ran down (its strike): a suspect of the law's is let go at once, and the third run down in a minute by one car has a patrol car sent after it. */
  noteStrike(strike: FigureStrike): void {
    this.scene.foot.spare(strike.guard);
    if (!strike.loose) this.scene.noteKnock(strike.car, strike.x, strike.z);
  }

  /** Player `actor`'s punch lands on a foot cop (the scene refuses without authority). */
  punchCop(x: number, z: number, dirX: number, dirZ: number, seconds: number, actor = this.ports.ownActor()): boolean {
    return this.scene.punchCop(x, z, dirX, dirZ, seconds, actor);
  }

  /** Player `actor`'s punch landed on a civilian: the law hears a shove, or (`grave`, a knock-out) knows of the fight at once. */
  playerStruck(seconds: number, grave: boolean, actor = this.ports.ownActor()): void {
    if (grave) this.scene.playerFought(seconds, actor);
    else this.scene.playerShoved(seconds, actor);
  }

  copMet(ray: LookRay, radius: number, reach: number, out: Meeting): Meeting {
    return this.scene.copMet(ray, radius, reach, out);
  }

  shootCop(cop: number, dirX: number, dirZ: number, seconds: number): void {
    this.scene.shootCop(cop, dirX, dirZ, seconds);
  }

  /** Player `actor`'s shot was fired: the law knows at once, seen or not. */
  playerFired(seconds: number, actor = this.ports.ownActor()): void {
    this.scene.playerFought(seconds, actor);
  }

  dispose(): void {
    this.crowd.overlay = null;
    this.unlisten?.();
    this.art.dispose();
  }
}
