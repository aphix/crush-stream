import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { BENCH_RACE } from "../engine/engine-bench-plan.ts";
import { decodeShare } from "../hud/share-url.ts";
import { DEFAULT_RACE_OPTIONS, type RaceOptions } from "../match/types.ts";
import { setGround } from "./ground.ts";
import { frame, makeWorld, type World } from "./race-world.test-util.ts";

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

/** The player's own race options as the setup card and the share URL read them (the race scene's `#` is built from these). */
const playersOptions = (w: World): RaceOptions => w.race.hud().options;

/** Every one of the player's race options is still its default, field by field so a failure names the field. */
function assertDefaultOptions(w: World, when = "the player's options"): void {
  const options = playersOptions(w);
  for (const key of Object.keys(DEFAULT_RACE_OPTIONS) as (keyof RaceOptions)[]) expect(options[key], `${when}: ${key}`).toBe(DEFAULT_RACE_OPTIONS[key]);
}

describe("given a player on the default race options, running the bench's own race", () => {
  it("when the bench sets its race up and then runs it, then it races its own course, laps and field while the player's options and the setup card hold no bench value", () => {
    inRaceMode((w) => {
      w.race.command(BENCH_RACE);
      assertDefaultOptions(w, "right after the bench applied its setup");
      w.race.reseed(1);
      w.race.command({ type: "start" });
      const state = { acc: 0 };
      for (let n = 0; n < 10 * 60; n++) frame(w, state);
      const hud = w.race.hud();
      expect(hud.trackName).toBe("Harbour Streets");
      expect(hud.laps).toBe(9);
      expect(hud.field).toBe(16);
      assertDefaultOptions(w, "while the bench race runs");
    });
  });

  it("when the race is left for the setup card, then the player's own options are back for the next race", () => {
    inRaceMode((w) => {
      w.race.command(BENCH_RACE);
      w.race.command({ type: "start" });
      w.race.command({ type: "quit" });
      expect(w.race.menu).toBe("setup");
      assertDefaultOptions(w);
      w.race.command({ type: "start" });
      const hud = w.race.hud();
      expect(hud.laps).toBe(DEFAULT_RACE_OPTIONS.laps);
      expect(hud.field).toBe(DEFAULT_RACE_OPTIONS.aiCount + 1);
      expect(hud.trackName).toBe("Brickyard Oval");
    });
  });
});

describe("given a player who chose the stunt course and 5 laps", () => {
  it("when a campaign begins, then the player's choices are untouched while round 1 runs on the campaign's own course", () => {
    inRaceMode((w) => {
      w.race.command({ type: "options", options: { trackId: "stunt", laps: 5 } });
      w.race.command({ type: "campaign" });
      expect(w.race.hud().mode).toBe("campaign");
      expect(w.race.hud().trackName, "round 1 is not the player's course").not.toBe("Crossover Canyon");
      expect(playersOptions(w).trackId).toBe("stunt");
      expect(playersOptions(w).laps).toBe(5);
    });
  });
});

describe("given the setup card on the default course", () => {
  it("when a saved highlight from the city course plays and then ends, then the field stands on the city meanwhile and on the player's course after, with the player's options never changed", () => {
    inRaceMode((w) => {
      w.race.command({ type: "program", options: { trackId: "city" } });
      w.race.reset();
      expect(w.race.hud().trackName).toBe("Harbour Streets");
      assertDefaultOptions(w);
      w.race.command({ type: "program", options: null });
      w.race.reset();
      expect(w.race.hud().trackName).toBe("Brickyard Oval");
      assertDefaultOptions(w);
    });
  });
});

describe("given a pasted share URL that names the city course, 9 laps, 15 AI cars, full aggression and police", () => {
  it("when the page applies it as the player's own settings, then the race options hold exactly those settings", () => {
    inRaceMode((w) => {
      const t = decodeShare("#scene=race&track=city&laps=9&ai=15&aggr=1&police=1");
      w.race.command({ type: "options", options: { trackId: t.track, campaign: t.camp, mode: t.mode, laps: t.laps, aiCount: t.ai, aggression: t.aggr, aiDifficulty: t.diff, police: t.police, timeOfDay: t.tod, noReset: t.noreset, spectate: t.spectate } });
      const options = playersOptions(w);
      expect(options.trackId, "trackId").toBe("city");
      expect(firstMismatch(options.campaign, ["oval", "rally", "city", "stunt", "four-count", "dam-spine", "razor-shelf", "breaker-yard", "national-mall"]), "campaign").toBeUndefined();
      expect(options.mode, "mode").toBe("single");
      expect(options.laps, "laps").toBe(9);
      expect(options.aiCount, "aiCount").toBe(15);
      expect(options.aggression, "aggression").toBe(1);
      expect(options.aiDifficulty, "aiDifficulty").toBe("hard");
      expect(options.police, "police").toBe(true);
      expect(options.timeOfDay, "timeOfDay").toBe("daytime");
      expect(options.noReset, "noReset").toBe(false);
      expect(options.spectate, "spectate").toBe(false);
    });
  });
});
