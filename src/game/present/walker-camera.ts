import { detAtan, detCos, detSin, hypot3 } from "../kernel/physics-core.js";
import { RUN_SPEED } from "./walker-locomotion.ts";
import { wrapAngle } from "./walker-math.ts";

/**
 * The on-foot camera's numbers, from third-person open-world practice (onfoot-camera research): the pivot at the chest, 60-70° across; the follow smoothed
 * critically damped with its own time for position, height and yaw (0.1-0.4 s), the view coming back behind him after 1-1.5 s without look input. `FOLLOW_RADIUS`
 * (3.5-4.5 m back) is the orbit he is framed on while he climbs back into his car; on his feet the camera is the shoulder rig below.
 */
export const PIVOT_OVER_TORSO = 0.36;
export const FOLLOW_RADIUS = 4.2;
export const FOLLOW_PITCH = 0.3;
/** The lens (deg across the view) he is framed with, and the vertical lens it is held between on a wide and an upright screen. */
const FOLLOW_HORIZONTAL_FOV = 66;
const FOV_MIN = 36;
const FOV_MAX = 56;

/** Smoothing times (s): the focus follows his ground position in this long walking and this long running, his height (the bob) and the yaw coming back behind him. */
const POSITION_TIME_WALK = 0.3;
const POSITION_TIME_RUN = 0.12;
const HEIGHT_TIME = 0.35;
const YAW_TIME = 0.4;
/** The view comes back behind him after this long (s) without look input while he moves faster than this (m/s). */
export const RECENTER_DELAY = 1.2;
const RECENTER_SPEED = 1;
/** The camera comes round behind him only while his facing is within this (rad) of it: it does not chase a sidestep. */
const RECENTER_GAP = 0.9;

/** The enter and exit blend (s): the lens, distance and pitch go to the on-foot shot over this long, 0.2-0.4 s in the research. */
export const BLEND_SECONDS = 0.3;

/** The views on foot that View (V) cycles and the wheel zooms between: over his right shoulder, and through his own eyes. */
export type OnFootView = "shoulder" | "first";

/**
 * The shoulder camera (an over-the-shoulder rig, onfoot-camera research: 1.5-2.2 m back, 0.45-0.7 m out to a shoulder, the eye 1.6-2 m up), close enough
 * that a room's walls stay behind it. The wheel zooms its boom from `SHOULDER_NEAREST` out; one notch nearer is his own eyes (`FIRST_PERSON_RADIUS`, the
 * wheel's nearest on foot, inside the nearest boom).
 */
export const SHOULDER_BOOM = 2.2;
export const SHOULDER_PITCH = 0.2;
/** The nearest boom (m): his shoulders' breadth with the arms (0.58 m) and the camera's ball off his head. */
export const SHOULDER_NEAREST = 0.8;
export const FIRST_PERSON_RADIUS = 0.7;
const SHOULDER_ACROSS = 0.5;
/** The shoulder camera's pivot over the follow point (m): the chest's to the base of his head. */
const SHOULDER_RISE = 0.12;
/** The camera's ball (m): it stands this far off every solid, past the near plane (0.1 m). */
export const CAMERA_RADIUS = 0.2;
/** His head's centre and his eyes over his torso's centre (m: the head box at 1.63 m, the torso's at 1.11 m), and the eyes ahead of the head's centre. */
const HEAD_OVER_TORSO = 0.52;
const EYE_OVER_TORSO = 0.54;
const EYE_AHEAD = 0.1;
/**
 * The nearest the shoulder camera's boom is pulled in by a wall (m), however tight the spot: his head's breadth and the camera's ball clear of him. A wall nearer than this is
 * stood in (a pen, a corridor), but the eye never sits in his head, so a drag round him in a squeeze stays his shoulder view, his head and torso drawn; first person is View's and the wheel's alone.
 */
export const SQUEEZED_BOOM = 0.6;
/** The eyes' height follows his torso's over this long (s): the gait's bob, eased, without lagging a step down a stair. */
const EYE_HEIGHT_TIME = 0.12;
/** A pulled-in camera lets go over this long (s; research 0.15-0.35); it comes in at once. */
const LET_GO_TIME = 0.25;
/** The pitch range (rad, positive: looking down) each view takes: his eyes look up and down; the shoulder camera up less, the floor behind it. */
export const VIEW_PITCH: Record<OnFootView, { low: number; high: number }> = { first: { low: -1.3, high: 1.3 }, shoulder: { low: -0.5, high: 1.22 } };
/** `view.look` stands this far (m) along the camera's way from its eye: the walk reads its heading off the two. */
export const LOOK_AHEAD = SHOULDER_BOOM;

