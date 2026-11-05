import { hypot2, detSin, detCos, detAtan2 } from "../kernel/physics-core.js";
import { DRIVE, type DriveInput } from "../vehicle/car-drive.ts";
import type { AiCar } from "./derby-ai.ts";
import { clamp, popcount, wrapPi } from "../kernel/scalar.ts";
import { Obstacles } from "./obstacles.ts";
import type { PropCollider } from "../world/placements.ts";
import type { SurvivalSpec } from "../world/track-schema.ts";
import type { Track } from "../world/track.ts";
import { ATTACK, attackTarget, CATCH_UP, CopBrain, HEAD_ON, PULL_OUT, pursuitSteer, RAM_TIME, TAIL_LANE, WAIT_BEHIND, type HunterWorld } from "./cop-brain.ts";
import { BRAKE_RISE } from "./pedals.ts";
import { arcSpeed, brakeOver } from "./race-ai.ts";

/** Survival's pack (docs/SURVIVAL.md): how many cops, how fast more come, where a cop that is lost or wrecked is put back. */
export const HUNT = {
  /** Seconds between one more cop wanted. */
  every: 12,
  /** Most cops hunting at once. */
  cap: 12,
  /** Cars built for the pack: the cap, and a few wrecks that lie until nobody can see them go. */
  units: 16,
  /** A wrecked cop lies this long (s) before it may be put away, once nobody can see it go. */
  wreckStore: 6,
  /** A cop farther than `far` m from the player and out of sight for `farTime` s is put away, and dropped in again. */
  far: 140,
  farTime: 5,
  /** Seconds between two drop-ins. */
  gap: 1.5,
  /** A cop drops in this far (m) from the player: at least, at most. */
  dropMin: 70,
  dropMax: 120,
  /**
   * Seconds a placed cop waits to show, the player driving on: the beat runs inside a physics step, the cop shows when the frame that step is
   * in ends, and a frame runs at most 8 steps (`SimPacer`'s MAX_STEPS) of at most `physicsSlice` at the engine's slowest slice speed (8 m/s): 8 × 0.07 / 8 s.
   * A spot keeps `dropMin` from the player's whole path over it.
   */
  lag: 0.07,
  /** Metres between the candidate drop-in spots along the roads, and the room a spot keeps from every car. */
  spacing: 6,
  clear: 12,
  /** Most `hidden` tests a drop-in beat spends (each may sight-line the camera against the course's solids). */
  tests: 16,
  /**
   * Cops (the formation, the cap and the units built) added per human beyond the first, as a share of one human's pack: a hosted run
   * with several humans hunts them in proportion (`packScale`). Measured (docs/SURVIVAL.md, Co-op): 1 holds two humans' median fall at the lone
   * player's (16.0 s against 17.2 s), 0.5 does not (19.7 s), and more than 1 adds nothing (drop-ins are one per `gap`).
   */
  perHuman: 1,
  /**
   * Seconds after the green the formation's units that do not seek a hit fly the opening at full aggression, whatever a(t) is: the launch up the boulevard to the
   * crest (it reaches the crest at about 11.5 s), cops tight behind the player and airborne over the crest, the set piece. The units that seek a hit (the nearest) go in at a(t).
   */
  opening: 13,
} as const;

/**
 * Survival's aggression a(t), from the green: `floor` until `hold` s, then a cubic ease-in to 1 over `full` s. 1 is the whole pack's meanness
 * (the pack as it was before the ramp); every choice that makes the pack mean is gated or scaled by it, no physics is.
 */
export const RAMP = {
  floor: 0.25,
  hold: 30,
  full: 60,
} as const;

/** The aggression `time` s after the green (the countdown, time under 0, is the floor). */
export function aggression(time: number): number {
  const u = clamp((time - RAMP.hold) / RAMP.full, 0, 1);
  return RAMP.floor + (1 - RAMP.floor) * u * u * u;
}

/** A quantity that is `atFloor` at the floor of a and `atFull` at 1, linear between. */
function ramped(a: number, atFloor: number, atFull: number): number {
  return atFloor + ((atFull - atFloor) * (a - RAMP.floor)) / (1 - RAMP.floor);
}

/**
 * The pack a run grows for `humans` free humans: `perHuman` more of everything (the cops wanted, the cap, the units built) for each human
 * beyond the first, so a team of any size is pressed per head as one human is.
 */
function packScale(humans: number): number {
  return 1 + HUNT.perHuman * Math.max(0, humans - 1);
}

/** Units built for a run that starts with `humans` humans, in a car list with `room` cars free for them: a pack never needs more cars than the room has. */
export function huntUnits(humans: number, room: number): number {
  return Math.min(room, Math.ceil(HUNT.units * packScale(humans)));
}

/** The most cops hunting at once with `humans` free humans and `units` units built: the cap scaled, the wrecks' share of the units kept. */
export function huntCap(humans: number, units: number): number {
  return Math.min(units - (HUNT.units - HUNT.cap), Math.ceil(HUNT.cap * packScale(humans)));
}

/**
 * The cops the run wants `time` s after the green for `humans` free humans (`units` built), from the `formation` at the start: one more every
 * `HUNT.every` s at full aggression, up to the cap. Before that the extra cops are a(t) of that schedule, so the ramp adds them.
 */
export function copsWanted(time: number, formation: number, humans = 1, units: number = HUNT.units): number {
  const extra = Math.floor(aggression(time) * Math.floor(Math.max(0, time) / HUNT.every));
  return Math.min(huntCap(humans, units), Math.ceil((formation + extra) * packScale(humans)));
}

