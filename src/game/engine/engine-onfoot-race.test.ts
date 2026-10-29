import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

/** The race's rules: one lap of the oval (no traffic on it) against one rival, no police. */
const RULES = { trackId: TRACK_ID.oval, laps: 1, aiCount: 1, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
const GREEN_WITHIN_S = 20;
/** He stays out at least this long (s): past the 8 s a car nobody drives may stand still before the rules count it dead. */
const OUT_AT_LEAST_S = 9;
/** The most his held car creeps on its brakes while he is out (m). */
const HELD_CREEP_M = 1.5;
const FALL_WITHIN_S = 1.5;
/** What driving off from the grid must gain on the course (m of progress) in 3 s. */
const DRIVES_OFF_M = 5;

describe("given the real engine in a race on the oval, the player at the wheel on the grid beside a rival", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const race = () => rig.engine["race"];
  const session = () => race()["session"]!;
  const row = () => session().cars[race()["rowOf"][race().self]!]!;

  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.engine.toggleRace();
    rig.engine.raceCommand({ type: "program", options: RULES });
    rig.engine.raceCommand({ type: "start" });
    for (let t = 0; t < GREEN_WITHIN_S && race().phase !== "racing"; t += FRAME) rig.run(FRAME);
    expect(race().phase, "the lights went green").toBe("racing");
    expect(rig.engine["seat"].mode, "the player has the wheel").toBe("drive");
  });
  afterAll(() => rig.dispose());

  it("when he gets out at green, walks off, is run down by a rival, stands out for 9 s and gets back in, then his car was held, his row stayed racing, and he drives again", () => {
    const self = race().self;
    const own = rig.cars()[self]!;
    const rivalAt = rig.cars().findIndex((_, i) => i !== self && race()["entrants"][i]?.kind === "ai");
    const rival = rig.cars()[rivalAt]!;
    const placements = own.placements;
    const start = own.group.position.clone();
    rig.getOut();
    expect(rig.away(), "his car is the one he left").toBe(self);
    rig.walkTo(rig.beside(own, 2, 3), 1.5, 15);
    rig.runDownBy(rival, own);
    for (let t = 0; t < FALL_WITHIN_S && rig.walker().state === "stand"; t += FRAME) rig.run(FRAME);
    expect(rig.walker().state, "the rival knocked him down").not.toBe("stand");
    // The rival retires where it stands, as a racer out of it brakes to a halt, so it does not lap round to him again.
    session().cars[race()["rowOf"][rivalAt]!]!.status = "dnf";
    rig.getUp();
    const outFor = rig.engine["elapsedWall"];
    while (rig.engine["elapsedWall"] - outFor < OUT_AT_LEAST_S) rig.run(0.5);
    expect(row().status, "his row is racing: the rules see a car that is held, not an empty seat").toBe("racing");
    expect(own.driverOut, "nobody was thrown out").toBe(null);
    expect(own.placements, "the rules did not put his car back on the road").toBe(placements);
    expect(own.group.position.distanceTo(start), `his car stood on its brakes: ${own.group.position.distanceTo(start).toFixed(2)} m`).toBeLessThan(HELD_CREEP_M);
    expect(race().hud().you?.driverOut, "the HUD does not show DRIVER OUT").toBe(false);
    rig.press("Escape");
    expect(race().menuOpen, "Escape on foot is the race's pause, which the walker does not swallow").toBe(true);
    rig.engine.raceCommand({ type: "resume" });
    expect(race().menuOpen, "and Resume puts him back on foot").toBe(false);
    expect(rig.phase(), "still on foot").toBe("onFoot");
    rig.getIn();
    const progress = row().progress;
    rig.hold("KeyW", 3);
    expect(row().progress - progress, `he drove on: ${(row().progress - progress).toFixed(1)} m of the course`).toBeGreaterThan(DRIVES_OFF_M);
    expect(row().status, "and he is still racing").toBe("racing");
  });
});