/** How far (m, at most `length`) the camera's ball moves from (x, y, z) along the unit (dx, dy, dz) before it touches a solid (`RagdollSystem.sightClear`). */
export type Sweep = (x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number) => number;
/** The ball stops this far (m) short of what it touched, so the next sweep from there starts clear of it. */
const SKIN = 0.02;

/** A sweep's `reach` (m) out of `length`: all of it when nothing was touched, else short of the touch by `SKIN`. */
function stopShort(reach: number, length: number): number {
  return reach >= length ? length : Math.max(0, reach - SKIN);
}

/** `now` toward `want`: at once when nearer (a solid came in), eased out over `LET_GO_TIME` otherwise; `want` alone with no `now` yet (NaN). */
function letGo(now: number, want: number, dt: number): number {
  if (!(now < Infinity) || want <= now) return want;
  return now + (want - now) * (1 - Math.exp(-dt / LET_GO_TIME));
}

/**
 * Where the on-foot camera stands and the way it looks (`eye`, the unit `ahead`), for the orbit's yaw (the eye at (sin, cos) of it behind its
 * point) and pitch: over his shoulder, pulled in short of every solid its ball would meet on the way from his head out, or through his eyes.
 * `inHead`: the eye is his own (first person), so his head and torso are not drawn to it: never the shoulder camera, however it is pulled in. Nothing allocates.
 */
export class WalkerView {
  readonly eye = new Float64Array(3);
  readonly ahead = new Float64Array(3);
  inHead = false;
  private pivotShare = NaN;
  private across = NaN;
  private boom = NaN;
  private readonly eyeY = new Damped();
  private eyeSeeded = false;

  /** The next view starts where it stands, eased from nothing. */
  reset(): void {
    this.pivotShare = this.across = this.boom = NaN;
    this.eyeSeeded = false;
  }

  /**
   * Over his right shoulder, `length` m of boom from the follow point (`fx`, `fy`, `fz`), his torso drawn at (`tx`, `ty`, `tz`): the ball goes from
   * his head (inside him, so clear) to the pivot, out to the shoulder, then back along the boom, and the eye stands where it stops.
   */
  shoulder(tx: number, ty: number, tz: number, fx: number, fy: number, fz: number, yaw: number, pitch: number, length: number, sweep: Sweep, dt: number): void {
    this.eyeSeeded = false;
    const s = detSin(yaw);
    const c = detCos(yaw);
    const cp = detCos(pitch);
    const sp = detSin(pitch);
    const hx = tx;
    const hy = ty + HEAD_OVER_TORSO;
    const hz = tz;
    const gx = fx - hx;
    const gy = fy + SHOULDER_RISE - hy;
    const gz = fz - hz;
    const gap = hypot3(gx, gy, gz);
    const share = gap > 0 ? stopShort(sweep(hx, hy, hz, gx / gap, gy / gap, gz / gap, gap), gap) / gap : 1;
    this.pivotShare = letGo(this.pivotShare, share, dt);
    const px = hx + gx * this.pivotShare;
    const py = hy + gy * this.pivotShare;
    const pz = hz + gz * this.pivotShare;
    // The camera's right, level: the way (cos, 0, -sin) of its yaw.
    this.across = letGo(this.across, stopShort(sweep(px, py, pz, c, 0, -s, SHOULDER_ACROSS), SHOULDER_ACROSS), dt);
    const ox = px + c * this.across;
    const oz = pz - s * this.across;
    const bx = s * cp;
    const bz = c * cp;
    this.boom = letGo(this.boom, stopShort(sweep(ox, py, oz, bx, sp, bz, length), length), dt);
    const reach = Math.max(this.boom, Math.min(length, SQUEEZED_BOOM));
    this.eye[0] = ox + bx * reach;
    this.eye[1] = py + sp * reach;
    this.eye[2] = oz + bz * reach;
    this.ahead[0] = -bx;
    this.ahead[1] = -sp;
    this.ahead[2] = -bz;
    this.inHead = false;
  }

