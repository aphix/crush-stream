import { useEffect, useRef, type RefObject } from "react";
import type { CrashEngine } from "@/game/engine/engine";
import { BOOST_TAP_SECONDS } from "@/game/hud/touch-scheme";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";

const BOOST_MASK = 1 << PAD_BUTTON.south;

/** Boost as a tap: `tap` presses the pad's Boost and holds it for one meter's burn, `release` lets go early (gas lifted, Brake held, the thumb gone). */
export function useBoostTap(engine: RefObject<CrashEngine | null>) {
  const timer = useRef<number | undefined>(undefined);
  const release = (): void => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const touch = engine.current?.touch;
    if (touch) touch.held &= ~BOOST_MASK;
  };
  const tap = (): void => {
    const touch = engine.current?.touch;
    if (!touch) return;
    release();
    touch.held |= BOOST_MASK;
    touch.tapped |= BOOST_MASK;
    timer.current = window.setTimeout(release, BOOST_TAP_SECONDS * 1000);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      const touch = engine.current?.touch;
      if (touch) touch.held &= ~BOOST_MASK;
    },
    [engine],
  );
  return { tap, release };
}
