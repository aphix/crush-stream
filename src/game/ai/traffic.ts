import { hypot2, detSin, detCos, detAtan2 } from "../kernel/physics-core.js";
import { clearDrive, DRIVE, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import type { AiCar } from "./derby-ai.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { closingSpeed, lookDistance, SEEN_BEHIND, SEEN_NEAR, Sighting, visibleStretch } from "./sight.ts";
import { steerGrip } from "./race-ai.ts";
import { Backoff } from "./cop-brain.ts";
import { Pedals } from "./pedals.ts";
import { PlanClock } from "./plan-clock.ts";
import { SURFACE_IDS, SURFACES } from "../world/catalog.ts";
import { blankPoint, blankProjection, pointOn, projectPath, type Track, type TrackPath } from "../world/track.ts";
import { clamp, wrapPi } from "../kernel/scalar.ts";
import { STRAIGHT_CURV } from "./constants.ts";

/** The least a traffic car looks ahead in its lane (m), and how many seconds of closing speed it looks when that is more: a racer closing at 35 m/s is seen 2.5 s out, not 0.5 s. */
const LANE_LOOK = 18;
const LANE_LOOK_S = 2.5;
/** A traffic driver's reaction time (s) to a car that has come into view: the typical driver's, a rested PVT median. */
const REACTION_S = 0.25;
/** Sideways reach (m) in which a racer coming up from behind, or head-on, is a car to make room for. */
const YIELD_LAT = 3;
/** A car coming up from behind is a yield only above this closing speed (m/s). */
const YIELD_CLOSING = 3;
/** Half lane (m): a car this close sideways is in our lane. */
const LANE_HALF = 2.1;
/** Gap (m) traffic keeps to whatever is stopped ahead. */
const STOP_GAP = 7;
/** Below this speed (m/s) a blocked car is stopped, and its wait begins. */
const STOPPED_SPEED = 0.8;
/** Seconds stopped behind a blocker before edging round it (toward the road centre, or our own kerb for a car facing us). */
const WAIT = 2.5;
/** Seconds spent edging round once started (long enough to clear a car at walking pace). */
const EDGE_TIME = 4.5;
/** Speed over its target (m/s) at which a traffic car's brake comes on, and under it by which it goes off; the brake is full at `BRAKE_SPAN` over. */
const BRAKE_ON = 1;
const BRAKE_OFF = 0.5;
const BRAKE_SPAN = 4;
/** A target under this (m/s) is a stop: the brake is held on. */
const STOP_TARGET = 0.3;
/** How far (m) past its lane a car facing a racer head-on edges toward its own kerb. */
const KERB_SHIFT = 1.5;
/** Grid zone (m) behind and ahead of the line kept clear of loop traffic at the start (16 cars reach back ~66 m). */
const GRID_CLEAR = 80;
/** Observer bubble (m): traffic farther than `DORMANT` from every observer is put away; it comes back between `SPAWN_NEAR` and `SPAWN_FAR`. */
export const DORMANT = 120;
export const SPAWN_NEAR = 55;
export const SPAWN_FAR = 100;
/** A woken car keeps this far (m) from every other car. */
const SPAWN_CLEAR = 14;
/** An open street's car this close (m) to its end is done and put away. */
const END_MARGIN = 6;

type TrafficSpawn = { x: number; y: number; z: number; yaw: number };

/** One traffic car's lane: the path it drives, its lateral offset and direction. */
type TrafficSlot = { path: TrackPath; offset: number; dir: 1 | -1 };

/**
 * NPC world traffic. Cars `firstId…` drive, in order, the course's race-loop lanes
 * (`traffic.count`, lanes round-robin) and then each side street (`traffic.routes`: its `count`
 * cars, its lanes round-robin). Each cruises its lane (offset from the path's centreline, + = left
 * of the path direction; `dir` −1 drives against it), slows for turns, brakes for anything in its
 * lane ahead (racers, wrecks, other traffic) and, after waiting behind a stopped obstacle, edges
 * round it, or to its own kerb when the obstacle faces it (a racer met head-on: edging toward the
 * centre put it back across the racer's path, and the two danced nose to nose until the racer was
 * DNF). Cross streets meet the race loop at grade, so racers get cross traffic at junctions.
 * The host keeps traffic in a bubble round the observers (`dormantFar`, `spawnPoint`).
 * Deterministic; no allocation per call.
 */
export class TrafficBrain {
  readonly track: Track;
  readonly firstId: number;
  readonly speed: number;
  readonly slots: TrafficSlot[];
  private readonly out: DriveInput = idleDrive();
  private readonly clock = new PlanClock();
  private readonly pedals = new Pedals();
  private readonly sighting = new Sighting();
  /** Per car, its last plan: the gap (m) and speed along (m/s) of what is in its lane ahead, the lane offset it steers for and whether it is edging round. */
  private readonly planGap = new Float64Array(MAX_CARS);
  private readonly planGapAlong = new Float64Array(MAX_CARS);
  private readonly planOffset = new Float64Array(MAX_CARS);
  private readonly planEdging = new Uint8Array(MAX_CARS);
  /** 1 while a racer bears down on the car (head-on or from behind) and it holds to its own kerb. */
  private readonly planYield = new Uint8Array(MAX_CARS);
  private readonly wedge = new Backoff(MAX_CARS);
  private readonly seg = new Int32Array(MAX_CARS);
  private readonly waited = new Float64Array(MAX_CARS);
  private readonly edge = new Float64Array(MAX_CARS);
  /** 1 while the edge round is to our own kerb (the blocker faces us), 0 toward the centre. */
  private readonly kerb = new Uint8Array(MAX_CARS);
  /** Next arc length to try when waking each car (scans on so wakes spread out). */
  private readonly scan = new Float64Array(MAX_CARS);
  private readonly proj = blankProjection();
  private readonly pt = blankPoint();

  constructor(track: Track, firstId: number) {
    const t = track.json.traffic;
    if (!t) throw new Error(`${track.id} has no traffic`);
    this.track = track;
    this.firstId = firstId;
    this.speed = t.speed;
    this.slots = [];
    for (let k = 0; k < t.count; k++) {
      const lane = t.lanes[k % t.lanes.length]!;
      this.slots.push({ path: track.path, offset: lane.offset, dir: lane.dir });
    }
    for (const r of track.routes) {
      for (let k = 0; k < r.count; k++) {
        const lane = r.lanes[k % r.lanes.length]!;
        this.slots.push({ path: r.path, offset: lane.offset, dir: lane.dir });
      }
    }
    this.reset();
  }

  get count(): number {
    return this.slots.length;
  }

  reset(): void {
    this.seg.fill(-1);
    this.waited.fill(0);
    this.edge.fill(0);
    this.kerb.fill(0);
    this.clock.forgetAll();
    this.pedals.reset();
    this.sighting.reset();
    for (let i = 0; i < MAX_CARS; i++) {
      this.scan[i] = ((i * 97.31) % 1) * 1e3;
      this.wedge.reset(i);
    }
  }

  slotOf(id: number): TrafficSlot {
    return this.slots[id - this.firstId]!;
  }

  /** Start spots: loop cars spread round the loop clear of the grid, street cars spread along their street. */
  spawns(): TrafficSpawn[] {
    const L = this.track.length;
    const loop = this.slots.filter((s) => s.path === this.track.path).length;
    const perPath = new Map<TrackPath, number>();
    return this.slots.map((slot, k) => {
      const n = slot.path === this.track.path ? loop : this.slots.filter((s) => s.path === slot.path).length;
      const j = perPath.get(slot.path) ?? 0;
      perPath.set(slot.path, j + 1);
      const s = slot.path === this.track.path ? GRID_CLEAR + ((j + 0.5) / n) * (L - 2 * GRID_CLEAR) : ((j + 0.5) / n) * slot.path.length;
      return this.placeAt(this.firstId + k, s);
    });
  }

  /**
   * A wake-up spot for dormant car `id`: on its lane, between SPAWN_NEAR and SPAWN_FAR of the
   * nearest observer, SPAWN_CLEAR from every car, and not where `seen(x, z)` says a player is
   * looking. Null when no such spot turns up this time.
   */
  spawnPoint(id: number, observers: readonly AiCar[], cars: readonly AiCar[], seen: (x: number, z: number) => boolean): TrafficSpawn | null {
    const slot = this.slotOf(id);
    const len = slot.path.length;
    const span = slot.path.closed ? len : len - 2 * END_MARGIN;
    for (let tries = 0; tries < 24; tries++) {
      const s = slot.path.closed ? this.scan[id]! % len : END_MARGIN + (this.scan[id]! % span);
      this.scan[id]! += 37;
      const p = this.placeAt(id, s);
      let near = Infinity;
      for (let q = 0; q < observers.length; q++) near = Math.min(near, hypot2(observers[q]!.x - p.x, observers[q]!.z - p.z));
      if (near < SPAWN_NEAR || near > SPAWN_FAR) continue;
      let clear = true;
      for (let q = 0; q < cars.length; q++) {
        const c = cars[q]!;
        if (c.id !== id && hypot2(c.x - p.x, c.z - p.z) < SPAWN_CLEAR) {
          clear = false;
          break;
        }
      }
      if (clear && !seen(p.x, p.z)) return p;
    }
    return null;
  }

  /** True when car `id` (at x, z) has driven off the end of an open street. */
  atEnd(id: number, x: number, z: number): boolean {
    const slot = this.slotOf(id);
    if (slot.path.closed) return false;
    const p = projectPath(slot.path, x, z, this.seg[id]!, this.proj);
    return slot.dir > 0 ? p.s > slot.path.length - END_MARGIN : p.s < END_MARGIN;
  }

  /** Forget a car's projection hint and wait (after a teleport). */
  respawned(id: number): void {
    this.seg[id] = -1;
    this.waited[id] = 0;
    this.edge[id] = 0;
    this.kerb[id] = 0;
    this.clock.forget(id);
    this.pedals.forget(id);
    this.sighting.forget(id);
    this.wedge.reset(id);
  }

  private placeAt(id: number, s: number): TrafficSpawn {
    const slot = this.slotOf(id);
    const p = pointOn(slot.path, s, this.pt);
    const heading = detAtan2(p.tx, p.tz);
    return {
      x: p.x + p.tz * slot.offset,
      y: p.y,
      z: p.z - p.tx * slot.offset,
      yaw: slot.dir > 0 ? heading : wrapPi(heading + Math.PI),
    };
  }

  /** One step for traffic car `self`: plans at `THINK_HZ` (what is in its lane ahead, whether it waits or edges round), drives its wheel and pedals every step. */
  think(self: AiCar, others: readonly AiCar[], dt: number): DriveInput {
    const out = clearDrive(this.out);
    const i = self.id;
    if (!self.alive) return out;
    if (this.wedge.backing(i, dt, out)) {
      this.pedals.follow(i, out);
      return out;
    }
    const slot = this.slotOf(i);
    const path = slot.path;
    const proj = projectPath(path, self.x, self.z, this.seg[i]!, this.proj);
    this.seg[i] = proj.k;
    if (this.clock.due(i, dt)) this.replan(self, others, proj.s);
    const speed = hypot2(self.vx, self.vz);
    const ld = clamp(4 + 0.5 * speed, 6, 14);
    const p = pointOn(path, proj.s + slot.dir * ld, this.pt);
    const offset = this.planOffset[i]!;
    const tx = p.x + p.tz * offset;
    const tz = p.z - p.tx * offset;
    const alpha = wrapPi(detAtan2(tx - self.x, tz - self.z) - self.yaw);
    const surf = SURFACES[SURFACE_IDS[path.surface[proj.k]!]!];
    const turnMax = DRIVE.turn * (0.35 + 0.65 * Math.min(1, speed / 8)) * steerGrip(surf.grip);
    out.steer = clamp((2 * Math.max(speed, 3) * detSin(alpha)) / ld / Math.max(0.2, turnMax), -1, 1);
    const edging = this.planEdging[i] === 1;
    const curv = Math.abs(path.curv[proj.k]!);
    let target = Math.min(this.speed, curv > STRAIGHT_CURV ? (DRIVE.turn * 0.6) / curv : Infinity);
    // Speed that still stops STOP_GAP short of it at a gentle 4 m/s².
    if (this.planGap[i]! < Infinity) target = Math.min(target, Math.max(0, this.planGapAlong[i]!) + Math.sqrt(8 * Math.max(0, this.planGap[i]! - STOP_GAP)));
    if (edging) target = Math.min(this.speed, 4);
    const along = self.vx * detSin(self.yaw) + self.vz * detCos(self.yaw);
    const stop = target < STOP_TARGET && !edging;
    if (this.pedals.latch(i, stop ? Infinity : along - target, BRAKE_ON, BRAKE_OFF)) out.brake = stop ? 1 : clamp((along - target + BRAKE_OFF) / BRAKE_SPAN, 0, 1);
    else out.throttle = clamp(target / DRIVE.maxFwd + (target - along) * 0.15, 0, 1);
    this.pedals.shape(i, out, dt);
    this.wedge.watch(i, self.x, self.z, dt, out);
    return out;
  }

  /** Car `self` (at arc `s` on its road)'s plan: what is in its lane ahead, whether a racer bears down on it, the wait behind a stopped blocker and the edge round it (the timers age by the time since its last plan). */
  private replan(self: AiCar, others: readonly AiCar[], s: number): void {
    const i = self.id;
    const age = this.clock.ageOf(i);
    const slot = this.slotOf(i);
    const fx = detSin(self.yaw);
    const fz = detCos(self.yaw);
    const sightArc = visibleStretch(slot.path, s, slot.dir);
    let gap = Infinity;
    let gapAlong = 0;
    let gapYaw = 0;
    let yielding = false;
    for (let q = 0; q < others.length; q++) {
      const o = others[q]!;
      if (o.id === i) continue;
      const dx = o.x - self.x;
      const dz = o.z - self.z;
      const dist = hypot2(dx, dz);
      const ahead = dx * fx + dz * fz;
      const inView = dist < SEEN_NEAR || (ahead > 0 ? ahead <= sightArc : dist < SEEN_BEHIND);
      if (!this.sighting.reacts(i, o.id, inView, age, REACTION_S)) continue;
      const side = dx * fz - dz * fx;
      const closing = closingSpeed(self.vx, self.vz, o.vx, o.vz, dx, dz, dist);
      const sameWay = detCos(o.yaw - self.yaw);
      const look = lookDistance(closing, LANE_LOOK_S, LANE_LOOK, sightArc);
      if (Math.abs(side) <= YIELD_LAT && ((ahead > 0.5 && ahead <= look && sameWay < -0.5) || (ahead < 0 && -ahead <= look && sameWay > 0.5 && closing > YIELD_CLOSING))) yielding = true;
      if (ahead <= 0.5 || ahead > look || Math.abs(side) > LANE_HALF || (sameWay < -0.5 && o.alive && closing > 0)) continue;
      if (ahead < gap) {
        gap = ahead;
        gapAlong = o.vx * fx + o.vz * fz;
        gapYaw = o.yaw;
      }
    }
    const blocked = gap < STOP_GAP + 3 && gapAlong < 1;
    this.waited[i] = blocked && hypot2(self.vx, self.vz) < STOPPED_SPEED ? this.waited[i]! + age : blocked ? this.waited[i]! : 0;
    if (this.waited[i]! > WAIT) {
      this.waited[i] = 0;
      this.edge[i] = EDGE_TIME;
      // A car facing us (a racer met head-on in our lane): make room at our own kerb, not across its path.
      this.kerb[i] = detCos(gapYaw - self.yaw) < -0.5 ? 1 : 0;
    }
    // Edging round: toward the centreline (and a little past it) at walking pace until clear, or to our own kerb for a car facing us.
    const edging = this.edge[i]! > 0;
    if (edging) this.edge[i]! -= age;
    const kerbSide = Math.sign(slot.offset || 1);
    this.planEdging[i] = edging ? 1 : 0;
    this.planYield[i] = yielding ? 1 : 0;
    this.planOffset[i] = edging ? (this.kerb[i] ? slot.offset + kerbSide * KERB_SHIFT : slot.offset - kerbSide * 3.6) : yielding ? slot.offset + kerbSide * KERB_SHIFT : slot.offset;
    this.planGap[i] = gap;
    this.planGapAlong[i] = gapAlong;
    this.clock.planned(i);
  }
}
