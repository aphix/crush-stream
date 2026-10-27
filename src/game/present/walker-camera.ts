import { detAtan } from "../kernel/physics-core.js";
import { RUN_SPEED } from "./walker-locomotion.ts";
import { wrapAngle } from "./walker-math.ts";

/**
 * The on-foot camera's numbers, from third-person open-world practice (onfoot-camera research): the pivot at the chest, 3.5-4.5 m back, 60-70° across; the
 * follow smoothed critically damped with its own time for position, height and yaw (0.1-0.4 s), the view coming back behind him after 1-1.5 s without look input.
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

/** The enter and exit blend (s): the lens, distance and pitch go to the on-foot shot over this long, 0.2-0.4 s in the research. */
export const BLEND_SECONDS = 0.3;

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
    return wrapAngle(this.yaw.step(yaw + wrapAngle(behind - yaw), YAW_TIME, dt));
  }

  private write(): void {
    this.point[0] = this.x.x;
    this.point[1] = this.y.x;
    this.point[2] = this.z.x;
  }
}
