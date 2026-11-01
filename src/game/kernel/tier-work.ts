/**
 * Main-thread ms spent this frame on present work only the costlier FX tiers run, outside the draw submit: the contour relax of a
 * moved skin (`normal-smooth.ts`, high and ultra) and the dent creases' blur (`paint-scratch.ts`, high and ultra). The engine adds it
 * to the frame's render ms and zeroes it (`takeTierWork`), so the FX governors judge it as what a tier changes, not as sim.
 */
const work = { ms: 0 };

/** `ms` more of this frame's tier-gated present work. */
export function bookTierWork(ms: number): void {
  work.ms += ms;
}

/** This frame's tier-gated present work (ms), zeroed for the next. */
export function takeTierWork(): number {
  const ms = work.ms;
  work.ms = 0;
  return ms;
}
