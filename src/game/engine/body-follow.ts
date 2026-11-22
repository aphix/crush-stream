import { detAtan2, detCos, detSin, hypot2, hypot3 } from "../kernel/physics-core.js";
import { WINCH_SPEED } from "../kernel/constants.ts";
import { BODY_FLAG, BODY_POSTURE, POSTURE_MASK, type BodyFrame, type BodyMotion } from "../net/body-codec.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { blankStrike } from "../scenes/figure-strike.ts";
import type { BodyHost } from "./openworld-bodies.ts";

/** She is standing when her pace is under this (m/s); her body then stands, facing as she does, once within `STAND_REACH` (m) of her spot, and walks to it from farther. */
export const STILL = 0.15;
export const STAND_REACH = 0.4;
/** How hard a body is pulled to her spot: the speed (m/s) added toward it per metre it lags. */
export const CATCH_UP = 2.5;
/** A body is never asked faster than this (m/s): a run. */
export const FASTEST = 3.5;
/** A body this far (m) from its target is not walked to it: it is stood or moved there at once. */
export const SNAP_M = 3;
/** A record is read at most this far (s) off the host's moment: the interpolation delay and one lost frame. */
const BODY_EXTRAPOLATE_S = 0.25;
/** A torso stands this far (m) over its feet. */
export const TORSO_ABOVE_FEET = PARTS[0].c[1];
/** What `followAnchor` left to its caller: nothing, or the walker to be stood again at the target. */
export const FOLLOW = { kept: 0, restand: 1 } as const;
/** A lying body is hauled toward its target at the target's velocity plus this per second of the gap (1 / `INTERP_DELAY`), at most `WINCH_SPEED` m/s. */
const HAUL_RATE = 1 / INTERP_DELAY;

const _here: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _path = { x: 0, z: 0 };
const _strike = blankStrike();

/** Record `at` of `frame` moved by its velocity for `age` s (clamped to `BODY_EXTRAPOLATE_S` either way) into `out`; lying while the record is struck. */
export function recordTarget(frame: BodyFrame, at: number, age: number, out: BodyMotion): void {
  const reach = age > BODY_EXTRAPOLATE_S ? BODY_EXTRAPOLATE_S : age < -BODY_EXTRAPOLATE_S ? -BODY_EXTRAPOLATE_S : age;
  const o = 3 * at;
  out.vx = frame.vel[o]!;
  out.vy = frame.vel[o + 1]!;
  out.vz = frame.vel[o + 2]!;
  out.x = frame.pos[o]! + out.vx * reach;
  out.y = frame.pos[o + 1]! + out.vy * reach;
  out.z = frame.pos[o + 2]! + out.vz * reach;
  out.heading = frame.heading[at]!;
  const state = frame.state[at]!;
  out.posture = (state & BODY_FLAG.struck) !== 0 ? BODY_POSTURE.down : state & POSTURE_MASK;
}

/**
 * The body in `slot` follows `target` by the first row that matches: a standing body is knocked limp where the target lies; a lying one is moved the whole gap
 * past `SNAP_M` and hauled to it within; a target on its feet past `SNAP_M` has the body stood again at it (`FOLLOW.restand`), within it the body gets up if it
 * lies and else is steered to it at most `cap` m/s. A body a cable of this machine holds is not moved.
 */
export function followAnchor(host: BodyHost, slot: number, target: BodyMotion, cap: number): number {
  if (host.roped(slot) || !host.motion(slot, _here)) return FOLLOW.kept;
  const up = host.standing(slot);
  const dx = target.x - _here.x;
  const dy = target.y - _here.y;
  const dz = target.z - _here.z;
  const gap = hypot2(dx, dz);
  if (target.posture === BODY_POSTURE.down) {
    if (up) {
      _strike.guard = -1;
      _strike.car = -1;
      _strike.x = _here.x;
      _strike.y = _here.y;
      _strike.z = _here.z;
      _strike.faceX = detSin(target.heading);
      _strike.faceZ = detCos(target.heading);
      _strike.vx = target.vx;
      _strike.vy = target.vy;
      _strike.vz = target.vz;
      host.knock(slot, _strike);
    } else if (gap > SNAP_M) host.shift(slot, dx, dy, dz);
    else {
      const vx = target.vx + HAUL_RATE * dx;
      const vy = target.vy + HAUL_RATE * dy;
      const vz = target.vz + HAUL_RATE * dz;
      const speed = hypot3(vx, vy, vz);
      const scale = speed > WINCH_SPEED ? WINCH_SPEED / speed : 1;
      host.drag(slot, vx * scale, vy * scale, vz * scale);
    }
    return FOLLOW.kept;
  }
  if (gap > SNAP_M) return FOLLOW.restand;
  if (!up) {
    host.getUp(slot);
    return FOLLOW.kept;
  }
  host.path(slot, _path);
  const vx = target.vx + CATCH_UP * (target.x - _path.x);
  const vz = target.vz + CATCH_UP * (target.z - _path.z);
  if (hypot2(target.vx, target.vz) < STILL && gap < STAND_REACH) host.steer(slot, target.heading, 0);
  else host.steer(slot, detAtan2(vx, vz), Math.min(cap, hypot2(vx, vz)));
  return FOLLOW.kept;
}
