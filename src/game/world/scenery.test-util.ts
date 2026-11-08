import { PREFABS } from "./catalog.ts";
import { PREFAB } from "./constants.ts";
import { boxClear, placeCourse, type Placed } from "./placements.ts";
import { parseTrack } from "./track-schema.ts";
import { Track, blankProjection, projectPath } from "./track.ts";
import { HAVANA } from "./tracks/havana.ts";
import { TRACKS } from "./tracks/index.ts";

/** What a course's scenery added, apart from its authored props. */
export type Dressed = { track: Track; authored: Placed[]; solid: Placed[]; drawn: Placed[] };

export const COURSE_JSON: readonly unknown[] = [...TRACKS, HAVANA];

const proj = blankProjection();
const memo = new Map<string, Dressed>();

/** `json` placed with the scenery service (its `scenery` block merged with `extra`): the authored props, the solid scenery after them, and the drawn-only. */
export function dress(json: unknown, extra: object = {}): Dressed {
  const parsed = parseTrack(json);
  const key = `${parsed.id}/${JSON.stringify(extra)}`;
  const known = memo.get(key);
  if (known) return known;
  const bare = placeCourse(new Track({ ...parsed, scenery: { biome: "none" } })).placed;
  const track = new Track({ ...parsed, scenery: { ...parsed.scenery, ...extra } });
  const course = placeCourse(track);
  const out = { track, authored: bare, solid: course.placed.slice(bare.length), drawn: course.drawn };
  memo.set(key, out);
  return out;
}

/** Key of a placement, for set comparisons. */
export const keyOf = (p: Placed): string => `${p.prefab}@${p.x.toFixed(3)},${p.z.toFixed(3)},${p.yaw.toFixed(3)}`;

/** Distance (m) from (x, z) to the nearest road centreline of the track. */
export function centreDistance(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (const path of track.paths()) best = Math.min(best, Math.sqrt(projectPath(path, x, z, -1, proj).dist2));
  return best;
}

/** Whether a road sample whose wall is down (on the side facing (x, z)) lies within `reach` m of (x, z) beyond its wall line: a gap a car leaves the road by. */
export function nearOpening(track: Track, x: number, z: number, reach: number): boolean {
  for (const path of track.paths()) {
    for (let i = 0; i < path.count; i++) {
      const dx = x - path.x[i]!;
      const dz = z - path.z[i]!;
      const left = dx * path.tz[i]! - dz * path.tx[i]! > 0;
      if ((left ? path.wallL : path.wallR)[i] !== 0) continue;
      if (Math.hypot(dx, dz) - path.half[i]! - (left ? path.runL[i]! : path.runR[i]!) < reach) return true;
    }
  }
  return false;
}

/** Half extents (m) of a placement's drawn footprint: along its local x and z. */
function half(p: Placed): [number, number] {
  const size = PREFABS[p.prefab].size;
  return [(size[0] * p.sx) / 2, (size[2] * p.sz) / 2];
}

/** The deepest (m) the drawn footprint of `p` reaches onto any road or run-off of the track (0 when it stands clear). */
export function intrusion(track: Track, p: Placed): number {
  const [hw, hd] = half(p);
  let deepest = 0;
  for (const path of track.paths()) deepest = Math.max(deepest, -boxClear(path, p.x, p.z, p.yaw, hw, hd));
  return deepest;
}

/** Half the width (m) of placement `p`'s footprint along the axis (ax, az): its local x is (cos yaw, −sin yaw), its local z (sin yaw, cos yaw). */
function radiusOn(p: Placed, ax: number, az: number): number {
  const [hw, hd] = half(p);
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return Math.abs(hw * (c * ax - s * az)) + Math.abs(hd * (s * ax + c * az));
}

/** Whether two placements' drawn footprints (oriented boxes) overlap, by the separating-axis test. */
export function overlap(a: Placed, b: Placed): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const [aw, ad] = half(a);
  const [bw, bd] = half(b);
  if (dx * dx + dz * dz > (Math.hypot(aw, ad) + Math.hypot(bw, bd)) ** 2) return false;
  for (const p of [a, b]) {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    for (const [ax, az] of [[c, -s], [s, c]] as const) {
      if (Math.abs(dx * ax + dz * az) >= radiusOn(a, ax, az) + radiusOn(b, ax, az)) return false;
    }
  }
  return true;
}

/** Kinds that lie flat on the ground or are driven through, which may lie under or among other props. */
export const FLAT = new Set<string>([PREFAB.sidewalk, PREFAB.wreck]);