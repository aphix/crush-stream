import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * A HUD preference kept in localStorage. The server render (and hydration) sees ""; anything mounted
 * afterwards reads the stored value straight away, so a remembered open section never flashes shut.
 * Until the user picks, the value is `phone` below the md breakpoint and on a phone on its side (the `phone-landscape` variant), `wide` otherwise.
 * Blocked storage (site data off, sandboxed frames) or a full quota keeps the choice for this page instead.
 */
export function useStoredString(key: string, phone: string, wide: string): [string, (next: string) => void] {
  const value = useSyncExternalStore(subscribe, () => remembered(key) ?? (wideScreen() ? wide : phone), () => "");
  return [
    value,
    (next) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch (err) {
        if (!(err instanceof DOMException)) throw err;
        // Storage blocked or full: `memory` keeps it for this page.
      }
      notify();
    },
  ];
}

/** Each key's value as this page knows it: read from storage once (null: none stored), then as last set. */
const memory = new Map<string, string | null>();

function remembered(key: string): string | null {
  const known = memory.get(key);
  if (known !== undefined) return known;
  const value = stored(key);
  memory.set(key, value);
  return value;
}

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
    return null;
  }
}

/** Whether the screen takes the `wide` default: read once (null before), then kept as its two media queries change. */
const wideRead: { matches: boolean | null } = { matches: null };

function wideScreen(): boolean {
  if (wideRead.matches !== null) return wideRead.matches;
  const md = window.matchMedia("(min-width: 768px)");
  const phoneLandscape = window.matchMedia("(pointer: coarse) and (max-height: 500px)");
  const read = (): boolean => (wideRead.matches = md.matches && !phoneLandscape.matches);
  const changed = (): void => {
    read();
    notify();
  };
  for (const query of [md, phoneLandscape]) query.addEventListener("change", changed);
  return read();
}
