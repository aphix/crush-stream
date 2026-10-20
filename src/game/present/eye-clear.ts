import type * as THREE from "three";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { CAR_HALF } from "../vehicle/car-mesh.ts";
import { boxEntry, CINE, gather, inside, solid, type Occluder, type Sight } from "./spectate-cam.ts";
import { Spring } from "./spring.ts";

/** Sight-line samples are `STEP` m apart, each `CINE.pad` (half a step) clear of every solid, so a line never slips between two. */
const STEP = 2 * CINE.pad;
/** The part of a line within this of the subject is the subject's own: it may be touching a wall or a car. */
const OWN = CINE.stop;
const BISECT = 6;
/** Turns tried round the subject, `SWING_STEP` apart up to a half turn. */
const SWING_STEP = Math.PI / 12;
const SWING_STEPS = 12;
/** An eye pulled in closer than a car's length to its subject swings round it instead. */
const SWING_BELOW = 2 * CAR_HALF.z;
/** After a search that found no turn with room, the next waits this long (s). */
const SEARCH_RETRY = 0.25;
/** Rates (1/s) at which a pull-in eases back out and the swing's spring settles on its turn, and the fastest (m/s) the pull-in lets go. */
const PULL_OMEGA = 8;
const SWING_OMEGA = 5;
const PULL_OUT_SPEED = 4;
/** The eye never stands more than this much (m) closer than the line needs, however fast the rig's own eye came in. */
const PULL_LAG_MAX = 3;
/** A pull-in this short (m) is none. */
const PULL_NONE = 1e-3;
/** The steepest (rad above level) a chase line looks down on its car: the drive rig's clamp, and as high as a lift over a car turns it. */
export const STEEPEST = 1.25;
/** Lifts tried evenly up to `STEEPEST` before the least clear one is bisected (to 1/2^`LIFT_BISECT` of a try, under 3 mm at the chase's 8 m), so a roof over the steepest (a tunnel's) still leaves a lower lift. */
const LIFT_TRIES = 8;
const LIFT_BISECT = 9;

type Vec3 = { x: number; y: number; z: number };

/**
 * Keeps a camera's line of sight to its subject clear of the scene's solids and of the cars' boxes. A car on the line (its box,
 * not just within `CINE.pad` of the line) lifts the eye over it: the line turns up about the subject to the least lift that
 * clears (at once as the car closes, eased back down). Past that, and for every other solid, the eye is pulled in along the
 * line to just short of the first solid on it (at once, eased back out), and when that leaves less than a car's length it
 * swings round the subject, about its vertical axis, to the nearest turn with room, eased so it never pops. The eye never ends
 * inside a solid. The rig's own spring is untouched, and where nothing is in the way the eye is exactly the rig's. No allocation.
 */
export class EyeClear {
  private pull = 0;
  /** The eased lift (rad) over the cars on the line. */
  private lift = 0;
  private readonly swing = new Spring();
  private swingTo = 0;
  private cooldown = 0;
  private sight: Sight | null = null;
  private boxes: readonly Occluder[] = [];
  private near: readonly Occluder[] = [];
  private sx = 0;
  private sy = 0;
  private sz = 0;
  /** The rig's line out to the eye, and the line the eye stands on (the rig's, lifted: `aim`). */
  private rx = 0;
  private ry = 0;
  private rz = 0;
  private dx = 0;
  private dy = 0;
  private dz = 0;
  private len = 0;

  reset(): void {
    this.pull = 0;
    this.lift = 0;
    this.swing.snap(0);
    this.swingTo = 0;
    this.cooldown = 0;
  }

