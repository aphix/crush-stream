import { CARD } from "@/components/race-menu-shell";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import { startLights } from "@/game/match/session";
import { cn } from "@/lib/utils";

const LIT = ["", "bg-signal-red shadow-lg shadow-signal-red/50", "bg-signal-amber shadow-lg shadow-signal-amber/50", "bg-signal-green shadow-lg shadow-signal-green/50"] as const;

/**
 * The start lights and the 3-2-1-GO numeral for a match clock that runs negative to the green light at 0 (race and
 * derby share it: `startLights`, `GRID_TIME`, `COUNTDOWN`). Nothing once the green has gone out. On a touch screen they are one
 * strip of three small lights beside the numeral (about 120 x 44), so the countdown never covers the road and the cars on the grid.
 */
export function StartLights({ time }: { time: number }) {
  const touch = useCoarsePointer();
  const lights = startLights(time);
  if (time >= 0 && lights === 0) return null;
  const numeral = time >= -3 && time < 0 ? String(Math.ceil(-time)) : time >= 0 && time < 1 ? "GO" : null;
  return (
    <div className={cn(CARD, "flex items-center", touch ? "flex-row gap-2 px-2.5 py-2.5" : "flex-col gap-2 px-3 py-2 sm:gap-3 sm:px-4 sm:py-3")}>
      <div className={cn("flex", touch ? "gap-1.5" : "gap-2 sm:gap-3")} role="img" aria-label="Start lights">
        {([1, 2, 3] as const).map((n) => (
          <span
            key={n}
            className={cn(
              "rounded-full transition-[background-color,box-shadow] duration-[var(--motion-quick)]",
              touch ? "size-5" : "size-12 sm:size-16",
              lights === n ? LIT[n] : "bg-surface-2 shadow-[var(--shadow-border)]",
            )}
          />
        ))}
      </div>
      {numeral ? (
        <p
          className={cn("font-display font-semibold leading-none tracking-tight", touch ? "text-2xl" : "text-6xl sm:text-7xl", numeral === "GO" ? "text-signal-green" : "text-fg")}
          aria-live="assertive"
        >
          {numeral}
        </p>
      ) : null}
    </div>
  );
}
