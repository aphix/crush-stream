import * as THREE from "three";
import { NO_FLOOR } from "../world/ground.ts";
import type { Sight } from "./spectate-cam.ts";

/** Crash cam: it aims this high (m) over the ground at the impact. */
export const AIM_UP = 0.55;

/** A contact's recorded height is its overlapping nodes' mean, up to this far (m) over the car's origin. */
const CONTACT_ABOVE_ORIGIN = 0.7;
/** The sight's own tolerance (`CLEAR.pad` is 0.25 m): a foot this near the aim is the same point. */
const SINK_MIN = 0.01;

/** What a hit's recorded height means: a wall hit records the car's own origin; a car-to-car hit the contact, over an origin. `under`: how far (m) the hit car's origin sits under the road. */
export type HitSource = { wall: boolean; under: number };

/** A car-to-car hit with its car on the road: what a hit with no record of its source is taken for. */
export const CAR_HIT: Readonly<HitSource> = { wall: false, under: 0 };

/** A wall hit on the course or in the sandbox: its recorded height is the car's own origin. */
export const WALL_HIT: Readonly<HitSource> = { wall: true, under: 0 };

/** `out` as the source of a hit by the car at (x, y, z), a wall hit or not, on `sight`'s road. */
export function hitSource(out: HitSource, sight: Sight, x: number, y: number, z: number, wall: boolean): HitSource {
  const g = sight.ground.heightAt(x, z, y + 1);
  out.wall = wall;
  out.under = g === NO_FLOOR ? 0 : Math.max(0, g - y);
  return out;
}

/**
 * The lowest point the reel may judge a hit at (x, z), recorded at height `y`: `AIM_UP` over the car's origin. A wall hit records the origin itself.
 * A car-to-car hit's origin sits no lower than the road less `source.under` or the contact, and no more than `CONTACT_ABOVE_ORIGIN` under the contact.
 */
export function hitFoot(out: THREE.Vector3, x: number, y: number, z: number, sight: Sight | null, source: Readonly<HitSource> = CAR_HIT): THREE.Vector3 {
  if (source.wall) return out.set(x, y + AIM_UP, z);
  const g = sight ? sight.ground.heightAt(x, z, y + 1) : 0;
  return out.set(x, Math.max((g === NO_FLOOR ? y : Math.min(g, y)) - source.under, y - CONTACT_ABOVE_ORIGIN) + AIM_UP, z);
}

/** How far (m) a hit's `foot` (`hitFoot`) sits under its aim `at` (`hitAim`); 0 under `SINK_MIN`. */
export function aimSink(at: THREE.Vector3, foot: THREE.Vector3): number {
  const drop = at.y - foot.y;
  return drop > SINK_MIN ? drop : 0;
}
