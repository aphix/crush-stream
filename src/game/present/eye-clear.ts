import type * as THREE from "three";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import type { DeformableCar } from "../vehicle/car.ts";
import { FLEET_HALF } from "../vehicle/car-rig.ts";
import { boxHit, CINE, gatherIn, inside, type Occluder, type Sight, solidAt } from "./spectate-cam.ts";
import { NEAR_BOX, NEAR_PAD, NEAR_X0, NEAR_X1, NEAR_Z0, NEAR_Z1, PROBE, PROBE_PAD, PROBE_X, PROBE_Y, PROBE_Z, RAY, RAY_FROM, RAY_PAD, RAY_T, RAY_TO, RAY_VX, RAY_VY, RAY_VZ, RAY_X, RAY_Y, RAY_Z } from "./sight-scratch.ts";
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
const SWING_BELOW = 2 * FLEET_HALF.z;
/** After a search that found no turn with room, the next waits this long (s). */
const SEARCH_RETRY = 0.25;
/** Rates (1/s) at which a lift over a car eases back down and the swing's spring settles on its turn, and the fastest (m/s) the pull-in lets go. */
const PULL_OMEGA = 8;
const SWING_OMEGA = 5;
const PULL_OUT_SPEED = 4;
/** A pull-in lets go at this rate (1/s): GTA's 0.92 per 1/50 s step, a 0.24 s time constant (.extraResearch/third-person-camera-and-controls.md). */
export const LET_GO_OMEGA = 1 / 0.24;
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

/** Room (m) a chase eye keeps from its own car's body: GTA's near-plane slack (.extraResearch/third-person-camera-and-controls.md). */
const BODY_PAD = 0.3;

/**
 * GTA's `maxAlphaAllowed` (.extraResearch/third-person-camera-and-controls.md): an `eye` inside its own car's box (floor to roof, grown by `BODY_PAD`) turns up
 * about the pivot `pivotY` over the car's origin to the lowest pitch that clears the roof, or straight up over it when its boom is too short to.
 */
