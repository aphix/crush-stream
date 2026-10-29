import { describe, expect, it } from "vitest";
import { Radio, ShuffleBag, shuffledOrder } from "./playlist.ts";
import type { MusicTrack, StationId } from "./music-manifest.ts";
import { mulberry32 } from "../world/placements.ts";

/** The next `plays` tracks the bag deals. */
function deal(bag: ShuffleBag, plays: number): number[] {
  return Array.from({ length: plays }, () => bag.next());
}

describe("given a shuffle bag over a station's tracks", () => {
  const testCases = [
    { count: 1, loops: 5 },
    { count: 2, loops: 20 },
    { count: 4, loops: 20 },
    { count: 10, loops: 20 },
  ];
  for (const c of testCases) {
    it(`when ${c.count} tracks are walked ${c.loops} loops from any seed, then every loop plays every track exactly once`, () => {
      for (let seed = 0; seed < 25; seed++) {
        const plays = deal(new ShuffleBag(c.count, mulberry32(seed)), c.count * c.loops);
        for (let loop = 0; loop < c.loops; loop++) {
          const played = plays.slice(loop * c.count, (loop + 1) * c.count).sort((a, b) => a - b);
          expect(played.join(), `seed ${seed} loop ${loop}`).toBe(Array.from({ length: c.count }, (_, index) => index).join());
        }
      }
    });
  }
  it("when 4 tracks are walked twice round, then every track plays twice", () => {
    const counts = [0, 0, 0, 0];
    for (const index of deal(new ShuffleBag(4, mulberry32(7)), 8)) counts[index]!++;
    expect(counts.join()).toBe("2,2,2,2");
  });
  it("when a loop ends, then the next loop never opens with the track that just ended", () => {
    for (let seed = 0; seed < 200; seed++) {
      const plays = deal(new ShuffleBag(3, mulberry32(seed)), 60);
      for (let loop = 1; loop < 20; loop++) expect(plays[loop * 3], `seed ${seed} loop ${loop}`).not.toBe(plays[loop * 3 - 1]);
    }
  });
  it("when a shuffle would open the next loop with the track that just ended, then a different track opens it", () => {
    expect(shuffledOrder(4, -1, () => 0).join(), "the dice's order with no track to avoid").toBe("1,2,3,0");
    expect(shuffledOrder(4, 3, () => 0).join(), "a different track just ended: no swap").toBe("1,2,3,0");
    expect(shuffledOrder(4, 1, () => 0).join(), "track 1 just ended and would open: it swaps with the next entry").toBe("2,1,3,0");
  });
  it("when the order is shuffled with different seeds, then every track can open a session", () => {
    const openers = new Set<number>();
    for (let seed = 0; seed < 100; seed++) openers.add(new ShuffleBag(4, mulberry32(seed)).next());
    expect([...openers].sort().join()).toBe("0,1,2,3");
  });
  it("when the station has no track, then the bag deals -1", () => {
    expect(new ShuffleBag(0, mulberry32(1)).next()).toBe(-1);
  });
});

function track(file: string, station?: StationId): MusicTrack {
  return { file: `${file}.mp3`, artist: "Artist", title: file, attribution: [], links: [], station };
}

describe("given a radio over tracks on two stations and one with no station", () => {
  const tracks = [track("a", "high"), track("b", "calm"), track("c"), track("d", "calm"), track("e", "high")];
  const dealt = (station: StationId, plays: number, seed: number): string[] => {
    const radio = new Radio(tracks, mulberry32(seed));
    return Array.from({ length: plays }, () => radio.next(station)!.title);
  };
  it("when the calm station plays, then only its own tracks come out, every one once per loop", () => {
    for (let seed = 0; seed < 25; seed++) {
      const plays = dealt("calm", 4, seed);
      expect(plays.slice(0, 2).sort().join(), `seed ${seed} first loop`).toBe("b,d");
      expect(plays.slice(2, 4).sort().join(), `seed ${seed} second loop`).toBe("b,d");
    }
  });
  it("when the high station plays, then the track with no station is on it with the tracks marked high", () => {
    for (let seed = 0; seed < 25; seed++) expect(dealt("high", 3, seed).sort().join(), `seed ${seed}`).toBe("a,c,e");
  });
  it("when the station switches from high to calm, then the next track is a calm one", () => {
    const radio = new Radio(tracks, mulberry32(3));
    expect(["a", "c", "e"].includes(radio.next("high")!.title), "high plays a high track").toBeTruthy();
    expect(["b", "d"].includes(radio.next("calm")!.title), "calm plays a calm track").toBeTruthy();
  });
  it("when a station has no track, then it deals none and counts zero while the station with a track counts one", () => {
    const onlyHigh = new Radio([track("a")], mulberry32(1));
    expect(onlyHigh.next("calm")).toBe(null);
    expect(onlyHigh.trackCount("calm")).toBe(0);
    expect(onlyHigh.trackCount("high")).toBe(1);
  });
});