const STORED = 0;
const HUNTING = 1;
const DOWN = 2;

/** The headings (rad) a unit tries off the straight one, in turn, to either side. */
const TURNS = [0.3, 0.6, 0.9, 1.25, 1.6, 2.2, Math.PI] as const;
/** A player car slower than this (m/s) is not blocked from ahead (a unit braking in front of a stopped player waits for ever); it is rammed. */
export const BLOCKABLE = 6;
/** A unit this close (m) to a player car that has stopped eases to a creep (m/s): the bust needs the player car slow, and a ram makes it fast. */
export const SETTLE = 12;
const CREEP = 3;
/** A player is boxed in when units (wrecks too) and solids stand within `SETTLE` m on at least `BOX_HEADINGS` of the 8 compass headings round it, units on at least `BOX_UNITS` of them. */
const BOX_HEADINGS = 5;
const BOX_UNITS = 2;
/** A boxed-in player over this speed (m/s: the bust's 20 km/h) is squirming: its bust hold breaks. A player sitting still or creeping under it is left to the bust. */
const SQUIRM = 20 / 3.6;
/** A player that has squirmed this long (s) in all, boxed in, is rammed (not busted: the pack's hold has failed). */
export const RAM_AFTER = 6;
/** Over this speed (m/s) the player is driving off, not creeping: the wait for a ram starts over. */
const ESCAPED = 14;
/** Once the wait is up, a player that sits still (under `SQUIRM`) this long (s) has stopped squirming: the ram is over and the bust has its chance. The bust's hold breaks at the same 20 km/h (`BUST.kph`), so it never lands while a ram runs: it lands 12 s after the player stopped at the soonest, `CALM_END` of them in the ram and the rest beside the pack back on PIT, slam and queue. */
export const CALM_END = 3;
/** A ramming unit charges from this far (m), the run a car needs to reach 28 m/s and over. A boxed human shows it its tail, where such a hit moves the engine only 2-7 % of what kills it: a tail ram does not kill the engine; it throws the driver out (the run ends, wrecked) or knocks the car about until the player sits still for `CALM_END` (docs/SURVIVAL.md). It has hit once it is under `RAM_HIT` m, and backs off for the next run. */
export const RUN_UP = 60;
const RAM_HIT = 10;
/** A unit lines up for the charge on the box's free line within this many metres of it, facing the target within this cosine; and has this speed (m/s) left to turn round at the run-up point. */
const RUN_UP_LINE = 3;
const RUN_UP_FACING = 0.94;
const RUN_UP_TURN = 10;
/** At the floor of a a ramming unit has hit only once it touches (a car's length), not at the full ram's `RAM_HIT`: a shove from a short run-up has no momentum to carry it through a turn away. */
const RAM_HIT_FLOOR = 5.5;
/** The units that seek a hit are the nearest ceil(a × n) of the n after one human; a unit picked stays picked this long (s), so units trading places do not flicker. */
const SEEK_HOLD = 3;
/** A seeker attacks from this share of its reach at the floor of a (1 at full). */
const REACH_FLOOR = 0.5;
/** From this a the pack opens its lethal choices: the head-on ram, the brake-check block ahead and the slam roles (units line up for the rear-quarter PIT only under it); the alongside turn-in of `attackTarget` stays, held to the closing cap. */
const LETHAL_FROM = 0.5;
/** The closing speed (m/s) a unit allows itself into a hit, reached `HIT_ZONE` m out: at the floor of a under the 16 m/s that throws a sedan's driver, at 1 a car's top speed (no limit). */
const CLOSE_FLOOR = 9;
const CLOSE_FULL = 60;
const HIT_ZONE = 6;
/** The squirm ram's run-up (m) at the floor of a: a hit from it is a shove, where the full run makes the kill. */
const RUN_UP_FLOOR = 15;
/**
 * A unit that does not seek holds `SHADOW_GAP` m behind a moving human, `SHADOW_ROW` m more for each unit queued nearer in its lane (at most `SHADOW_ROWS`), closing on that slot at
 * `SHADOW_PACE` m/s per metre of slack and at most `SHADOW_CATCH` m/s over the human's pace, and braking at `SHADOW_BRAKE` when over it.
 */
const SHADOW_GAP = 12;
const SHADOW_ROW = 7;
const SHADOW_ROWS = 3;
const SHADOW_PACE = 0.5;
const SHADOW_CATCH = 8;
const SHADOW_BRAKE = 0.5;
/** The target speed (m/s) above which the police queue behind a target (their PIT cap). */
const BUMP_ABOVE = 20;
/** Above this speed (m/s) a unit lifts when a solid is close ahead; below it, easing off only wedges it. */
const DODGE_SPEED = 8;
/** With no heading clear for the whole stretch, a bend of one radian is worth this many metres of clear run. */
const TURN_COST = 6;
/** Metres of road behind a target that a queue lane must keep clear of solids. */
const QUEUE = 30;