export function outOfBody(eye: THREE.Vector3, car: DeformableCar, pivotY: number): void {
  const p = car.group.position;
  const half = car.frame.half;
  const ex = eye.x - p.x;
  const ez = eye.z - p.z;
  const cos = car.fwdFlat.z;
  const sin = car.fwdFlat.x;
  const top = p.y + 2 * half.y + BODY_PAD;
  if (eye.y >= top || eye.y < p.y - BODY_PAD || Math.abs(ex * cos - ez * sin) >= half.x + BODY_PAD || Math.abs(ex * sin + ez * cos) >= half.z + BODY_PAD) return;
  const flat = hypot2(ex, ez);
  const rise = top - (p.y + pivotY);
  const boom = hypot2(flat, eye.y - (p.y + pivotY));
  const k = boom > rise && flat > PULL_NONE ? Math.sqrt(boom * boom - rise * rise) / flat : 1;
  eye.set(p.x + ex * k, top, p.z + ez * k);
}

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
  /** `liftOver`'s answer, the lift `aim` turns the line up by, the clear length a swing needs and the flat reach `gatherAround` takes (m). */
  private over = 0;
  private liftAsk = 0;
  private need = 0;
  private around = 0;
  /** The rig's line's flat length (m), `aim`'s: worked out once a frame where a lift needs it, not once a try. */
  private rh = 0;
  /** The line `march`, `carReach` and `reach` take (a unit way, a turn) and what they find (m): fields, as a double across a call that is not inlined boxes. */
  private ux = 0;
  private uy = 0;
  private uz = 0;
  private turnAsk = 0;
  private reached = 0;
  private marched = 0;
  private carClear = 0;

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
    this.around = reachOut;
    this.near = this.gatherAround(s);
    const sy = this.clearAbove(subject.y, reachOut);
    if (sy !== sy) return;
    this.sy = sy;
    this.rx = eye.x - subject.x;
    this.ry = eye.y - sy;
    this.rz = eye.z - subject.z;
    // A pivot at the subject's own height is the line already measured.
    const len = sy === subject.y ? reachOut : hypot3(this.rx, this.ry, this.rz);
    if (len < PULL_NONE) return;
    this.len = len;
    if (len > reachOut) {
      this.around = len;
      this.near = this.gatherAround(s);
    }

    this.liftOver();
    const over = this.over;
    this.lift = over >= this.lift ? over : over + (this.lift - over) * Math.exp(-PULL_OMEGA * dt);
    if (this.lift * len < PULL_NONE) this.lift = 0;
    this.liftAsk = this.lift;
    if (this.lift !== 0 && this.over === 0) this.rh = hypot2(this.rx, this.rz);
    this.aim();

    this.need = Math.min(SWING_BELOW, len);
    this.turnAsk = 0;
    this.reach();
    const straight = this.reached;
    this.cooldown -= dt;
    if (this.swingTo === 0) {
      if (straight < this.need && this.cooldown <= 0) this.chooseSwing();
    } else if (straight >= len) {
      this.swingTo = 0;
    } else if (this.cooldown <= 0) {
      this.turnAsk = this.swingTo;
      this.reach();
      if (this.reached < this.need) this.chooseSwing();
    }
    if (dt === Infinity) this.swing.snap(this.swingTo);
    else this.swing.step(this.swingTo, SWING_OMEGA, dt);
    if (this.swingTo === 0 && Math.abs(this.swing.x) < PULL_NONE && Math.abs(this.swing.v) < PULL_NONE) this.swing.snap(0);

    const turn = this.swing.x;
    this.turnAsk = turn;
    if (turn !== 0) this.reach();
    const clear = turn === 0 ? straight : this.reached;
    const pulledIn = len - clear;
    this.pull = pulledIn >= this.pull ? pulledIn : Math.max(pulledIn, this.pull - Math.min(this.pull * (1 - Math.exp(-LET_GO_OMEGA * dt)), PULL_OUT_SPEED * dt));
    this.pull = Math.min(this.pull, pulledIn + PULL_LAG_MAX);
    if (this.pull < PULL_NONE) this.pull = 0;
    if (this.pull === 0 && turn === 0 && this.lift === 0) return;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const k = (len - this.pull) / len;
    eye.set(this.sx + (this.dx * c + this.dz * sn) * k, this.sy + this.dy * k, this.sz + (this.dz * c - this.dx * sn) * k);
  }

  /** The solids within `around` m (flat) of the subject, `CINE.pad` grown (`gatherIn`). */
  private gatherAround(s: Sight): readonly Occluder[] {
    const r = this.around;
    NEAR_BOX[NEAR_X0] = this.sx - r;
    NEAR_BOX[NEAR_Z0] = this.sz - r;
    NEAR_BOX[NEAR_X1] = this.sx + r;
    NEAR_BOX[NEAR_Z1] = this.sz + r;
    NEAR_BOX[NEAR_PAD] = CINE.pad;
    return gatherIn(s);
  }

  /**
   * The line's pivot: `y` over the subject, or for a subject inside a solid (a car in a ramp or a deck's slab, a look under a slope) the
   * first height above it that stands clear, so the pull never closes on the subject itself. NaN: none within `reach` m up (the rig's eye stays).
   */
  private clearAbove(y: number, reach: number): number {
    const s = this.sight!;
    PROBE[PROBE_X] = this.sx;
    PROBE[PROBE_Y] = y;
    PROBE[PROBE_Z] = this.sz;
    PROBE[PROBE_PAD] = 0;
    if (!solidAt(s, this.near, true)) return y;
    PROBE[PROBE_PAD] = CINE.pad;
    for (let up = CINE.pad; up <= reach; up += CINE.pad) {
      PROBE[PROBE_Y] = y + up;
      if (!solidAt(s, this.near, true)) return y + up;
    }
    return NaN;
  }

  /** The turn (rad) nearest the rig's, on the side it already turned if equal, with at least `need` m of clear line; else the one with most. */
  private chooseSwing(): void {
    const need = this.need;
    const side = this.swingTo < 0 ? -1 : 1;
    let best = -1;
    let bestTurn = 0;
    for (let k = 1; k <= SWING_STEPS; k++) {
      this.turnAsk = side * k * SWING_STEP;
      this.reach();
      const first = this.reached;
      this.turnAsk = -side * k * SWING_STEP;
      this.reach();
      const second = this.reached;
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
   * The least lift (rad, up to `STEEPEST`, into `over`) that takes the rig's line over every car on it and clear of the solids too: 0 when
   * no car is on it, a solid stops it nearer the subject than the first car (the walls' rule), or no lift clears it.
   */
  private liftOver(): void {
    this.over = 0;
    this.liftAsk = 0;
    this.aim();
    const len = this.len;
    this.ux = this.dx / len;
    this.uy = this.dy / len;
    this.uz = this.dz / len;
    this.carReach();
    if (this.carClear >= len) return;
    this.march();
    if (this.marched < this.carClear) return;
    this.rh = hypot2(this.rx, this.rz);
    const h = this.rh;
    const room = STEEPEST - Math.atan2(this.ry, h);
    if (h < PULL_NONE || room <= 0) return;
    let lo = 0;
    let hi = 0;
    this.turnAsk = 0;
    for (let k = 1; k <= LIFT_TRIES; k++) {
      const at = (room * k) / LIFT_TRIES;
      this.liftAsk = at;
      this.aim();
      this.reach();
      if (this.reached >= len) {
        hi = at;
        break;
      }
      lo = at;
    }
    if (hi === 0) return;
    for (let i = 0; i < LIFT_BISECT; i++) {
      const mid = (lo + hi) / 2;
      this.liftAsk = mid;
      this.aim();
      this.reach();
      if (this.reached >= len) hi = mid;
      else lo = mid;
    }
    this.over = hi;
  }

  /** Sets the eye's line (`dx`, `dy`, `dz`) to the rig's turned up `liftAsk` rad about the subject, toward the vertical. */
  private aim(): void {
    const lift = this.liftAsk;
    if (lift === 0) {
      this.dx = this.rx;
      this.dy = this.ry;
      this.dz = this.rz;
      return;
    }
    const h = this.rh;
    const up = Math.atan2(this.ry, h) + lift;
    const k = (this.len * Math.cos(up)) / h;
    this.dx = this.rx * k;
    this.dy = this.len * Math.sin(up);
    this.dz = this.rz * k;
  }

  /** How far (m, at most `len`, into `reached`) the line from the subject, turned `turnAsk` rad about the vertical, runs clear of every solid and car. */
  private reach(): void {
    const c = Math.cos(this.turnAsk);
    const sn = Math.sin(this.turnAsk);
    this.ux = (this.dx * c + this.dz * sn) / this.len;
    this.uy = this.dy / this.len;
    this.uz = (this.dz * c - this.dx * sn) / this.len;
    this.march();
    this.carReach();
    this.reached = Math.min(this.marched, this.carClear);
  }

  /** How far (m, at most `len`, into `marched`) the line from the subject along the unit `u` runs clear of the scene's solids. */
  private march(): void {
    const s = this.sight!;
    const ux = this.ux;
    const uy = this.uy;
    const uz = this.uz;
    PROBE[PROBE_PAD] = CINE.pad;
    let lo = 0;
    let d = OWN;
    for (;;) {
      const at = Math.min(d, this.len);
      PROBE[PROBE_X] = this.sx + ux * at;
      PROBE[PROBE_Y] = this.sy + uy * at;
      PROBE[PROBE_Z] = this.sz + uz * at;
      if (solidAt(s, this.near, true)) {
        let hi = at;
        for (let i = 0; i < BISECT; i++) {
          const mid = (lo + hi) / 2;
          PROBE[PROBE_X] = this.sx + ux * mid;
          PROBE[PROBE_Y] = this.sy + uy * mid;
          PROBE[PROBE_Z] = this.sz + uz * mid;
          if (solidAt(s, this.near, true)) hi = mid;
          else lo = mid;
        }
        this.marched = lo;
        return;
      }
      if (at >= this.len) {
        this.marched = this.len;
        return;
      }
      lo = at;
      d += STEP;
    }
  }

  /**
   * How far (m, at most `len`, into `carClear`) the line `u` runs before a car: one whose box stands on it past the subject's own part, or within
   * `CINE.pad` of the eye at its end, stops it `CINE.pad` short of the box. A box the line only passes within `CINE.pad` of hides nothing.
   */
  private carReach(): void {
    const len = this.len;
    let reach = len;
    RAY[RAY_X] = this.sx;
    RAY[RAY_Y] = this.sy;
    RAY[RAY_Z] = this.sz;
    RAY[RAY_VX] = this.ux;
    RAY[RAY_VY] = this.uy;
    RAY[RAY_VZ] = this.uz;
    RAY[RAY_TO] = len;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const o = boxes[i]!;
      RAY[RAY_FROM] = OWN;
      RAY[RAY_PAD] = 0;
      if (!boxHit(o) && !inside(o, this.sx + this.ux * len, this.sy + this.uy * len, this.sz + this.uz * len, CINE.pad)) continue;
      RAY[RAY_FROM] = 0;
      RAY[RAY_PAD] = CINE.pad;
      if (boxHit(o)) reach = Math.min(reach, Math.max(0, RAY[RAY_T]!));
    }
    this.carClear = reach;
  }
}
