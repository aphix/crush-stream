import { SCENERY_ASSETS } from "./index.ts";

/** Width (m) of an asset draw cell: a course is under 4 km across and holds a few hundred sprites of a kind, so a kind and family is one draw, not one per 512 m of road. */
export const ASSET_DRAW_CELL = 8192;

/** The draw group of the placement of asset `asset` at (x, z): its row's kind and family in a `ASSET_DRAW_CELL` cell, drawn as one instanced mesh (a solid card, cross or box shares its plain kind's geometry and material). */
export function assetDrawGroupOf(asset: number, x: number, z: number, cell: number = ASSET_DRAW_CELL): string {
  const row = SCENERY_ASSETS[asset];
  if (row === undefined) throw new Error(`scenery asset ${asset} is no registry row`);
  return `${row.kind}:${row.family}@${Math.floor(x / cell + 0.5)},${Math.floor(z / cell + 0.5)}`;
}

/** The draw cell widths (m) a course uses unless its `environment.drawCell` names one. */
export const DRAW_CELLS = { prop: 512, asset: ASSET_DRAW_CELL } as const;
