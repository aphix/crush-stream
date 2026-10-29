import { useEffect, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CrashEngine } from "@/game/engine/engine";
import { pressTouchButton, releaseTouchButton } from "@/game/hud/touch-scheme";

/** Unmounted under a finger (the seat changed): let go, or the bit would stay held. */
export function useReleaseOnUnmount(engine: RefObject<CrashEngine | null>, button: number): void {
  useEffect(
    () => () => {
      const t = engine.current?.touch;
      if (t) releaseTouchButton(t, button);
    },
    [engine, button],
  );
}

/**
 * The touch pad's one way to press a button (`PAD_BUTTON` index): held while a finger is on the element, and a tap shorter than a frame
 * still presses. Spread the result on any button; the thumb pad's buttons, Easy's Boost and the nitrous bottle share it, so there is one boost path.
 */
export function usePadHold(engine: RefObject<CrashEngine | null>, button: number) {
  useReleaseOnUnmount(engine, button);
  const release = (e: ReactPointerEvent<HTMLElement>): void => {
    delete e.currentTarget.dataset.held;
    const t = engine.current?.touch;
    if (t) releaseTouchButton(t, button);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>): void => {
      const t = engine.current?.touch;
      if (!t) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.dataset.held = "";
      pressTouchButton(t, button);
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onContextMenu: (e: { preventDefault: () => void }): void => e.preventDefault(),
  };
}
