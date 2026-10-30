import type { HingeSpec } from "./hinge-spec.ts";
import { KPH_PER_MS } from "../kernel/constants.ts";
import { detSin, detCos } from "../kernel/physics-core.js";

/**
 * Hinged parts in motion (docs/PANEL_FLAP.md): the wind on a loosened quarter panel, arch flare or hanging bumper, and an
 * open door as a pendulum on the car's own acceleration. Pure functions of speed, hinge value and the car-frame
 * acceleration: nothing here draws a random number.
 */

/** A panel or bumper hinged to `PANEL_FRAGILE_T` or past it stands ~0.2 m off a quarter's body: stretched, and easy to break. */
export const PANEL_FRAGILE_T = 0.5;
/** A pushed-back (smushed) panel keeps this much hinge: dented, not flat. */
export const PANEL_SMUSH_MIN = 0.1;

/** Flutter peaks (rad) at `FLAP_V` m/s and above, from a part hinged `FLAP_FULL_T` or more. */
const FLAP_MAX = 0.3;
const FLAP_V = 40;
const FLAP_FULL_T = 0.25;
/** The flap clock turns at `FLAP_HZ0 + FLAP_HZ1 · v` Hz. */
const FLAP_HZ0 = 3;
const FLAP_HZ1 = 0.2;

/** The airflow's share of its full push at `speed`: 0 at rest, ∝ v², 1 from `FLAP_V`. Every hinged part's wind reads it. */
function airflow(speed: number): number {
  const v = Math.min(1, speed / FLAP_V);
  return v * v;
}

/** Flutter amplitude (rad): 0 at rest, ∝ v², full at `FLAP_V`; a barely hinged part hardly moves. */
export function flapAmp(speed: number, hingeT: number): number {
  return FLAP_MAX * airflow(speed) * Math.min(1, hingeT / FLAP_FULL_T);
}

/** The flap clock's rate (rad/s) at `speed`. */
export function flapRate(speed: number): number {
  return 2 * Math.PI * (FLAP_HZ0 + FLAP_HZ1 * speed);
}

/** 0..1, never negative: a part lifts off its body and settles back, it does not fold into it. Two beats that never line up. */
export function flapWave(phase: number): number {
  return 0.5 + 0.35 * detSin(phase) + 0.15 * detSin(2.7 * phase + 1.3);
}

/** Peak push (m/s²) of the airflow on an open door or lid at `FLAP_V`, its beat's mean half that: ½ρv² (980 Pa) on ~0.8 m² of a 12-26 kg lid (guessed). */
const WIND_PUSH_MAX = 80;

/** Rearward push (m/s² along the car, for `speed` forward) of the airflow on an open door or lid, beating at `phase` as a panel flutters. */
export function windPush(speed: number, phase: number): number {
  return WIND_PUSH_MAX * airflow(speed) * flapWave(phase);
}

/** Above this speed (m/s, 80 km/h) a hinged part wears: faster, and quicker still once stretched. */
export const FLAP_TEAR_MPS = 80 / KPH_PER_MS;
/** Seconds at `FLAP_TEAR_MPS` a part hinged `FLAP_FULL_T` or more lasts (a stretched one: `FLAP_TEAR_FRAGILE_S`). */
const FLAP_TEAR_S = 6;
const FLAP_TEAR_FRAGILE_S = 1.5;

/** Wear per second (of 1 = off) of a part hinged to `hingeT` at `speed`; negative: it recovers below `FLAP_TEAR_MPS`. */
export function windWear(speed: number, hingeT: number): number {
  if (speed < FLAP_TEAR_MPS) return -1 / FLAP_TEAR_S;
  const gust = (speed / FLAP_TEAR_MPS) ** 2;
  return hingeT >= PANEL_FRAGILE_T ? gust / FLAP_TEAR_FRAGILE_S : (Math.min(1, hingeT / FLAP_FULL_T) * gust) / FLAP_TEAR_S;
}

/**
 * The car-frame acceleration that drives the door pendulum is capped here (m/s², 1.5 g; rad/s² for the yaw): driving stays
 * under it, a crash's spike saturates (the crash rules C1 tear or spare a door, not the pendulum).
 */
export const DOOR_ACC_MAX = 15;
export const DOOR_YAW_ACC_MAX = 30;
/** The pendulum feels the car's acceleration only after contact has been quiet this long (s): a crash's jolts are the crash rules' (C1). */
export const DOOR_QUIET_S = 0.3;

/** Plastic moment of a quarter panel's crease (N·m ≈ 200 MPa × 1.2 mm² × 0.5 m / 4): the work a striker pays per rad it bends it. */
export const PANEL_BEND_NM = 36;
/**
 * Energy a striker's plastic push puts into a quarter panel before it tears off (J, guessed like `HINGE_TEAR_J`): pushed back
 * onto the body (`SLAM`), pulled out (`PULL`), or already stretched to `PANEL_FRAGILE_T` (`FRAGILE`: a nudge).
 */
export const PANEL_SLAM_J = 150;
export const PANEL_PULL_J = 60;
export const PANEL_FRAGILE_J = 15;

/**
 * Opening acceleration (rad/s²) of a door of side `sx` (−1 left, +1 right) on hinge `h`, open `theta`, from the car frame's pseudo
 * force: the hinge frame accelerates at (`ax` right, `az` forward) m/s² and turns at `w` rad/s with `al` rad/s². The door is
 * a uniform slab hinged at (sx·hx, hz) and swinging along u = (sx sin θ, −cos θ); its virtual work per rad is
 * ∫ r (∂p/∂θ)·F dm over the slab with F = −a + ω² p − α × p. Braking (az < 0) swings an open door forward (opens),
 * accelerating shuts it; the outside of a turn opens, the inside shuts.
 */
export function swingAccel(h: HingeSpec, sx: number, theta: number, ax: number, az: number, w: number, al: number): number {
  const s = detSin(theta);
  const c = detCos(theta);
  const k = 3 / (2 * h.length);
  const drive = -(sx * c * ax + s * az) + w * w * (h.hx * c + h.hz * s);
  return k * drive - al * sx * (k * (h.hz * c - h.hx * s) - 1);
}

/** Striker ↔ door or lid restitution. */
const SWING_RESTITUTION = 0.2;

/** The impulse (N·s) a striker of `kg` closing at `closing` m/s, `k` m from the hinge, gives a free door or lid of `inertia` (kg·m²): through its effective mass I/k². */
export function swingImpulse(inertia: number, kg: number, closing: number, k: number): number {
  const mEff = inertia / (k * k);
  return ((1 + SWING_RESTITUTION) * closing) / (1 / kg + 1 / mEff);
}
