import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { PropCollider } from "./placements.ts";
import { blankPoint, blankProjection, pointOn, projectPath, type Track, type TrackPath } from "./track.ts";

/** Where a car is put: its centre (m), the road's height there, and its facing (rad, 0 along +z). */
export type RoadSpot = { x: number; z: number; y: number; yaw: number };

/** Spots tried along the road from the nearest point, one car and its gap apart (m), alternating ahead and behind: 42 m of road. */
const SPOT_STEP = 6;
const SPOT_TRIES = 15;
/** A spot is clear of a solid that stands no nearer (m) than half a car's length to it. */
const CAR_REACH = 2.5;
/** A solid standing from this high (m) over the road passes over a car (a deck's prop). */
const CAR_HEIGHT = 2;

const _proj = blankProjection();
const _pt = blankPoint();

/** Whether one of `colliders` (`PropCollider`'s frame) stands within `reach` m of (`x`, `z`) in plan, between `y` and a car's height over it. */
function solidNear(colliders: readonly PropCollider[], x: number, y: number, z: number, reach: number): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]!;
    if (c.top <= y || c.base >= y + CAR_HEIGHT) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    if (c.kind === "circle") {
      if (hypot2(dx, dz) < c.r + reach) return true;
      continue;
    }
    const cos = detCos(c.yaw);
    const sin = detSin(c.yaw);
    const outU = Math.max(0, Math.abs(dx * cos - dz * sin) - c.hx);
    const outW = Math.max(0, Math.abs(dx * sin + dz * cos) - c.hz);
    if (hypot2(outU, outW) < reach) return true;
  }
  return false;
}

/**
 * The spot nearest (`x`, `z`) on the centreline of the course's roads (its loop, shortcuts and streets), facing along the road the way nearer `facing`
 * (rad, 0 along +z), clear of `colliders` and of whatever `occupied` says (the cars): the nearest road point, then `SPOT_STEP` m ahead and behind along
 * it. Into `out`; false when no spot within `SPOT_TRIES` is clear.
 */
export function roadSpotNear(track: Track, x: number, z: number, facing: number, colliders: readonly PropCollider[], occupied: (x: number, z: number) => boolean, out: RoadSpot): boolean {
  let road: TrackPath | null = null;
  let at = 0;
  let nearest = Infinity;
  for (const path of track.paths()) {
    projectPath(path, x, z, -1, _proj);
    if (_proj.dist2 >= nearest) continue;
    nearest = _proj.dist2;
    road = path;
    at = _proj.s;
  }
  if (road === null) return false;
  pointOn(road, at, _pt);
  const way = detSin(facing) * _pt.tx + detCos(facing) * _pt.tz >= 0 ? 1 : -1;
  for (let k = 0; k < SPOT_TRIES; k++) {
    const shift = Math.ceil(k / 2) * SPOT_STEP * (k % 2 === 1 ? 1 : -1);
    const s = road.closed ? at + shift : Math.max(0, Math.min(road.length, at + shift));
    pointOn(road, s, _pt);
    if (occupied(_pt.x, _pt.z) || solidNear(colliders, _pt.x, _pt.y, _pt.z, CAR_REACH)) continue;
    out.x = _pt.x;
    out.z = _pt.z;
    out.y = _pt.y;
    out.yaw = detAtan2(_pt.tx * way, _pt.tz * way);
    return true;
  }
  return false;
}
