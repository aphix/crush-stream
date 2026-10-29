import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { HighlightClip } from "./highlights.ts";
import { makeClip } from "../net/reel-clip.test-util.ts";
import { CAMPAIGN_REEL_CLIPS, CampaignReel, reelWeight, WINNER_LEAN } from "./campaign-reel.ts";

const base = makeClip().clip;

/** A clip of `score` on `trackId` with the racers `slots` in it. */
const clipOf = (name: string, score: number, slots: readonly number[], trackId = "city"): HighlightClip => ({
  ...base,
  trackId,
  score,
  cars: slots.map((slot) => ({ ...base.cars[0]!, slot, name: `${name}-${slot}` })),
});

const scores = (clips: readonly HighlightClip[]): number[] => clips.map((c) => c.score);
const noWinners: ReadonlySet<number> = new Set();

/** The reference ranking: every clip, no memory bound, best weighed score first, ties to the earlier clip. */
const rankAll = (all: readonly HighlightClip[], winners: ReadonlySet<number>): HighlightClip[] =>
  all
    .map((clip, order) => ({ clip, order }))
    .sort((a, b) => reelWeight(b.clip, winners) - reelWeight(a.clip, winners) || a.order - b.order)
    .slice(0, CAMPAIGN_REEL_CLIPS)
    .map((r) => r.clip);

describe("given the clips of a campaign's rounds", () => {
  it("when the reel is picked, then it is the three best scores from all the rounds' courses, best first", () => {
    const reel = new CampaignReel();
    reel.note([clipOf("a", 30, [0, 1], "city"), clipOf("b", 10, [2], "city")]);
    reel.note([clipOf("c", 25, [0, 3], "oval"), clipOf("d", 5, [4], "oval")]);
    reel.note([clipOf("e", 40, [1, 2], "havana"), clipOf("f", 12, [0], "havana")]);
    const top = reel.top(noWinners);
    assert.deepEqual(scores(top), [40, 30, 25]);
    assert.deepEqual(
      top.map((c) => c.trackId),
      ["havana", "city", "oval"],
      "each clip keeps its own course",
    );
  });

  it("when two clips score the same and only one has a final top-three racer in it, then that one ranks first, whichever the rounds found first", () => {
    const first = clipOf("first-found", 20, [4]);
    const second = clipOf("second-found", 20, [7]);
    const testCases = [
      { it: "the winner is in the clip found second", winners: new Set([7]), expected: second },
      { it: "the winner is in the clip found first", winners: new Set([4]), expected: first },
    ];
    for (const testCase of testCases) {
      const reel = new CampaignReel();
      reel.note([clipOf("a", 30, [0]), clipOf("b", 25, [1])]);
      reel.note([first, second]);
      const top = reel.top(testCase.winners);
      assert.equal(top.length, CAMPAIGN_REEL_CLIPS);
      assert.equal(top[2], testCase.expected, testCase.it);
    }
  });

  it("when nobody of the clips is a winner, then equal scores keep the order the rounds found them in", () => {
    const reel = new CampaignReel();
    const first = clipOf("first-found", 20, [4]);
    reel.note([clipOf("a", 30, [0]), clipOf("b", 25, [1]), first]);
    reel.note([clipOf("late", 20, [7])]);
    assert.equal(reel.top(noWinners)[2], first);
  });

  it("when a clip with a winner in it trails the one without by less than the lean, then it ranks ahead; by more, behind", () => {
    const testCases = [
      { it: "trailing by 7 % (inside the lean)", trailing: 20, leader: 21.4, winnerFirst: true },
      { it: "trailing by 12 % (outside the lean)", trailing: 20, leader: 22.4, winnerFirst: false },
    ];
    for (const testCase of testCases) {
      const reel = new CampaignReel();
      const winnerClip = clipOf("winner", testCase.trailing, [5]);
      const plainClip = clipOf("plain", testCase.leader, [6]);
      reel.note([clipOf("a", 90, [0]), clipOf("b", 80, [1]), winnerClip, plainClip]);
      const third = reel.top(new Set([5]))[2];
      assert.equal(third, testCase.winnerFirst ? winnerClip : plainClip, testCase.it);
    }
    assert.ok(WINNER_LEAN > 0.07 && WINNER_LEAN < 0.12, "the cases above straddle the lean");
  });

  it("when a campaign of many rounds is noted, then only the clips that can still reach the top three are kept", () => {
    const reel = new CampaignReel();
    for (let round = 0; round < 4; round++) reel.note([1, 2, 3, 4, 5].map((k) => clipOf(`r${round}`, 1 + round * 5 + k - 1, [k])));
    assert.deepEqual(scores(reel.clips), [20, 19, 18, 17], "scores 1 to 20: a clip stays only while fewer than three others score a lean above it");
  });

  it("when clips are let go along the way, then the reel is the one a campaign that kept every clip would show, for any three winners", () => {
    const all: HighlightClip[] = [];
    const reel = new CampaignReel();
    let seed = 7;
    for (let round = 0; round < 6; round++) {
      const round5 = Array.from({ length: 5 }, (_, k) => {
        seed = (seed * 48271) % 2147483647;
        return clipOf(`r${round}k${k}`, 3 + (seed % 3000) / 100, [seed % 6, (seed >> 3) % 6]);
      });
      all.push(...round5);
      reel.note(round5);
    }
    assert.ok(reel.clips.length < all.length, `${reel.clips.length} of ${all.length} clips are kept: the memory is bounded`);
    let checked = 0;
    for (let mask = 0; mask < 64; mask++) {
      const winners = new Set([0, 1, 2, 3, 4, 5].filter((id) => (mask >> id) & 1));
      if (winners.size > CAMPAIGN_REEL_CLIPS) continue;
      assert.equal(JSON.stringify(reel.top(winners)), JSON.stringify(rankAll(all, winners)), `winners ${[...winners].join(",") || "none"}`);
      checked++;
    }
    assert.ok(checked >= 40, `${checked} winner sets checked`);
  });

  it("when the campaign ends, then clear forgets the clips", () => {
    const reel = new CampaignReel();
    reel.note([clipOf("a", 30, [0])]);
    reel.clear();
    assert.deepEqual(reel.top(noWinners), []);
  });
});
