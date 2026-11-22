import { detAtan, detCos, detSin, hypot3 } from "../kernel/physics-core.js";
import { RUN_SPEED, SPRINT_SPEED } from "./walker-locomotion.ts";
import { smoothstep, wrapAngle } from "./walker-math.ts";

/**
 * The on-foot camera's numbers. GTA's on-foot camera (.extraResearch/third-person-camera-and-controls.md): the pivot 0.8 m over the ped's
 * centre, about head height; a boom of 1.7 + 2.0 cos(pitch) m; the player centred with his whole body in view.
 */
export const PIVOT_OVER_TORSO = 0.55;
/** The follow boom at pitch p is `BOOM_BASE + BOOM_SWING cos(p)` m (GTA, .extraResearch/third-person-camera-and-controls.md). */
const BOOM_BASE = 1.7;
const BOOM_SWING = 2;
/** The default zoom: the follow boom at level, 3.7 m; the wheel scales it. */
export const FOLLOW_BOOM = BOOM_BASE + BOOM_SWING;
/** The resting pitch (rad, from above): GTA's `fDefaultAlphaOrient` -0.22 rad, its sign ours (.extraResearch/third-person-camera-and-controls.md). */
export const REST_PITCH = 0.22;
/** The orbit he is framed on while he climbs back into his car (m, rad): tuned by feel. */
export const FOLLOW_RADIUS = 4.2;
export const FOLLOW_PITCH = 0.3;
/** The vertical lens (deg) for this lens across a wide view, held between these: the narrowest that keeps his feet in the default framing (walker-camera.test.ts). */
const FOLLOW_HORIZONTAL_FOV = 80;
const FOV_MIN = 48;
const FOV_MAX = 60;

/** Smoothing times (s): the focus follows his ground position in this long walking and this long running, his height (the bob) and the yaw coming back behind him. */
const POSITION_TIME_WALK = 0.3;
const POSITION_TIME_RUN = 0.12;
const HEIGHT_TIME = 0.35;
const YAW_TIME = 0.4;
/** A pad's view comes back behind him after this long (s) without look input while he moves faster than this (m/s): GTA's pad camera eases back; the delay tuned by feel. */
export const RECENTER_DELAY = 1;
const RECENTER_SPEED = 1;
/** The camera comes round behind him only while his facing is within this (rad) of it: it does not chase a sidestep. */
const RECENTER_GAP = 0.9;

/** The enter and exit blend (s): the lens, distance and pitch go to the on-foot shot over this long, 0.2-0.4 s in the research. */
export const BLEND_SECONDS = 0.3;

/** The views on foot, in View's (V) order and the wheel's from out to in: GTA's follow, over his right shoulder, his own eyes. */
export type OnFootView = "follow" | "shoulder" | "first";

/** The over-the-shoulder stop (level boom, m) and how far its pivot stands to his right (m): research 1.5-2.2 m back, 0.45-0.7 m out. */
export const SHOULDER_BOOM = 1.6;
export const SHOULDER_ACROSS = 0.5;
/** The nearest boom (m): his shoulders' breadth with the arms (0.58 m) and the camera's ball off his head. Inside it the wheel is his own eyes. */
export const SHOULDER_NEAREST = 0.8;
export const FIRST_PERSON_RADIUS = 0.7;
/** Each view's zoom, the level boom View (V) takes it to. */
export const VIEW_BOOM: Record<OnFootView, number> = { follow: FOLLOW_BOOM, shoulder: SHOULDER_BOOM, first: FIRST_PERSON_RADIUS };
/** The camera's ball (m): it stands this far off every solid, past the near plane (0.1 m). */
export const CAMERA_RADIUS = 0.2;
/** His head's centre and his eyes over his torso's centre (m: the head box at 1.63 m, the torso's at 1.11 m), and the eyes ahead of the head's centre. */
const HEAD_OVER_TORSO = 0.52;
const EYE_OVER_TORSO = 0.54;
const EYE_AHEAD = 0.1;
/** An eye pulled in this near (m) to his head's centre would show the inside of his head and shoulders: they are not drawn to it. Tuned by feel. */
const HEAD_HIDE = 0.4;
/** The eyes' height follows his torso's over this long (s): the gait's bob, eased, without lagging a step down a stair. */
const EYE_HEIGHT_TIME = 0.12;
/** A pulled-in camera lets go over this long (s): GTA's 0.92 per 1/50 s step (.extraResearch/third-person-camera-and-controls.md); it comes in at once. */
const LET_GO_TIME = 0.24;
/** The pitch range (rad, positive: looking down) of his eyes and of the cameras behind him: they look up less, the floor behind them. */
export const FIRST_PITCH = { low: -1.3, high: 1.3 } as const;
export const THIRD_PITCH = { low: -0.5, high: 1.22 } as const;
/** `view.look` stands this far (m) along the camera's way from its eye: the walk reads its heading off the two. */
export const LOOK_AHEAD = 2.2;

/** The view a zoom (the level boom, m) shows: his eyes inside the nearest boom, over his shoulder up to halfway to the follow boom, else the follow. */
export function viewAt(levelBoom: number): OnFootView {
  if (levelBoom < SHOULDER_NEAREST) return "first";
  return levelBoom < (SHOULDER_BOOM + FOLLOW_BOOM) / 2 ? "shoulder" : "follow";
}