/**
 * Survival's cops (Driver 2's mode, docs/SURVIVAL.md): cars `first … first + count − 1` hunt the player over open ground, up
 * the embankment and across the plaza, not along a road: the aim is the player (led by its velocity), the heading is bent to the
 * most open of a few headings when a solid prop stands in the way, and within `ATTACK` m the unit attacks with the police's own
 * geometry (`attackTarget`: PIT, slam, block, head-on ram), steers by their one rule (`pursuitSteer`) and backs off when wedged
 * (`Backoff`). Far behind it boosts to catch up (police have no meter), so a full-throttle player cannot simply outrun the pack.
 *
 * The pack grows (`copsWanted`): the formation at the green, one more every `HUNT.every` s up to `HUNT.cap`. A cop wrecked (`down`)
 * or lost (far and unseen) is put away and a new one dropped in on a road, `HUNT.dropMin`…`dropMax` m from the player, ahead of it
 * first, only where `world.hidden` says the camera cannot see it. Deterministic (seeded dice, no clock); no allocation per call.
 */
export class HunterBrain extends CopBrain {
  /** This run: cops dropped in after the start, put away for being lost, knocked out, and the most hunting at once. */
  readonly stats = { drops: 0, despawns: 0, disabled: 0, peak: 0 };
  private readonly racers: number;
  private readonly formation: SurvivalSpec["formation"];
  private readonly obstacles: Obstacles;
  /** Driving, so a slow one may be pulling out (not waiting in storage), unless it is creeping on purpose (`settled`): that one is read at its real speed. */
  protected readonly pullsOut = (u: number): boolean => this.state[u] !== STORED && this.settled[u] === 0;
  /** The pack guard reads a slow mate as pulling out only while it hunts: a knocked-out unit is the stopped obstacle it is (read as one pulling out at 8 m/s, cops never braked for a wreck and drove into it). */
  protected override readonly pulling = (u: number): boolean => this.state[u] === HUNTING && this.settled[u] === 0;
  /** The human a unit that is ramming charges at (−1: not ramming) and where it stands: its box (the units within `SETTLE` m of it, wrecks too) is not read by the guard, which would brake the charge for the cars that make the box. */
  private rammingAt = -1;
  private boxX = 0;
  private boxZ = 0;
  protected override readonly ignores = (mate: AiCar): boolean => this.rammingAt >= 0 && hypot2(mate.x - this.boxX, mate.z - this.boxZ) < SETTLE;
  /** Per unit: creeping beside a stopped player car on purpose, so its slow pace is not read as pulling out. */
  private readonly settled: Uint8Array;
  private readonly state: Uint8Array;
  private readonly lost: Float64Array;
  /** Per unit: the side (+1 / −1) it last bent round a solid, so it keeps to it. */
  private readonly side: Int8Array;
  /** Candidate drop-in spots along every road: position and the road's direction. */
  private readonly spotX: number[] = [];
  private readonly spotZ: number[] = [];
  private readonly spotTx: number[] = [];
  private readonly spotTz: number[] = [];
  /** The free-human flags of the last patrol (`update`), by car id; null before the first. */
  private hunted: Uint8Array | null = null;
  /** Per unit: the car id of the human it is after (the nearest free one; −1 none). */
  private readonly aim: Int16Array;
  /** Per racer: seconds it has squirmed boxed in (`RAM_AFTER`). Before the wait is up it starts over when the racer is out of the box; once it is up, only a drive-off, the hunt ending, or `CALM_END` s of sitting still clears it (the units that back off for their run-up are the ones that boxed it in). */
  private readonly pinned: Float64Array;
  /** Per racer: seconds it has sat still since the wait was up (`CALM_END`). */
  private readonly calm: Float64Array;
  /** Per unit: charging its target from the run-up (1), or backing off to the run-up (0). */
  private readonly charging: Uint8Array;
  /** Per unit: it seeks a hit (1) or shadows (0), its pick held until this race second, and the human it was ranked against (−1 none) and its distance (m) to that human. */
  private readonly seeks: Uint8Array;
  private readonly seekUntil: Float64Array;
  private readonly rankedOn: Int16Array;
  private readonly rankedAt: Float64Array;
  /** The aggression `update` last read: a(t). */
  private mean: number = RAMP.floor;
  /** Per formation unit: it flies the opening at full aggression (`HUNT.opening`), whatever a is; the split is made once at the green (`opened`). */
  private readonly flies: Uint8Array;
  private opened = false;
  /** The distance (m) `nearestHunted` found. */
  private nearGap = Infinity;
  private go = false;
  private nextDrop = 0;
  /** Per unit: the lane it last queued in (−1 / +1; 0 none). Scratch: the queue place `slot` found, and the last drop-in spot found. */
  private readonly queued: Int8Array;
  private lane = 0;
  private row = 0;
  private readonly at = { x: 0, z: 0, yaw: 0 };

  /** `racers` cars (ids 0 …) are hunted; the units follow them from `first`. */
  constructor(track: Track, colliders: readonly PropCollider[], racers: number, first: number, count: number, seed: number) {
    super(track, first, count, seed);
    const spec = track.survival;
    if (!spec) throw new Error(`${track.id} has no survival anchors`);
    this.racers = racers;
    this.formation = spec.formation;
    this.obstacles = new Obstacles(colliders);
    this.state = new Uint8Array(count);
    this.settled = new Uint8Array(count);
    this.aim = new Int16Array(count).fill(-1);
    this.pinned = new Float64Array(racers);
    this.calm = new Float64Array(racers);
    this.charging = new Uint8Array(count);
    this.seeks = new Uint8Array(count);
    this.flies = new Uint8Array(count);
    this.seekUntil = new Float64Array(count).fill(-Infinity);
    this.rankedOn = new Int16Array(count).fill(-1);
    this.rankedAt = new Float64Array(count);
    this.lost = new Float64Array(count);
    this.queued = new Int8Array(count);
    this.side = new Int8Array(count).fill(1);
    for (const p of track.paths()) {
      for (let k = 0; k < p.count; k += HUNT.spacing) {
        if (p.deck[k]) continue;
        this.spotX.push(p.x[k]!);
        this.spotZ.push(p.z[k]!);
        this.spotTx.push(p.tx[k]!);
        this.spotTz.push(p.tz[k]!);
      }
    }
  }

