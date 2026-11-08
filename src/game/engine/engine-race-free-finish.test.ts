import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** A spectator's race: three laps of the city with seven rivals, no police. */
const SPECTATE = { trackId: TRACK_ID.city, laps: 3, aiCount: 7, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: true, noReset: false };

describe("given the real engine with a spectator race on Auto", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;

  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, pacer: true });
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: SPECTATE });
    engine.raceCommand({ type: "start" });
    runSeconds(engine, 3);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  // Mutation (red): sed -i '/^      if (this\.race\.auto) this\.race\.autoStep(-1, true);$/d' src/game/engine/engine.ts
  it("given a spectator race on Auto and the spectator in free fly, when the car the panel names finishes, then the free camera stays and the spectated car moves on", () => {
    expect(hud.get().race?.auto, "the control: the race is on Auto").toBe(true);
    expect(hud.get().cam).toBe("auto");
    engine.cycleCamera();
    expect(hud.get().cam).toBe("free");
    expect(engine["view"].flying).toBe(true);
    const named = engine["seat"].carIndex;
    const namedName = hud.get().race?.spectating;
    expect(namedName, "the control: the panel names a car").toBeTruthy();

    const session = engine["race"]["session"]!;
    const rec = session.cars[engine["race"]["rowOf"][named]!]!;
    rec.status = "finished";
    rec.finishTime = session.time;
    runSeconds(engine, 2);

    expect(engine["view"].flying, "the free eye is still the viewer's").toBe(true);
    expect(engine["cameraRig"]()).toBe("free");
    expect(engine["seat"].carIndex, "the seat left the finished car").not.toBe(named);
    expect(hud.get().race?.spectating, "the panel names another car").not.toBe(namedName);
    engine.cycleCamera();
    expect(hud.get().cam).toBe("auto");
  });

  // Mutation (red): in `watchCam` (engine.ts), drop `this.view.leaveFree();` so it only sets `this.view.spec = "auto"`.
  it("given the spectator in free fly, when a new spectator race starts, then free fly is left and the camera is unframed", () => {
    for (let presses = 0; presses < 10 && hud.get().cam !== "free"; presses++) engine.cycleCamera();
    expect(hud.get().cam, "the control: the free view is on").toBe("free");
    expect(engine["view"].flying).toBe(true);
    engine.raceCommand({ type: "start" });
    runSeconds(engine, FRAME);
    expect(engine["view"].flying).toBe(false);
    expect(engine["view"].userFramed).toBe(false);
  });
});
