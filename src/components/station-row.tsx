import { ChangedDot, SEGMENT, TRACK } from "@/components/hud-controls";
import { Button } from "@/components/ui/button";
import { useStation } from "@/components/use-station";
import { DEFAULT_STATION, STATION_IDS, stationName } from "@/game/present/music-manifest";
import { cn } from "@/lib/utils";

/** The Audio section's radio row: one button per station; the pick is saved for this browser and `CrashLab` mirrors it into the engine. */
export function StationRow() {
  const { station, setStation } = useStation();
  return (
    <div className="flex items-center gap-2">
      <span className="hud-label relative w-12 shrink-0">
        Radio
        <ChangedDot on={station !== DEFAULT_STATION} />
      </span>
      <div className={cn(TRACK, "grid-cols-2")} role="group" aria-label="Radio station">
        {STATION_IDS.map((id) => (
          <Button
            key={id}
            className={SEGMENT}
            variant={station === id ? "default" : "ghost"}
            aria-pressed={station === id}
            aria-label={`Radio station ${stationName(id)}`}
            onClick={() => setStation(id)}
          >
            {stationName(id)}
          </Button>
        ))}
      </div>
    </div>
  );
}
