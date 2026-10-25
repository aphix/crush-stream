import { STATION_IDS, stationOf, type MusicTrack, type StationId } from "./music-manifest.ts";

/** A uniform random permutation of 0..count-1 (Fisher-Yates from `random01`, each draw in [0, 1)) that never opens with `justPlayed` while another track exists. */
export function shuffledOrder(count: number, justPlayed: number, random01: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let last = count - 1; last > 0; last--) {
    const pick = Math.min(last, Math.floor(random01() * (last + 1)));
    [order[last], order[pick]] = [order[pick]!, order[last]!];
  }
  if (count > 1 && order[0] === justPlayed) {
    const swapWith = 1 + Math.min(count - 2, Math.floor(random01() * (count - 1)));
    [order[0], order[swapWith]] = [order[swapWith]!, order[0]!];
  }
  return order;
}

/** The shuffle bag of one station: every track plays once per loop in a fresh order, and a new loop never opens with the track that just ended. */
export class ShuffleBag {
  private readonly count: number;
  private readonly random01: () => number;
  private upcoming: number[] = [];
  private justPlayed = -1;

  constructor(count: number, random01: () => number) {
    this.count = count;
    this.random01 = random01;
  }

  /** The next track's index; -1 when the station has no track. */
  next(): number {
    if (this.count === 0) return -1;
    if (this.upcoming.length === 0) this.upcoming = shuffledOrder(this.count, this.justPlayed, this.random01);
    this.justPlayed = this.upcoming.shift()!;
    return this.justPlayed;
  }
}

/** Every station's shuffle bag over the tracks the manifest puts on it (a track with no station is on the default one). */
export class Radio {
  private readonly stations = new Map<StationId, { tracks: MusicTrack[]; bag: ShuffleBag }>();

  constructor(tracks: readonly MusicTrack[], random01: () => number) {
    for (const id of STATION_IDS) {
      const own = tracks.filter((track) => stationOf(track) === id);
      this.stations.set(id, { tracks: own, bag: new ShuffleBag(own.length, random01) });
    }
  }

  trackCount(station: StationId): number {
    return this.stations.get(station)!.tracks.length;
  }

  /** The station's next shuffled track; null when it has none. */
  next(station: StationId): MusicTrack | null {
    const { tracks, bag } = this.stations.get(station)!;
    return tracks[bag.next()] ?? null;
  }
}
