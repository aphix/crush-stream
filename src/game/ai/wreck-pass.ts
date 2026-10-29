import { MAX_CARS } from "../scenes/fleet.ts";
import { clamp, hash01 } from "../kernel/scalar.ts";

/** Most stopped cars a plan weighs at once (a pile), and most committed rivals it weighs a candidate lane against. */
const MAX_OBSTACLES = 12;
const MAX_RIVALS = 8;
/** Lanes tried across the road, evenly from edge to edge. */
const CANDIDATES = 9;
/** Centre-to-centre distance (m) a pass lane keeps from a stopped car: a car width and a hand's breadth either side of the gap (it was 3.3 m before this planner). */
const PASS_CLEAR = 3.3;
/** Room (m) beyond `PASS_CLEAR` at which a lane is as comfortable as it gets: tighter lanes carry risk and a lower pass speed. */
const PASS_COMFORT = 1.5;
/** A stopped car this far behind the nose (m) still holds the lane: the car's own length plus a margin, so the rejoin never clips the wreck it has just passed. */
const PASS_TAIL = 7;
/** A lane on the edge of the room the road leaves (`room`, itself the road's half width less the planner's edge margin) still has this much (m) to spare, so edge lanes carry risk but are not barred. */
const EDGE_SLACK = 0.5;
/** Score of a lane: its free run to the next stopped car (share of the look-ahead) times `FREE_W`, less `RISK_W` at no room to spare, `PATH_W` a metre off the line, `LANE_W` a metre of lane change, `TAKEN_W` where a rival has committed, plus `COMMIT_W` where it committed itself. */
const FREE_W = 4;
const RISK_W = 3;
const PATH_W = 0.3;
const LANE_W = 0.15;
const TAKEN_W = 3;
const COMMIT_W = 6;
/** The weight of a driver's own bias (a hash of its id, −1 … 1) for the left or the right of a wreck: two drivers who score the sides alike still split. */
const SPREAD_W = 0.3;
const PASS_SALT = 14;
/** A committed lane is kept this many seconds after the last plan that needed it, and a lane within this far (m) of it counts as it. */
const COMMIT_S = 2.5;
const COMMIT_BAND = 1.2;
/** A rival's committed lane counts as taken while it is within this far (m) along the road, ahead or behind. */
const TAKEN_WINDOW = 16;
/** The least speed (m/s) a pass slows to when there is a lane: the contact guard brakes for what it must, the plan does not crawl. */
const PASS_FLOOR = 10;
/** Share of the way from top speed down to `PASS_FLOOR` a pass slows by at no room to spare (a gap with room needs no slowing): a tight squeeze lifts, it does not crawl. */
const TIGHT_SHARE = 0.35;
/** Distance (m) short of a stopped car by which the lane change must be done, and short of one it cannot pass by which the car must stop. */
const NOSE_GAP = 3;
const STOP_BUFFER = 6;
/** A lane move shorter than this (m) needs no slower pass. */
const SHORT_MOVE = 0.3;

/**
 * The pass round stopped cars (dead-engine wrecks, parked or jammed traffic) in the road ahead of a racer: candidate lanes across the road are scored on the free
 * run beyond them, the room to spare, the cost of leaving the line and the lane change, the side other racers have taken and the driver's own bias; the best
 * becomes the line and sets what speed the pass allows. Cars alongside still hold the lane (`PASS_TAIL`), so the line rejoins only once they are astern.
 * No allocation per call.
 */
export class WreckPass {
  private readonly ahead = new Float64Array(MAX_OBSTACLES);
  private readonly lateral = new Float64Array(MAX_OBSTACLES);
  /** 1 for an obstacle that only steers the lane choice (a dead or stopped cop, a dead car): it never caps the speed. */
  private readonly soft = new Uint8Array(MAX_OBSTACLES);
  private count = 0;
  private readonly rivalLateral = new Float64Array(MAX_RIVALS);
  private rivals = 0;
  /** Per car: the lane (m) it last passed by and the seconds that commitment has left. */
  private readonly commitLane = new Float64Array(MAX_CARS);
  private readonly commitFor = new Float64Array(MAX_CARS);
  /** The speed (m/s) the last `choose` allows the car, Infinity when it needs none. */
  speedCap = Infinity;

  /** A new scan for car `i`, `age` s after its last: forget the stopped cars and rivals, age its commitment. */
  begin(i: number, age: number): void {
    this.count = 0;
    this.rivals = 0;
    this.commitFor[i] = Math.max(0, this.commitFor[i]! - age);
  }

  /** Forget car `i`'s commitment (a respawn, a new race). */
  forget(i: number): void {
    this.commitFor[i] = 0;
  }

  /** A stopped or crawling car `ahead` m on the nose (`PASS_TAIL` behind it still counts), `lateral` m from the road's centre line; `soft` ones (a dead or stopped cop, a dead car) are steered round at speed, never braked for. */
  note(ahead: number, lateral: number, soft: boolean): void {
    if (ahead <= -PASS_TAIL || this.count >= MAX_OBSTACLES) return;
    this.ahead[this.count] = ahead;
    this.lateral[this.count] = lateral;
    this.soft[this.count] = soft ? 1 : 0;
    this.count++;
  }

  /** A rival `ahead` m on the nose (negative: behind) that has committed to a lane, which then counts as taken for this car. */
  noteRival(id: number, ahead: number): void {
    if (this.commitFor[id]! <= 0 || Math.abs(ahead) > TAKEN_WINDOW || this.rivals >= MAX_RIVALS) return;
    this.rivalLateral[this.rivals++] = this.commitLane[id]!;
  }