  /** Cops hunting now. */
  get hunting(): number {
    let n = 0;
    for (let u = 0; u < this.count; u++) if (this.state[u] === HUNTING) n++;
    return n;
  }

  /** The run starts: the formation takes its slots, held until the green (`update` sees time ≥ 0). */
  launch(world: HunterWorld): void {
    this.go = false;
    this.aim.fill(-1);
    this.pinned.fill(0);
    this.seeks.fill(0);
    this.flies.fill(0);
    this.opened = false;
    this.seekUntil.fill(-Infinity);
    this.mean = aggression(0);
    this.nextDrop = 0;
    for (let u = 0; u < this.count; u++) this.state[u] = STORED;
    for (const [k, f] of this.formation.entries()) {
      if (k >= this.count) continue;
      world.park(this.first + k, f.x, 0, f.z, f.yaw);
      this.deploy(k, world);
    }
  }

  /** Cops after racer `id` now: the units hunting that have it as the nearest free human. */
  copsOn(id: number): number {
    let n = 0;
    for (let u = 0; u < this.count; u++) if (this.state[u] === HUNTING && this.aim[u] === id) n++;
    return n;
  }

  /** Out driving: hunting with the pack released (`go`; the formation sits braked before the green). */
  override drives(id: number): boolean {
    return this.go && super.drives(id);
  }

  protected chasing(u: number): boolean {
    return this.state[u] === HUNTING;
  }

  protected stored(u: number): boolean {
    return this.state[u] === STORED;
  }

  protected drive(self: AiCar, cars: readonly AiCar[], dt: number): DriveInput {
    const out = this.out;
    out.throttle = 0;
    out.steer = 0;
    out.brake = 1;
    out.ebrake = false;
    out.boost = false;
    const u = self.id - this.first;
    if (u < 0 || u >= this.count) return out;
    this.settled[u] = 0;
    this.rammingAt = -1;
    // Each cop hunts the nearest human still free; the one it is after now is its `aim`.
    const target = this.nearestHunted(self.x, self.z, cars);
    this.aim[u] = target;
    if (!self.alive || self.crashed || this.state[u] !== HUNTING || !this.go || target < 0) return out;
    out.brake = 0;
    this.driven = true;
    if (this.wedge.backing(u, dt, out)) return out;
    const speed = hypot2(self.vx, self.vz);
    const tg = cars[target]!;
    const dx = tg.x - self.x;
    const dz = tg.z - self.z;
    const dist = hypot2(dx, dz);
    const tv = hypot2(tg.vx, tg.vz);
    const ramming = this.pinned[target]! >= RAM_AFTER;
    // A unit leaving a ram starts the next one from a back-off: a charge flag kept from the last would hit with no run-up.
    if (!ramming) this.charging[u] = 0;
    this.settled[u] = !ramming && tv <= BLOCKABLE && dist < SETTLE ? 1 : 0;
    const mean = this.flies[u] === 1 ? 1 : this.mean;
    const lethal = mean >= LETHAL_FROM;
    // A stopped or creeping human is contained by the whole pack (the bust), whatever a is.
    const seeking = this.seeks[u] === 1 || this.flies[u] === 1 || tv <= BLOCKABLE;
    this.rammingAt = ramming && seeking ? target : -1;
    if (ramming && seeking) {
      this.boxX = tg.x;
      this.boxZ = tg.z;
    }
    // How far the unit stands ahead of its target along the target's travel (+), and whether it faces it from there.
    const along = -(dx * detSin(tg.yaw) + dz * detCos(tg.yaw));
    const headOn = lethal && along > WAIT_BEHIND && detSin(self.yaw) * dx + detCos(self.yaw) * dz > dist * HEAD_ON;
    const reach = (along > 0 ? Math.max(ATTACK, tv * (headOn ? RAM_TIME : PULL_OUT)) : ATTACK) * ramped(mean, REACH_FLOOR, 1);
    // Behind a target too fast to PIT the police queue; a seeker that is not yet lethal drives on into its tail, boosting, and lifts for its closing cap.
    const bump = !lethal && along < 0 && tv > BUMP_ABOVE;
    if (ramming && seeking) this.ram(u, self, tg, speed, dist, out, mean);
    else if (!seeking && dist <= ATTACK) {
      this.slot(u, self, tg, dist, cars);
      this.shadow(self, tg, speed, tv, out);
      this.dodge(u, self, tg, speed, dist, out);
    } else if (dist <= reach && !bump) {
      this.slot(u, self, tg, dist, cars);
      attackTarget(self, tg, lethal ? this.role[u]! : 0, this.turnMax, speed, dist, headOn, out, tv > BLOCKABLE && lethal, this.lane, this.row, this.pedals.isBraking(self.id));
      this.dodge(u, self, tg, speed, dist, out);
    } else this.chase(u, self, tg, speed, dist, out, bump ? 0 : CATCH_UP);
    // A ram throws a stopped player car over the bust's 20 km/h and restarts its hold, so the unit brakes in time to arrive slowly.
    const closing = Math.max(0, (self.vx * dx + self.vz * dz) / Math.max(dist, 1));
    if (!ramming && tv <= BLOCKABLE && speed > CREEP && dist < SETTLE + (closing * closing) / (2 * DRIVE.brake) + closing / BRAKE_RISE) {
      out.throttle = 0;
      out.brake = 1;
      out.boost = false;
    }
    // Under full aggression a unit that drives at its target lifts in time to meet it no faster than `CLOSE_FLOOR…CLOSE_FULL` allows, a ram included; one that is moving away from it is not its brake-check.
    if (mean < 1 && closing > 0) {
      const rel = ((self.vx - tg.vx) * dx + (self.vz - tg.vz) * dz) / Math.max(dist, 1);
      const cap = ramped(mean, CLOSE_FLOOR, CLOSE_FULL);
      if (rel > cap && dist < HIT_ZONE + (rel * rel - cap * cap) / (2 * DRIVE.brake) + rel / BRAKE_RISE) {
        out.throttle = 0;
        out.brake = 1;
        out.boost = false;
      }
    }
    this.swing(u, self, tg, seeking && tv > BLOCKABLE && !ramming && dist <= reach && !bump, dt, out);
    this.wedge.watch(u, self.x, self.z, dt, out);
    return out;
  }

