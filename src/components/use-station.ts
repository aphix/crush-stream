import { useStoredString } from "@/components/use-stored-string";
import { DEFAULT_STATION, stationIdOrDefault, type StationId } from "@/game/present/music-manifest";

const STATION_KEY = "crush.audio.station";

/** This browser's radio station (the default until picked); `CrashLab` mirrors it into the engine. */
export function useStation(): { station: StationId; setStation: (station: StationId) => void } {
  const [saved, setStation] = useStoredString(STATION_KEY, DEFAULT_STATION, DEFAULT_STATION);
  return { station: stationIdOrDefault(saved), setStation };
}