  /**
   * Move `eye` (the rig's, `subject`'s line out to it) clear of `s` and of `boxes`, `dt` s after the last call. `dt` Infinity:
   * no easing, so the eye depends on where it stands alone.
   */
  apply(s: Sight, boxes: readonly Occluder[], subject: Vec3, eye: THREE.Vector3, dt: number): void {
    const reachOut = hypot3(eye.x - subject.x, eye.y - subject.y, eye.z - subject.z);
    if (reachOut < PULL_NONE) return;
    this.sight = s;
    this.boxes = boxes;
    this.sx = subject.x;
    this.sz = subject.z;
    this.near = gather(s, this.sx - reachOut, this.sz - reachOut, this.sx + reachOut, this.sz + reachOut, CINE.pad);
    const sy = this.clearAbove(subject.y, reachOut);
    if (sy !== sy) return;
    this.sy = sy;
    this.rx = eye.x - subject.x;
    this.ry = eye.y - sy;
    this.rz = eye.z - subject.z;
    const len = hypot3(this.rx, this.ry, this.rz);
    if (len < PULL_NONE) return;
    this.len = len;
    if (len > reachOut) this.near = gather(s, this.sx - len, this.sz - len, this.sx + len, this.sz + len, CINE.pad);

    const over = this.liftOver();
    this.lift = over >= this.lift ? over : over + (this.lift - over) * Math.exp(-PULL_OMEGA * dt);
    if (this.lift * len < PULL_NONE) this.lift = 0;
    this.aim(this.lift);

    const need = Math.min(SWING_BELOW, len);
    const straight = this.reach(0);
    this.cooldown -= dt;
    if (this.swingTo === 0) {
      if (straight < need && this.cooldown <= 0) this.chooseSwing(need);
    } else if (straight >= len) {
      this.swingTo = 0;
    } else if (this.cooldown <= 0 && this.reach(this.swingTo) < need) {
      this.chooseSwing(need);
    }
    if (dt === Infinity) this.swing.snap(this.swingTo);
    else this.swing.step(this.swingTo, SWING_OMEGA, dt);
    if (this.swingTo === 0 && Math.abs(this.swing.x) < PULL_NONE && Math.abs(this.swing.v) < PULL_NONE) this.swing.snap(0);

    const turn = this.swing.x;
    const clear = turn === 0 ? straight : this.reach(turn);
    const pulledIn = len - clear;
    this.pull = pulledIn >= this.pull ? pulledIn : Math.max(pulledIn, this.pull - Math.min(this.pull * (1 - Math.exp(-PULL_OMEGA * dt)), PULL_OUT_SPEED * dt));
    this.pull = Math.min(this.pull, pulledIn + PULL_LAG_MAX);
    if (this.pull < PULL_NONE) this.pull = 0;
    if (this.pull === 0 && turn === 0 && this.lift === 0) return;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const k = (len - this.pull) / len;
    eye.set(this.sx + (this.dx * c + this.dz * sn) * k, this.sy + this.dy * k, this.sz + (this.dz * c - this.dx * sn) * k);
  }

  /**
   * The line's pivot: `y` over the subject, or for a subject inside a solid (a car in a ramp or a deck's slab, a look under a slope) the
   * first height above it that stands clear, so the pull never closes on the subject itself. NaN: none within `reach` m up (the rig's eye stays).
   */
  private clearAbove(y: number, reach: number): number {
    const s = this.sight!;
    if (!solid(s, this.sx, y, this.sz, 0, this.near)) return y;
    for (let up = CINE.pad; up <= reach; up += CINE.pad) if (!solid(s, this.sx, y + up, this.sz, CINE.pad, this.near)) return y + up;
    return NaN;
  }

  /** The turn (rad) nearest the rig's, on the side it already turned if equal, with at least `need` m of clear line; else the one with most. */
  private chooseSwing(need: number): void {
    const side = this.swingTo < 0 ? -1 : 1;
    let best = -1;
    let bestTurn = 0;
    for (let k = 1; k <= SWING_STEPS; k++) {
      const first = this.reach(side * k * SWING_STEP);
      const second = this.reach(-side * k * SWING_STEP);
      const turn = (second > first ? -side : side) * k * SWING_STEP;
      const room = Math.max(first, second);
      if (room >= need) {
        this.swingTo = turn;
        return;
      }
      if (room > best) {
        best = room;
        bestTurn = turn;
      }
    }
    this.swingTo = bestTurn;
    this.cooldown = SEARCH_RETRY;
  }

