import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { makeWorld, type World } from "./race-world.test-util.ts";

/** A race start, a retry and the next race are scene resets like a sandbox one: the last run's debris, dummies and fx go first. */
describe("given an entered race, where starting, retrying or moving to the next race resets the scene like a sandbox reset (the last run's debris, dummies and fx go first)", () => {
  let w: World;
  beforeAll(() => {
    w = makeWorld();
    w.race.enter();
  });
  afterAll(() => {
    w.race.exit();
    setGround(null);
  });

  it("when start, retry and campaign are each commanded, then each asks the engine to clear the scene once", () => {
    for (const cmd of [{ type: "start" }, { type: "retry" }, { type: "campaign" }] as const) {
      const before = w.clears;
      w.race.command(cmd);
      expect(w.clears - before, `${cmd.type}: one clear`).toBe(1);
    }
  });

  it("when the grid is re-parked in setup by a field-size change, then it counts as no run and the scene is not cleared", () => {
    w.race.command({ type: "quit" });
    const before = w.clears;
    w.race.command({ type: "options", options: { aiCount: 3 } });
    expect(w.clears).toBe(before);
  });
});
