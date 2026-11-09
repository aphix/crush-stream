import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, looseRunsDown, runsDown, stood, type FigureStrike } from "../../scenes/figure-strike.ts";
import { LOOSE_BODIES } from "../../vehicle/part-state.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { CAR_REACH } from "../../scenes/lawn-guard.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "./civilian-clock.ts";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, GENDER, MIX_INDEX, MIX_RESIDENT, MIX_SALT, NO_PLACE, PLAN_LEAD_TICKS, PURPOSE, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { carGap } from "./civilian-contact.ts";
import {
  BUMP_CLOSING_SPEED,
  BUMP_COOLDOWN_SECONDS,
  BUMP_DISTANCE,
  CAR_NUDGE_GAP,
  CAR_NUDGE_SPEED,
  CLOCK_OFFSET_CREEP,
  EVENT_LOG_CAPACITY,
  HARD_CLOSING_SPEED,
  HARD_DISTANCE,
  HEARD_KNOCK_LATE_SECONDS,
  HEARD_KNOCK_QUEUE,
  LOOK,
  POLICE_HASH,
  PUSH_LOCKOUT_SECONDS,
  STRIDE_RADIANS_PER_METRE,
  WALKER_CAPACITY,
  WALKER_PUSH_CLOSING_SPEED,
  WALKER_PUSH_DISTANCE,
  WRECK_LOCKOUT_SECONDS,
  WRECK_MARGIN,
  WRECK_SPEED,
} from "./civilian-crowd-constants.ts";
import { LegPose, legPose, legPositionAt } from "./civilian-leg.ts";
import type { CivilianRemote } from "./civilian-remote.ts";
import { CrowdSeparation } from "./civilian-separation.ts";
import type { CityState } from "./civilian-state.ts";
import { type ActivityReading, readActivity } from "./society-activity.ts";
import { CrimeDesk } from "./society-crime.ts";
import { CrowdWalkers } from "./crowd-walkers.ts";
import { createCrowdPoses, type CrowdPoses } from "./crowd-poses.ts";

const NO_EVENTS: readonly number[] = [];
const NO_STRIKES: readonly FigureStrike[] = [];
/** The pusher of a push that was no civilian: a player's walker or a car. */
const NOT_A_CIVILIAN = -1;

/** The look word of the resident whose integer row starts at `base` (`LOOK`): the same resident in the same city always looks the same. */
function lookOf(seed: number, ints: Int32Array, base: number): number {
  let hash = Math.imul(seed ^ LOOK.salt, MIX_RESIDENT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.firstName]!, MIX_INDEX);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.familyName]!, MIX_SALT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.birthDay]!, MIX_RESIDENT);
  hash ^= hash >>> LOOK.hashShift;
  const woman = ints[base + RESIDENT_INT.gender] === GENDER.female ? 1 : 0;
  const who = Math.min(hash & LOOK.hashMask, POLICE_HASH - 1);
  return ((ints[base + RESIDENT_INT.species]! << LOOK.speciesShift) | (woman << LOOK.womanShift) | who) >>> 0;
}

function hasLooseBody(car: DeformableCar): boolean {
  for (let slot = 0; slot < LOOSE_BODIES; slot++) {
    const body = car.looseBody(slot);
    if (body !== null && !body.shape.asleep) return true;
  }
  return false;
}

/** A client's view of the host's crowd clock: the host's crowd time from its messages, run on this machine's clock the way the snapshot clock runs (least gap seen, a creep up). */
export class ClientCrowdClock {
  private offset = Infinity;
  private heardHost = 0;
  private heardCrowd = 0;

  hear(hostTime: number, crowdTime: number, localNow: number): void {
    this.offset = Math.min(localNow - hostTime, this.offset + CLOCK_OFFSET_CREEP);
    this.heardHost = hostTime;
    this.heardCrowd = crowdTime;
  }

  /** The host's crowd time at the host clock `renderDelay` s behind now, where the snapshots the client draws are. */
  crowdSeconds(localNow: number, renderDelay: number): number {
    return Math.max(0, this.heardCrowd + (localNow - this.offset - renderDelay - this.heardHost));
  }
}

/**
 * The drawn crowd on the main thread: the brain's civilians (`CivilianRemote`) placed on their legs at the sim's crowd time, the cars' hits on them and the buildings' wrecks as host events, and the host's events heard on a client.
 * `poses` is read by the drawing: a civilian's drawn spot is the brain's (a pure function of its rows and the crowd time) pushed off the others by at most `MAX_OFFSET`.
 * Hits and events are found on the brain's spot, so the push never reaches the society except as a push event.
 */
