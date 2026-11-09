import { detCos, detSin } from "../kernel/physics-core.js";
import { NO_FLOOR } from "./ground.ts";
import type { Placed, PropCollider } from "./placements.ts";

/** The depth (m) of one tread: a flight of length L has round(L / this) of them. */
export const STAIR_TREAD = 0.28;
/** Cell side (m) of `StairField`'s index: longer than any flight, so a flight covers at most four cells. */
const CELL = 8;
/** Offset keeping a cell's coordinates positive in its key, and the key's stride: a map spans well under 32768 cells a side. */
const CELL_BIAS = 32768;
const CELL_STRIDE = 65536;

/** A flight's box (the prop's collider) and how many treads it holds. */
export type Flight = { x: number; z: number; yaw: number; cos: number; sin: number; halfLength: number; halfWidth: number; base: number; top: number; treads: number };

/** The flights among `colliders` (the box colliders of `placed`' stairs props: their top falls from `top` at the local -x end to `base` at the +x end, in equal treads) and the colliders that are not. */
export function splitStairs(colliders: readonly PropCollider[], placed: readonly Placed[]): { flights: Flight[]; rest: PropCollider[] } {
  const flights: Flight[] = [];
  const rest: PropCollider[] = [];
  for (const c of colliders) {
    if (c.kind !== "box" || placed[c.index]!.stairs !== true) {
      rest.push(c);
      continue;
    }
    flights.push({ x: c.x, z: c.z, yaw: c.yaw, cos: detCos(c.yaw), sin: detSin(c.yaw), halfLength: c.hx, halfWidth: c.hz, base: c.base, top: c.top, treads: Math.max(1, Math.round((2 * c.hx) / STAIR_TREAD)) });
  }
  return { flights, rest };
}

/** The height (m) of the tread under the world point (x, z): `NO_FLOOR` outside the flight's footprint. */
export function flightHeightAt(flight: Flight, x: number, z: number): number {
  const dx = x - flight.x;
  const dz = z - flight.z;
  const along = dx * flight.cos - dz * flight.sin;
  const across = dx * flight.sin + dz * flight.cos;
  if (Math.abs(along) >= flight.halfLength || Math.abs(across) >= flight.halfWidth) return NO_FLOOR;
  const climbed = (flight.halfLength - along) / (2 * flight.halfLength);
  return flight.base + ((flight.top - flight.base) * Math.ceil(climbed * flight.treads)) / flight.treads;
}

const cellOf = (coordinate: number): number => Math.floor(coordinate / CELL) + CELL_BIAS;
const keyOf = (cellX: number, cellZ: number): number => cellX * CELL_STRIDE + cellZ;

const NO_FLIGHTS: readonly Flight[] = [];

/** Flights by the grid cell their footprint's bounds touch, so a point asks only the few near it. */
export class StairField {
  private readonly cells = new Map<number, Flight[]>();

  constructor(flights: readonly Flight[]) {
    for (const flight of flights) {
      const reach = Math.abs(flight.cos) * flight.halfLength + Math.abs(flight.sin) * flight.halfWidth;
      const reachZ = Math.abs(flight.sin) * flight.halfLength + Math.abs(flight.cos) * flight.halfWidth;
      for (let cx = cellOf(flight.x - reach); cx <= cellOf(flight.x + reach); cx++) {
        for (let cz = cellOf(flight.z - reachZ); cz <= cellOf(flight.z + reachZ); cz++) {
          const key = keyOf(cx, cz);
          const there = this.cells.get(key);
          if (there === undefined) this.cells.set(key, [flight]);
          else there.push(flight);
        }
      }
    }
  }

  /** The tread height (m) of the flight over (x, z); `NO_FLOOR` where none stands. */
  heightAt(x: number, z: number): number {
    const near = this.cells.get(keyOf(cellOf(x), cellOf(z))) ?? NO_FLIGHTS;
    for (let i = 0; i < near.length; i++) {
      const height = flightHeightAt(near[i]!, x, z);
      if (height !== NO_FLOOR) return height;
    }
    return NO_FLOOR;
  }
}

export const NO_STAIRS = new StairField(NO_FLIGHTS);
