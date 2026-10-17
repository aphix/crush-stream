/**
 * Quiet time before a driving phone's HUD calms (read-outs and chrome fall to a third of their opacity so the road is all there is).
 * Long enough that a lap or a pass is read before it fades, short enough that a straight does not sit under a lit HUD.
 */
export const CALM_MS = 4000;

/** An options object: Node's EventTarget ignores a bare `true` when removing the listener. */
const CAPTURE = { capture: true };

export interface CalmWatch {
  stop: () => void;
  /** Counts as a wake: the HUD lights up if it was calm, and the countdown restarts (a pass, a lap, a crash: news the player should see). */
  wake: () => void;
}

/**
 * Calls `onCalm` once `target` has seen no wake for `ms`; a wake (a tap, or `wake()`) calls `onWake` if the HUD was calm and restarts the
 * countdown, so the watcher cycles calm / lit for as long as it runs.
 * A tap on an element marked `data-keep-idle` (the driving controls) is not a wake: holding the pedals must not keep the HUD lit.
 */
export function watchCalm(target: EventTarget, onCalm: () => void, onWake: () => void, ms = CALM_MS): CalmWatch {
  let calm = false;
  const settle = (): void => {
    calm = true;
    onCalm();
  };
  let timer = setTimeout(settle, ms);
  const wake = (): void => {
    if (calm) {
      calm = false;
      onWake();
    }
    clearTimeout(timer);
    timer = setTimeout(settle, ms);
  };
  const tapped = (e: Event): void => {
    if ((e.target as Element).closest?.("[data-keep-idle]")) return;
    wake();
  };
  target.addEventListener("pointerdown", tapped, CAPTURE);
  return {
    stop: () => {
      clearTimeout(timer);
      target.removeEventListener("pointerdown", tapped, CAPTURE);
    },
    wake,
  };
}
