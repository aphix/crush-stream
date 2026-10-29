import { useEffect, useState, useSyncExternalStore } from "react";
import type { HudStore } from "@/game/hud/hud-store";
import { NOW_PLAYING_MS, nowPlayingCorner, type NowPlayingCorner } from "@/game/hud/now-playing";
import { prefersReducedMotion } from "@/lib/utils";

/** A phone in portrait: Tailwind's `sm` breakpoint is 640 px. */
const NARROW_QUERY = "(max-width: 639px)";

const CORNER_CLASS: Record<NowPlayingCorner, string> = {
  "top-right": "top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))]",
  "top-center": "top-[max(0.5rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2",
  "bottom-left": "bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))]",
};

function subscribeNarrow(notify: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

type Phase = "hidden" | "shown" | "fading";

/**
 * "♪ Artist – Title" for `NOW_PLAYING_MS` each time a song starts (`trackSerial` changes), then a fade that ends on its `transitionend`
 * (none under reduced motion: it simply goes). It sits in the corner the screen leaves free (`nowPlayingCorner`).
 */
export function NowPlaying({ store }: { store: HudStore }) {
  const hud = useSyncExternalStore(store.subscribe, store.get, store.get);
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches, () => false);
  const [phase, setPhase] = useState<Phase>("hidden");
  const serial = hud.trackSerial;
  useEffect(() => {
    if (serial === 0) return;
    setPhase("shown");
    const fade = window.setTimeout(() => setPhase(prefersReducedMotion() ? "hidden" : "fading"), NOW_PLAYING_MS);
    return () => window.clearTimeout(fade);
  }, [serial]);
  if (phase === "hidden") return null;
  const race = hud.race;
  const corner = nowPlayingCorner({
    raceLive: race !== null || hud.derbyView !== null,
    menuOpen: race?.menu != null,
    reel: race?.reel != null || race?.solo != null,
    narrow,
  });
  return (
    <div
      role="status"
      aria-live="polite"
      onTransitionEnd={(event) => {
        if (phase === "fading" && event.target === event.currentTarget && event.propertyName === "opacity") setPhase("hidden");
      }}
      className={`pointer-events-none fixed z-[60] max-w-[min(20rem,calc(100vw-1rem))] truncate rounded-full bg-surface/80 px-3 py-1 text-xs text-fg shadow-[var(--shadow-border)] transition-opacity duration-[600ms] motion-reduce:transition-none ${CORNER_CLASS[corner]} ${phase === "shown" ? "opacity-100" : "opacity-0"}`}
    >
      ♪ {hud.nowPlaying}
    </div>
  );
}
