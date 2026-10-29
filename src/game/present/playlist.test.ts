import { describe, it } from "vitest";
import assert from "node:assert/strict";
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
          assert.equal(played.join(), Array.from({ length: c.count }, (_, index) => index).join(), `seed ${seed} loop ${loop}`);
        }
      }
    });
  }
  it("when 4 tracks are walked twice round, then every track plays twice", () => {
    const counts = [0, 0, 0, 0];
    for (const index of deal(new ShuffleBag(4, mulberry32(7)), 8)) counts[index]!++;
    assert.equal(counts.join(), "2,2,2,2");
  });
  it("when a loop ends, then the next loop never opens with the track that just ended", () => {
    for (let seed = 0; seed < 200; seed++) {
      const plays = deal(new ShuffleBag(3, mulberry32(seed)), 60);
      for (let loop = 1; loop < 20; loop++) assert.notEqual(plays[loop * 3], plays[loop * 3 - 1], `seed ${seed} loop ${loop}`);
    }
  });
  it("when the dice would open the next loop with the track that just ended, then that entry swaps out", () => {
    assert.equal(shuffledOrder(4, -1, () => 0).join(), "1,2,3,0", "the dice's order with no track to avoid");
    assert.equal(shuffledOrder(4, 3, () => 0).join(), "1,2,3,0", "a different track just ended: no swap");
    assert.equal(shuffledOrder(4, 1, () => 0).join(), "2,1,3,0", "track 1 just ended and would open: it swaps with the next entry");
  });
  it("when the order is shuffled, then different dice give different first tracks (every track can open a session)", () => {
    const openers = new Set<number>();
    for (let seed = 0; seed < 100; seed++) openers.add(new ShuffleBag(4, mulberry32(seed)).next());
    assert.equal([...openers].sort().join(), "0,1,2,3");
  });
  it("when the station has no track, then the bag deals -1", () => {
    assert.equal(new ShuffleBag(0, mulberry32(1)).next(), -1);
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
      assert.equal(plays.slice(0, 2).sort().join(), "b,d", `seed ${seed} first loop`);
      assert.equal(plays.slice(2, 4).sort().join(), "b,d", `seed ${seed} second loop`);
    }
  });
  it("when the high station plays, then the track with no station is on it with the tracks marked high", () => {
    for (let seed = 0; seed < 25; seed++) assert.equal(dealt("high", 3, seed).sort().join(), "a,c,e", `seed ${seed}`);
  });
  it("when the station switches from high to calm, then the next track is a calm one", () => {
    const radio = new Radio(tracks, mulberry32(3));
    assert.ok(["a", "c", "e"].includes(radio.next("high")!.title), "high plays a high track");
    assert.ok(["b", "d"].includes(radio.next("calm")!.title), "calm plays a calm track");
  });
  it("when a station has no track, then it deals none and counts zero", () => {
    const onlyHigh = new Radio([track("a")], mulberry32(1));
    assert.equal(onlyHigh.next("calm"), null);
    assert.equal(onlyHigh.trackCount("calm"), 0);
    assert.equal(onlyHigh.trackCount("high"), 1);
  });
});
