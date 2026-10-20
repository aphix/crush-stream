import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { MAX_CARS } from "../scenes/fleet.ts";
import { blankPoint, blankProjection, projectPath, type Projection, type Track } from "../world/track.ts";
import type { AiCar } from "./derby-ai.ts";

/** What a racer sees (m): everything within `near` by straight line; along the road, `ahead` m down it and `behind` m back in its mirrors. */
interface SightRange {
  near: number;
  ahead: number;
  behind: number;
}

/** A course this long (m) or longer is seen at the full ranges; a shorter one, whose whole lap a few racers would cover, at the share of them its length is of this. */
const SIGHT_COURSE = 2000;
const SIGHT_NEAR = 100;
const SIGHT_AHEAD = 200;
const SIGHT_BEHIND = 40;
/** Metres a racer drives, flat out, in the 0.25 s between the beat that reads its place and the frame a cop put on the road shows. */
export const SIGHT_MARGIN = 20;
/** Metres a racer may be past the road's run-off and still be on its corridor (`projectPath`'s own margin): beyond it the racer is not on this road. */
export const CORRIDOR = 8;
/** Units of one stakeout park this far apart (m) along the road. */
export const PARK_SPACING = 12;
/** Half width and half length (m) of a car's footprint, for the parking spot. */
const HALF_W = 0.95;
const HALF_L = 2.3;
/** Room (m) a parked car keeps from the run-off's outer edge (the wall). */
const PARK_MARGIN = 0.15;
/** A parked car noses this far (rad) toward the road where the run-off is at least `ANGLED_RUN` m wide. */
const PARK_ANGLE = 0.25;
const ANGLED_RUN = 3;
/** A parking spot keeps this far (m) from every car. */
const PARK_CLEAR = 10;

/** The ranges a racer sees on a course `length` m round. */
export function sightRange(length: number): SightRange {
  const scale = Math.min(1, length / SIGHT_COURSE);
  return { near: SIGHT_NEAR * scale, ahead: SIGHT_AHEAD * scale, behind: SIGHT_BEHIND * scale };
}

/** Whether a point on the course is out of every racer's sight, by where the racers are and the road between: no camera is read. */
export class RacerSight {
  /** The straight-line distance (m) from the last queried point to the nearest racer. */
  gap = Infinity;
  readonly range: SightRange;
  private readonly track: Track;
  private readonly racers: number;
  private cars: readonly AiCar[] = [];
  /** Per racer: its road arc (m) and whether it is on the road's corridor (else its arc says nothing about what it sees). */
  private readonly arc = new Float64Array(MAX_CARS);
  private readonly onRoad = new Uint8Array(MAX_CARS);
  /** Per car id: projection hint. */
  private readonly seg = new Int32Array(MAX_CARS).fill(-1);
  private readonly proj = blankProjection();
  private readonly pt = blankPoint();
  /** The last spot `parkSpot` found: its place, the ground's height there, heading and road arc. */
  readonly spot = { x: 0, y: 0, z: 0, yaw: 0, s: 0 };

  constructor(track: Track, racers: number) {
    this.track = track;
    this.racers = racers;
    this.range = sightRange(track.length);
  }

  /** The racers' places this beat (`cars[0 … racers − 1]`); every query after reads them. */
  watch(cars: readonly AiCar[]): void {
    this.cars = cars;
    for (let i = 0; i < this.racers; i++) {
      const car = cars[i]!;
      const on = this.project(car);
      this.arc[i] = on.s;
      this.onRoad[i] = this.onCorridor(on) ? 1 : 0;
    }
  }

  /** Car `c` stands where no racer sees it (of those `only` marks by id, when given): see `hiddenAt`. */
  hiddenCar(c: AiCar, only?: Uint8Array): boolean {
    const on = this.project(c);
    return this.hiddenAt(c.x, c.z, on.s, this.onCorridor(on), only);
  }

