import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import "../kernel/rapier-node.test-util.ts";
import { AI_DEFAULT } from "../ai/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { RESULTS_DELAY } from "./engine-race.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { FLIGHT_S } from "./engine-highlights.ts";
import { stageCrossing } from "./reel-view.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** A spectator's race on the figure-8: three rivals of medium skill, who misjudge the crossing and meet there. */
const SPECTATE = { trackId: "figure-8", laps: 3, aiCount: 3, police: false, aggression: 1, aiDifficulty: AI_DEFAULT, spectate: true, noReset: false };
/** The staged crossing hit's speed (m/s) and the longest the race takes to go green and the clip to be filed (s). */
const CROSSING_SPEED = 16;
const WAIT_S = 30;

describe("given a figure-8 spectator race on Auto, the spectator in free fly, and a hit at the crossing that the recorder keeps", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  const race = () => engine["race"];
  const run = async (seconds: number): Promise<void> => {
    engine.advance(seconds, { frameDt: FRAME });
    await engine.warmsIdle();
  };
  const runUntil = async (done: () => boolean): Promise<boolean> => {
    for (let s = 0; s < WAIT_S && !done(); s += 0.5) await run(0.5);
    return done();
  };

  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, pacer: true });
    engine["highlights"].stepBudgetMs = Infinity;
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: SPECTATE });
    engine.raceCommand({ type: "start" });
    await runUntil(() => race().phase === "racing");
    await run(2);
    for (let presses = 0; presses < 10 && hud.get().cam !== "free"; presses++) engine.cycleCamera();
    const cars = engine["live"]();
    stageCrossing(race()["track"]!, cars[1]!, cars[2]!, CROSSING_SPEED);
    await runUntil(() => race().recorder.ledger.kept.length > 0);
    engine.raceCommand({ type: "end" });
    await run(FRAME);
    // The reel is packed and unpacked off this thread (about 8 ms, more on a busy box): wait for the reel itself, not for a count of turns, which can pass in less.
    for (const until = performance.now() + WAIT_S * 1000; !engine["highlights"].hasReel && performance.now() < until; ) await nextTurn();
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  // Mutation (red): sed -i '/^      if (on) this\.view\.leaveFree();$/d' src/game/engine/engine-reel.ts
  it("when the results reel opens, then free fly is left and the reel's own camera holds the frame, not the eye parked over the crossing", async () => {
    expect(hud.get().cam, "the control: the spectator is in free fly when the race ends").toBe("free");
    expect(engine["view"].flying).toBe(true);
    expect(race().recorder.ledger.kept.length, "the control: the crossing hit is a kept clip").toBeGreaterThan(0);
    expect(engine["highlights"].hasReel, "the control: the reel is set").toBe(true);

    engine.advance(RESULTS_DELAY + FLIGHT_S + 1, { frameDt: FRAME });

    expect(engine["highlights"].playing, "the reel is up").toBe(true);
    expect(engine["view"].flying, "free fly ended with the reel's start").toBe(false);
    expect(engine["cameraRig"](), "the reel holds the camera").toBe("reel");
    expect(hud.get().cam, "the HUD no longer names the free view").not.toBe("free");
  });
});
