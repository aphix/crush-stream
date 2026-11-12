import { detAtan2, detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import { blankStrike, fell, felled, looseRunsDown, runsDown, stood, type FigureStrike } from "../../scenes/figure-strike.ts";
import { LOOSE_BODIES } from "../../vehicle/part-state.ts";
import type { DeformableCar } from "../../vehicle/car.ts";
import { CAR_REACH } from "../../scenes/lawn-guard.ts";
import { activeGround } from "../../world/ground.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { tickAt } from "./civilian-clock.ts";
import { ACTIVITY, ACTIVITY_OPEN_ENDED, ACTIVITY_SECONDS } from "./civilian-activity.ts";
import type { DoorSpot } from "./civilian-car-door.ts";
import { DECISION_HZ, EVENT_KIND, EVENT_TRIPLE, NEVER_TICK, NO_PLACE, PLAN_LEAD_TICKS, RESIDENT_FLOAT, RESIDENT_FLOAT_STRIDE, RESIDENT_INT, RESIDENT_INT_STRIDE, SPECIES } from "./civilian-constants.ts";
import { carGap, comingAt, punchGap } from "./civilian-contact.ts";
import {
  BUMP_CLOSING_SPEED,
  BUMP_COOLDOWN_SECONDS,
  AMBULANCE_DELAY_SECONDS,
  AMBULANCE_RETRIES,
  AMBULANCE_RETRY_SECONDS,
  BUMP_DISTANCE,
  CAR_NUDGE_GAP,
  CAR_NUDGE_SPEED,
  CLOCK_OFFSET_CREEP,
  CRASH_LOCKOUT_SECONDS,
  CRASH_NODE_REACH,
  DANGER_CONFIRM_SECONDS,
  DANGER_LOCKOUT_SECONDS,
  DANGER_MIN_SPEED,
  DANGER_SHARED_SECONDS,
  EVENT_LOG_CAPACITY,
  HARD_CLOSING_SPEED,
  HARD_DISTANCE,
  HEARD_KNOCK_LATE_SECONDS,
  HEARD_KNOCK_QUEUE,
  PUSH_LOCKOUT_SECONDS,
  STRIDE_RADIANS_PER_METRE,
  WALKER_BEARING_STEPS,
  WALKER_CAPACITY,
  WALKER_PUSH_CLOSING_SPEED,
  WALKER_PUSH_DISTANCE,
  WRECK_LOCKOUT_SECONDS,
  WRECK_MARGIN,
  WRECK_SPEED,
} from "./civilian-crowd-constants.ts";
import { LegPose, legPose, legPositionAt } from "./civilian-leg.ts";
import { lookOf } from "./civilian-look-word.ts";
import type { CivilianRemote } from "./civilian-remote.ts";
import { CrowdSeparation } from "./civilian-separation.ts";
import type { CityState } from "./civilian-state.ts";
import { type ActivityReading, CivilianBlow, findCivilianBlow, knockoutBlow, readActivity } from "./society-activity.ts";
import { ambulanceCaller } from "./society-alarm.ts";
import { CrimeDesk } from "./society-crime.ts";
import { CrowdWalkers } from "./crowd-walkers.ts";
import { createCrowdPoses, type CrowdPoses } from "./crowd-poses.ts";
import type { Stoops } from "../../world/openworld/openworld-stoops.ts";

/** Where the driver's door of resident `resident`'s car stands (the spot and facing of a person at it, her feet's height there and her seat top's), filled for activity `code` (`ACTIVITY.carIn` or `carOut`); false when she has no car to be at. */
export type DriverDoors = (resident: number, code: number, out: DoorSpot) => boolean;


/** Changes the crowd's poses after its own placing: the poses, the crowd time, whether this crowd is the host's. */
type CrowdOverlay = (poses: CrowdPoses, crowdSeconds: number, authority: boolean) => void;

/** `CAR_REACH` squared: a civilian within it of a car is tested for a hit (compared squared, no root per car per civilian per frame). */
const CAR_REACH_SQUARED = CAR_REACH * CAR_REACH;
const NO_EVENTS: readonly number[] = [];
const NO_STRIKES: readonly FigureStrike[] = [];
/** The pusher of a push that was no civilian: a player's walker or a car. */
const NOT_A_CIVILIAN = -1;

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
  private readonly door: DoorSpot = { x: 0, z: 0, yaw: 0, feetY: 0, surfaceY: 0 };
  /** Called on the host when someone run down has stayed down long enough to call an ambulance for: where they lie, when it was called and who they are. */
  onAmbulanceCall: ((x: number, z: number, seconds: number, victim: number) => void) | null = null;
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
  private struckSpare: FigureStrike[] = [];
  private readonly wreckedAt: Float64Array;
  private readonly heardKnockResident = new Int32Array(HEARD_KNOCK_QUEUE);
  private readonly heardKnockSeconds = new Float64Array(HEARD_KNOCK_QUEUE);
  private heardKnocks = 0;
  private readonly heardKnockBy = new Int32Array(HEARD_KNOCK_QUEUE).fill(-1);
  private readonly bumpSince: Float64Array;
  private readonly hitSince: Float64Array;
  private readonly bumpPartner: Int32Array;
  private readonly pushedAt: Float64Array;
  /** Per resident: when a car was first seen coming at them (-Infinity: none), when they may next be in danger, and when an ambulance is due for them and where they lie (Infinity: none). */
  private readonly dangerSince: Float64Array;
  private readonly dangerCar: Int16Array;
  private readonly dangerUntil: Float64Array;
  private readonly ambulanceDue: Float64Array;
  /** Times each one down has been looked for a caller for. */
  private readonly ambulanceTries: Uint8Array;
  /** 1 for a resident walking a leg that is not a door's spur: the ones `Stoops.keepOut` moves. */
  private readonly laneWalking: Uint8Array;
  private readonly ambulanceX: Float32Array;
  private readonly ambulanceZ: Float32Array;
  private lastCrashSeconds = -Infinity;
  private lastDangerSeconds = -Infinity;
  private readonly reading: ActivityReading = { code: ACTIVITY.none, sinceSeconds: 0, leftSeconds: ACTIVITY_OPEN_ENDED, partner: NOT_A_CIVILIAN, surfaceY: 0, placed: false, fixed: false, x: 0, z: 0, yaw: 0 };
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
    this.bumpSince = new Float64Array(capacity).fill(-Infinity);
    this.hitSince = new Float64Array(capacity).fill(-Infinity);
    this.bumpPartner = new Int32Array(capacity).fill(-1);
    this.pushedAt = new Float64Array(capacity).fill(-Infinity);
    this.dangerSince = new Float64Array(capacity).fill(-Infinity);
    this.dangerCar = new Int16Array(capacity);
    this.dangerUntil = new Float64Array(capacity).fill(-Infinity);
    this.ambulanceDue = new Float64Array(capacity).fill(Infinity);
    this.ambulanceTries = new Uint8Array(capacity);
    this.laneWalking = new Uint8Array(capacity);
    this.ambulanceX = new Float32Array(capacity);
    this.ambulanceZ = new Float32Array(capacity);
    this.crimeDesk = new CrimeDesk(capacity);
    this.crimesDue = new Int32Array(capacity);
    this.blows = new Uint8Array(capacity);
    this.blowsFight = new Int32Array(capacity).fill(NEVER_TICK);
    this.knockoutAt = new Uint8Array(capacity);
    this.blowsLanded = new Float64Array(capacity).fill(-Infinity);
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
    this.blowsFrom = this.seconds;
    this.authority = authority;
    this.advanceBrain(tickAt(crowdSeconds));
    this.seconds = crowdSeconds;
    this.fillPoses(crowdSeconds);
    this.separate(crowdSeconds);
    if (this.overlay !== null) {
      this.overlay(this.poses, crowdSeconds, authority);
      this.keepOverlaidOut();
    }
    this.liftWalkers();
    if (authority) {
      this.findPunches();
      this.findHits(cars, crowdSeconds);
      this.raiseDangers(crowdSeconds, cars);
      this.raiseAmbulanceCalls(crowdSeconds);
      this.postBatch();
    } else this.throwHeardKnocks(cars);
  }

  /** The residents the overlay moved off the spot `separate` drew (the law's suspects, running or led) are kept out of the stoops like the lane's walkers: the rest still stand where `separate` left them and are not touched. */
  private keepOverlaidOut(): void {
    const stoops = this.stoops;
    if (stoops === null) return;
    const { x, z, shown } = this.poses;
    const { drawX, drawZ } = this.separation;
    for (let resident = 0; resident < this.separation.capacity; resident++) {
      if (shown[resident] === 0 || (x[resident] === drawX[resident] && z[resident] === drawZ[resident])) continue;
      stoops.keepOut(x, z, resident);
    }
  }

  /** A solid met by a car closing at `closing` m/s at (x, z): hard enough on a building's footprint, it is a wreck event (the host only). */
  noteWallHit(closing: number, x: number, z: number): void {
    if (!this.authority || closing < WRECK_SPEED) return;
    const place = this.buildingAt(x, z);
    if (place === NO_PLACE) {
      this.noteCrash(x, z);
      return;
    }
    if (this.seconds - this.wreckedAt[place]! < WRECK_LOCKOUT_SECONDS) return;
    this.wreckedAt[place] = this.seconds;
    this.appendLog(EVENT_KIND.wreck, place, this.seconds);
    this.queueForBrain(EVENT_KIND.wreck, place, this.seconds);
    this.postBatch();
  }

  /** A hard hit of a car on something that is no building's, near enough a street, is a crash for those who see it: one in `CRASH_LOCKOUT_SECONDS`. */
  private noteCrash(x: number, z: number): void {
    if (this.seconds - this.lastCrashSeconds < CRASH_LOCKOUT_SECONDS) return;
    const node = this.nearestNode(x, z);
    if (node === NO_PLACE) return;
    const { nodeX, nodeZ } = this.map.graph;
    if (hypot2(nodeX[node]! - x, nodeZ[node]! - z) > CRASH_NODE_REACH) return;
    this.lastCrashSeconds = this.seconds;
    this.logHostEvent(EVENT_KIND.danger, node, this.seconds);
    this.postBatch();
  }

  /** The walk-graph node nearest (x, z); `NO_PLACE` when the graph has none. */
  private nearestNode(x: number, z: number): number {
    const { nodeX, nodeZ } = this.map.graph;
    let best = NO_PLACE;
    let bestDistance = Infinity;
    for (let node = 0; node < nodeX.length; node++) {
      const distance = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = node;
    }
    return best;
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
        // A knock that names its striker is followed by her push and an `alongside` triple at the same second.
        const pushed = at + EVENT_TRIPLE;
        const alongside = pushed + EVENT_TRIPLE;
        const named = alongside + EVENT_TRIPLE <= events.length && events[pushed] === EVENT_KIND.push && events[pushed + 1] === subject && events[pushed + 2] === seconds && events[alongside] === EVENT_KIND.alongside && events[alongside + 2] === seconds;
        this.heardKnockBy[this.heardKnocks] = named ? events[alongside + 1]! : -1;
        this.heardKnockResident[this.heardKnocks] = subject;
        this.heardKnockSeconds[this.heardKnocks++] = seconds;
      }
    }
    if (this.started) this.postBatch();
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
      this.postBatch();
    }
    this.seconds = crowdSeconds;
    return true;
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
    const { yaw, stride, speed, look, shown, activity, activityClock, activityLeft, partner, surfaceY, feetY } = this.poses;
    const { present, fixed, brainX, brainZ, velocityX, velocityZ } = this.separation;
    const pose = this.pose;
    const reading = this.reading;
    const door = this.door;
    for (let resident = 0; resident < state.capacity; resident++) {
      const intBase = resident * RESIDENT_INT_STRIDE;
      shown[resident] = 0;
      present[resident] = 0;
      this.poses.onSpur[resident] = 0;
      this.laneWalking[resident] = 0;
      if (ints[intBase + RESIDENT_INT.species] !== SPECIES.person) continue;
      this.activityReader(state, resident, seconds, reading);
      const walkSpeed = floats[resident * RESIDENT_FLOAT_STRIDE + RESIDENT_FLOAT.speed]!;
      const atCar = reading.code === ACTIVITY.carIn || reading.code === ACTIVITY.carOut;
      if (atCar) {
        if (this.driverDoors === null || !this.driverDoors(resident, reading.code, door)) continue;
        brainX[resident] = door.x;
        brainZ[resident] = door.z;
        velocityX[resident] = 0;
        velocityZ[resident] = 0;
        yaw[resident] = door.yaw;
        speed[resident] = 0;
        stride[resident] = 0;
        feetY[resident] = door.feetY;
        surfaceY[resident] = door.surfaceY;
      } else if (reading.placed) {
        brainX[resident] = reading.x;
        brainZ[resident] = reading.z;
        velocityX[resident] = 0;
        velocityZ[resident] = 0;
        yaw[resident] = reading.yaw;
        speed[resident] = 0;
        stride[resident] = 0;
      } else {
        const onLeg = ints[intBase + RESIDENT_INT.pathCount]! > 0 && seconds >= ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ && seconds < ints[intBase + RESIDENT_INT.arriveTick]! / DECISION_HZ;
        if (!onLeg || !legPositionAt(state, resident, seconds, pose)) continue;
        this.poses.onSpur[resident] = this.stoops !== null && this.stoops.leadsToDoor(pose.from, pose.to) ? 1 : 0;
        this.laneWalking[resident] = this.poses.onSpur[resident] === 1 ? 0 : 1;
        brainX[resident] = pose.x;
        brainZ[resident] = pose.z;
        velocityX[resident] = pose.dirX * pose.speed;
        velocityZ[resident] = pose.dirZ * pose.speed;
        yaw[resident] = pose.yaw;
        speed[resident] = Math.abs(pose.speed);
        stride[resident] = walkSpeed * (seconds - ints[intBase + RESIDENT_INT.departTick]! / DECISION_HZ) * STRIDE_RADIANS_PER_METRE;
      }
      shown[resident] = 1;
      present[resident] = 1;
      fixed[resident] = reading.fixed || atCar ? 1 : 0;
      look[resident] = lookOf(state.seed, ints, intBase);
      activity[resident] = reading.code;
      activityClock[resident] = reading.sinceSeconds;
      activityLeft[resident] = reading.leftSeconds;
      partner[resident] = reading.partner;
      if (!atCar) {
        feetY[resident] = 0;
        surfaceY[resident] = reading.surfaceY;
      }
    }
  }

  /** Every civilian who walks a stoop's door spur stands at the step under her: she leaves her door at the sill's height, goes down to the street, and the reverse coming home. */
  private liftWalkers(): void {
    const stoops = this.stoops;
    if (stoops === null) return;
    const { x, z, feetY, shown } = this.poses;
    const { onSpur } = this.poses;
    for (let resident = 0; resident < this.separation.capacity; resident++) if (shown[resident] === 1 && onSpur[resident] === 1) stoops.liftFeet(x, z, feetY, resident);
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
      if (this.laneWalking[resident] === 1 && this.stoops !== null) this.stoops.keepOut(x, z, resident);
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
      if (separation.fixed[first] === 1 || (!byWalker && separation.fixed[second] === 1)) continue;
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
    this.logHostEvent(EVENT_KIND.push, victim, seconds);
    this.logHostEvent(party, Math.round(turns * WALKER_BEARING_STEPS) & (WALKER_BEARING_STEPS - 1), seconds);
  }

  /** The victim's triple, then the pusher's `alongside` triple when the pusher is a civilian (a car, or a knock, has none): the wire's subject is 16 bits. */
  private logPush(victim: number, pusher: number, seconds: number): void {
    this.logPair(EVENT_KIND.push, victim, pusher, seconds);
  }

  private logPair(kind: number, first: number, second: number, seconds: number): void {
    this.logHostEvent(kind, first, seconds);
    if (second !== NOT_A_CIVILIAN) this.logHostEvent(EVENT_KIND.alongside, second, seconds);
  }

  /** The shown civilian nearest a punch thrown at (x, z) along (dirX, dirZ), within its reach and arc, whom no body stands for (`held`); -1 for none, or without authority. */
  punchTarget(x: number, z: number, dirX: number, dirZ: number, held: Uint8Array | null): number {
    if (!this.authority) return -1;
    const { x: px, z: pz, shown } = this.poses;
    let nearest = -1;
    let nearestGap = Infinity;
    for (let resident = 0; resident < this.separation.capacity; resident++) {
      if (shown[resident] === 0 || (held !== null && held[resident] === 1)) continue;
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
    this.postBatch();
  }

  /** The player's blow fells `resident` (a knock-out): hidden, thrown along (dirX, dirZ), the knock in the log. */
  knockOut(resident: number, seconds: number, dirX: number, dirZ: number): void {
    if (!this.authority || this.poses.shown[resident] === 0) return;
    const x = this.poses.x[resident]!;
    const z = this.poses.z[resident]!;
    this.knockDown(resident, seconds, felled(resident, x, activeGround().heightAt(x, z), z, dirX, dirZ, blankStrike()));
    // A punch lands between steps: posted now, the brain hides her before the next step's poses (as `noteWallHit` posts), not a frame after.
    this.postBatch();
  }

  /** Host: a bullet takes drawn resident `resident`: she is knocked down along it at `speed` m/s, as a car's knock. */
  shoot(resident: number, seconds: number, dirX: number, dirZ: number, speed: number): void {
    if (!this.authority || this.poses.shown[resident] === 0) return;
    const x = this.poses.x[resident]!;
    const z = this.poses.z[resident]!;
    const strike = felled(resident, x, activeGround().heightAt(x, z), z, dirX, dirZ, blankStrike());
    strike.vx = Math.fround(dirX * speed);
    strike.vz = Math.fround(dirZ * speed);
    this.knockDown(resident, seconds, strike);
    // A shot lands between steps: posted now, as `knockOut` posts.
    this.postBatch();
  }

  private logHostEvent(kind: number, subject: number, seconds: number): void {
    this.appendLog(kind, subject, seconds);
    this.queueForBrain(kind, subject, seconds);
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
        if (coming) this.watchApproach(resident, carIndex, spotX - carX, spotZ - carZ, car.velocity.x, car.velocity.z, carSpeed, seconds);
        const apartX = carX - spotX;
        const apartZ = carZ - spotZ;
        const near = apartX * apartX + apartZ * apartZ <= CAR_REACH_SQUARED;
        if (!near && !loose) continue;
        const spotY = ground.heightAt(spotX, spotZ);
        if (near && runsDown(car, spotX, spotZ, spotY)) this.knockDown(resident, seconds, fell(car, carIndex, resident, spotX, spotY, spotZ, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (loose && looseRunsDown(car, spotX, spotZ, spotY)) this.knockDown(resident, seconds, stood(carIndex, resident, spotX, spotY, spotZ, detSin(yaw[resident]!), detCos(yaw[resident]!), blankStrike()));
        else if (near && carSpeed >= CAR_NUDGE_SPEED && carGap(car, spotX, spotZ) < CAR_NUDGE_GAP) this.raiseBearingPush(resident, carX, carZ, seconds, EVENT_KIND.car);
      }
    }
  }

  /** Host: the fights' blows that landed since the last step (`blowsFrom` to `seconds`; read from fields so the step passes no boxed number). The blow that reaches its victim's knock-out count fells her as a car's knock does, with the striker named. */
  private findPunches(): void {
    const state = this.remote.state;
    const blow = this.blow;
    for (let from = 0; ; ) {
      const striker = findCivilianBlow(state, this.blowsFrom, this.seconds, from, blow);
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
      this.knockDown(victim, this.seconds, this.felledBy(victim, striker, blankStrike()), striker);
    }
  }

  /** `out` as the blow of `striker` felling `victim`: along the line from his drawn spot to hers, from the ground under her. */
  private felledBy(victim: number, striker: number, out: FigureStrike): FigureStrike {
    const { x, z } = this.poses;
    const dx = x[victim]! - x[striker]!;
    const dz = z[victim]! - z[striker]!;
    const far = hypot2(dx, dz);
    return felled(victim, x[victim]!, activeGround().heightAt(x[victim]!, z[victim]!), z[victim]!, far > 0 ? dx / far : 0, far > 0 ? dz / far : 1, out);
  }

  /** Car `carIndex` (velocity (vx, vz), `carSpeed`) coming at the civilian (toX, toZ from it) is noted for `raiseDangers` (`comingAt`: a car driving down the street is not). */
  private watchApproach(resident: number, carIndex: number, toX: number, toZ: number, vx: number, vz: number, carSpeed: number, seconds: number): void {
    if (!comingAt(toX, toZ, vx, vz, carSpeed)) return;
    if (this.dangerSince[resident] !== -Infinity || seconds < this.dangerUntil[resident]!) return;
    this.dangerSince[resident] = seconds;
    this.dangerCar[resident] = carIndex;
  }

  /** Those a car came at who, `DANGER_CONFIRM_SECONDS` on, are still on their feet with it still coming at them (it did not brake or swerve) are in danger, seen by whoever is about; those it ran down are not (their knock is the news). */
  private raiseDangers(seconds: number, cars: readonly DeformableCar[]): void {
    const { x, z, shown } = this.poses;
    for (let resident = 0; resident < this.dangerSince.length; resident++) {
      const since = this.dangerSince[resident]!;
      if (since === -Infinity || seconds - since < DANGER_CONFIRM_SECONDS) continue;
      this.dangerSince[resident] = -Infinity;
      const car = cars[this.dangerCar[resident]!];
      if (car === undefined || shown[resident] === 0 || seconds - this.lastDangerSeconds < DANGER_SHARED_SECONDS) continue;
      const vx = car.velocity.x;
      const vz = car.velocity.z;
      if (!comingAt(x[resident]! - car.group.position.x, z[resident]! - car.group.position.z, vx, vz, hypot2(vx, vz))) continue;
      const node = this.nearestNode(x[resident]!, z[resident]!);
      if (node === NO_PLACE) continue;
      this.dangerUntil[resident] = seconds + DANGER_LOCKOUT_SECONDS;
      this.lastDangerSeconds = seconds;
      this.logHostEvent(EVENT_KIND.danger, node, seconds);
    }
  }

  /** Someone run down `AMBULANCE_DELAY_SECONDS` ago is still down: the call is made (it is in the log for every peer) and whoever sends the ambulance hears of it. */
  private raiseAmbulanceCalls(seconds: number): void {
    for (let resident = 0; resident < this.ambulanceDue.length; resident++) {
      let due = this.ambulanceDue[resident]!;
      while (due <= seconds) {
        if (ambulanceCaller(this.remote.state, resident, tickAt(due)) !== NO_PLACE) {
          this.logHostEvent(EVENT_KIND.ambulance, resident, due);
          this.onAmbulanceCall?.(this.ambulanceX[resident]!, this.ambulanceZ[resident]!, due, resident);
          due = Infinity;
        } else if (this.ambulanceTries[resident]!++ < AMBULANCE_RETRIES) due += AMBULANCE_RETRY_SECONDS;
        else due = Infinity;
      }
      this.ambulanceDue[resident] = due;
    }
  }

  private knockDown(resident: number, seconds: number, strike: FigureStrike, by = NOT_A_CIVILIAN): void {
    this.ambulanceDue[resident] = seconds + AMBULANCE_DELAY_SECONDS;
    this.ambulanceTries[resident] = 0;
    this.ambulanceX[resident] = this.poses.x[resident]!;
    this.ambulanceZ[resident] = this.poses.z[resident]!;
    this.poses.shown[resident] = 0;
    this.struck.push(strike);
    this.appendLog(EVENT_KIND.knock, resident, seconds);
    this.queueForBrain(EVENT_KIND.knock, resident, seconds);
    this.logPush(resident, by, seconds);
  }

  /** A knock heard from the host, once this clock reaches its time (the cars are drawn at that time): the civilian is thrown by the car nearest where they were, as that car's own hit would have thrown them. */
  private throwHeardKnocks(cars: readonly DeformableCar[]): void {
    const state = this.remote.state;
    let waiting = 0;
    for (let knock = 0; knock < this.heardKnocks; knock++) {
      const resident = this.heardKnockResident[knock]!;
      const at = this.heardKnockSeconds[knock]!;
      if (at > this.seconds) {
        this.heardKnockBy[waiting] = this.heardKnockBy[knock]!;
        this.heardKnockResident[waiting] = resident;
        this.heardKnockSeconds[waiting++] = at;
        continue;
      }
      if (this.seconds - at > HEARD_KNOCK_LATE_SECONDS) continue;
      const by = this.heardKnockBy[knock]!;
      if (by >= 0) {
        this.struck.push(this.felledBy(resident, by, blankStrike()));
        continue;
      }
      if (!legPose(state, resident, at, this.pose)) continue;
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