  /** Through his eyes, his torso drawn at (`tx`, `ty`, `tz`): at his head's height, eased, and a little ahead of its centre unless a wall is nearer. */
  first(tx: number, ty: number, tz: number, yaw: number, pitch: number, sweep: Sweep, dt: number): void {
    this.pivotShare = this.across = this.boom = NaN;
    if (!this.eyeSeeded) this.eyeY.snap(ty + EYE_OVER_TORSO);
    this.eyeSeeded = true;
    const y = this.eyeY.step(ty + EYE_OVER_TORSO, EYE_HEIGHT_TIME, dt);
    const s = detSin(yaw);
    const c = detCos(yaw);
    const cp = detCos(pitch);
    const ahead = stopShort(sweep(tx, y, tz, -s, 0, -c, EYE_AHEAD), EYE_AHEAD);
    this.eye[0] = tx - s * ahead;
    this.eye[1] = y;
    this.eye[2] = tz - c * ahead;
    this.ahead[0] = -s * cp;
    this.ahead[1] = -detSin(pitch);
    this.ahead[2] = -c * cp;
    this.inHead = true;
  }
}

/** A value that follows its target critically damped: no overshoot, `smoothTime` s to close most of the gap (the exact solution, so any step is the same). */
export class Damped {
  x = 0;
  v = 0;

  snap(x: number): void {
    this.x = x;
    this.v = 0;
  }

  step(target: number, smoothTime: number, dt: number): number {
    const w = 2 / smoothTime;
    const decay = Math.exp(-w * dt);
    const gap = this.x - target;
    const push = (this.v + w * gap) * dt;
    this.v = (this.v - w * push) * decay;
    this.x = target + (gap + push) * decay;
    return this.x;
  }
}

/** The vertical lens (deg) for `FOLLOW_HORIZONTAL_FOV` across a view `aspect` wide. */
export function followFov(aspect: number): number {
  const half = (FOLLOW_HORIZONTAL_FOV * Math.PI) / 360;
  const vertical = (2 * detAtan(Math.tan(half) / Math.max(aspect, 0.1)) * 180) / Math.PI;
  return Math.max(FOV_MIN, Math.min(FOV_MAX, vertical));
}

/** The point the on-foot camera looks at, and the way round it the camera stands. Nothing allocates. */
export class FollowFocus {
  readonly point = new Float64Array(3);
  /** Seconds the view has been left alone (no drag, stick or mouse look). */
  idle = 0;
  private readonly x = new Damped();
  private readonly y = new Damped();
  private readonly z = new Damped();
  private readonly yaw = new Damped();

  /** Start the follow on him at (`x`, `y`, `z`): no glide from wherever it was. */
  seed(x: number, y: number, z: number): void {
    this.x.snap(x);
    this.y.snap(y + PIVOT_OVER_TORSO);
    this.z.snap(z);
    this.yaw.v = 0;
    this.idle = 0;
    this.write();
  }

  /** The focus follows his torso at (`x`, `y`, `z`) moving `speed` m/s. */
  follow(dt: number, x: number, y: number, z: number, speed: number): void {
    const run = Math.max(0, Math.min(1, speed / RUN_SPEED));
    const time = POSITION_TIME_WALK + (POSITION_TIME_RUN - POSITION_TIME_WALK) * run;
    this.x.step(x, time, dt);
    this.z.step(z, time, dt);
    this.y.step(y + PIVOT_OVER_TORSO, HEIGHT_TIME, dt);
    this.write();
  }

  /**
   * The camera's yaw (rad, as the orbit counts it: the eye stands at (sin, cos) of it from the focus) after one step of `dt`: unchanged while the
   * player looks round or he is slow, else eased to behind `facing` once the view has been left alone `RECENTER_DELAY` s.
   */
  recenter(dt: number, yaw: number, facing: number, speed: number, looking: boolean): number {
    this.idle = looking ? 0 : this.idle + dt;
    if (this.idle < RECENTER_DELAY || speed < RECENTER_SPEED) {
      this.yaw.v = 0;
      return yaw;
    }
    this.yaw.x = yaw;
    const behind = facing + Math.PI;
    const gap = Math.abs(wrapAngle(behind - yaw));
    if (gap > RECENTER_GAP) {
      this.yaw.v = 0;
      return yaw;
    }
    return wrapAngle(this.yaw.step(yaw + wrapAngle(behind - yaw), YAW_TIME / Math.max(0.3, detCos(gap)), dt));
  }

  private write(): void {
    this.point[0] = this.x.x;
    this.point[1] = this.y.x;
    this.point[2] = this.z.x;
  }
}