  /** A ram: the run-up point lies out through the box's open side (`Obstacles.way`), reached slowly enough to turn round; the charge starts within `RAM_HIT` m of the point, or on that line from there outward facing the target, and comes in straight along it. */
  private ram(u: number, self: AiCar, tg: AiCar, speed: number, dist: number, out: DriveInput, mean: number): void {
    const runUp = ramped(mean, RUN_UP_FLOOR, RUN_UP);
    const near = ramped(mean, RAM_HIT_FLOOR, RAM_HIT);
    const h = this.obstacles.way(tg.x, tg.z, detAtan2(self.x - tg.x, self.z - tg.z), runUp);
    const reach = this.obstacles.run(tg.x, tg.z, h, runUp);
    const ux = detSin(h);
    const uz = detCos(h);
    const toPoint = hypot2(tg.x + ux * reach - self.x, tg.z + uz * reach - self.z);
    const outward = (self.x - tg.x) * ux + (self.z - tg.z) * uz;
    const off = Math.abs((self.x - tg.x) * uz - (self.z - tg.z) * ux);
    const facing = (detSin(self.yaw) * (tg.x - self.x) + detCos(self.yaw) * (tg.z - self.z)) / Math.max(dist, 1);
    const lined = outward >= reach - near && off < RUN_UP_LINE && facing > RUN_UP_FACING;
    // A unit within `near` of the human has hit: it backs off first, so a short run-up (no heading clear far) never leaves the flag set at contact.
    if (dist < near) this.charging[u] = 0;
    else if (lined || toPoint < near) this.charging[u] = 1;
    const charge = this.charging[u] === 1;
    const lead = charge ? Math.min(2, dist / Math.max(8, speed)) : 0;
    const ax = charge ? tg.x + tg.vx * lead : tg.x + ux * reach;
    const az = charge ? tg.z + tg.vz * lead : tg.z + uz * reach;
    const aimDist = hypot2(ax - self.x, az - self.z);
    const alpha = wrapPi(this.openHeading(u, self, detAtan2(ax - self.x, az - self.z), speed, aimDist) - self.yaw);
    out.steer = pursuitSteer(alpha, clamp(speed * 0.8, 8, 24), speed, this.turnMax);
    out.throttle = Math.abs(alpha) > 1.3 && speed > 6 ? 0.2 : 1;
    out.boost = out.throttle > 0.5 && Math.abs(alpha) < 0.35;
    // Short of the run-up point it brakes in time to be turning round there at `RUN_UP_TURN`, at about half the pedal's figure (the tyres' share, measured on the lawn).
    if (!charge && speed > RUN_UP_TURN && toPoint - near < (speed * speed - RUN_UP_TURN * RUN_UP_TURN) / DRIVE.brake + speed / BRAKE_RISE) {
      out.throttle = 0;
      out.brake = 1;
      out.boost = false;
    }
  }

  /** A unit that does not seek, near a moving human: onto its queue lane's slot behind it, closing on it at a pace no more than `SHADOW_CATCH` over the human's. Only a target faster than `BLOCKABLE` (6 m/s) reaches it (`drive`'s `seeking`), so `tv` is never near zero. */
  private shadow(self: AiCar, tg: AiCar, speed: number, tv: number, out: DriveInput): void {
    const fx = tg.vx / tv;
    const fz = tg.vz / tv;
    const gap = SHADOW_GAP + SHADOW_ROW * Math.min(this.row, SHADOW_ROWS);
    const ax = tg.x - fx * gap + fz * this.lane * TAIL_LANE;
    const az = tg.z - fz * gap - fx * this.lane * TAIL_LANE;
    const slack = (ax - self.x) * fx + (az - self.z) * fz;
    const alpha = wrapPi(detAtan2(ax - self.x, az - self.z) - self.yaw);
    out.steer = pursuitSteer(alpha, Math.max(8, hypot2(ax - self.x, az - self.z)), speed, this.turnMax);
    const want = tv + clamp(slack * SHADOW_PACE, -tv, SHADOW_CATCH);
    if (speed > want + 1) out.brake = SHADOW_BRAKE;
    else out.throttle = 1;
  }