  /**
   * The least lift (rad, up to `STEEPEST`) that takes the rig's line over every car on it and clear of the solids too: 0 when
   * no car is on it, a solid stops it nearer the subject than the first car (the walls' rule), or no lift clears it.
   */
  private liftOver(): number {
    this.aim(0);
    const len = this.len;
    const ux = this.dx / len;
    const uy = this.dy / len;
    const uz = this.dz / len;
    const car = this.carReach(ux, uy, uz);
    if (car >= len || this.march(ux, uy, uz) < car) return 0;
    const h = hypot2(this.rx, this.rz);
    const room = STEEPEST - Math.atan2(this.ry, h);
    if (h < PULL_NONE || room <= 0) return 0;
    let lo = 0;
    let hi = 0;
    for (let k = 1; k <= LIFT_TRIES; k++) {
      const at = (room * k) / LIFT_TRIES;
      this.aim(at);
      if (this.reach(0) >= len) {
        hi = at;
        break;
      }
      lo = at;
    }
    if (hi === 0) return 0;
    for (let i = 0; i < LIFT_BISECT; i++) {
      const mid = (lo + hi) / 2;
      this.aim(mid);
      if (this.reach(0) >= len) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** Sets the eye's line (`dx`, `dy`, `dz`) to the rig's turned up `lift` rad about the subject, toward the vertical. */
  private aim(lift: number): void {
    if (lift === 0) {
      this.dx = this.rx;
      this.dy = this.ry;
      this.dz = this.rz;
      return;
    }
    const h = hypot2(this.rx, this.rz);
    const up = Math.atan2(this.ry, h) + lift;
    const k = (this.len * Math.cos(up)) / h;
    this.dx = this.rx * k;
    this.dy = this.len * Math.sin(up);
    this.dz = this.rz * k;
  }

  /** How far (m, at most `len`) the line from the subject, turned `turn` rad about the vertical, runs clear of every solid and car. */
  private reach(turn: number): number {
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const ux = (this.dx * c + this.dz * sn) / this.len;
    const uy = this.dy / this.len;
    const uz = (this.dz * c - this.dx * sn) / this.len;
    return Math.min(this.march(ux, uy, uz), this.carReach(ux, uy, uz));
  }

  /** How far (m, at most `len`) the line from the subject along the unit (`ux`, `uy`, `uz`) runs clear of the scene's solids. */
  private march(ux: number, uy: number, uz: number): number {
    const s = this.sight!;
    let lo = 0;
    let d = OWN;
    for (;;) {
      const at = Math.min(d, this.len);
      if (solid(s, this.sx + ux * at, this.sy + uy * at, this.sz + uz * at, CINE.pad, this.near)) {
        let hi = at;
        for (let i = 0; i < BISECT; i++) {
          const mid = (lo + hi) / 2;
          if (solid(s, this.sx + ux * mid, this.sy + uy * mid, this.sz + uz * mid, CINE.pad, this.near)) hi = mid;
          else lo = mid;
        }
        return lo;
      }
      if (at >= this.len) return this.len;
      lo = at;
      d += STEP;
    }
  }

  /**
   * How far (m, at most `len`) the same line runs before a car: one whose box stands on it past the subject's own part, or within
   * `CINE.pad` of the eye at its end, stops it `CINE.pad` short of the box. A box the line only passes within `CINE.pad` of hides nothing.
   */
  private carReach(ux: number, uy: number, uz: number): number {
    const len = this.len;
    let reach = len;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const o = boxes[i]!;
      if (boxEntry(o, this.sx, this.sy, this.sz, ux, uy, uz, OWN, len, 0) === Infinity && !inside(o, this.sx + ux * len, this.sy + uy * len, this.sz + uz * len, CINE.pad)) continue;
      reach = Math.min(reach, Math.max(0, boxEntry(o, this.sx, this.sy, this.sz, ux, uy, uz, 0, len, CINE.pad)));
    }
    return reach;
  }
}
