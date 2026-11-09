import type { Lots } from "./openworld-layout.ts";
import { sidesOf, type BlockSide } from "./openworld-sides.ts";

/** How far (m) the point stands out of block face `side`'s property line toward its street: negative inside the block. */
export function outOf(side: BlockSide, x: number, z: number): number {
  return ((side.alongX ? z : x) - side.fixed) * side.outward;
}

function alongFace(side: BlockSide, x: number, z: number): boolean {
  const along = side.alongX ? x : z;
  return along >= side.start && along <= side.start + side.length;
}

/** The block face whose strip (along its length, up to `reach` m out of its property line) holds the point, null when none does. */
export function faceAt(lots: Lots, x: number, z: number, reach: number): BlockSide | null {
  for (const block of lots.blocks) {
    for (const side of sidesOf(block, lots.geometry)) {
      const out = outOf(side, x, z);
      if (alongFace(side, x, z) && out > 0 && out < reach) return side;
    }
  }
  return null;
}

/** Whether the point lies strictly inside (by `margin` m) the clear walking path of any block face: between the frontage zone and the furniture strip. */
export function inClearPath(lots: Lots, x: number, z: number, margin = 0): boolean {
  const { sidewalkFrontage, sidewalkClear } = lots.geometry;
  for (const block of lots.blocks) {
    for (const side of sidesOf(block, lots.geometry)) {
      const out = outOf(side, x, z);
      if (alongFace(side, x, z) && out > sidewalkFrontage + margin && out < sidewalkFrontage + sidewalkClear - margin) return true;
    }
  }
  return false;
}
