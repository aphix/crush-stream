import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { NO_PLACE } from "./civilian-constants.ts";
import { WRECK_MARGIN } from "./civilian-crowd-constants.ts";

/** The walk-graph node nearest (x, z); `NO_PLACE` when the graph has none. */
export function nearestNode(map: OpenWorldMap, x: number, z: number): number {
  const { nodeX, nodeZ } = map.graph;
  let best = NO_PLACE;
  let bestDistance = Infinity;
  for (let node = 0; node < nodeX.length; node++) {
    const distance = hypot2(nodeX[node]! - x, nodeZ[node]! - z);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = node;
  }
  return best;
}

/** The place whose footprint (grown by `WRECK_MARGIN`) holds the contact most deeply, among those inside the walls; `NO_PLACE` for none. */
export function buildingAt(map: OpenWorldMap, x: number, z: number): number {
  const { places } = map;
  let best = NO_PLACE;
  let bestExcess = Infinity;
  for (let place = 0; place < places.length; place++) {
    const entry = places[place]!;
    if (entry.doorNode < 0) continue;
    const dx = x - entry.x;
    const dz = z - entry.z;
    const cos = detCos(entry.yaw);
    const sin = detSin(entry.yaw);
    const excess = Math.max(Math.abs(dx * cos - dz * sin) - entry.depth / 2, Math.abs(dx * sin + dz * cos) - entry.width / 2);
    if (excess > WRECK_MARGIN || excess >= bestExcess) continue;
    bestExcess = excess;
    best = place;
  }
  return best;
}
