import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, felled, looseRunsDown, runsDown, stood, type FigureStrike } from "../../scenes/figure-strike.ts";
import { LOOSE_BODIES } from "../../vehicle/part-state.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { CAR_REACH } from "../../scenes/lawn-guard.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "./civilian-clock.ts";
import { ACTIVITY, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, NEVER_TICK, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { carGap, punchGap } from "./civilian-contact.ts";
import {
  BUMP_CLOSING_SPEED,
  BUMP_COOLDOWN_SECONDS,
  BUMP_DISTANCE,
  CAR_NUDGE_GAP,
  CAR_NUDGE_SPEED,
  CRASH_LOCKOUT_SECONDS,
  CRASH_NODE_REACH,
  DANGER_MIN_SPEED,
  HARD_CLOSING_SPEED,
  HARD_DISTANCE,
  NOT_A_CIVILIAN,
  PUSH_LOCKOUT_SECONDS,
  WALKER_BEARING_STEPS,
  WALKER_CAPACITY,
  WALKER_PUSH_CLOSING_SPEED,
  WALKER_PUSH_DISTANCE,
  WRECK_LOCKOUT_SECONDS,
  WRECK_SPEED,
} from "./civilian-crowd-constants.ts";
import type { CivilianRemote } from "./civilian-remote.ts";
import { CrowdSeparation } from "./civilian-separation.ts";
import type { CityState } from "./civilian-state.ts";
import { CivilianBlow, findCivilianBlow, knockoutBlow, readActivity } from "./society-activity.ts";
import { CrimeDesk } from "./society-crime.ts";
import { CrowdAftermath } from "./crowd-aftermath.ts";
import { CrowdEventLog, NO_EVENTS } from "./crowd-event-log.ts";
import { felledBy, groundUnder, HeardKnocks } from "./crowd-knocks.ts";
import { buildingAt, nearestNode } from "./crowd-places.ts";
import { CrowdPlacing, keepOverlaidOut, liftWalkers, type DriverDoors } from "./crowd-placing.ts";
import { CrowdWalkers } from "./crowd-walkers.ts";
import { createCrowdPoses, type CrowdPoses } from "./crowd-poses.ts";
import type { Stoops } from "../../world/openworld/openworld-stoops.ts";

/** Changes the crowd's poses after its own placing: the poses, the crowd time, whether this crowd is the host's. */
type CrowdOverlay = (poses: CrowdPoses, crowdSeconds: number, authority: boolean) => void;

/** `CAR_REACH` squared: a civilian within it of a car is tested for a hit (compared squared, no root per car per civilian per frame). */
const CAR_REACH_SQUARED = CAR_REACH * CAR_REACH;
const NO_STRIKES: readonly FigureStrike[] = [];

function hasLooseBody(car: DeformableCar): boolean {
  for (let slot = 0; slot < LOOSE_BODIES; slot++) {
    const body = car.looseBody(slot);
    if (body !== null && !body.shape.asleep) return true;
  }
  return false;
}

/**
 * The drawn crowd on the main thread: the brain's civilians (`CivilianRemote`) placed on their legs at the sim's crowd time, the cars' hits on them and the buildings' wrecks as host events, and the host's events heard on a client.
 * `poses` is read by the drawing: a civilian's drawn spot is the brain's (a pure function of its rows and the crowd time) pushed off the others by at most `MAX_OFFSET`.
 * The cars' hits are found on the drawn spots; a bump or push is the brain walking two bodies through each other, so it is found on the brain's.
 */
export class CivilianCrowd {
  readonly poses: CrowdPoses;
  /** The law's: run once a step after the civilians are placed and before the cars' hits are found, so a hit meets where a fleeing suspect is drawn. */
  overlay: CrowdOverlay | null = null;
  /** Where a resident the society has getting into or out of her car stands (the traffic's car, the body style's door): none set, and she is not drawn. Every peer fills the same spot: it is a pure function of the brain's rows and the parking space. */
  driverDoors: DriverDoors | null = null;
  /** The rowhomes' stoops: a civilian walking out of or into a door on one is lifted to its step (`feetY`), the same on every peer. None set, the ground is flat. */
  stoops: Stoops | null = null;
  /** What the society says each resident is doing: its own reader, set by a test that needs one the brain does not give yet. */
  activityReader: typeof readActivity = readActivity;
  /** Who is in danger of a car and who is down awaiting an ambulance; its `onAmbulanceCall` is called on the host. */
  readonly aftermath: CrowdAftermath;
  readonly walkers = new CrowdWalkers();
  readonly separation: CrowdSeparation;
  private readonly remote: CivilianRemote;
  private readonly map: OpenWorldMap;
  private readonly log: CrowdEventLog;
  private readonly placing: CrowdPlacing;
  private readonly knocks = new HeardKnocks();
  private advancedThrough = -1;
  private seconds = 0;
  private authority = false;
  private started = false;
  private struck: FigureStrike[] = [];
  private struckSpare: FigureStrike[] = [];
  private readonly wreckedAt: Float64Array;
  private readonly bumpSince: Float64Array;
  private readonly hitSince: Float64Array;
  private readonly bumpPartner: Int32Array;
  private readonly pushedAt: Float64Array;
  private lastCrashSeconds = -Infinity;
  private readonly crimeDesk: CrimeDesk;
  private readonly crimesDue: Int32Array;
  private readonly blows: Uint8Array;
  private readonly blowsFight: Int32Array;
  /** Per victim, the landing second of the latest swing counted in the fight `blowsFight` names: a swing is counted once however many steps look at its window. */
  private readonly blowsLanded: Float64Array;
  /** Per victim, the blow that knocks her out in the fight `blowsFight` names (0: none), drawn once a fight. */
  private readonly knockoutAt: Uint8Array;
  /** The crowd second of the step before this one: where the blows `findPunches` looks for begin. */
  private blowsFrom = 0;
  private readonly blow = new CivilianBlow();

  constructor(map: OpenWorldMap, seed: number, playableResidents: number, remote: CivilianRemote, signals = false) {
    remote.init(seed, map, playableResidents, signals);
    this.remote = remote;
    this.map = map;
    const { capacity } = remote.state;
    this.poses = createCrowdPoses(capacity);
    this.separation = new CrowdSeparation(capacity);
    this.log = new CrowdEventLog(capacity, remote);
    this.placing = new CrowdPlacing(capacity);
    this.aftermath = new CrowdAftermath(capacity);
    this.bumpSince = new Float64Array(capacity).fill(-Infinity);
    this.hitSince = new Float64Array(capacity).fill(-Infinity);
    this.bumpPartner = new Int32Array(capacity).fill(-1);
    this.pushedAt = new Float64Array(capacity).fill(-Infinity);
    this.crimeDesk = new CrimeDesk(capacity);
    this.crimesDue = new Int32Array(capacity);
    this.blows = new Uint8Array(capacity);
    this.blowsFight = new Int32Array(capacity).fill(NEVER_TICK);
    this.knockoutAt = new Uint8Array(capacity);
    this.blowsLanded = new Float64Array(capacity).fill(-Infinity);
    this.wreckedAt = new Float64Array(map.places.length).fill(-Infinity);
  }

  get state(): CityState {
    return this.remote.state;
  }

  get usingWorker(): boolean {
    return this.remote.usingWorker;
  }

  /** The crowd time of the last step. */
  get crowdSeconds(): number {
    return this.seconds;
  }

  /** One step at crowd time `crowdSeconds`: every decision tick passed is advanced, the people placed (animals walk in the brain but are not shown until there is art for them), and on the host (`authority`) the cars' hits on them found; a client throws the knocks it heard. */
  step(crowdSeconds: number, cars: readonly DeformableCar[], authority: boolean): void {
    this.blowsFrom = this.seconds;
    this.authority = authority;
    this.advanceBrain(tickAt(crowdSeconds));
    this.seconds = crowdSeconds;
    this.placing.fillPoses(crowdSeconds, this.remote.state, this.poses, this.separation, this.driverDoors, this.stoops, this.activityReader);
    this.separate(crowdSeconds);
    if (this.overlay !== null) {
      this.overlay(this.poses, crowdSeconds, authority);
      keepOverlaidOut(this.stoops, this.poses, this.separation);
    }
    liftWalkers(this.stoops, this.poses, this.separation);
    if (authority) {
      this.findPunches();
      this.findHits(cars, crowdSeconds);
      this.aftermath.raiseDangers(crowdSeconds, cars, this.poses, this.map, this.log);
      this.aftermath.raiseAmbulanceCalls(crowdSeconds, this.remote.state, this.log);
      this.log.postBatch();
    } else this.knocks.throwDue(this.seconds, this.remote.state, cars, this.poses, this.struck);
  }

  /** A solid met by a car closing at `closing` m/s at (x, z): hard enough on a building's footprint, it is a wreck event (the host only). */
  noteWallHit(closing: number, x: number, z: number): void {
    if (!this.authority || closing < WRECK_SPEED) return;
    const place = buildingAt(this.map, x, z);
    if (place === NO_PLACE) {
      this.noteCrash(x, z);
      return;
    }
    if (this.seconds - this.wreckedAt[place]! < WRECK_LOCKOUT_SECONDS) return;
    this.wreckedAt[place] = this.seconds;
    this.log.appendLog(EVENT_KIND.wreck, place, this.seconds);
    this.log.queueForBrain(EVENT_KIND.wreck, place, this.seconds);
    this.log.postBatch();
  }

  /** A hard hit of a car on something that is no building's, near enough a street, is a crash for those who see it: one in `CRASH_LOCKOUT_SECONDS`. */
  private noteCrash(x: number, z: number): void {
    if (this.seconds - this.lastCrashSeconds < CRASH_LOCKOUT_SECONDS) return;
    const node = nearestNode(this.map, x, z);
    if (node === NO_PLACE) return;
    const { nodeX, nodeZ } = this.map.graph;
    if (hypot2(nodeX[node]! - x, nodeZ[node]! - z) > CRASH_NODE_REACH) return;
    this.lastCrashSeconds = this.seconds;
    this.log.logHostEvent(EVENT_KIND.danger, node, this.seconds);
    this.log.postBatch();
  }

  /** A host event the crowd does not decide itself (a bust, say) enters the log and the brain's next plan; a client's call does nothing. */
  raiseEvent(kind: number, subject: number, seconds = this.seconds): void {
    if (!this.authority) return;
    this.log.logHostEvent(kind, subject, seconds);
    this.log.postBatch();
  }

  /** A host event between two civilians (`first` the victim, `second` the other; -1 for none) enters the log as a triple for each and the brain's next plan; a client's call does nothing. */
  raisePair(kind: number, first: number, second: number, seconds = this.seconds): void {
    if (!this.authority) return;
    this.log.logPair(kind, first, second, seconds);
    this.log.postBatch();
  }

  /** The host's event log (kind, subject, crowd seconds triples), a view of the live one. */
  eventLog(): Float64Array {
    return this.log.view();
  }

  /** The host's log as it stands: the events after the last one this crowd has are new (the log only grows), given to the brain and, for a knock, to the ragdoll throw. */
  hear(events: Float64Array): void {
    for (let at = this.log.firstNew(events); at + EVENT_TRIPLE <= events.length; at += EVENT_TRIPLE) {
      const kind = events[at]!;
      const subject = events[at + 1]!;
      const seconds = events[at + 2]!;
      this.log.appendLog(kind, subject, seconds);
      if (this.started) this.log.queueForBrain(kind, subject, seconds);
      this.knocks.hear(events, at, kind, subject, seconds, this.poses);
    }
    if (this.started) this.log.postBatch();
  }

  /** The civilians run down since the last call, oldest first; the array is the crowd's own, valid until the next call that has any. */
  takeStrikes(): readonly FigureStrike[] {
    if (this.struck.length === 0) return NO_STRIKES;
    const out = this.struck;
    this.struck = this.struckSpare;
    this.struck.length = 0;
    this.struckSpare = out;
    return out;
  }

  dispose(): void {
    this.remote.dispose();
  }

  /**
   * Solo's time skip: the society lives through the ticks before the one `crowdSeconds` falls in, a tick at a time as the sim steps would (a crime due is raised and posted as it comes), so the next `step` at `crowdSeconds` has one tick left to take.
   * The skipped time is asked nothing of the cars, the cops or the player: no hit, danger or ambulance call is raised in it. False, and nothing done, for a crowd that is not the authority (a client's, or one not stepped yet).
   */
  skipThrough(crowdSeconds: number): boolean {
    if (!this.authority) return false;
    const last = tickAt(crowdSeconds) - 1;
    while (this.advancedThrough < last) {
      this.advanceBrain(this.advancedThrough + 1);
      this.log.postBatch();
    }
    this.seconds = crowdSeconds;
    return true;
  }

  private advanceBrain(tick: number): void {
    while (this.advancedThrough < tick) {
      const next = this.advancedThrough + 1;
      this.remote.advance(next, this.started ? NO_EVENTS : this.log.replayDue(next));
      this.advancedThrough = next;
      this.log.advanced(next);
      if (this.authority) this.raiseCrimes(next);
    }
    if (!this.started) {
      this.started = true;
      this.log.queueUnreplayed();
    }
  }

  /** The crimes the brain has come to the point of committing at `tick`: each is a host event, so a cop can stop it before the brain commits it. */
  private raiseCrimes(tick: number): void {
    const due = this.crimeDesk.collect(this.remote.state, tick, this.crimesDue);
    for (let at = 0; at < due; at++) this.log.logHostEvent(EVENT_KIND.crime, this.crimesDue[at]!, tick / DECISION_HZ);
  }

  /** The drawn spots: the brain's, with the players on foot as bodies that do not give way, pushed apart; then the bumps and pushes the closing pairs make. */
  private separate(seconds: number): void {
    const separation = this.separation;
    const walkers = this.walkers;
    for (let walker = 0; walker < WALKER_CAPACITY; walker++) {
      const body = separation.capacity + walker;
      const there = walker < walkers.count;
      separation.present[body] = there ? 1 : 0;
      separation.fixed[body] = 1;
      if (!there) continue;
      separation.brainX[body] = walkers.x[walker]!;
      separation.brainZ[body] = walkers.z[walker]!;
      separation.velocityX[body] = walkers.velocityX[walker]!;
      separation.velocityZ[body] = walkers.velocityZ[walker]!;
    }
    separation.now[0] = seconds;
    separation.resolve();
    const { x, z, shown } = this.poses;
    for (let resident = 0; resident < separation.capacity; resident++) {
      if (shown[resident] === 0) continue;
      x[resident] = separation.drawX[resident]!;
      z[resident] = separation.drawZ[resident]!;
      if (this.placing.laneWalking[resident] === 1 && this.stoops !== null) this.stoops.keepOut(x, z, resident);
    }
    this.noteContacts(seconds);
    this.writeActivity(seconds);
  }

  /** Pairs whose brain spots touch bump (every peer draws it); on the host, a hard collision or a player's shove is a push event. */
  private noteContacts(seconds: number): void {
    const separation = this.separation;
    const { pairFirst, pairSecond, pairDistance, pairClosing, brainX, brainZ, velocityX, velocityZ } = separation;
    for (let at = 0; at < separation.pairCount; at++) {
      const distance = pairDistance[at]!;
      if (distance >= BUMP_DISTANCE) continue;
      const closing = pairClosing[at]!;
      const first = pairFirst[at]!;
      const second = pairSecond[at]!;
      const byWalker = second >= separation.capacity;
      if (separation.fixed[first] === 1 || (!byWalker && separation.fixed[second] === 1) || this.isAnimal(first) || (!byWalker && this.isAnimal(second))) continue;
      if (closing >= BUMP_CLOSING_SPEED) {
        this.startBump(first, byWalker ? NOT_A_CIVILIAN : second, seconds);
        if (!byWalker) this.startBump(second, first, seconds);
      }
      if (!this.authority) continue;
      if (byWalker) {
        if (this.walkers.shoves[second - separation.capacity] === 0) continue;
        if (distance < WALKER_PUSH_DISTANCE && closing >= WALKER_PUSH_CLOSING_SPEED) this.raiseBearingPush(first, brainX[second]!, brainZ[second]!, seconds, EVENT_KIND.walker);
        continue;
      }
      if (distance >= HARD_DISTANCE || closing < HARD_CLOSING_SPEED) continue;
      const apartX = brainX[first]! - brainX[second]!;
      const apartZ = brainZ[first]! - brainZ[second]!;
      const firstIntoSecond = -(velocityX[first]! * apartX + velocityZ[first]! * apartZ);
      const secondIntoFirst = velocityX[second]! * apartX + velocityZ[second]! * apartZ;
      if (firstIntoSecond > secondIntoFirst) this.raisePush(second, first, seconds);
      else this.raisePush(first, second, seconds);
    }
  }

  private startBump(resident: number, partner: number, seconds: number): void {
    if (seconds - this.bumpSince[resident]! < ACTIVITY_SECONDS.bump + BUMP_COOLDOWN_SECONDS) return;
    this.bumpSince[resident] = seconds;
    this.bumpPartner[resident] = partner;
  }

  /** A civilian with nothing of the brain's to do bumps for the clip's length after a bump. */
  private writeActivity(seconds: number): void {
    const { shown, activity, activityClock, activityLeft, partner } = this.poses;
    for (let resident = 0; resident < this.separation.capacity; resident++) {
      if (shown[resident] === 0) continue;
      const hitAge = seconds - this.hitSince[resident]!;
      if (activity[resident] === ACTIVITY.none && hitAge >= 0 && hitAge < ACTIVITY_SECONDS.hit) {
        activity[resident] = ACTIVITY.hit;
        activityClock[resident] = hitAge;
        activityLeft[resident] = ACTIVITY_SECONDS.hit - hitAge;
        partner[resident] = NOT_A_CIVILIAN;
        continue;
      }
      const age = seconds - this.bumpSince[resident]!;
      if (activity[resident] !== ACTIVITY.none || age < 0 || age >= ACTIVITY_SECONDS.bump) continue;
      activity[resident] = ACTIVITY.bump;
      activityClock[resident] = age;
      activityLeft[resident] = ACTIVITY_SECONDS.bump - age;
      partner[resident] = this.bumpPartner[resident]!;
    }
  }

  /** Whether a push may be logged: at most one for a resident (as victim or pusher) in `PUSH_LOCKOUT_SECONDS`; a push let through locks its residents out. */
  private mayPush(victim: number, pusher: number, seconds: number): boolean {
    if (seconds - this.pushedAt[victim]! < PUSH_LOCKOUT_SECONDS) return false;
    if (pusher !== NOT_A_CIVILIAN && seconds - this.pushedAt[pusher]! < PUSH_LOCKOUT_SECONDS) return false;
    this.pushedAt[victim] = seconds;
    if (pusher !== NOT_A_CIVILIAN) this.pushedAt[pusher] = seconds;
    return true;
  }

  /** A push by a civilian or (`NOT_A_CIVILIAN`) a car, on the host. */
  private raisePush(victim: number, pusher: number, seconds: number): void {
    if (this.mayPush(victim, pusher, seconds)) this.logPush(victim, pusher, seconds);
  }

  /** A player on foot at (`walkerX`, `walkerZ`) shoved `victim`: the push triple, then a `walker` triple of the bearing from the victim's brain spot to him, so the brain tells a shove from a car's nudge and turns the fight his way. */
  /** A push by a body at (x, z) that is not a civilian, logged with the bearing to it (`party`: `EVENT_KIND.walker` for the player on foot, `EVENT_KIND.car` for a car): the one pushed turns on it. */
  private raiseBearingPush(victim: number, x: number, z: number, seconds: number, party: number): void {
    if (!this.mayPush(victim, NOT_A_CIVILIAN, seconds)) return;
    const turns = detAtan2(x - this.separation.brainX[victim]!, z - this.separation.brainZ[victim]!) / (2 * Math.PI);
    this.log.logHostEvent(EVENT_KIND.push, victim, seconds);
    this.log.logHostEvent(party, Math.round(turns * WALKER_BEARING_STEPS) & (WALKER_BEARING_STEPS - 1), seconds);
  }

  /** The victim's triple, then the pusher's `alongside` triple when the pusher is a civilian (a car, or a knock, has none): the wire's subject is 16 bits. */
  private logPush(victim: number, pusher: number, seconds: number): void {
    this.log.logPair(EVENT_KIND.push, victim, pusher, seconds);
  }

  /** The shown civilian nearest a punch thrown at (x, z) along (dirX, dirZ), within its reach and arc, whom no body stands for (`held`); -1 for none, or without authority. */
  punchTarget(x: number, z: number, dirX: number, dirZ: number, held: Uint8Array | null): number {
    if (!this.authority) return -1;
    const { x: px, z: pz, shown } = this.poses;
    let nearest = -1;
    let nearestGap = Infinity;
    for (let resident = 0; resident < this.separation.capacity; resident++) {
      if (shown[resident] === 0 || (held !== null && held[resident] === 1) || this.isAnimal(resident)) continue;
      const gap = punchGap(x, z, dirX, dirZ, px[resident]!, pz[resident]!);
      if (gap < 0 || gap >= nearestGap) continue;
      nearestGap = gap;
      nearest = resident;
    }
    return nearest;
  }

  /** The player's punch from (x, z) landed on `resident`: she may turn on him (the push a walker's bump raises) and plays the hit clip. */
  punched(resident: number, x: number, z: number, seconds: number): void {
    if (!this.authority) return;
    this.raiseBearingPush(resident, x, z, seconds, EVENT_KIND.walker);
    this.hitSince[resident] = seconds;
    this.log.postBatch();
  }

  /** The player's blow fells `resident` (a knock-out): hidden, thrown along (dirX, dirZ), the knock in the log. */
  knockOut(resident: number, seconds: number, dirX: number, dirZ: number): void {
    if (!this.authority || this.poses.shown[resident] === 0) return;
    const x = this.poses.x[resident]!;
    const z = this.poses.z[resident]!;
    this.knockDown(resident, seconds, felled(resident, x, groundUnder(this.poses, resident, x, z), z, dirX, dirZ, blankStrike()));
    // A punch lands between steps: posted now, the brain hides her before the next step's poses (as `noteWallHit` posts), not a frame after.
    this.log.postBatch();
  }

  /** Host: a bullet takes drawn resident `resident`: she is knocked down along it at `speed` m/s, as a car's knock. */
  shoot(resident: number, seconds: number, dirX: number, dirZ: number, speed: number): void {
    if (!this.authority || this.poses.shown[resident] === 0) return;
    const x = this.poses.x[resident]!;
    const z = this.poses.z[resident]!;
    const strike = felled(resident, x, groundUnder(this.poses, resident, x, z), z, dirX, dirZ, blankStrike());
    strike.vx = Math.fround(dirX * speed);
    strike.vz = Math.fround(dirZ * speed);
    this.knockDown(resident, seconds, strike);
    // A shot lands between steps: posted now, as `knockOut` posts.
    this.log.postBatch();
  }

  /** The host's hits meet the body the player sees. The separation is a pure function of the brain's spots and the fixed bodies, and a client hears the knock as an event, so the host's drawn spots are the authority; a client's own walker shifts only its drawn spots, never a hit. */
  private findHits(cars: readonly DeformableCar[], seconds: number): void {
    const state = this.remote.state;
    const { x, z, yaw, shown } = this.poses;
    const ground = activeGround();
    for (let carIndex = 0; carIndex < cars.length; carIndex++) {
      const car = cars[carIndex]!;
      const carX = car.group.position.x;
      const carZ = car.group.position.z;
      const carSpeed = hypot2(car.velocity.x, car.velocity.z);
      const loose = hasLooseBody(car);
      const coming = carSpeed >= DANGER_MIN_SPEED;
      for (let resident = 0; resident < state.capacity; resident++) {
        if (shown[resident] === 0) continue;
        const spotX = x[resident]!;
        const spotZ = z[resident]!;
        const animal = this.isAnimal(resident);
        if (coming && !animal) this.aftermath.watchApproach(resident, carIndex, spotX - carX, spotZ - carZ, car.velocity.x, car.velocity.z, carSpeed, seconds);
        const apartX = carX - spotX;
        const apartZ = carZ - spotZ;
        const near = apartX * apartX + apartZ * apartZ <= CAR_REACH_SQUARED;
        if (!near && !loose) continue;
        const spotY = ground.heightAt(spotX, spotZ);
        if (near && runsDown(car, spotX, spotZ, spotY)) this.knockDown(resident, seconds, fell(car, carIndex, resident, spotX, spotY, spotZ, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (loose && looseRunsDown(car, spotX, spotZ, spotY)) this.knockDown(resident, seconds, stood(carIndex, resident, spotX, spotY, spotZ, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (!animal && near && carSpeed >= CAR_NUDGE_SPEED && carGap(car, spotX, spotZ) < CAR_NUDGE_GAP) this.raiseBearingPush(resident, carX, carZ, seconds, EVENT_KIND.car);
      }
    }
  }

  /** Host: the fights' blows that landed since the last step (`blowsFrom` to `seconds`, handed over in the blow's fields so no double crosses a call boxed). The blow that reaches its victim's knock-out count fells her as a car's knock does, with the striker named. */
  private findPunches(): void {
    const state = this.remote.state;
    const blow = this.blow;
    blow.fromSeconds = this.blowsFrom;
    blow.toSeconds = this.seconds;
    for (let from = 0; ; ) {
      const striker = findCivilianBlow(state, from, blow);
      if (striker < 0) return;
      from = striker + 1;
      const victim = blow.victim;
      const fightTick = state.ints[victim * RESIDENT_INT_STRIDE + RESIDENT_INT.fightTick]!;
      if (this.blowsFight[victim] !== fightTick) {
        this.blowsFight[victim] = fightTick;
        this.blows[victim] = 0;
        this.blowsLanded[victim] = -Infinity;
        this.knockoutAt[victim] = knockoutBlow(state.seed, victim, fightTick);
      }
      if (blow.landing <= this.blowsLanded[victim]!) continue;
      this.blowsLanded[victim] = blow.landing;
      this.blows[victim] = this.blows[victim]! + 1;
      const knockout = this.knockoutAt[victim]!;
      if (knockout === 0 || this.blows[victim] !== knockout || this.poses.shown[victim] === 0) continue;
      this.knockDown(victim, this.seconds, felledBy(this.poses, victim, striker, blankStrike()), striker);
    }
  }

  private knockDown(resident: number, seconds: number, strike: FigureStrike, by = NOT_A_CIVILIAN): void {
    // Nobody calls an ambulance for a run-down animal.
    this.aftermath.knockedDown(resident, seconds, this.isAnimal(resident), this.poses);
    this.poses.shown[resident] = 0;
    this.struck.push(strike);
    this.log.appendLog(EVENT_KIND.knock, resident, seconds);
    this.log.queueForBrain(EVENT_KIND.knock, resident, seconds);
    this.logPush(resident, by, seconds);
  }

  /** Whether `resident` is a cat or a dog: shown and run down like a person, never bumped, pushed, punched, warned of a car or sent an ambulance. */
  isAnimal(resident: number): boolean {
    return this.remote.state.ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species] !== SPECIES.person;
  }
}
