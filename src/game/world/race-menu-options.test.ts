import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { DEFAULT_RACE_OPTIONS, type RaceMode, type RaceOptions } from "../match/types.ts";
import { courseTap, selectAll } from "../hud/setup-patch.ts";
import { setGround } from "./ground.ts";
import { frame, makeWorld, type World } from "./race-world.test-util.ts";
import { CAMPAIGN } from "./tracks/index.ts";

/** A world in race mode (the setup card up), run through `body` and always left again. */
function inRaceMode(body: (w: World) => void): void {
  const w = makeWorld();
  w.race.enter();
  try {
    body(w);
  } finally {
    w.race.exit();
    setGround(null);
  }
}

const optionsOf = (w: World): RaceOptions => w.race.hud().options;
const nameOf = (w: World, id: string): string => w.race.hud().courses.find((c) => c.id === id)!.name;

/** Frames until the race menu `menu` is up (a watched race of AI cars runs itself out). */
function untilMenu(w: World, menu: "results" | "standings"): void {
  const state = { acc: 0 };
  for (let n = 0; n < 60 * 600 && w.race.hud().menu !== menu; n++) frame(w, state);
  assert.equal(w.race.hud().menu, menu);
}

/** Options none of which is a default (the course is the one under test). */
const NON_DEFAULT: Partial<RaceOptions> = { spectate: true, police: true, noReset: true, laps: 5, aiCount: 4, aggression: 0.8, aiDifficulty: "easy" };

describe("given the setup card with watch, police, no reset, 5 laps, 4 AI cars, 80% aggression and easy AI", () => {
  it("when a course is picked through the options command the menu sends, then only the course changes, before a race and back at the card after one", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: NON_DEFAULT });
      const before = optionsOf(w);
      for (const [key, value] of Object.entries(NON_DEFAULT)) assert.equal(before[key as keyof RaceOptions], value, `${key} was taken`);
      const pickAll = (when: string): void => {
        for (const c of w.race.hud().courses) {
          w.race.command({ type: "options", options: { trackId: c.id } });
          const after = optionsOf(w);
          for (const key of Object.keys(before) as (keyof RaceOptions)[]) assert.equal(after[key], key === "trackId" ? c.id : before[key], `${when}: after picking ${c.name}: ${key}`);
        }
      };
      pickAll("on the first card");
      w.race.command({ type: "start" });
      w.race.command({ type: "quit" });
      assert.equal(w.race.menu, "setup");
      pickAll("on the card after a race");
    });
  });
});

describe("given the setup card", () => {
  it("when it first opens, then the campaign has every course in the campaign's own order", () => {
    assert.equal(DEFAULT_RACE_OPTIONS.campaign.join(), CAMPAIGN.join());
    inRaceMode((w) => assert.equal(optionsOf(w).campaign.join(), CAMPAIGN.join()));
  });

  it("when everything is unticked and three courses are ticked in turn, then the campaign is those three in tap order and round 1 is the first tapped", () => {
    inRaceMode((w) => {
      const pick = (campaign: readonly string[]): void => w.race.command({ type: "options", options: { campaign } });
      pick([]);
      assert.deepEqual(optionsOf(w).campaign, []);
      pick(["stunt"]);
      pick(["stunt", "oval"]);
      pick(["stunt", "oval", "city"]);
      assert.deepEqual(optionsOf(w).campaign, ["stunt", "oval", "city"]);
      w.race.command({ type: "campaign" });
      const hud = w.race.hud();
      assert.equal(hud.mode, "campaign");
      assert.deepEqual(hud.campaign!.tracks, ["stunt", "oval", "city"]);
      assert.equal(hud.trackName, nameOf(w, "stunt"));
      assert.deepEqual(optionsOf(w).campaign, ["stunt", "oval", "city"], "the pick stays for the next campaign");
    });
  });

  it("when the pick names unknown courses and repeats, then they drop and the rest keep the order they came in", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: ["rally", "nowhere", "rally", "city", "../x"] } });
      assert.deepEqual(optionsOf(w).campaign, ["rally", "city"]);
    });
  });

  it("when the campaign is commanded with no course ticked, then nothing starts and the card stays up", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: [] } });
      w.race.command({ type: "campaign" });
      const hud = w.race.hud();
      assert.equal(hud.mode, "single");
      assert.equal(hud.phase, null);
      assert.equal(w.race.menu, "setup");
    });
  });

  it("when another option changes after the pick, then the pick is kept", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: ["rally", "oval"] } });
      w.race.command({ type: "options", options: { laps: 2, trackId: "city" } });
      assert.deepEqual(optionsOf(w).campaign, ["rally", "oval"]);
    });
  });
});

