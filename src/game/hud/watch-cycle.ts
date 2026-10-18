import type { CrashHudState } from "./hud-store.ts";

/**
 * Whether Previous / Next are drawn: only while the camera is actually watching a target (a followed car: not the whole field, not at the wheel)
 * and the cycle has somewhere else to go (two or more targets, `CrashHudState.watchTargets`, counted by the same list Q/E and LB/RB walk).
 * Otherwise the buttons take no room at all: no disabled ones, no space kept for them, in any scene, menu or replay.
 */
export function showsPrevNext(state: Pick<CrashHudState, "seat" | "watchTargets">): boolean {
  return state.seat === "follow" && state.watchTargets >= 2;
}
