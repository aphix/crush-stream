/** How long the "now playing" toast stays fully shown (ms); its fade-out is the toast's CSS transition, which ends the toast. */
export const NOW_PLAYING_MS = 4000;

/** What on screen decides where the toast sits: the plain facts the HUD state and the viewport give. */
export type NowPlayingContext = {
  /** A race, a derby or a survival run is the scene (its title sits top left). */
  raceLive: boolean;
  /** A race sheet (setup, pause, dead, results, standings) is open. */
  menuOpen: boolean;
  /** The results reel or a solo clip view plays. */
  reel: boolean;
  /** A phone-portrait width (under 640 px). */
  narrow: boolean;
};

export type NowPlayingCorner = "top-right" | "top-center" | "bottom-left";

/**
 * The corner the toast takes, the first rule that holds:
 * 1. the reel: top-center, in the shader letterbox's top bar (the reel sheet is right/bottom, the standings cover left);
 * 2. a race sheet on a wide screen: bottom-left (the results sheet is a right panel from 640 px, the sheets are centred and the dock row is hidden then);
 * 3. the sandbox, rigs and lab on a phone: top-right (the title is gone, the online button is left, the readouts panel sits below);
 * 4. everything else: top-center. The corners are taken: a race's title and standings left, the readouts (the sandbox's panel, a race's
 *    lap and position) right, the gauge and touch buttons bottom-right, the stick and dock bottom-left. On a phone in a race the
 *    toast covers the tail of the race title for its few seconds: no corner is free there.
 */
export function nowPlayingCorner(context: NowPlayingContext): NowPlayingCorner {
  if (context.reel) return "top-center";
  if (context.menuOpen && !context.narrow) return "bottom-left";
  if (context.narrow && !context.raceLive) return "top-right";
  return "top-center";
}