  /**
   * Where unit `u` queues behind a target too fast to PIT: a lane (±`TAIL_LANE` m either side of the target's line, never the line itself:
   * a car right behind a target that brakes has nowhere to go) and its row there. The unit keeps the side it is on, or a side it took
   * before while it is within a metre of the line, and takes the other while a prop stands in the way of its queue (a palm row the
   * target hugs). Its row counts the hunters queued in that lane that are nearer the target, so the queue keeps the order the pack has.
   * Sets `lane`, `row`.
   */
  private slot(u: number, self: AiCar, tg: AiCar, dist: number, cars: readonly AiCar[]): void {
    const lx = detCos(tg.yaw);
    const lz = -detSin(tg.yaw);
    const side = (self.x - tg.x) * lx + (self.z - tg.z) * lz;
    let lane = side > 1 ? 1 : side < -1 ? -1 : this.queued[u] || (side >= 0 ? 1 : -1);
    if (this.obstacles.run(tg.x + lx * lane * TAIL_LANE, tg.z + lz * lane * TAIL_LANE, tg.yaw + Math.PI, QUEUE) < QUEUE) lane = -lane;
    this.queued[u] = lane;
    this.lane = lane;
    this.row = 0;
    for (let v = 0; v < this.count; v++) {
      if (v === u || this.state[v] !== HUNTING || this.queued[v] !== lane || this.aim[v] !== this.aim[u]) continue;
      const c = cars[this.first + v]!;
      if (c.alive && hypot2(c.x - tg.x, c.z - tg.z) < dist) this.row++;
    }
  }

  /** A solid nearer than the target dead ahead of an attacking unit: bend round it (the police's attack geometry knows no walls). */
  private dodge(u: number, self: AiCar, tg: AiCar, speed: number, dist: number, out: DriveInput): void {
    const len = clamp(speed * 0.7 + 4, 6, 20);
    const clear = this.obstacles.run(self.x, self.z, self.yaw, len);
    if (clear >= len || clear >= dist - 3) return;
    const h = this.openHeading(u, self, detAtan2(tg.x - self.x, tg.z - self.z), speed, dist);
    out.steer = pursuitSteer(wrapPi(h - self.yaw), clamp(speed * 0.8, 8, 24), speed, this.turnMax);
    if (speed > DODGE_SPEED && clear < speed * 0.35) out.throttle = Math.min(out.throttle, 0.3);
  }

  /** Beyond `ATTACK`: flat out at where the target will be, round any solid in the way, boosting when far behind, held to the speed the turn to its aim allows. */
  private chase(u: number, self: AiCar, tg: AiCar, speed: number, dist: number, out: DriveInput, boostFrom: number): void {
    const lead = Math.min(2, dist / Math.max(8, speed));
    const ax = tg.x + tg.vx * lead;
    const az = tg.z + tg.vz * lead;
    const aimDist = hypot2(ax - self.x, az - self.z);
    const h = this.openHeading(u, self, detAtan2(ax - self.x, az - self.z), speed, aimDist);
    const alpha = wrapPi(h - self.yaw);
    // Pure pursuit looks a speed-scaled way ahead, so a heading bent round a solid is followed as sharply as it was asked.
    out.steer = pursuitSteer(alpha, Math.min(aimDist, clamp(speed * 0.8, 8, 24)), speed, this.turnMax);
    out.throttle = Math.abs(alpha) > 1.3 && speed > 6 ? 0.2 : 1;
    out.boost = out.throttle > 0.5 && dist > boostFrom && Math.abs(alpha) < 0.35;
    // The turn it must make is the arc to its aim (tangent to its nose; an aim past the shoulder is a right angle), on the grip under it: over that
    // speed it brakes on a racer's latch (`brakeOver`), under it it asks no more throttle than that speed's share of its top.
    const cls = this.cls[self.id]!;
    const arc = arcSpeed(cls, Math.max(4, aimDist), Math.min(Math.abs(alpha), Math.PI / 2), this.surf);
    const brake = brakeOver(this.pedals, self.id, speed - arc);
    if (brake > 0) {
      out.throttle = 0;
      out.brake = brake;
    } else out.throttle = Math.min(out.throttle, arc / cls.topSpeed);
    if (arc < cls.topSpeed) out.boost = false;
  }

