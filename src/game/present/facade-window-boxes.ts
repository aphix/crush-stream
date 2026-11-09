/**
 * Where a house's window boxes stand: on the sills of the windows its picture shows (the window table, `facade-fittings.ts`), one storey's worth, never over the window that holds the
 * air-conditioning unit. Drawn only; a box is 0.28 m out of the wall and 3.7 m or more over the sidewalk, so it is over no path and no stoop tread.
 */

/** A window of the street face as the table gives it (`visibleWindowsOf`): its middle across the lot, its width, its sill over the sidewalk and the storey it lights. */
export type SillWindow = { across: number; width: number; sill: number; storey: number };

/** One box as the kit stands it (`facade-bays.ts` `Placement`). */
type BoxPlacement = { across: number; up: number; width: number; height: number; depth: number };

/** A box is this share of its window's width, this tall and this far out of the wall (m), its trough hanging this far under the sill, and no window narrower than `minWindow` gets one. */
export const WINDOW_BOX = { share: 0.9, overall: 0.55, depth: 0.28, below: 0.16, minWindow: 0.6 } as const;

/** The boxes of the windows of `storey` among `windows`, less the window `skip` holds an air-conditioning unit. */
export function windowBoxPlacements(windows: readonly SillWindow[], storey: number, skip: SillWindow | null): BoxPlacement[] {
  const placements: BoxPlacement[] = [];
  for (const window of windows) {
    if (window.storey !== storey || window.width < WINDOW_BOX.minWindow) continue;
    if (skip !== null && skip.across === window.across && skip.sill === window.sill) continue;
    placements.push({ across: window.across, up: window.sill - WINDOW_BOX.below, width: window.width * WINDOW_BOX.share, height: WINDOW_BOX.overall, depth: WINDOW_BOX.depth });
  }
  return placements;
}
