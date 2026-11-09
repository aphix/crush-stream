/**
 * Main-thread ms spent this frame on present work only the costlier FX tiers run, outside the draw submit: the contour relax of a
 * moved skin (`normal-smooth.ts`, high and ultra) and the dent creases' blur (`paint-scratch.ts`, high and ultra). The engine adds it
 * to the frame's render ms and zeroes it (`takeTierWork`), so the FX governors judge it as what a tier changes, not as sim.
 */
const work = { ms: 0, timed: false };

/** Whether anything reads the tier work (the Auto FX tier judges it: the engine sets this each frame from `autoFx.auto`). Off, the work reads no clock: a clock read boxes its number, and Node's `performance.now` allocates besides. */
export function timeTierWork(on: boolean): void {
  work.timed = on;
}

/** The clock a piece of tier-gated present work starts at (`bookTierWork`'s `since`); 0 while nothing reads it. */
export function tierWorkStart(): number {
  return work.timed ? performance.now() : 0;
}

/** The ms since `since` (`tierWorkStart`) more of this frame's tier-gated present work. */
export function bookTierWork(since: number): void {
  if (work.timed) work.ms += performance.now() - since;
}

/** This frame's tier-gated present work (ms), zeroed for the next. */
export function takeTierWork(): number {
  const ms = work.ms;
  work.ms = 0;
  return ms;
}
