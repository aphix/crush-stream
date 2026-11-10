import { detCos, detSin } from "../../kernel/physics-core.js";
import { layOutLots } from "../../world/openworld/openworld-lots.ts";
import type { Building, Lots } from "../../world/openworld/openworld-layout.ts";
import { buildOpenWorldMap } from "../../world/openworld/openworld-map.ts";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import type { LineOfSight } from "./offence-source.ts";

/** A wall's thickness a person may stand against (m): a point this close inside a building's footprint is still at its door or its wall. */
export const WALL_SKIN = 0.4;

export type RealMap = { lots: Lots; map: OpenWorldMap; sight: LineOfSight; insideBuilding: (x: number, z: number) => boolean };

/** A building's footprint in its own axes: its front is local +x (`depth` along it), `width` along local z. */
function local(building: Building, x: number, z: number): { across: number; along: number } {
  const ex = x - building.x;
  const ez = z - building.z;
  return { along: ex * detCos(building.yaw) - ez * detSin(building.yaw), across: ex * detSin(building.yaw) + ez * detCos(building.yaw) };
}

function pointInside(building: Building, x: number, z: number): boolean {
  const at = local(building, x, z);
  return Math.abs(at.along) < building.depth / 2 - WALL_SKIN && Math.abs(at.across) < building.width / 2 - WALL_SKIN;
}

/** Whether the segment from (ax, az) to (bx, bz) passes through the footprint (slab test in the building's axes, less `WALL_SKIN`). */
function segmentCrosses(building: Building, ax: number, az: number, bx: number, bz: number): boolean {
  const from = local(building, ax, az);
  const to = local(building, bx, bz);
  const halfAlong = building.depth / 2 - WALL_SKIN;
  const halfAcross = building.width / 2 - WALL_SKIN;
  let enter = 0;
  let leave = 1;
  for (const [start, end, half] of [[from.along, to.along, halfAlong], [from.across, to.across, halfAcross]] as const) {
    const move = end - start;
    if (Math.abs(move) < 1e-9) {
      if (Math.abs(start) >= half) return false;
      continue;
    }
    const first = (-half - start) / move;
    const second = (half - start) / move;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter >= leave) return false;
  }
  return true;
}

/** The real open world's map (the programme's lots, the walk graph), with sight lines and footprint tests over its buildings: the world the law walks in the game. Built once per file. */
export function realMap(): RealMap {
  const lots = layOutLots();
  const map = buildOpenWorldMap(lots);
  const buildings = lots.buildings;
  return {
    lots,
    map,
    sight: (ax, az, bx, bz) => {
      for (let at = 0; at < buildings.length; at++) if (segmentCrosses(buildings[at]!, ax, az, bx, bz)) return false;
      return true;
    },
    insideBuilding: (x, z) => {
      for (let at = 0; at < buildings.length; at++) if (pointInside(buildings[at]!, x, z)) return true;
      return false;
    },
  };
}
