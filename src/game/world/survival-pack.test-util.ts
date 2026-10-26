import type { Chase } from "./survival-players.test-util.ts";

/**
 * The Survival pack chasing a scripted player in the closed arena (`survival-arena.test-util.ts`: Havana's plaza inside a square of its
 * own stucco, 160 m across): the player cannot leave, so the pack has to catch it. The formation is held until `release(seed)`, spread
 * evenly from `RELEASE_FIRST` to `RELEASE_LAST` over seeds 1-24, so each seed's pack meets the player somewhere else.
 */
const RELEASE_FIRST = 8.1;
const RELEASE_LAST = 12.1;
const RELEASE_SPREAD = 24;

/** The race second seed `seed`'s formation is let go. */
export const release = (seed: number): number => RELEASE_FIRST + ((RELEASE_LAST - RELEASE_FIRST) * (seed - 1)) / (RELEASE_SPREAD - 1);

/** Why `c` is not a run the pack ended (null: it is): still running, ended by something else (or by anything but `only`), or, when `packWins`, a run that ended itself with no powered cop touching. */
export function miss(c: Chase, packWins: boolean, by: number, only: string | null = null): string | null {
  if (!c.ended) return `still running after ${by} s (${c.touches} cop contacts, the last at ${c.lastTouch.toFixed(0)} s)`;
  if (c.cause !== "busted" && c.cause !== "wrecked") return `ended by ${c.cause}`;
  if (only !== null && c.cause !== only) return `ended ${c.cause}, not ${only}`;
  if (packWins && c.time - c.lastTouch >= 2) return `no cop touched the player in the last ${(c.time - c.lastTouch).toFixed(1)} s: it ended itself`;
  return null;
}
