import { describe, expect, it } from "vitest";
import { DEFAULT_RACE_OPTIONS, type RaceMode, type RaceOptions } from "../match/types.ts";
import { courseTap, selectAll } from "../hud/setup-patch.ts";
import { setGround } from "./ground.ts";
import { frame, makeWorld, type World } from "./race-world.test-util.ts";
import { CAMPAIGN } from "./tracks/index.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

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
  expect(w.race.hud().menu).toBe(menu);
}

/** Options none of which is a default (the course is the one under test). */
const NON_DEFAULT: Partial<RaceOptions> = { spectate: true, police: true, noReset: true, laps: 5, aiCount: 4, aggression: 0.8, aiDifficulty: "easy" };

describe("given the setup card with watch, police, no reset, 5 laps, 4 AI cars, 80% aggression and easy AI", () => {
  it("when a course is picked through the options command the menu sends, then only the course changes, before a race and back at the card after one", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: NON_DEFAULT });
      const before = optionsOf(w);
      for (const [key, value] of Object.entries(NON_DEFAULT)) expect(before[key as keyof RaceOptions], `${key} was taken`).toBe(value);
      const pickAll = (when: string): void => {
        for (const c of w.race.hud().courses) {
          w.race.command({ type: "options", options: { trackId: c.id } });
          const after = optionsOf(w);
          for (const key of Object.keys(before) as (keyof RaceOptions)[]) expect(after[key], `${when}: after picking ${c.name}: ${key}`).toBe(key === "trackId" ? c.id : before[key]);
        }
      };
      pickAll("on the first card");
      w.race.command({ type: "start" });
      w.race.command({ type: "quit" });
      expect(w.race.menu).toBe("setup");
      pickAll("on the card after a race");
    });
  });
});

describe("given the setup card", () => {
  it("when it first opens, then the campaign has every course in the campaign's own order", () => {
    expect(DEFAULT_RACE_OPTIONS.campaign.join()).toBe(CAMPAIGN.join());
    inRaceMode((w) => expect(optionsOf(w).campaign.join()).toBe(CAMPAIGN.join()));
  });

  it("when everything is unticked and three courses are ticked in turn, then the campaign is those three in tap order and round 1 is the first tapped", () => {
    inRaceMode((w) => {
      const pick = (campaign: readonly string[]): void => w.race.command({ type: "options", options: { campaign } });
      pick([]);
      expect(optionsOf(w).campaign).toHaveLength(0);
      pick(["stunt"]);
      pick(["stunt", "oval"]);
      pick(["stunt", "oval", "city"]);
      expect(firstMismatch(optionsOf(w).campaign, ["stunt", "oval", "city"])).toBeUndefined();
      w.race.command({ type: "campaign" });
      const hud = w.race.hud();
      expect(hud.mode).toBe("campaign");
      expect(firstMismatch(hud.campaign!.tracks, ["stunt", "oval", "city"])).toBeUndefined();
      expect(hud.trackName).toBe(nameOf(w, "stunt"));
      expect(firstMismatch(optionsOf(w).campaign, ["stunt", "oval", "city"]), "the pick stays for the next campaign").toBeUndefined();
    });
  });

  it("when the pick names unknown courses and repeats, then they drop and the rest keep the order they came in", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: ["rally", "nowhere", "rally", "city", "../x"] } });
      expect(firstMismatch(optionsOf(w).campaign, ["rally", "city"])).toBeUndefined();
    });
  });

  it("when the campaign is commanded with no course ticked, then nothing starts and the card stays up", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: [] } });
      w.race.command({ type: "campaign" });
      const hud = w.race.hud();
      expect(hud.mode).toBe("single");
      expect(hud.phase).toBe(null);
      expect(w.race.menu).toBe("setup");
    });
  });

  it("when another option changes after the pick, then the pick is kept", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { campaign: ["rally", "oval"] } });
      w.race.command({ type: "options", options: { laps: 2, trackId: "city" } });
      expect(firstMismatch(optionsOf(w).campaign, ["rally", "oval"])).toBeUndefined();
    });
  });
});

describe("given a Watch campaign of the rally and then the oval, the reverse of the campaign's own order", () => {
  it("when each round runs out and Next is pressed, then the rounds race on those courses in that order and the campaign ends back at the card", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { laps: 1, aiCount: 3, spectate: true, campaign: ["rally", "oval"] } });
      w.race.command({ type: "campaign" });
      expect(w.race.hud().trackName).toBe(nameOf(w, "rally"));
      untilMenu(w, "results");
      w.race.command({ type: "next" });
      expect(w.race.hud().menu).toBe("standings");
      expect(w.race.hud().campaign!.round).toBe(1);
      w.race.command({ type: "next" });
      expect(w.race.hud().trackName).toBe(nameOf(w, "oval"));
      untilMenu(w, "results");
      w.race.command({ type: "next" });
      w.race.command({ type: "next" });
      expect(w.race.menu, "the two picked rounds were the whole campaign").toBe("setup");
    });
  });
});

describe("given the setup card's Mode row set to Campaign", () => {
  it("when a campaign is started and quit again, then the Mode is still Campaign with its picks (it lives in the options, not in the menu's mount), and an unknown mode is ignored", () => {
    inRaceMode((w) => {
      expect(optionsOf(w).mode).toBe("single");
      w.race.command({ type: "options", options: { mode: "campaign", laps: 1, aiCount: 3, spectate: true, campaign: ["oval"] } });
      w.race.command({ type: "campaign" });
      w.race.command({ type: "quit" });
      expect(optionsOf(w).mode).toBe("campaign");
      expect(firstMismatch(optionsOf(w).campaign, ["oval"])).toBeUndefined();
      w.race.command({ type: "options", options: { mode: "tournament" as unknown as RaceMode } });
      expect(optionsOf(w).mode).toBe("campaign");
    });
  });
});

describe("given a setup menu rendered from a HUD snapshot older than the last option change", () => {
  it("when a course card is tapped, then it sends only the course (its own key) and the newer option survives", () => {
    inRaceMode((w) => {
      const stale = optionsOf(w);
      w.race.command({ type: "options", options: { laps: 5, police: true } });
      const patch = courseTap(stale, "city");
      expect(firstMismatch(Object.keys(patch), ["trackId"])).toBeUndefined();
      w.race.command({ type: "options", options: patch });
      expect(optionsOf(w).trackId).toBe("city");
      expect(optionsOf(w).laps).toBe(5);
      expect(optionsOf(w).police).toBe(true);
    });
  });

  it("when a card is tapped in Campaign mode, or Select all is, then it sends only the campaign list and the newer option survives", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { mode: "campaign", campaign: [] } });
      const stale = optionsOf(w);
      w.race.command({ type: "options", options: { aiCount: 4 } });
      const tick = courseTap(stale, "rally");
      expect(firstMismatch(Object.keys(tick), ["campaign"])).toBeUndefined();
      w.race.command({ type: "options", options: tick });
      const all = selectAll(optionsOf(w), w.race.hud().courses.map((c) => c.id));
      expect(firstMismatch(Object.keys(all), ["campaign"])).toBeUndefined();
      expect(optionsOf(w).aiCount).toBe(4);
      expect(firstMismatch(optionsOf(w).campaign, ["rally"])).toBeUndefined();
      w.race.command({ type: "options", options: all });
      expect(optionsOf(w).campaign.length).toBe(w.race.hud().courses.length);
      expect(optionsOf(w).mode).toBe("campaign");
    });
  });
});
