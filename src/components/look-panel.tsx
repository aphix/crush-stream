import type { LookAtHud } from "@/game/hud/hud-store";

/** What the eye is on in the open world: its title (a civilian's name and job, a building's name) over its short lines. Nothing while it rests on nothing. */
export function LookPanel({ lookAt }: { lookAt: LookAtHud | null }) {
  if (!lookAt) return null;
  return (
    <aside className="hud-panel pointer-events-none mt-1 w-56 p-2" aria-label="Looking at">
      <p className="font-display text-sm font-semibold leading-tight">{lookAt.title}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-muted">
        {lookAt.lines.map((line, row) => (
          <li key={row}>{line}</li>
        ))}
      </ul>
    </aside>
  );
}