export class CivilianCrowd {
  readonly poses: CrowdPoses;
  readonly walkers = new CrowdWalkers();
  readonly separation: CrowdSeparation;
  private readonly remote: CivilianRemote;
  private readonly map: OpenWorldMap;
  private readonly pose = new LegPose();
  private advancedThrough = -1;
  /** The newest tick posted to the brain, kept in step with the remote's own: an event is posted at the next one. */
  private postedThrough = -1;
  private seconds = 0;
  private authority = false;
  private started = false;
  private readonly log = new Float64Array(EVENT_LOG_CAPACITY * EVENT_TRIPLE);
  private logCount = 0;
  private logView = new Float64Array(0);
  /** Log events a late joiner's catch-up has given the brain. */
  private replayed = 0;
  private readonly batch: Float64Array;
  private batchCount = 0;
  private struck: FigureStrike[] = [];
  private readonly wreckedAt: Float64Array;
  private readonly heardKnockResident = new Int32Array(HEARD_KNOCK_QUEUE);
  private readonly heardKnockSeconds = new Float64Array(HEARD_KNOCK_QUEUE);
  private heardKnocks = 0;
  private readonly bumpSince: Float64Array;
  private readonly bumpPartner: Int32Array;
  private readonly pushedAt: Float64Array;
  private readonly reading: ActivityReading = { code: ACTIVITY.none, sinceSeconds: 0, leftSeconds: ACTIVITY_OPEN_ENDED, partner: NOT_A_CIVILIAN, surfaceY: 0, placed: false, x: 0, z: 0, yaw: 0 };
  private readonly crimeDesk: CrimeDesk;
  private readonly crimesDue: Int32Array;

  constructor(map: OpenWorldMap, seed: number, playableResidents: number, remote: CivilianRemote) {
    remote.init(seed, map, playableResidents);
    this.remote = remote;
    this.map = map;
    const { capacity } = remote.state;
    this.poses = createCrowdPoses(capacity);
    this.separation = new CrowdSeparation(capacity);
    this.bumpSince = new Float64Array(capacity).fill(-Infinity);
    this.bumpPartner = new Int32Array(capacity).fill(-1);
    this.pushedAt = new Float64Array(capacity).fill(-Infinity);
    this.crimeDesk = new CrimeDesk(capacity);
    this.crimesDue = new Int32Array(capacity);
    this.batch = new Float64Array((capacity + EVENT_LOG_CAPACITY) * EVENT_TRIPLE);
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
    this.authority = authority;
    this.advanceBrain(tickAt(crowdSeconds));
    this.seconds = crowdSeconds;
    this.fillPoses(crowdSeconds);
    this.separate(crowdSeconds);
    if (authority) {
      this.findHits(cars, crowdSeconds);
      this.postBatch();
    } else this.throwHeardKnocks(cars);
  }

  /** A solid met by a car closing at `closing` m/s at (x, z): hard enough on a building's footprint, it is a wreck event (the host only). */
  noteWallHit(closing: number, x: number, z: number): void {
    if (!this.authority || closing < WRECK_SPEED) return;
    const place = this.buildingAt(x, z);
    if (place === NO_PLACE || this.seconds - this.wreckedAt[place]! < WRECK_LOCKOUT_SECONDS) return;
    this.wreckedAt[place] = this.seconds;
    this.appendLog(EVENT_KIND.wreck, place, this.seconds);
    this.queueForBrain(EVENT_KIND.wreck, place, this.seconds);
    this.postBatch();
  }

  /** A host event the crowd does not decide itself (a bust, say) enters the log and the brain's next plan; a client's call does nothing. */
  raiseEvent(kind: number, subject: number, seconds = this.seconds): void {
    if (!this.authority) return;
    this.logHostEvent(kind, subject, seconds);
    this.postBatch();
  }

  /** A host event between two civilians (`first` the victim, `second` the other; -1 for none) enters the log as a triple for each and the brain's next plan; a client's call does nothing. */
  raisePair(kind: number, first: number, second: number, seconds = this.seconds): void {
    if (!this.authority) return;
    this.logPair(kind, first, second, seconds);
    this.postBatch();
  }

  /** The host's event log (kind, subject, crowd seconds triples), a view of the live one. */
  eventLog(): Float64Array {
    if (this.logView.length !== this.logCount * EVENT_TRIPLE) this.logView = this.log.subarray(0, this.logCount * EVENT_TRIPLE);
    return this.logView;
  }

