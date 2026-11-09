import { detCos, detSin } from "../kernel/physics-core.js";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";

/**
 * Which buildings of a course have a neighbour against both their sides: their side walls are party walls, drawn bare (`facades.ts` skins). Read off the placements alone, so the facade and the
 * interior (which opens windows only on a side with no building against it, `Place.openSides`) agree by construction.
 */

/** A probe just past a building's side lands this far (m) inside its neighbour, whose wall it abuts. */
const SIDE_PROBE = 0.1;
/** A neighbour must stand square to the building: the sine of the angle between their yaws is under this. */
const PARALLEL_SINE = 1e-3;
/** The grid the buildings are bucketed in (m): wider than any building's reach to its neighbour's middle (a four-lot shop's half width and a lot's). */
const GRID_CELL = 24;
/** A cell's key packs its x index over this many z indices. */
const CELL_KEY_SPAN = 4096;
/** The two sides, each a sign along the building's local z (the plan's across). */
const SIDES = [-1, 1] as const;

const isBuilding = (placed: Placed): boolean => placed.prefab === PREFAB.building || placed.prefab === PREFAB.buildingShell;

const cellKey = (x: number, z: number): number => Math.floor(x / GRID_CELL) * CELL_KEY_SPAN + Math.floor(z / GRID_CELL);

/** Whether the point (x, z) lies in `building`'s footprint: its depth along its local x, its width along its local z. */
function contains(building: Placed, x: number, z: number): boolean {
  const [depth, , width] = PREFABS[building.prefab].size;
  const dx = x - building.x;
  const dz = z - building.z;
  const along = dx * detCos(building.yaw) - dz * detSin(building.yaw);
  const across = dx * detSin(building.yaw) + dz * detCos(building.yaw);
  return Math.abs(along) <= (building.sx * depth) / 2 && Math.abs(across) <= (building.sz * width) / 2;
}

/** The buildings of `placed` with a building square to them against each side. */
export function partyBuildingsOf(placed: readonly Placed[]): ReadonlySet<Placed> {
  const buildings = placed.filter(isBuilding);
  const grid = new Map<number, Placed[]>();
  for (const building of buildings) {
    const key = cellKey(building.x, building.z);
    const cell = grid.get(key);
    if (cell === undefined) grid.set(key, [building]);
    else cell.push(building);
  }
  const neighbourAt = (home: Placed, x: number, z: number): boolean => {
    for (let cellX = -1; cellX <= 1; cellX++) {
      for (let cellZ = -1; cellZ <= 1; cellZ++) {
        const candidates = grid.get(cellKey(x + cellX * GRID_CELL, z + cellZ * GRID_CELL)) ?? [];
        if (candidates.some((other) => other !== home && Math.abs(detSin(other.yaw - home.yaw)) < PARALLEL_SINE && contains(other, x, z))) return true;
      }
    }
    return false;
  };
  const party = new Set<Placed>();
  for (const home of buildings) {
    const halfWidth = (home.sz * PREFABS[home.prefab].size[2]) / 2;
    const closed = SIDES.every((side) => neighbourAt(home, home.x + side * (halfWidth + SIDE_PROBE) * detSin(home.yaw), home.z + side * (halfWidth + SIDE_PROBE) * detCos(home.yaw)));
    if (closed) party.add(home);
  }
  return party;
}
