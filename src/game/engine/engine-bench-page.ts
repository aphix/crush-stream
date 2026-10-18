import { FRAME } from "./bench-hitch.ts";
import { PAGE_PHASES, type PageEvent, type PageSeconds } from "./engine-bench-report.ts";

/** Entries a run keeps: far above the handful of tab switches a run sees. Past it changes are dropped; each phase's opening entry always fits. */
const PAGE_CAP = 64;
const PAGE_VISIBLE = 1;
const PAGE_FOCUSED = 2;
const PAGE_FULLSCREEN = 4;
/** The screen wake lock is held (the per-second series only: the loop's lock, not a page event). */
const PAGE_AWAKE = 8;
/** Seconds the per-second series holds: a whole loop step (a page of the loop takes 10 minutes at the slowest) with room. */
const SECONDS_CAP = 1800;
/** The page events that change what `watchPage` records: shown/hidden and fullscreen on the document, focus on the window. */
const PAGE_DOC_EVENTS = ["visibilitychange", "fullscreenchange"] as const;
const PAGE_WIN_EVENTS = ["focus", "blur"] as const;

/** Safari on iPad still ships the prefixed element (same fallback as the HUD's fullscreen button). */
type FsDocument = Document & { webkitFullscreenElement?: Element | null };

/** Fullscreen by the API (`fullscreenElement`) or as an installed app launched `display: fullscreen`, where that element stays null. */
function isFullscreen(): boolean {
  const d: FsDocument = document;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null || window.matchMedia("(display-mode: fullscreen)").matches;
}

/** What `watchPage` gives: the stretch of the run, the page's changes, whether it changed lately, and the page's state each second. */
export interface PageWatch {
  phase(index: number): void;
  stop(): PageEvent[];
  changedWithin(ms: number): boolean;
  /**
   * One frame of the per-second series: reads the frame's stamp from `row` (`FRAME.now`) and writes the page's state (the last event's, plus whether
   * the screen is `awake`) for every second the run has reached since its first frame, so a second the page drew no frame in (hidden) still has its entry.
   */
  tick(row: Float64Array, phase: number, awake: boolean, sky: number): void;
  /** The series as the card carries it: a hex digit a second (bits visible 1, focused 2, fullscreen 4, awake 8), the stretch's index a second and the sky as drawn (`SKY_DRAWN`) a second. */
  seconds(): PageSeconds;
}

/**
 * The page's state (shown, focused, fullscreen: the API or the installed app's display mode) from the first `phase` until `stop`: one entry as each phase begins and one at every
 * change (`BenchResult.pageEvents`), and a state a second (`seconds`). Listeners, not per-frame reads: a hidden page draws no frames, so only its events see it go and
 * come back. The listener writes into preallocated arrays (nothing allocates while the bench measures); `stop` and `seconds` build the card's values.
 */
export function watchPage(): PageWatch {
  const phaseAtS = new Float64Array(PAGE_CAP);
  const phaseOf = new Uint8Array(PAGE_CAP);
  const flags = new Uint8Array(PAGE_CAP);
  const secondFlags = new Uint8Array(SECONDS_CAP);
  const secondPhase = new Uint8Array(SECONDS_CAP);
  const secondSky = new Uint8Array(SECONDS_CAP);
  let n = 0;
  let seconds = 0;
  let firstStamp = -1;
  let current = 0;
  let lastChangeMs = -Infinity;
  let phase = 0;
  let phaseStart = performance.now();
  const record = (): void => {
    phaseAtS[n] = (performance.now() - phaseStart) / 1000;
    phaseOf[n] = phase;
    current = (document.hidden ? 0 : PAGE_VISIBLE) | (document.hasFocus() ? PAGE_FOCUSED : 0) | (isFullscreen() ? PAGE_FULLSCREEN : 0);
    flags[n++] = current;
  };
  const note = (): void => {
    lastChangeMs = performance.now();
    if (n < PAGE_CAP - PAGE_PHASES.length) record();
  };
  for (const e of PAGE_DOC_EVENTS) document.addEventListener(e, note);
  for (const e of PAGE_WIN_EVENTS) window.addEventListener(e, note);
  return {
    changedWithin: (ms) => performance.now() - lastChangeMs <= ms,
    phase: (index) => {
      phase = index;
      phaseStart = performance.now();
      record();
    },
    tick: (row, index, awake, sky) => {
      if (firstStamp < 0) firstStamp = row[FRAME.now]!;
      const reached = Math.floor((row[FRAME.now]! - firstStamp) / 1000);
      const state = awake ? current | PAGE_AWAKE : current;
      while (seconds <= reached && seconds < SECONDS_CAP) {
        secondFlags[seconds] = state;
        secondSky[seconds] = sky;
        secondPhase[seconds++] = index;
      }
    },
    seconds: () => {
      let states = "";
      let phases = "";
      let skies = "";
      for (let i = 0; i < seconds; i++) {
        states += secondFlags[i]!.toString(16);
        phases += secondPhase[i]!.toString(16);
        skies += secondSky[i]!.toString(16);
      }
      return { flags: states, phases, sky: skies };
    },
    stop: () => {
      for (const e of PAGE_DOC_EVENTS) document.removeEventListener(e, note);
      for (const e of PAGE_WIN_EVENTS) window.removeEventListener(e, note);
      const events: PageEvent[] = new Array(n);
      for (let i = 0; i < n; i++) {
        events[i] = { phase: PAGE_PHASES[phaseOf[i]!]!, atS: phaseAtS[i]!, visible: (flags[i]! & PAGE_VISIBLE) !== 0, focused: (flags[i]! & PAGE_FOCUSED) !== 0, fullscreen: (flags[i]! & PAGE_FULLSCREEN) !== 0 };
      }
      return events;
    },
  };
}
