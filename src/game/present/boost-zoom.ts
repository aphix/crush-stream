import { DRIVE } from "../vehicle/car-drive.ts";

/** Wall seconds the zoom takes to reach full once the player's boost thrust starts. */
const BOOST_ZOOM_IN_S = 0.25;
/** Wall seconds it takes to fade out once the thrust ends: slower than in, so the lens settles instead of snapping. */
const BOOST_ZOOM_OUT_S = 0.4;
/** The longest blur (screen UV) at full strength, reached only at the screen corner: the cap that keeps the periphery readable. */
export const BOOST_ZOOM_CAP = 0.05;
/** Distance from the screen centre (UV) at which the blur reaches `BOOST_ZOOM_CAP`: the corner, so the centre of the frame stays sharp. */
export const BOOST_ZOOM_FULL_RADIUS = Math.SQRT1_2;
/** The speed (m/s) at which the zoom is at its full strength: half the sedan's top speed (100 km/h), which a burst out of a corner reaches within one boost. */
export const BOOST_ZOOM_FULL_SPEED = DRIVE.maxFwd * 0.5;
/** Progress within this of an end of its range lands on it, so the ease ends at exactly 0 (the blur skipped) or 1 and float residue never holds the pass on. */
const BOOST_ZOOM_SNAP = 1e-6;

/** `progress` (0..1, linear in time) one frame of `dt` wall s on: up at `BOOST_ZOOM_IN_S` while `boosting`, down at `BOOST_ZOOM_OUT_S` after. */
export function stepBoostZoom(progress: number, boosting: boolean, dt: number): number {
  const next = boosting ? progress + dt / BOOST_ZOOM_IN_S : progress - dt / BOOST_ZOOM_OUT_S;
  if (next < BOOST_ZOOM_SNAP) return 0;
  return next > 1 - BOOST_ZOOM_SNAP ? 1 : next;
}

/** The zoom's strength (0..1): `progress` through a smoothstep, scaled by the car's speed up to `BOOST_ZOOM_FULL_SPEED`, so a standing-start boost barely blurs. */
export function boostZoomStrength(progress: number, speed: number): number {
  const eased = progress * progress * (3 - 2 * progress);
  return eased * Math.min(1, Math.max(0, speed / BOOST_ZOOM_FULL_SPEED));
}