  /** The host's log as it stands: the events after the last one this crowd has are new (the log only grows), given to the brain and, for a knock, to the ragdoll throw. */
  hear(events: Float64Array): void {
    let first = 0;
    const last = (this.logCount - 1) * EVENT_TRIPLE;
    for (let at = events.length - EVENT_TRIPLE; at >= 0 && last >= 0; at -= EVENT_TRIPLE) {
      if (events[at] === this.log[last] && events[at + 1] === this.log[last + 1] && events[at + 2] === this.log[last + 2]) {
        first = at + EVENT_TRIPLE;
        break;
      }
    }
    for (let at = first; at + EVENT_TRIPLE <= events.length; at += EVENT_TRIPLE) {
      const kind = events[at]!;
      const subject = events[at + 1]!;
      const seconds = events[at + 2]!;
      this.appendLog(kind, subject, seconds);
      if (this.started) this.queueForBrain(kind, subject, seconds);
      if (kind === EVENT_KIND.knock && this.heardKnocks < HEARD_KNOCK_QUEUE && subject >= 0 && subject < this.poses.count) {
        this.heardKnockResident[this.heardKnocks] = subject;
        this.heardKnockSeconds[this.heardKnocks++] = seconds;
      }
    }
    if (this.started) this.postBatch();
  }

  /** The civilians run down since the last call, oldest first. */
  takeStrikes(): readonly FigureStrike[] {
    if (this.struck.length === 0) return NO_STRIKES;
    const out = this.struck;
    this.struck = [];
    return out;
  }

  dispose(): void {
    this.remote.dispose();
  }

  private advanceBrain(tick: number): void {
    while (this.advancedThrough < tick) {
      const next = this.advancedThrough + 1;
      this.remote.advance(next, this.started ? NO_EVENTS : this.replayDue(next));
      this.advancedThrough = next;
      this.postedThrough = Math.max(this.postedThrough, next + PLAN_LEAD_TICKS);
      if (this.authority) this.raiseCrimes(next);
    }
    if (!this.started) this.queueUnreplayed();
  }

  /** The crimes the brain has come to the point of committing at `tick`: each is a host event, so a cop can stop it before the brain commits it. */
  private raiseCrimes(tick: number): void {
    const due = this.crimeDesk.collect(this.remote.state, tick, this.crimesDue);
    for (let at = 0; at < due; at++) this.logHostEvent(EVENT_KIND.crime, this.crimesDue[at]!, tick / DECISION_HZ);
  }

  /** After the catch-up, the log's events still to come (the host's clock is ahead of a client's) go to the brain as heard ones do. */
  private queueUnreplayed(): void {
    this.started = true;
    for (let at = this.replayed; at < this.logCount; at++) this.queueForBrain(this.log[at * EVENT_TRIPLE]!, this.log[at * EVENT_TRIPLE + 1]!, this.log[at * EVENT_TRIPLE + 2]!);
    this.replayed = this.logCount;
    this.postBatch();
  }

  /** A late joiner's first steps give the brain the log's events at the ticks they happened in, as the host's brain had them. */
  private replayDue(tick: number): ArrayLike<number> {
    let end = this.replayed;
    while (end < this.logCount && tickAt(this.log[end * EVENT_TRIPLE + 2]!) <= tick) end++;
    if (end === this.replayed) return NO_EVENTS;
    const due = this.log.subarray(this.replayed * EVENT_TRIPLE, end * EVENT_TRIPLE);
    this.replayed = end;
    return due;
  }

