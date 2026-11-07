import { MAX_CARS } from "../scenes/fleet.ts";
import { clamp, hash01 } from "../kernel/scalar.ts";

/** Most stopped cars a plan weighs at once (a pile), and most committed rivals it weighs a candidate lane against. */
const MAX_OBSTACLES = 12;
const MAX_RIVALS = 8;
/** Candidate lanes: the edges, the wanted line, the current lane and four around every stopped car (`fillCandidates`). */
const MAX_CANDIDATES = 4 + 4 * MAX_OBSTACLES;
/** Margins closer than this (m) tie in the blockade gap choice. */
const TIE = 1e-6;
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
  private readonly candidates = new Float64Array(MAX_CANDIDATES);
  /** The speed (m/s) a pass allows the car: Infinity, a pass is driven on the gas. */
  speedCap = Infinity;
  /** Whether the last `choose` found every lane held and fell back to the biggest gap. */
  blockaded = false;

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
    if (ahead <= -PASS_TAIL) return;
    let slot = this.count;
    if (slot >= MAX_OBSTACLES) {
      // Full: the nearest wrecks are never dropped, so a nearer one takes the place of the farthest-ahead note.
      slot = 0;
      for (let j = 1; j < MAX_OBSTACLES; j++) if (this.ahead[j]! > this.ahead[slot]!) slot = j;
      if (this.ahead[slot]! <= ahead) return;
    } else this.count++;
    this.ahead[slot] = ahead;
    this.lateral[slot] = lateral;
    this.soft[slot] = soft ? 1 : 0;
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
   * (`lookDistance`). When stopped cars hold every lane alongside it is the one with the biggest gap (ties: nearest `want`): the car gasses at it, never brakes short.
   */
  choose(i: number, want: number, lane: number, room: number, look: number): number {
    const n = this.fillCandidates(want, lane, room);
    const bias = hash01(i, PASS_SALT) * 2 - 1;
    const centre = this.nearestLateral();
    let best = Number.NaN;
    let bestScore = -Infinity;
    let gapLane = Number.NaN;
    let gapMargin = -Infinity;
    for (let k = 0; k < n; k++) {
      const candidate = this.candidates[k]!;
      const margin = this.marginAt(candidate, look, room);
      if (margin < 0) {
        if (margin > gapMargin + TIE || (margin > gapMargin - TIE && Math.abs(candidate - want) < Math.abs(gapLane - want))) {
          gapMargin = margin;
          gapLane = candidate;
        }
        continue;
      }
      const free = this.freeRun(candidate, look);
      let score = FREE_W * (free / look) - RISK_W * clamp(1 - margin / PASS_COMFORT, 0, 1) - PATH_W * Math.abs(candidate - want) - LANE_W * Math.abs(candidate - lane);
      score += SPREAD_W * bias * Math.sign(candidate - centre);
      // A committed lane a stopped car now holds is no longer worth keeping: the commitment outweighed a lane held 6 m on and drove a racer into it.
      if (free === look && this.commitFor[i]! > 0 && Math.abs(candidate - this.commitLane[i]!) < COMMIT_BAND) score += COMMIT_W;
      for (let r = 0; r < this.rivals; r++) if (Math.abs(this.rivalLateral[r]! - candidate) < PASS_CLEAR) score -= TAKEN_W;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    this.blockaded = Number.isNaN(best);
    if (this.blockaded) best = gapLane;
    this.commitLane[i] = best;
    this.commitFor[i] = COMMIT_S;
    return best;
  }

  /** Room to spare (m) a car in `lane` has beside the stopped cars that do not hold it and the road's edge (`EDGE_SLACK` past `room`); negative, the deepest overlap (m), when stopped cars hold it, alongside or ahead within `look` (`PASS_TAIL` to the nose): a lane with a wreck in it is not a way through. */
  private marginAt(lane: number, look: number, room: number): number {
    let margin = Math.min(PASS_COMFORT, room - Math.abs(lane) + EDGE_SLACK);
    let held = 0;
    for (let j = 0; j < this.count; j++) {
      if (this.ahead[j]! >= look) continue;
      const gap = Math.abs(this.lateral[j]! - lane) - PASS_CLEAR;
      if (gap < 0) held = Math.min(held, gap);
      else if (gap < margin) margin = gap;
    }
    return held < 0 ? held : margin;
  }

  /** Fills `candidates` with the edges, the wanted line, the current lane and a clear and a comfortable gap either side of every stopped car, all within `room`; returns how many. */
  private fillCandidates(want: number, lane: number, room: number): number {
    const c = this.candidates;
    let n = 0;
    c[n++] = clamp(want, -room, room);
    c[n++] = clamp(lane, -room, room);
    c[n++] = -room;
    c[n++] = room;
    for (let j = 0; j < this.count; j++) {
      const at = this.lateral[j]!;
      c[n++] = clamp(at - PASS_CLEAR, -room, room);
      c[n++] = clamp(at + PASS_CLEAR, -room, room);
      c[n++] = clamp(at - PASS_CLEAR - PASS_COMFORT, -room, room);
      c[n++] = clamp(at + PASS_CLEAR + PASS_COMFORT, -room, room);
    }
    return n;
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
}
