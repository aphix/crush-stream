import type { RaceHudRow, RacePhase } from "../match/types.ts";

/** Wall ms a row that left the standings stays on screen to fade out (the row's `--motion-fast`, 250 ms, plus a frame). */
export const LEAVE_MS = 300;

/**
 * The classes every standings row (`li`) carries (masterclass 23:34, "fade them in or out"): a row slides to its new place
 * (`useSlide` hands it its old offset, the transform transition takes it home), and fades in from `data-fading` when it
 * arrives and out to it while it leaves. A transition, not a keyframe animation: a row the DOM moves on a pass would
 * restart an animation and blink.
 */
export const STANDING_LI = "transition-[transform,opacity] duration-[var(--motion-fast)] ease-[var(--ease-out)] data-[fading]:pointer-events-none data-[fading]:opacity-0";

export type StandingSlot = { row: RaceHudRow; leaving: boolean };

/** `rows` (live order) with each of `gone` (rows that left, in the order they stood) put back at its last place, flagged leaving. A row that is back in `rows` is not a leaver. */
export function withLeavers(rows: readonly RaceHudRow[], gone: readonly RaceHudRow[]): StandingSlot[] {
  const out: StandingSlot[] = rows.map((row) => ({ row, leaving: false }));
  for (const g of gone) {
    if (rows.some((r) => r.id === g.id)) continue;
    out.splice(Math.min(out.length, g.place - 1), 0, { row: g, leaving: true });
  }
  return out;
}

/** Wall ms a phone's standings list stays up after the viewer's place changes (a pass either way). */
export const PASS_FLASH_MS = 3000;

/** Race seconds after green the phone's standings list stays up, so the field is read off the grid before it thins out. */
export const GREEN_WINDOW_SECONDS = 4;

/**
 * When the pass flash ends after the viewer's place went from `previousPlace` to `place` at wall time `now`: a new window when it
 * changed, else `flashUntil` as it was. The first sample (no previous place) and a missing place are not a pass.
 */
export function nextFlashUntil(previousPlace: number | null, place: number | null, now: number, flashUntil: number): number {
  if (previousPlace === null || place === null || previousPlace === place) return flashUntil;
  return now + PASS_FLASH_MS;
}

export type StandingsVisibility = {
  /** Watching another car, not driving. */
  spectating: boolean;
  phase: RacePhase | null;
  /** Race clock (s): negative before green. */
  raceTime: number;
  /** The results reel plays. */
  reel: boolean;
  flashUntil: number;
  now: number;
};

/**
 * Whether the phone's standings list is up: always while spectating, over the results reel and once the race is over, on the grid
 * and countdown and the first `GREEN_WINDOW_SECONDS` after green, and until `flashUntil` after a pass. Otherwise it fades out and
 * leaves the road clear.
 */
export function standingsVisible({ spectating, phase, raceTime, reel, flashUntil, now }: StandingsVisibility): boolean {
  if (phase === null) return false;
  if (spectating || reel) return true;
  if (phase === "grid" || phase === "countdown" || phase === "finished") return true;
  return raceTime < GREEN_WINDOW_SECONDS || now < flashUntil;
}
