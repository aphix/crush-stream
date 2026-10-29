import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { HighlightClip } from "../match/highlights.ts";
import { CAMPAIGN_REEL_CLIPS, reelWeight } from "../match/campaign-reel.ts";
import type { CrashEngine } from "./engine.ts";
import { CRASH_GAP, CRASH_SPEED } from "./engine-bench-replay.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The campaign's rules: three courses, one lap each, three rivals, no police. */
const RULES = { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
const COURSES = [TRACK_ID.city, TRACK_ID.oval, TRACK_ID.rally];
/** The longest a round takes to go green and a crash to be filed, and the reel to play, in seconds. */
const GREEN_WAIT_S = 20;
const CLIP_WAIT_S = 20;
const REEL_WAIT_S = 400;
/** A reel clip's lap is its slow-mo timeline and a hold: well under this. */
const REEL_CHUNK_S = 40;

describe("given a three-course campaign whose every round recorded a head-on", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const race = () => engine["race"];
  /** `seconds` of frames, then the warm-ups a new course or car starts (`queueWarm`) end, as between the browser's frames. */
  const run = async (seconds: number): Promise<void> => {
    engine.advance(seconds, { frameDt: FRAME });
    await engine.warmsIdle();
  };
  /** Set when a reel clip's view ends: the promise that starts the next clip then resolves within one loop turn. */
  let clipEnded = false;
  /**
   * Frames until `done`, `step` seconds at a time, at most `limit` seconds: whether it came. A chunk's synthetic clock starts at the real one (`advance`), so what plays on a clock
   * (a reel's clip) needs a chunk as long as it lasts.
   */
  const runUntil = async (done: () => boolean, limit: number, step = 0.25): Promise<boolean> => {
    for (let s = 0; s < limit && !done(); s += step) {
      await run(step);
      if (!clipEnded) continue;
      clipEnded = false;
      await nextTurn();
    }
    return done();
  };
  const noted: HighlightClip[] = [];
  const viewed: HighlightClip[] = [];

  /** One round: green, the first two cars head-on, the crash filed, the race closed and scored. */
  const playRound = async (): Promise<void> => {
    expect(await runUntil(() => race().phase === "racing", GREEN_WAIT_S), "the round went green").toBeTruthy();
    expect(race().crashAtStart(CRASH_GAP, CRASH_SPEED), "two cars on the grid").toBeTruthy();
    expect(await runUntil(() => race().recorder.ledger.kept.length > 0, CLIP_WAIT_S), "the crash was filed").toBeTruthy();
    engine.raceCommand({ type: "end" });
    await run(0.2);
    engine.raceCommand({ type: "next" });
  };

  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine();
    // Every round's clips as the engine's reel start hears them, and every clip the player is then shown.
    const startReel = engine["startReel"].bind(engine);
    engine["startReel"] = (clips, since) => {
      noted.push(...clips);
      startReel(clips, since);
    };
    const highlights = engine["highlights"];
    const viewSaved = highlights.viewSaved.bind(highlights);
    highlights.viewSaved = (clip, now, back, passes) => {
      viewed.push(clip);
      viewSaved(clip, now, (ended) => {
        clipEnded = true;
        back(ended);
      }, passes);
    };
    highlights.stepBudgetMs = Infinity;
    engine.toggleRace();
    engine.raceCommand({ type: "options", options: { ...RULES, campaign: COURSES } });
    engine.raceCommand({ type: "campaign" });
    for (let round = 0; round < COURSES.length; round++) {
      await playRound();
      expect(race().menu, `round ${round + 1} is scored`).toBe("standings");
      if (round < COURSES.length - 1) engine.raceCommand({ type: "next" });
    }
    await run(0.2);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the last round is scored, then the podium raises itself with the campaign's top three by points, and offers the reel", () => {
    const standings = race().hud().campaign!.standings;
    expect(race().hud().campaign!.round).toBe(COURSES.length);
    const hud = engine["reelHud"]();
    expect(hud.podium?.kind).toBe("campaign");
    for (const [k, row] of standings.slice(0, 3).entries()) expect(hud.podium?.names[k], `place ${k + 1}`).toBe(row.name);
    expect(hud.campaignReel).toBe(Math.min(CAMPAIGN_REEL_CLIPS, noted.length));
    expect(noted.length, `${noted.length} clips were recorded over ${COURSES.length} rounds: the control that three can be picked`).toBeGreaterThanOrEqual(CAMPAIGN_REEL_CLIPS);
  });

  it("when Skip is pressed, then the standings sheet is back with the reel option, and the podium does not raise itself again", async () => {
    engine.raceCommand({ type: "podium", on: false });
    await run(0.1);
    expect(engine["reelHud"]().podium).toBe(null);
    expect(race().menu).toBe("standings");
    expect(engine["reelHud"]().campaignReel).toBe(Math.min(CAMPAIGN_REEL_CLIPS, noted.length));
    await run(1);
    expect(engine["reelHud"]().podium, "it comes once").toBe(null);
  });

  it("when the reel is viewed, then the best clips of all the courses play once each, best first, on their courses, and the setup menu follows", async () => {
    const standings = race().hud().campaign!.standings;
    const winners = new Set(standings.slice(0, 3).map((r) => r.id));
    const expected = noted
      .map((clip, order) => ({ clip, order }))
      .sort((a, b) => reelWeight(b.clip, winners) - reelWeight(a.clip, winners) || a.order - b.order)
      .slice(0, CAMPAIGN_REEL_CLIPS)
      .map((r) => r.clip);
    engine.raceCommand({ type: "campaignReel" });
    expect(await runUntil(() => viewed.length === expected.length && engine["highlights"].hud().solo === null, REEL_WAIT_S, REEL_CHUNK_S), `${viewed.length} of ${expected.length} clips played`).toBeTruthy();
    expect(viewed.length).toBe(expected.length);
    for (const [k, clip] of expected.entries()) expect(viewed[k], `clip ${k + 1}`).toBe(clip);
    await run(1);
    expect(race().menu).toBe("setup");
    expect(engine["highlights"].playing).toBe(false);
  });
});
