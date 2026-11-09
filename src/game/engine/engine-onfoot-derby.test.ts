import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME, OnFootRig } from "./engine-onfoot.test-util.ts";

const FALL_WITHIN_S = 1.5;
/** A derby grid's cars brake hard (12 m/s²) until green: the rival that runs him down starts this close and this fast to meet him above the strike speed (4 m/s). */
const GRID_RUN_UP_M = 2.5;
const GRID_HIT_MPS = 11;
/** The crown comes within this many seconds of the green light (s): the grid and the countdown are 4.5 s, a held car is not counted out for a minute. */
const CROWNED_WITHIN_S = 15;
/** Where the rivals' wrecks are put (m): the far side of the arena from the player's grid spot, in a row. */
const WRECKS_AT_X = 22;
const WRECKS_SPACING_Z = 5;
/** What driving off must move his car (m) in 2 s. */
const DRIVES_OFF_M = 2;

describe("given the real engine in a derby, the player at the wheel of his car on the grid among the rivals", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const derby = () => rig.engine["derby"];

  beforeAll(async () => {
    rig = await OnFootRig.boot();
    rig.engine["looping"] = false;
    rig.engine.toggleDerby();
    rig.run(0.5);
    expect(rig.engine.derbyMode, "the derby is on").toBeTruthy();
    rig.sit(0);
    rig.run(FRAME);
    expect(rig.engine["seat"].mode, "the player has the wheel").toBe("drive");
  });
  afterAll(() => rig.dispose());

  it("when he gets out on the grid, is run down by a rival, and every rival's engine then dies, then his car is the last one alive and wins while he is still on foot, and he gets back in and drives", () => {
    const self = rig.engine["seat"].carIndex;
    const own = rig.cars()[self]!;
    const rival = rig.cars().find((_, i) => i !== self)!;
    rig.getOut();
    expect(rig.away(), "his car is the one he left").toBe(self);
    rig.walkTo(rig.beside(own, 2, 3), 1.5, 15);
    rig.runDownBy(rival, own, "ahead", GRID_HIT_MPS, GRID_RUN_UP_M);
    for (let t = 0; t < FALL_WITHIN_S && rig.walker().state === "stand"; t += FRAME) rig.run(FRAME);
    expect(rig.walker().state, "the rival knocked him down").not.toBe("stand");
    // Every rival's engine dies, each on the far side of the arena (a wreck stopping at his door would be in his way).
    for (const [i, car] of rig.cars().entries()) {
      if (i === self) continue;
      car.spawnFacing(WRECKS_AT_X, WRECKS_SPACING_Z * (i - 2), 0, 0);
      car.disable();
    }
    for (let t = 0; t < CROWNED_WITHIN_S && derby().winnerId == null; t += FRAME) rig.run(FRAME);
    expect(derby().winnerId, "the last car alive won").toBe(self);
    expect(derby().decided, "by the rivals' wrecks").toBe("wreck");
    expect(rig.phase(), "he was on foot when it was decided").not.toBe("inCar");
    rig.getUp();
    rig.getIn();
    const driven = own.group.position.clone();
    rig.hold("KeyW", 2);
    expect(own.group.position.distanceTo(driven), `he drove his car again: ${own.group.position.distanceTo(driven).toFixed(1)} m`).toBeGreaterThan(DRIVES_OFF_M);
  });
});
