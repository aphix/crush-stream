import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { sightLine, type Sight } from "./spectate-cam.ts";

/** How far (m) the eye may move from where a car was found hidden before it counts visible again: a solid's corner a metres from the eye swings the line at the car by s · distance / a. */
const EYE_MOVE_M = 0.1;
/** How far (m) a car may move from where it was found hidden before that is read again. */
const CAR_MOVE_M = 0.25;
/** Frames a car found visible is taken for visible wherever it and the eye go, without a test: a visible verdict only costs a missed skip, so it needs no bound. */
const RECHECK_FRAMES = 6;
/** Cars tested a frame (each up to four sight lines); the rest count visible until their turn, so the cost of the test is capped. */
const TESTS_PER_FRAME = 6;
/** A camera that moves this far (m) or turns this much (cosine of the angle) between two reads has cut: no verdict survives it. */
const CUT_M = 6;
const CUT_COS = Math.cos((15 * Math.PI) / 180);
/** Floats a car's verdict keeps: where the eye and the car stood when it was found (x, y, z each) and the frame. */
const KEPT = 7;
const NONE = 0;
const VISIBLE = 1;
const HIDDEN = 2;

/**
 * Which cars no camera can see for a solid: every sight line from the eye to the car's sphere (its centre, top and both sides across the view) is blocked (`sightLine`).
 * A hidden verdict stands only while the eye and the car stay put (`EYE_MOVE_M`, `CAR_MOVE_M`) and no cut came; a car without one, or past its test budget, counts visible.
 */
export class CarCover {
  /** Totals since construction, for the bench and probes: cars tested, sight-line samples taken, ms spent. */
  tests = 0;
  samples = 0;
  ms = 0;
  private kept = new Float64Array(0);
  private verdict = new Uint8Array(0);
  private budget = 0;
  private frame = 0;
  private cutFrame = -1;
  private seen = false;
  private readonly eye = new Float64Array(3);
  private readonly view = new Float64Array(3);

  /** Reads the camera's eye and view direction; `newFrame` opens a frame's test budget. A jump of the camera since the last read is a cut: every verdict goes, and every car is visible for the rest of the frame. */
  aim(ex: number, ey: number, ez: number, vx: number, vy: number, vz: number, newFrame: boolean): void {
    if (newFrame) {
      this.frame++;
      this.budget = TESTS_PER_FRAME;
    }
    const e = this.eye;
    const v = this.view;
    if (this.seen && (hypot3(ex - e[0]!, ey - e[1]!, ez - e[2]!) > CUT_M || vx * v[0]! + vy * v[1]! + vz * v[2]! < CUT_COS)) {
      this.verdict.fill(NONE);
      this.cutFrame = this.frame;
    }
    e[0] = ex;
    e[1] = ey;
    e[2] = ez;
    v[0] = vx;
    v[1] = vy;
    v[2] = vz;
    this.seen = true;
  }

  /** Whether car `i`, a sphere of `radius` m at (cx, cy, cz), is wholly behind `sight`'s solids from the last `aim`. */
  hidden(i: number, sight: Sight, cx: number, cy: number, cz: number, radius: number): boolean {
    if (this.cutFrame === this.frame) return false;
    if ((i + 1) * KEPT > this.kept.length) this.grow(i);
    const k = i * KEPT;
    const { kept, eye } = this;
    const state = this.verdict[i]!;
    if (state === VISIBLE && this.frame - kept[k + 6]! < RECHECK_FRAMES) return false;
    if (state === HIDDEN && hypot3(eye[0]! - kept[k]!, eye[1]! - kept[k + 1]!, eye[2]! - kept[k + 2]!) < EYE_MOVE_M && hypot3(cx - kept[k + 3]!, cy - kept[k + 4]!, cz - kept[k + 5]!) < CAR_MOVE_M) return true;
    if (this.budget === 0) return false;
    this.budget--;
    const t0 = performance.now();
    const hidden = this.test(sight, cx, cy, cz, radius);
    kept[k] = eye[0]!;
    kept[k + 1] = eye[1]!;
    kept[k + 2] = eye[2]!;
    kept[k + 3] = cx;
    kept[k + 4] = cy;
    kept[k + 5] = cz;
    kept[k + 6] = this.frame;
    this.verdict[i] = hidden ? HIDDEN : VISIBLE;
    this.ms += performance.now() - t0;
    return hidden;
  }

  private grow(i: number): void {
    const cars = Math.max(i + 1, 2 * (this.verdict.length || 8));
    const kept = new Float64Array(cars * KEPT);
    kept.set(this.kept);
    const verdict = new Uint8Array(cars);
    verdict.set(this.verdict);
    this.kept = kept;
    this.verdict = verdict;
  }

  /** Every line to the sphere's centre, top and two sides across the view is blocked; the first clear one ends the test. */
  private test(sight: Sight, cx: number, cy: number, cz: number, radius: number): boolean {
    this.tests++;
    const { eye } = this;
    const dx = cx - eye[0]!;
    const dz = cz - eye[2]!;
    const across = radius / (hypot2(dx, dz) || 1);
    return this.blocked(sight, cx, cy, cz) && this.blocked(sight, cx, cy + radius, cz) && this.blocked(sight, cx - dz * across, cy, cz + dx * across) && this.blocked(sight, cx + dz * across, cy, cz - dx * across);
  }

  private blocked(sight: Sight, x: number, y: number, z: number): boolean {
    const { eye } = this;
    const n = sightLine(sight, eye[0]!, eye[1]!, eye[2]!, x, y, z);
    this.samples += Math.abs(n);
    return n < 0;
  }
}
