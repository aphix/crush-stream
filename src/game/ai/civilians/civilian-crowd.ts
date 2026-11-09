import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, looseRunsDown, runsDown, stood, type FigureStrike } from "../../scenes/figure-strike.ts";
import { MAX_CARS } from "../../scenes/fleet.ts";
import { LOOSE_BODIES } from "../../vehicle/part-state.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "./civilian-clock.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, GENDER, MIX_INDEX, MIX_RESIDENT, MIX_SALT, PLAN_LEAD_TICKS, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { CAR_REACH, CLOCK_OFFSET_CREEP, EVENT_LOG_CAPACITY, HEARD_KNOCK_QUEUE, LOOK, STRIDE_RADIANS_PER_METRE, WRECK_LOCKOUT_SECONDS, WRECK_MARGIN, WRECK_SPEED } from "./civilian-crowd-constants.ts";
import { LegPose, legPose, legPositionAt } from "./civilian-leg.ts";
import type { CivilianRemote } from "./civilian-remote.ts";
import type { CityState } from "./civilian-state.ts";
import type { CrowdPoses } from "./crowd-poses.ts";

const NO_EVENTS: readonly number[] = [];
const NO_STRIKES: readonly FigureStrike[] = [];
const NO_PLACE_HIT = -1;

/** The look word of the resident whose integer row starts at `base` (`LOOK`): the same resident in the same city always looks the same. */
function lookOf(seed: number, ints: Int32Array, base: number): number {
  let hash = Math.imul(seed ^ LOOK.salt, MIX_RESIDENT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.firstName]!, MIX_INDEX);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.familyName]!, MIX_SALT);
  hash = Math.imul(hash ^ ints[base + RESIDENT_INT.birthDay]!, MIX_RESIDENT);
  hash ^= hash >>> LOOK.hashShift;
  const woman = ints[base + RESIDENT_INT.gender] === GENDER.female ? 1 : 0;
  return ((ints[base + RESIDENT_INT.species]! << LOOK.speciesShift) | (woman << LOOK.womanShift) | (hash & LOOK.hashMask)) >>> 0;
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
 * `poses` is read by the drawing; a civilian is a pure function of the brain's rows and the crowd time.
 */
export class CivilianCrowd {
  readonly poses: CrowdPoses;
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

  constructor(map: OpenWorldMap, seed: number, playableResidents: number, remote: CivilianRemote) {
    remote.init(seed, map, playableResidents);
    this.remote = remote;
    this.map = map;
    const { capacity } = remote.state;
    this.poses = { count: capacity, x: new Float32Array(capacity), z: new Float32Array(capacity), yaw: new Float32Array(capacity), stride: new Float32Array(capacity), speed: new Float32Array(capacity), look: new Uint32Array(capacity), shown: new Uint8Array(capacity) };
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

  /** One step at crowd time `crowdSeconds`: every decision tick passed is advanced, the civilians placed, and on the host (`authority`) the cars' hits on them found; a client throws the knocks it heard. */
  step(crowdSeconds: number, cars: readonly DeformableCar[], authority: boolean): void {
    this.authority = authority;
    this.advanceBrain(tickAt(crowdSeconds));
    this.seconds = crowdSeconds;
    this.fillPoses(crowdSeconds);
    if (authority) {
      this.findHits(cars, crowdSeconds);
      this.postBatch();
    } else this.throwHeardKnocks(cars);
  }

  /** A solid met by a car closing at `closing` m/s at (x, z): hard enough on a building's footprint, it is a wreck event (the host only). */
  noteWallHit(closing: number, x: number, z: number): void {
    if (!this.authority || closing < WRECK_SPEED) return;
    const place = this.buildingAt(x, z);
    if (place === NO_PLACE_HIT || this.seconds - this.wreckedAt[place]! < WRECK_LOCKOUT_SECONDS) return;
    this.wreckedAt[place] = this.seconds;
    this.appendLog(EVENT_KIND.wreck, place, this.seconds);
    this.queueForBrain(EVENT_KIND.wreck, place, this.seconds);
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
    }
    this.started = true;
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
    const { x, z, yaw, stride, speed, look, shown } = this.poses;
    const pose = this.pose;
    for (let resident = 0; resident < state.capacity; resident++) {
      if (!legPositionAt(state, resident, seconds, pose)) {
        shown[resident] = 0;
        continue;
      }
      const intBase = resident * RESIDENT_INT_STRIDE;
      const walkSpeed = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
      shown[resident] = 1;
      x[resident] = pose.x;
      z[resident] = pose.z;
      yaw[resident] = pose.yaw;
      speed[resident] = walkSpeed;
      stride[resident] = walkSpeed * (seconds - ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ) * STRIDE_RADIANS_PER_METRE;
      look[resident] = lookOf(state.seed, ints, intBase);
    }
  }

  private findHits(cars: readonly DeformableCar[], seconds: number): void {
    const state = this.remote.state;
    const { ints } = state;
    const { x, z, yaw, shown } = this.poses;
    const ground = activeGround();
    for (let carIndex = 0; carIndex < cars.length; carIndex++) {
      const car = cars[carIndex]!;
      const carX = car.group.position.x;
      const carZ = car.group.position.z;
      const loose = hasLooseBody(car);
      for (let resident = 0; resident < state.capacity; resident++) {
        if (shown[resident] === 0 || ints[resident * RESIDENT_INT_STRIDE + RESIDENT_INT.species] !== SPECIES.person) continue;
        const near = hypot2(carX - x[resident]!, carZ - z[resident]!) <= CAR_REACH;
        if (!near && !loose) continue;
        const spotY = ground.heightAt(x[resident]!, z[resident]!);
        if (near && runsDown(car, x[resident]!, z[resident]!, spotY)) this.knockDown(resident, seconds, fell(car, carIndex, resident, x[resident]!, spotY, z[resident]!, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (loose && looseRunsDown(car, x[resident]!, z[resident]!, spotY)) this.knockDown(resident, seconds, stood(carIndex, resident, x[resident]!, spotY, z[resident]!, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
      }
    }
  }

  private knockDown(resident: number, seconds: number, strike: FigureStrike): void {
    this.poses.shown[resident] = 0;
    this.struck.push(strike);
    this.appendLog(EVENT_KIND.knock, resident, seconds);
    this.queueForBrain(EVENT_KIND.knock, resident, seconds);
  }

  /** A knock heard from the host: the civilian is thrown by the car nearest where they were, as that car's own hit would have thrown them. */
  private throwHeardKnocks(cars: readonly DeformableCar[]): void {
    const state = this.remote.state;
    for (let knock = 0; knock < this.heardKnocks; knock++) {
      const resident = this.heardKnockResident[knock]!;
      if (!legPose(state, resident, this.heardKnockSeconds[knock]!, this.pose)) continue;
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
    this.heardKnocks = 0;
  }

  /** The place whose footprint (grown by `WRECK_MARGIN`) holds the contact most deeply, among those inside the walls; `NO_PLACE_HIT` for none. */
  private buildingAt(x: number, z: number): number {
    const { places } = this.map;
    let best = NO_PLACE_HIT;
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