  /** The heading nearest `want` whose way is clear of solids for the next stretch; else the one with the longest clear run, a bend costing `TURN_COST` m per radian. */
  private openHeading(u: number, self: AiCar, want: number, speed: number, aimDist: number): number {
    const len = Math.min(aimDist, clamp(speed * 1.1 + 8, 12, 34));
    let best = want;
    let bestScore = this.obstacles.run(self.x, self.z, want, len);
    if (bestScore >= len) return want;
    const s0 = this.side[u]!;
    for (const t of TURNS) {
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? s0 : -s0;
        const h = want + s * t;
        const run = this.obstacles.run(self.x, self.z, h, len);
        const score = run >= len ? Infinity : run - t * TURN_COST;
        if (score > bestScore) {
          bestScore = score;
          best = h;
          this.side[u] = s;
          if (run >= len) return h;
        }
      }
    }
    return best;
  }

  update(time: number, dt: number, cars: readonly AiCar[], hunt: Uint8Array, _lead: number, world: HunterWorld): void {
    this.go = time >= 0;
    this.hunted = hunt;
    let humans = 0;
    for (let i = 0; i < this.racers; i++) humans += hunt[i]!;
    this.clockSquirm(cars, hunt, dt);
    let hunting = 0;
    for (let u = 0; u < this.count; u++) {
      const st = this.state[u]!;
      if (st === STORED) continue;
      const id = this.first + u;
      const car = cars[id]!;
      this.since[u]! += dt;
      if (st === DOWN) {
        if (this.since[u]! > HUNT.wreckStore && world.hidden(car.x, car.z)) this.store(u, world);
        continue;
      }
      // A crashed cop no longer drives (`drive`), so it is down for the pack too: left counted, a pile of them held off every drop-in.
      if (world.down(id) || car.crashed) {
        this.state[u] = DOWN;
        this.since[u] = 0;
        world.sirens(id, false);
        this.stats.disabled++;
        continue;
      }
      // Lost: far from every free human and nobody to see it go. The human nearest it and how far off is what `pickSeekers` ranks the units by.
      this.rankedOn[u] = this.nearestHunted(car.x, car.z, cars);
      this.rankedAt[u] = this.nearGap;
      const far = this.rankedOn[u]! >= 0 && this.rankedAt[u]! > HUNT.far;
      this.lost[u] = far && world.hidden(car.x, car.z) ? this.lost[u]! + dt : 0;
      if (this.lost[u]! > HUNT.farTime) {
        this.store(u, world);
        this.stats.despawns++;
        continue;
      }
      hunting++;
    }
    this.stats.peak = Math.max(this.stats.peak, hunting);
    this.mean = aggression(time);
    this.pickSeekers(time);
    this.openFormation(time);
    if (!this.go || humans === 0 || time < this.nextDrop || hunting >= copsWanted(time, this.formation.length, humans, this.count)) return;
    const u = this.vacant();
    const tg = this.dropTarget(cars);
    if (u < 0 || !this.dropSpot(tg, cars, world)) return;
    world.park(this.first + u, this.at.x, 0, this.at.z, this.at.yaw);
    this.deploy(u, world);
    this.stats.drops++;
    this.nextDrop = time + HUNT.gap;
  }

  /**
   * Each hunted racer's squirm clock: it grows while the racer is boxed in and over `SQUIRM`, holds while it sits still, clears when it
   * is out of the box or drives off over `ESCAPED`. Once it has reached `RAM_AFTER` the box no longer clears it (the rammers backing off
   * for their run-up are the units that boxed it in): only a drive-off, the hunt ending, or `CALM_END` s of sitting still, when the
   * racer has stopped squirming and the bust gets its chance.
   */
  private clockSquirm(cars: readonly AiCar[], hunt: Uint8Array, dt: number): void {
    for (let i = 0; i < this.racers; i++) {
      const me = cars[i]!;
      const v = hypot2(me.vx, me.vz);
      const waited = this.pinned[i]! >= RAM_AFTER;
      if (hunt[i] !== 1 || v > ESCAPED || (!waited && !this.boxedIn(me, cars))) {
        this.pinned[i] = 0;
        this.calm[i] = 0;
      } else if (v >= SQUIRM) {
        this.pinned[i]! += dt;
        this.calm[i] = 0;
      } else if (waited && (this.calm[i]! += dt) >= CALM_END) {
        this.pinned[i] = 0;
        this.calm[i] = 0;
      }
    }
  }

  /** Each hunting unit seeks a hit while it is among the nearest `ceil(a × n)` of the `n` units after the human it is ranked against; the pick is held `SEEK_HOLD` s. */
  private pickSeekers(time: number): void {
    for (let u = 0; u < this.count; u++) {
      if (this.state[u] !== HUNTING) {
        this.seeks[u] = 0;
        continue;
      }
      let n = 0;
      let nearer = 0;
      for (let v = 0; v < this.count; v++) {
        if (this.state[v] !== HUNTING || this.rankedOn[v] !== this.rankedOn[u]) continue;
        n++;
        if (this.rankedAt[v]! < this.rankedAt[u]! || (this.rankedAt[v] === this.rankedAt[u] && v < u)) nearer++;
      }
      if (nearer < Math.ceil(this.mean * n)) this.seekUntil[u] = time + SEEK_HOLD;
      this.seeks[u] = time < this.seekUntil[u]! ? 1 : 0;
    }
  }

  /** At the green the formation splits: its units that seek a hit go in at a(t), the rest fly the opening at full aggression until `HUNT.opening` s, then every unit follows a(t). */
  private openFormation(time: number): void {
    if (time >= HUNT.opening) {
      this.flies.fill(0);
      this.opened = true;
    }
    if (this.opened || time < 0) return;
    this.opened = true;
    for (let u = 0; u < this.formation.length && u < this.count; u++) if (this.state[u] === HUNTING && this.seeks[u] === 0) this.flies[u] = 1;
  }

  /** Whether units and solids close in `me` on enough headings (`BOX_HEADINGS`), units on enough of them (`BOX_UNITS`). */
  private boxedIn(me: AiCar, cars: readonly AiCar[]): boolean {
    let units = 0;
    for (let u = 0; u < this.count; u++) {
      if (this.state[u] === STORED) continue;
      const c = cars[this.first + u]!;
      const dx = c.x - me.x;
      const dz = c.z - me.z;
      if (dx * dx + dz * dz < SETTLE * SETTLE) units |= 1 << (Math.round(detAtan2(dx, dz) / (Math.PI / 4)) & 7);
    }
    if (popcount(units) < BOX_UNITS) return false;
    let around = units;
    for (let k = 0; k < 8; k++) if (this.obstacles.run(me.x, me.z, (k * Math.PI) / 4, SETTLE) < SETTLE) around |= 1 << k;
    return popcount(around) >= BOX_HEADINGS;
  }

  /** A unit to drop in: one in storage, else the longest-lying wreck (past `wreckStore`) that the camera still sees, so a pile of wrecks in view never leaves the pack empty. −1 none. */
  private vacant(): number {
    const u = this.free();
    if (u >= 0) return u;
    let oldest = -1;
    for (let k = 0; k < this.count; k++) if (this.state[k] === DOWN && this.since[k]! > HUNT.wreckStore && (oldest < 0 || this.since[k]! > this.since[oldest]!)) oldest = k;
    return oldest;
  }

  /** The free human with the fewest cops after it (the lowest car id on a tie): where the next drop-in is aimed. */
  private dropTarget(cars: readonly AiCar[]): AiCar {
    let best = -1;
    let fewest = Infinity;
    for (let i = 0; i < this.racers; i++) {
      if (this.hunted![i] !== 1) continue;
      const n = this.copsOn(i);
      if (n < fewest) {
        fewest = n;
        best = i;
      }
    }
    return cars[best]!;
  }

  /** The nearest free human (`hunt` flags of the last patrol) to (x, z): its car id, −1 when none. Sets `nearGap` to the distance (m). */
  private nearestHunted(x: number, z: number, cars: readonly AiCar[]): number {
    const hunted = this.hunted;
    let best = -1;
    let gap = Infinity;
    if (hunted !== null) {
      for (let i = 0; i < this.racers; i++) {
        if (hunted[i] !== 1) continue;
        const d = hypot2(cars[i]!.x - x, cars[i]!.z - z);
        if (d < gap) {
          gap = d;
          best = i;
        }
      }
    }
    this.nearGap = gap;
    return best;
  }

  /** Unit `u` is parked and starts hunting. */
  private deploy(u: number, world: HunterWorld): void {
    this.state[u] = HUNTING;
    this.since[u] = 0;
    this.lost[u] = 0;
    this.role[u] = u;
    this.queued[u] = 0;
    this.charging[u] = 0;
    this.seekUntil[u] = -Infinity;
    this.flies[u] = 0;
    this.wedge.reset(u);
    this.swings.clear(u);
    world.sirens(this.first + u, true);
  }

  protected override store(u: number, world: HunterWorld): void {
    super.store(u, world);
    this.state[u] = STORED;
  }

  /**
   * A road spot `dropMin … dropMax` m from `tg` (`dropMin` from every point of its path over the next `HUNT.lag` s, going straight on: the cop shows
   * that much later), clear of every car, that the camera cannot see (`world.hidden`), facing along the road toward the player: ahead of the
   * player's travel first, anywhere round it if none is. Fills `at`.
   */
  private dropSpot(tg: AiCar, cars: readonly AiCar[], world: HunterWorld): boolean {
    const n = this.spotX.length;
    const fx = detSin(tg.yaw);
    const fz = detCos(tg.yaw);
    const v2 = tg.vx * tg.vx + tg.vz * tg.vz;
    const moving = hypot2(tg.vx, tg.vz) > 5;
    let tests = 0;
    for (let pass = moving ? 0 : 1; pass < 2; pass++) {
      const ahead = pass === 0;
      const from = Math.floor(this.roll() * n);
      for (let k = 0; k < n; k++) {
        const i = (from + k) % n;
        const dx = this.spotX[i]! - tg.x;
        const dz = this.spotZ[i]! - tg.z;
        const d = hypot2(dx, dz);
        if (d > HUNT.dropMax || (ahead && dx * fx + dz * fz < d * 0.3)) continue;
        const t = v2 > 0 ? clamp((dx * tg.vx + dz * tg.vz) / v2, 0, HUNT.lag) : 0;
        if (hypot2(dx - tg.vx * t, dz - tg.vz * t) < HUNT.dropMin) continue;
        if (this.crowded(this.spotX[i]!, this.spotZ[i]!, cars) || this.nearHuman(this.spotX[i]!, this.spotZ[i]!, tg.id, cars)) continue;
        if (tests++ >= HUNT.tests) return false;
        if (!world.hidden(this.spotX[i]!, this.spotZ[i]!)) continue;
        // Along the road, the way that points at the player.
        const sign = this.spotTx[i]! * -dx + this.spotTz[i]! * -dz >= 0 ? 1 : -1;
        this.at.x = this.spotX[i]!;
        this.at.z = this.spotZ[i]!;
        this.at.yaw = detAtan2(this.spotTx[i]! * sign, this.spotTz[i]! * sign);
        return true;
      }
    }
    return false;
  }

  private crowded(x: number, z: number, cars: readonly AiCar[]): boolean {
    for (const c of cars) if (hypot2(c.x - x, c.z - z) < HUNT.clear) return true;
    return false;
  }

  /** Whether (x, z) is nearer than `dropMin` to a free human other than `except`: a cop does not drop in on a teammate's side. */
  private nearHuman(x: number, z: number, except: number, cars: readonly AiCar[]): boolean {
    const hunted = this.hunted;
    if (hunted === null) return false;
    for (let i = 0; i < this.racers; i++) if (i !== except && hunted[i] === 1 && hypot2(cars[i]!.x - x, cars[i]!.z - z) < HUNT.dropMin) return true;
    return false;
  }
}