  /**
   * (x, z), at road arc `s` and on the road's corridor or not, is out of sight of every racer: `range.near` m or more from each, and for
   * a racer on the road, more than `range.behind` m behind it or `range.ahead` m ahead along the road (a racer off the road, whose
   * heading says nothing of the road, sees `range.ahead` m round it), each with `SIGHT_MARGIN` m to spare for the metres a racer
   * drives between the beat that read its place and the frame the cop shows; with `only`, of the racers it marks (by id). Sets `gap`, to the
   * nearest of every racer.
   */
  hiddenAt(x: number, z: number, s: number, onCorridor: boolean, only?: Uint8Array): boolean {
    const L = this.track.length;
    const { near, ahead: seesAhead, behind: seesBehind } = this.range;
    let hidden = true;
    this.gap = Infinity;
    for (let i = 0; i < this.racers; i++) {
      const racer = this.cars[i]!;
      const dist = hypot2(racer.x - x, racer.z - z);
      if (dist < this.gap) this.gap = dist;
      if (only && only[i] !== 1) continue;
      if (dist < near + SIGHT_MARGIN) hidden = false;
      else if (!onCorridor || this.onRoad[i] === 0) hidden = hidden && dist >= seesAhead + SIGHT_MARGIN;
      else {
        const along = s - this.arc[i]!;
        const ahead = along - L * Math.round(along / L);
        hidden = hidden && (ahead <= -(seesBehind + SIGHT_MARGIN) || ahead >= seesAhead + SIGHT_MARGIN);
      }
    }
    return hidden;
  }

  /**
   * A parking spot `ahead` m along the road from car `c` (behind it when negative; `seg` the caller's per-car projection hint), on the run-off on
   * `side` (+1 left of travel), facing with the travel (`facing` 1) or against it (−1), clear of every car and out of every racer's sight; it scans
   * on along the road, the way it was asked for, past bridge decks. Fills `spot`.
   */
  parkSpot(c: AiCar, ahead: number, side: 1 | -1, facing: 1 | -1, cars: readonly AiCar[], seg: Int32Array): boolean {
    const path = this.track.path;
    const L = this.track.length;
    let s = projectPath(path, c.x, c.z, seg[c.id]!, this.proj).s + ahead;
    seg[c.id] = this.proj.k;
    for (let tries = 0; tries < 6; tries++, s += Math.sign(ahead) * PARK_SPACING * 1.5) {
      const ws = ((s % L) + L) % L;
      const k = Math.min(path.count - 1, Math.floor((ws / L) * path.count));
      if (path.deck[k]) continue;
      const run = side > 0 ? path.runL[k]! : path.runR[k]!;
      const angle = run >= ANGLED_RUN ? PARK_ANGLE : 0;
      const lat = side * (path.half[k]! + run - HALF_W - PARK_MARGIN - HALF_L * detSin(angle));
      const pt = this.track.pointAt(ws, this.pt);
      const x = pt.x + pt.tz * lat;
      const z = pt.z - pt.tx * lat;
      if (!this.hiddenAt(x, z, ws, true)) continue;
      let clear = true;
      for (const o of cars) if (hypot2(o.x - x, o.z - z) < PARK_CLEAR) clear = false;
      if (!clear) continue;
      // Nose toward the road: forward turned by `angle` toward the centreline.
      const fx = facing * pt.tx * detCos(angle) - side * pt.tz * detSin(angle);
      const fz = facing * pt.tz * detCos(angle) + side * pt.tx * detSin(angle);
      this.spot.x = x;
      this.spot.y = pt.y;
      this.spot.z = z;
      this.spot.yaw = detAtan2(fx, fz);
      this.spot.s = ws;
      return true;
    }
    return false;
  }

  private project(c: AiCar): Projection {
    const on = projectPath(this.track.path, c.x, c.z, this.seg[c.id]!, this.proj);
    this.seg[c.id] = on.k;
    return on;
  }

  private onCorridor(on: Projection): boolean {
    const path = this.track.path;
    const reach = path.half[on.k]! + Math.max(path.runL[on.k]!, path.runR[on.k]!) + CORRIDOR;
    return on.dist2 <= reach * reach;
  }
}