  private fillPoses(seconds: number): void {
    const state = this.remote.state;
    const { ints, floats } = state;
    const { yaw, stride, speed, look, shown, activity, activityClock, activityLeft, partner, surfaceY } = this.poses;
    const { present, fixed, brainX, brainZ, velocityX, velocityZ } = this.separation;
    const pose = this.pose;
    const reading = this.reading;
    for (let resident = 0; resident < state.capacity; resident++) {
      const intBase = resident * RESIDENT_INT_STRIDE;
      shown[resident] = 0;
      present[resident] = 0;
      if (ints[intBase + RESIDENT_INT.species] !== SPECIES.person) continue;
      readActivity(state, resident, seconds, reading);
      const walkSpeed = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
      if (reading.placed) {
        brainX[resident] = reading.x;
        brainZ[resident] = reading.z;
        velocityX[resident] = 0;
        velocityZ[resident] = 0;
        yaw[resident] = reading.yaw;
        speed[resident] = 0;
        stride[resident] = 0;
      } else {
        const onLeg = ints[intBase + RESIDENT_INT.pathCount]! > 0 && seconds >= ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ && seconds < ints[intBase + RESIDENT_INT.arriveTick]! / DECISION_HZ;
        if (!onLeg || ints[intBase + RESIDENT_INT.legPurpose] === PURPOSE.drive || !legPositionAt(state, resident, seconds, pose)) continue;
        brainX[resident] = pose.x;
        brainZ[resident] = pose.z;
        velocityX[resident] = pose.dirX * walkSpeed;
        velocityZ[resident] = pose.dirZ * walkSpeed;
        yaw[resident] = pose.yaw;
        speed[resident] = walkSpeed;
        stride[resident] = walkSpeed * (seconds - ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ) * STRIDE_RADIANS_PER_METRE;
      }
      shown[resident] = 1;
      present[resident] = 1;
      fixed[resident] = reading.placed ? 1 : 0;
      look[resident] = lookOf(state.seed, ints, intBase);
      activity[resident] = reading.code;
      activityClock[resident] = reading.sinceSeconds;
      activityLeft[resident] = reading.leftSeconds;
      partner[resident] = reading.partner;
      surfaceY[resident] = reading.surfaceY;
    }
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
    separation.resolve();
    const { x, z, shown } = this.poses;
    for (let resident = 0; resident < separation.capacity; resident++) {
      if (shown[resident] === 0) continue;
      x[resident] = separation.drawX[resident]!;
      z[resident] = separation.drawZ[resident]!;
    }
    this.noteContacts(seconds);
    this.writeActivity(seconds);
  }

