import { ACTIVITY, ACTIVITY_OPEN_ENDED } from "./civilian-activity.ts";
import type { CityState } from "./civilian-state.ts";

/** What the society says a resident is doing now, and where it places them when they are on no leg (`placed`). */
export type ActivityReading = { code: number; sinceSeconds: number; leftSeconds: number; partner: number; surfaceY: number; placed: boolean; x: number; z: number; yaw: number };

/** PLACEHOLDER until the society's own reader replaces this file: every resident is walking or standing, none is placed. */
export function readActivity(_state: CityState, _resident: number, _crowdSeconds: number, out: ActivityReading): void {
  out.code = ACTIVITY.none;
  out.sinceSeconds = 0;
  out.leftSeconds = ACTIVITY_OPEN_ENDED;
  out.partner = -1;
  out.surfaceY = 0;
  out.placed = false;
}
