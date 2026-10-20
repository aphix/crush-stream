import { CORRIDOR, sightRange } from "../ai/cop-sight.ts";
import { blankProjection, type Projection, type Track } from "./track.ts";

function onCorridor(track: Track, on: Projection): boolean {
  const path = track.path;
  const reach = path.half[on.k]! + Math.max(path.runL[on.k]!, path.runR[on.k]!) + CORRIDOR;
  return on.dist2 <= reach * reach;
}

/**
 * Whether some racer sees (x, z) by `sightRange`, judged without `SIGHT_MARGIN`; the first one that does, as a sentence ("" when none).
 * A racer or point off the road's corridor has no arc on it: that racer sees the ahead range round it.
 */
export function racerSeeing(track: Track, racers: readonly { x: number; z: number }[], x: number, z: number): { sees: boolean; nearest: number; text: string } {
  const sight = sightRange(track.length);
  const proj = blankProjection();
  const spot = track.project(x, z, -1, proj);
  const spotS = spot.s;
  const spotOnRoad = onCorridor(track, spot);
  let nearest = Infinity;
  let text = "";
  for (const [i, p] of racers.entries()) {
    const dist = Math.hypot(p.x - x, p.z - z);
    nearest = Math.min(nearest, dist);
    if (dist < sight.near) text ||= `racer ${i}: ${dist.toFixed(0)} m away`;
    const on = track.project(p.x, p.z, -1, proj);
    if (!spotOnRoad || !onCorridor(track, on)) {
      if (dist < sight.ahead) text ||= `racer ${i}, off the road: ${dist.toFixed(0)} m away`;
      continue;
    }
    const along = spotS - on.s;
    const ahead = along - track.length * Math.round(along / track.length);
    if (ahead > -sight.behind && ahead < sight.ahead) text ||= `racer ${i}: ${dist.toFixed(0)} m away, spot ${ahead.toFixed(0)} m ahead of it along the road`;
  }
  return { sees: text !== "", nearest, text };
}