  /** Pairs whose brain spots touch bump (every peer draws it); on the host, a hard collision or a walker's shove is a push event. */
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
      if (separation.fixed[first] === 1 || (!byWalker && separation.fixed[second] === 1)) continue;
      if (closing >= BUMP_CLOSING_SPEED) {
        this.startBump(first, byWalker ? NOT_A_CIVILIAN : second, seconds);
        if (!byWalker) this.startBump(second, first, seconds);
      }
      if (!this.authority) continue;
      if (byWalker) {
        if (distance < WALKER_PUSH_DISTANCE && closing >= WALKER_PUSH_CLOSING_SPEED) this.raisePush(first, NOT_A_CIVILIAN, seconds);
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
      const age = seconds - this.bumpSince[resident]!;
      if (activity[resident] !== ACTIVITY.none || age < 0 || age >= ACTIVITY_SECONDS.bump) continue;
      activity[resident] = ACTIVITY.bump;
      activityClock[resident] = age;
      activityLeft[resident] = ACTIVITY_SECONDS.bump - age;
      partner[resident] = this.bumpPartner[resident]!;
    }
  }

  /** A push event on the host, at most one for a resident (as victim or pusher) in `PUSH_LOCKOUT_SECONDS`. */
  private raisePush(victim: number, pusher: number, seconds: number): void {
    if (seconds - this.pushedAt[victim]! < PUSH_LOCKOUT_SECONDS) return;
    if (pusher !== NOT_A_CIVILIAN && seconds - this.pushedAt[pusher]! < PUSH_LOCKOUT_SECONDS) return;
    this.pushedAt[victim] = seconds;
    if (pusher !== NOT_A_CIVILIAN) this.pushedAt[pusher] = seconds;
    this.logPush(victim, pusher, seconds);
  }

  /** The victim's triple, then the pusher's `alongside` triple when the pusher is a civilian (a player's walker or a car has none): the wire's subject is 16 bits. */
  private logPush(victim: number, pusher: number, seconds: number): void {
    this.logPair(EVENT_KIND.push, victim, pusher, seconds);
  }

  private logPair(kind: number, first: number, second: number, seconds: number): void {
    this.logHostEvent(kind, first, seconds);
    if (second !== NOT_A_CIVILIAN) this.logHostEvent(EVENT_KIND.alongside, second, seconds);
  }

  private logHostEvent(kind: number, subject: number, seconds: number): void {
    this.appendLog(kind, subject, seconds);
    this.queueForBrain(kind, subject, seconds);
  }

  private findHits(cars: readonly DeformableCar[], seconds: number): void {
    const state = this.remote.state;
    const { x, z, yaw, shown } = this.poses;
    const { brainX, brainZ } = this.separation;
    const ground = activeGround();
    for (let carIndex = 0; carIndex < cars.length; carIndex++) {
      const car = cars[carIndex]!;
      const carX = car.group.position.x;
      const carZ = car.group.position.z;
      const carSpeed = hypot2(car.velocity.x, car.velocity.z);
      const loose = hasLooseBody(car);
      for (let resident = 0; resident < state.capacity; resident++) {
        if (shown[resident] === 0) continue;
        const near = hypot2(carX - brainX[resident]!, carZ - brainZ[resident]!) <= CAR_REACH;
        if (!near && !loose) continue;
        const spotY = ground.heightAt(brainX[resident]!, brainZ[resident]!);
        if (near && runsDown(car, brainX[resident]!, brainZ[resident]!, spotY)) this.knockDown(resident, seconds, fell(car, carIndex, resident, x[resident]!, spotY, z[resident]!, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (loose && looseRunsDown(car, brainX[resident]!, brainZ[resident]!, spotY)) this.knockDown(resident, seconds, stood(carIndex, resident, x[resident]!, spotY, z[resident]!, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (near && carSpeed >= CAR_NUDGE_SPEED && carGap(car, brainX[resident]!, brainZ[resident]!) < CAR_NUDGE_GAP) this.raisePush(resident, NOT_A_CIVILIAN, seconds);
      }
    }
  }

  private knockDown(resident: number, seconds: number, strike: FigureStrike): void {
    this.poses.shown[resident] = 0;
    this.struck.push(strike);
    this.appendLog(EVENT_KIND.knock, resident, seconds);
    this.queueForBrain(EVENT_KIND.knock, resident, seconds);
    this.logPush(resident, NOT_A_CIVILIAN, seconds);
  }

  /** A knock heard from the host, once this clock reaches its time (the cars are drawn at that time): the civilian is thrown by the car nearest where they were, as that car's own hit would have thrown them. */
  private throwHeardKnocks(cars: readonly DeformableCar[]): void {
    const state = this.remote.state;
    let waiting = 0;
    for (let knock = 0; knock < this.heardKnocks; knock++) {
      const resident = this.heardKnockResident[knock]!;
      const at = this.heardKnockSeconds[knock]!;
      if (at > this.seconds) {
        this.heardKnockResident[waiting] = resident;
        this.heardKnockSeconds[waiting++] = at;
        continue;
      }
      if (this.seconds - at > HEARD_KNOCK_LATE_SECONDS || !legPose(state, resident, at, this.pose)) continue;
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let carIndex = 0; carIndex < cars.length; carIndex++) {
        const distance = hypot2(cars[carIndex]!.group.position.x - this.pose.x, cars[carIndex]!.group.position.z - this.pose.z);
        if (distance >= nearestDistance) continue;
        nearestDistance = distance;
        nearest = carIndex;
      }
      if (nearest < 0) continue;
      this.struck.push(fell(cars[nearest]!, nearest, resident, this.pose.x, activeGround().heightAt(this.pose.x, this.pose.z), this.pose.z, this.pose.dirX, this.pose.dirZ, blankStrike()));
    }
    this.heardKnocks = waiting;
  }

  /** The place whose footprint (grown by `WRECK_MARGIN`) holds the contact most deeply, among those inside the walls; `NO_PLACE` for none. */
  private buildingAt(x: number, z: number): number {
    const { places } = this.map;
    let best = NO_PLACE;
    let bestExcess = Infinity;
    for (let place = 0; place < places.length; place++) {
      const entry = places[place]!;
      if (entry.doorNode < 0) continue;
      const dx = x - entry.x;
      const dz = z - entry.z;
      const cos = detCos(entry.yaw);
      const sin = detSin(entry.yaw);
      const excess = Math.max(Math.abs(dx * cos - dz * sin) - entry.depth / 2, Math.abs(dx * sin + dz * cos) - entry.width / 2);
      if (excess > WRECK_MARGIN || excess >= bestExcess) continue;
      bestExcess = excess;
      best = place;
    }
    return best;
  }

  private appendLog(kind: number, subject: number, seconds: number): void {
    if (this.logCount === EVENT_LOG_CAPACITY) {
      this.log.copyWithin(0, EVENT_TRIPLE);
      this.logCount--;
      this.replayed = Math.max(0, this.replayed - 1);
    }
    const at = this.logCount++ * EVENT_TRIPLE;
    this.log[at] = kind;
    this.log[at + 1] = subject;
    this.log[at + 2] = seconds;
  }

  private queueForBrain(kind: number, subject: number, seconds: number): void {
    const at = this.batchCount++ * EVENT_TRIPLE;
    this.batch[at] = kind;
    this.batch[at + 1] = subject;
    this.batch[at + 2] = seconds;
  }

  /** The queued events go to the brain with the next tick it has not been asked to plan, so a knock hides its civilian at once and every peer gets the plan its events ride. */
  private postBatch(): void {
    if (this.batchCount === 0) return;
    this.postedThrough++;
    this.remote.post(this.postedThrough, this.batch.subarray(0, this.batchCount * EVENT_TRIPLE));
    this.batchCount = 0;
  }
}
