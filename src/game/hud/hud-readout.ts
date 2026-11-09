import type { CrashHudState } from "./hud-store.ts";

/** The readouts of the game itself: the race standings, the derby board, the speeds, the clock, the views of cars, the bubble, and the piston and door scenes' readouts. The settings screen shows none of them. */
const SIM_READOUT = [
  "race", "derbyBoard", "derbyView", "fleetView", "derbyWinner", "derbyDecided", "derbyTime", "elapsed", "speedA", "speedB", "closingKph",
  "impactKph", "eta", "fps", "phase", "trackSerial", "nowPlaying", "drift", "boost", "foot", "pistons", "doors",
] as const satisfies readonly (keyof CrashHudState)[];

/** Readings that are not settings but are shown on the settings screen: the quality rows print the draw distance, the render scale and the shadow map the governors have settled on. */
const SHOWN_IN_SETTINGS = ["viewFar", "pixelRatio", "shadowMap"] as const satisfies readonly (keyof CrashHudState)[];

/** The HUD state that is not a setting: what the game reads out and what the quality governors report. A bench card keeps none of it. */
export const HUD_READOUT = [...SIM_READOUT, ...SHOWN_IN_SETTINGS] as const;

/** The readouts the settings accordion never reads: `sameSettings` takes no notice of them. */
export const UNSEEN_BY_SETTINGS: ReadonlySet<string> = new Set(SIM_READOUT);

/**
 * Whether two snapshots read the same to what shows only settings (the accordion): every setting and shown reading the same, and a readout it does not show the same only in whether it is there (a null, or not):
 * the settings screen need not be rendered again as the sim's numbers move, and the rows that hide for a race still do.
 */
export function sameSettings(before: CrashHudState, after: CrashHudState): boolean {
  for (const key of Object.keys(after) as (keyof CrashHudState)[]) {
    if (UNSEEN_BY_SETTINGS.has(key) ? (before[key] === null) !== (after[key] === null) : !Object.is(before[key], after[key])) return false;
  }
  return true;
}