describe("given a Watch campaign of the rally and then the oval, the reverse of the campaign's own order", () => {
  it("when each round runs out and Next is pressed, then the rounds race on those courses in that order and the campaign ends back at the card", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { laps: 1, aiCount: 3, spectate: true, campaign: ["rally", "oval"] } });
      w.race.command({ type: "campaign" });
      assert.equal(w.race.hud().trackName, nameOf(w, "rally"));
      untilMenu(w, "results");
      w.race.command({ type: "next" });
      assert.equal(w.race.hud().menu, "standings");
      assert.equal(w.race.hud().campaign!.round, 1);
      w.race.command({ type: "next" });
      assert.equal(w.race.hud().trackName, nameOf(w, "oval"));
      untilMenu(w, "results");
      w.race.command({ type: "next" });
      w.race.command({ type: "next" });
      assert.equal(w.race.menu, "setup", "the two picked rounds were the whole campaign");
    });
  });
});

describe("given the setup card's Mode row set to Campaign", () => {
  it("when a campaign is started and quit again, then the Mode is still Campaign with its picks (it lives in the options, not in the menu's mount), and an unknown mode is ignored", () => {
    inRaceMode((w) => {
      assert.equal(optionsOf(w).mode, "single");
      w.race.command({ type: "options", options: { mode: "campaign", laps: 1, aiCount: 3, spectate: true, campaign: ["oval"] } });
      w.race.command({ type: "campaign" });
      w.race.command({ type: "quit" });
      assert.equal(optionsOf(w).mode, "campaign");
      assert.deepEqual(optionsOf(w).campaign, ["oval"]);
      w.race.command({ type: "options", options: { mode: "tournament" as unknown as RaceMode } });
      assert.equal(optionsOf(w).mode, "campaign");
    });
  });
});

describe("given a setup menu rendered from a HUD snapshot older than the last option change", () => {
  it("when a course card is tapped, then it sends only the course (its own key) and the newer option survives", () => {
    inRaceMode((w) => {
      const stale = optionsOf(w);
      w.race.command({ type: "options", options: { laps: 5, police: true } });
      const patch = courseTap(stale, "city");
      assert.deepEqual(Object.keys(patch), ["trackId"]);
      w.race.command({ type: "options", options: patch });
      assert.equal(optionsOf(w).trackId, "city");
      assert.equal(optionsOf(w).laps, 5);
      assert.equal(optionsOf(w).police, true);
    });
  });

  it("when a card is tapped in Campaign mode, or Select all is, then it sends only the campaign list and the newer option survives", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { mode: "campaign", campaign: [] } });
      const stale = optionsOf(w);
      w.race.command({ type: "options", options: { aiCount: 4 } });
      const tick = courseTap(stale, "rally");
      assert.deepEqual(Object.keys(tick), ["campaign"]);
      w.race.command({ type: "options", options: tick });
      const all = selectAll(optionsOf(w), w.race.hud().courses.map((c) => c.id));
      assert.deepEqual(Object.keys(all), ["campaign"]);
      assert.equal(optionsOf(w).aiCount, 4);
      assert.deepEqual(optionsOf(w).campaign, ["rally"]);
      w.race.command({ type: "options", options: all });
      assert.equal(optionsOf(w).campaign.length, w.race.hud().courses.length);
      assert.equal(optionsOf(w).mode, "campaign");
    });
  });
});