  /** Whether a stopped car holds the line (`want`) or the lane the car is in now: the plan is a pass. */
  blocks(want: number, lane: number): boolean {
    for (let j = 0; j < this.count; j++) if (Math.abs(this.lateral[j]! - want) < PASS_CLEAR || Math.abs(this.lateral[j]! - lane) < PASS_CLEAR) return true;
    return false;
  }

  /**
   * The lane (m from the road's centre line, within `room` either side) car `i` passes by: `want` is its line, `lane` where it is, `look` its look-ahead
   * (`lookDistance`), `decel` what it can brake at, `top` its top speed, `rate` the speed (m/s) its lane moves at. NaN when every lane is held by a stopped car: it brakes
   * short of them (`speedCap`).
   */
  choose(i: number, want: number, lane: number, room: number, look: number, decel: number, top: number, rate: number): number {
    const step = room > 0 ? (2 * room) / (CANDIDATES - 1) : 0;
    const bias = hash01(i, PASS_SALT) * 2 - 1;
    const centre = this.nearestLateral();
    let best = Number.NaN;
    let bestScore = -Infinity;
    for (let k = 0; k < CANDIDATES; k++) {
      const candidate = room > 0 ? -room + k * step : 0;
      const margin = this.marginAt(candidate, look, room);
      if (margin < 0) continue;
      let score = FREE_W * (this.freeRun(candidate, look) / look) - RISK_W * clamp(1 - margin / PASS_COMFORT, 0, 1) - PATH_W * Math.abs(candidate - want) - LANE_W * Math.abs(candidate - lane);
      score += SPREAD_W * bias * Math.sign(candidate - centre);
      if (this.commitFor[i]! > 0 && Math.abs(candidate - this.commitLane[i]!) < COMMIT_BAND) score += COMMIT_W;
      for (let r = 0; r < this.rivals; r++) if (Math.abs(this.rivalLateral[r]! - candidate) < PASS_CLEAR) score -= TAKEN_W;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    this.speedCap = Number.isNaN(best) ? this.stopSpeed(lane, decel) : this.passSpeed(lane, best, this.marginAt(best, look, room, true), look, top, rate);
    if (!Number.isNaN(best)) {
      this.commitLane[i] = best;
      this.commitFor[i] = COMMIT_S;
    }
    return best;
  }

  /** Room to spare (m) a car in `lane` has beside the stopped cars that do not hold it and the road's edge (`EDGE_SLACK` past `room`), negative when one holds it alongside (`PASS_TAIL` to the nose); `hardOnly` leaves out the soft ones. */
  private marginAt(lane: number, look: number, room: number, hardOnly = false): number {
    let margin = Math.min(PASS_COMFORT, room - Math.abs(lane) + EDGE_SLACK);
    for (let j = 0; j < this.count; j++) {
      if (hardOnly && this.soft[j] === 1) continue;
      const gap = Math.abs(this.lateral[j]! - lane) - PASS_CLEAR;
      if (gap < 0 && this.ahead[j]! <= 0.5) return -1;
      if (gap >= 0 && this.ahead[j]! < look && gap < margin) margin = gap;
    }
    return margin;
  }

  /** The run (m, up to `look`) ahead in `lane` before the first stopped car that holds it. */
  private freeRun(lane: number, look: number): number {
    let free = look;
    for (let j = 0; j < this.count; j++) if (Math.abs(this.lateral[j]! - lane) < PASS_CLEAR && this.ahead[j]! > 0.5 && this.ahead[j]! < free) free = this.ahead[j]!;
    return free;
  }

  /** The lateral (m) of the nearest stopped car ahead: the side a lane is on is judged against it. */
  private nearestLateral(): number {
    let nearest = Infinity;
    let lateral = 0;
    for (let j = 0; j < this.count; j++) {
      if (this.ahead[j]! > 0 && this.ahead[j]! < nearest) {
        nearest = this.ahead[j]!;
        lateral = this.lateral[j]!;
      }
    }
    return lateral;
  }

  /** Distance (m) to the first stopped car holding `lane`, Infinity when none; `hardOnly` leaves out the soft ones. */
  private nearestIn(lane: number, hardOnly: boolean): number {
    let nearest = Infinity;
    for (let j = 0; j < this.count; j++) {
      if (hardOnly && this.soft[j] === 1) continue;
      if (Math.abs(this.lateral[j]! - lane) < PASS_CLEAR && this.ahead[j]! > 0.5 && this.ahead[j]! < nearest) nearest = this.ahead[j]!;
    }
    return nearest;
  }

  /** The speed a pass by `target` allows: the lane change done `NOSE_GAP` short of the car in the way, a tight gap slower, never under `PASS_FLOOR`. */
  private passSpeed(lane: number, target: number, margin: number, look: number, top: number, rate: number): number {
    const shift = Math.abs(target - lane);
    const blocker = this.nearestIn(lane, true);
    let cap = top - TIGHT_SHARE * (top - PASS_FLOOR) * (1 - clamp(margin / PASS_COMFORT, 0, 1));
    if (shift > SHORT_MOVE && blocker < look) cap = Math.min(cap, Math.max(PASS_FLOOR, ((blocker - NOSE_GAP) * rate) / shift));
    return cap;
  }

  /** The speed that still stops `STOP_BUFFER` short of the first stopped car in `lane` at `decel`. */
  private stopSpeed(lane: number, decel: number): number {
    const blocker = this.nearestIn(lane, false);
    return Math.sqrt(2 * decel * Math.max(0, blocker - STOP_BUFFER));
  }
}
