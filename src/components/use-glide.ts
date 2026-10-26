import { useLayoutEffect, useRef, type RefObject } from "react";

/** How long (ms) a glide takes to a new value: the 150 ms linear CSS transition it replaced. */
const GLIDE_MS = 150;

type Glide<E> = { el: E | null; from: number; to: number; at: number; shown: number; frame: number };

/**
 * `target` drawn by `draw` on the element the returned ref is put on, gliding to each new value linearly over `GLIDE_MS` from where it stands, as an interrupted
 * CSS transition did: written straight to its style on animation frames, so a HUD snapshot neither re-renders the style nor restarts a transition.
 */
export function useGlide<E extends HTMLElement>(target: number, draw: (el: E, value: number) => void): RefObject<E | null> {
  const ref = useRef<E>(null);
  const glide = useRef<Glide<E>>({ el: null, from: target, to: target, at: 0, shown: target, frame: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    const g = glide.current;
    if (!el) return;
    if (el !== g.el) {
      cancelAnimationFrame(g.frame);
      g.frame = 0;
      g.el = el;
      g.shown = g.to = target;
      draw(el, target);
      return;
    }
    if (target === g.to) return;
    g.from = g.shown;
    g.to = target;
    g.at = performance.now();
    if (g.frame !== 0) return;
    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - g.at) / GLIDE_MS));
      g.shown = g.from + (g.to - g.from) * t;
      if (g.el) draw(g.el, g.shown);
      g.frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    g.frame = requestAnimationFrame(step);
  });
  useLayoutEffect(() => {
    const g = glide.current;
    return () => {
      cancelAnimationFrame(g.frame);
      g.frame = 0;
      g.el = null;
    };
  }, []);
  return ref;
}