/** The boom (m) at `pitch` for a zoom of `levelBoom`: GTA's, scaled by the zoom. */
export function boomAt(levelBoom: number, pitch: number): number {
  return (levelBoom * (BOOM_BASE + BOOM_SWING * detCos(pitch))) / FOLLOW_BOOM;
}

/** How far (m) the pivot stands to his right at a zoom of `levelBoom`: none at the follow boom, all of `SHOULDER_ACROSS` from the shoulder stop in, eased between. */
export function acrossAt(levelBoom: number): number {
  return SHOULDER_ACROSS * smoothstep((FOLLOW_BOOM - levelBoom) / (FOLLOW_BOOM - SHOULDER_BOOM));
}

/** The boom grows by up to this share from a run to a sprint: Pignole's "distance grows with forward speed between two speeds, up to a maximum" (.extraResearch/third-person-camera-and-controls.md); the share tuned by feel. */
const SPRINT_BOOM_SHARE = 0.15;

/** The boom (m) at his `speed` (m/s) for a boom of `boom` at rest: unchanged up to a run, `SPRINT_BOOM_SHARE` longer at a sprint, eased between. */
export function sprintBoom(boom: number, speed: number): number {
  return boom * (1 + SPRINT_BOOM_SHARE * smoothstep((speed - RUN_SPEED) / (SPRINT_SPEED - RUN_SPEED)));
}

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
 * point) and pitch: behind him, its ball swept out from his head and stopped short of every solid, or through his eyes. `inHead`: the eye is
 * at his head (his own eyes, or pulled in that close), so his head and torso are not drawn to it. Nothing allocates.
 */
export class WalkerView {
  readonly eye = new Float64Array(3);
  readonly ahead = new Float64Array(3);
  inHead = false;
  /** The eye's distance (m) to his head's centre. */
  headGap = 0;
  /** The share of the asked boom the eye stands at (1: nothing in the way). */
  reachShare = 1;
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
   * Behind him on `length` m of boom from the pivot (`fx`, `fy`, `fz`) moved `across` m to the camera's right, his torso drawn at (`tx`, `ty`, `tz`):
   * the ball goes from his head (inside him, so clear) to the pivot, out to the side, then back along the boom, and the eye stands where it stops.
   */
  shoulder(tx: number, ty: number, tz: number, fx: number, fy: number, fz: number, yaw: number, pitch: number, length: number, across: number, sweep: Sweep, dt: number): void {
    this.eyeSeeded = false;
    const s = detSin(yaw);
    const c = detCos(yaw);
    const cp = detCos(pitch);
    const sp = detSin(pitch);
    const hx = tx;
    const hy = ty + HEAD_OVER_TORSO;
    const hz = tz;
    const gx = fx - hx;
    const gy = fy - hy;
    const gz = fz - hz;
    const gap = hypot3(gx, gy, gz);
    const share = gap > 0 ? stopShort(sweep(hx, hy, hz, gx / gap, gy / gap, gz / gap, gap), gap) / gap : 1;
    this.pivotShare = letGo(this.pivotShare, share, dt);
    const px = hx + gx * this.pivotShare;
    const py = hy + gy * this.pivotShare;
    const pz = hz + gz * this.pivotShare;
    // The camera's right, level: the way (cos, 0, -sin) of its yaw.
    this.across = letGo(this.across, across > 0 ? stopShort(sweep(px, py, pz, c, 0, -s, across), across) : 0, dt);
    const ox = px + c * this.across;
    const oz = pz - s * this.across;
    const bx = s * cp;
    const bz = c * cp;
    this.boom = letGo(this.boom, stopShort(sweep(ox, py, oz, bx, sp, bz, length), length), dt);
    const reach = this.boom;
    this.reachShare = length > 0 ? reach / length : 1;
    this.eye[0] = ox + bx * reach;
    this.eye[1] = py + sp * reach;
    this.eye[2] = oz + bz * reach;
    this.ahead[0] = -bx;
    this.ahead[1] = -sp;
    this.ahead[2] = -bz;
    this.headGap = hypot3(this.eye[0] - hx, this.eye[1] - hy, this.eye[2] - hz);
    this.inHead = this.headGap < HEAD_HIDE;
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
    this.headGap = hypot3(this.eye[0] - tx, this.eye[1] - (ty + HEAD_OVER_TORSO), this.eye[2] - tz);
    this.reachShare = 1;
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
   * The camera's yaw (rad, as the orbit counts it: the eye stands at (sin, cos) of it from the focus) after one step of `dt`: unchanged unless a pad
   * walks him (`byPad`; a mouse camera never comes back by itself), and unchanged while the player looks round or he is slow; else eased to behind
   * `facing` once the view has been left alone `RECENTER_DELAY` s.
   */
  recenter(dt: number, yaw: number, facing: number, speed: number, looking: boolean, byPad: boolean): number {
    this.idle = looking ? 0 : this.idle + dt;
    if (!byPad || this.idle < RECENTER_DELAY || speed < RECENTER_SPEED) {
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
