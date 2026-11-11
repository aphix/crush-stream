import { fmtClock12 } from "@/game/hud/race-clock";
import { cn } from "@/lib/utils";

/** The open world's time of day, small and dim; nothing outside the open world. */
export function GameClock({ minute, className }: { minute: number | null; className?: string }) {
  if (minute === null) return null;
  return (
    <p className={cn("hud-ink hud-label tabular-nums text-fg/60", className)} role="timer" aria-label="Game time">
      {fmtClock12(minute)}
    </p>
  );
}
