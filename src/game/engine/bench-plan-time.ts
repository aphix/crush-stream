import { BENCH, QUICK } from "./bench-measure.ts";
import { REPLAY_SETTLE_S, REPLAY_TIER_S } from "./engine-bench-replay.ts";
import { FX_TIERS } from "../present/engine-post.ts";
import { FX_TIER_ULTRA } from "../present/constants.ts";
import { DEFAULT_MAPS } from "./bench-loop.ts";

/** How long the loop shows a step's card and receipt before the next step begins. */
export const BETWEEN_STEPS_S = 4;

/** Seconds an A/B arm or the window's opening spends settling, as the cards measured (3.0-4.1 s on a software GL at 10 fps, under 2 s on a desktop GPU). */
const SETTLE_TYPICAL_S = 3.5;
/** The race clock an extended page warms before its window (`warmS` of the city; the strip's is shorter), and the seconds its crash recording and the clip's filing take (the card's replay stretch minus its tiers). */
const EXTENDED_WARM_S = 20;
const REPLAY_FILING_S = 10;

const tiersOf = (ultra: boolean): number => (ultra && (FX_TIERS as readonly string[]).includes(FX_TIER_ULTRA) ? 4 : 3);

/**
 * The quick bench's planned length (s) for `mapCount` maps: its one sweep (the FX tiers and the epicenter pair, held `QUICK.sweepStopS` each), then each map's load, grid and window, and the pauses between pages.
 * What a device's grid and loads really take varies (a phone's longer): the start screen says `about`.
 */
export function quickPlanS(ultra: boolean, mapCount = DEFAULT_MAPS.length): number {
  const sweep = (tiersOf(ultra) + 2) * QUICK.sweepStopS;
  const pages = mapCount * (QUICK.loadS + QUICK.countdownS + QUICK.windowS);
  return sweep + pages + (mapCount - 1) * BETWEEN_STEPS_S;
}

/** The extended bench's planned length (s) for one cycle of two pages for each of `mapCount` maps (both epicenter arms): the first page's full sweep, every page's warm-up, window, the eight A/Bs and the replay. */
export function extendedPlanS(ultra: boolean, mapCount = DEFAULT_MAPS.length): number {
  const tiers = tiersOf(ultra);
  const arms = (count: number, rounds: number): number => count * rounds * (BENCH.blockS + SETTLE_TYPICAL_S);
  const abs = arms(2, BENCH.paceCycles) + arms(3, BENCH.detailCycles) + arms(tiers, BENCH.fxCycles) + arms(3, BENCH.skyCycles) + 3 * arms(2, BENCH.qualityCycles) + arms(3, BENCH.timeCycles);
  const replay = REPLAY_FILING_S + tiers * (REPLAY_SETTLE_S + REPLAY_TIER_S);
  const page = QUICK.loadS + QUICK.countdownS + EXTENDED_WARM_S + SETTLE_TYPICAL_S + BENCH.measureS + abs + replay;
  const fullSweep = (tiers + 2 + 3 + 3 + 2 + 3) * BENCH.sweepS;
  const pages = 2 * mapCount;
  const shortSweeps = (pages - 1) * (tiers + 2) * BENCH.sweepShortS;
  return pages * page + fullSweep + shortSweeps + (pages - 1) * BETWEEN_STEPS_S;
}

/** A planned length as the start screen says it: whole minutes, `about 3 min`. */
export const planText = (seconds: number): string => `about ${Math.max(1, Math.round(seconds / 60))} min`;
