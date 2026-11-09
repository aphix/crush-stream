import { afterEach, describe, expect, it } from "vitest";
import { assertSameDigest } from "../vehicle/test-support.ts";
import { RigSolids } from "../scenes/rig-solids.ts";
import { DISC_GROUND, setGround } from "../world/ground.ts";
import { armSolids } from "../world/surfaces.ts";
import { runPair, runWall } from "./crash-scenarios.test-util.ts";

// Mutations (each turns the row named red): delete `wallRuns.set(key, held);` (same run); `return Object.freeze(r)` -> `return r` (frozen); drop `opts.fresh ||` (fresh);
// drop `activeGround() !== FLAT_GROUND ||` (another ground); drop `|| armedSolids() !== null` (armed solids); `[scenario, ...args,` -> `[scenario, args[0],` (other arguments).

/** A hit that runs in a moment: these rows are about which runs are shared, not about the crash. */
const BRIEF = { after: 0.3 };
const KPH = 30;

describe("given a wall hit asked for twice with the same arguments", () => {
  afterEach(() => {
    setGround(null);
    armSolids(null);
  });

  it("when both are run on the flat ground, then the second is the first's run, and no row can write its numbers", () => {
    const first = runWall(KPH, 1, "front", BRIEF);
    expect(runWall(KPH, 1, "front", BRIEF), "the second hit is the first's run").toBe(first);
    expect(Object.isFrozen(first) && Object.isFrozen(first.detached) && Object.isFrozen(first.hubsPopped) && Object.isFrozen(first.lampsOut) && Object.isFrozen(first.hinge), "the shared run is frozen").toBeTruthy();
    expect(() => {
      first.noseShortL = 0;
    }, "a row wrote a shared run's number").toThrow();
  });

  it("when the second asks for a run of its own, then it is a new run with the same numbers", () => {
    const shared = runWall(KPH, 1, "front", BRIEF);
    const own = runWall(KPH, 1, "front", { ...BRIEF, fresh: true });
    expect(own, "a fresh run is the shared one").not.toBe(shared);
    assertSameDigest(own, shared, "a fresh run of the same hit");
  });

  it("when the overlap differs, then it is another run", () => {
    expect(runWall(KPH, 0.5, "front", BRIEF), "an offset hit is the full-width run").not.toBe(runWall(KPH, 1, "front", BRIEF));
  });

  it("when the ground is not the flat one, then it is a run of its own", () => {
    const flat = runWall(KPH, 1, "front", BRIEF);
    setGround(DISC_GROUND);
    expect(runWall(KPH, 1, "front", BRIEF), "the disc's hit is the flat ground's run").not.toBe(flat);
  });

  it("when solids are armed, then it is a run of its own", () => {
    const bare = runWall(KPH, 1, "front", BRIEF);
    armSolids(new RigSolids());
    expect(runWall(KPH, 1, "front", BRIEF), "a hit among armed solids is the bare run").not.toBe(bare);
  });
});

describe("given a two-car hit asked for twice with the same arguments", () => {
  it("when both are run on the flat ground, then the second is the first's run, and no row can write its cars' numbers", () => {
    const first = runPair(0, KPH, "t-bone", BRIEF);
    expect(runPair(0, KPH, "t-bone", BRIEF), "the second hit is the first's run").toBe(first);
    expect(Object.isFrozen(first) && Object.isFrozen(first[0]) && Object.isFrozen(first[1]), "the shared run is frozen").toBeTruthy();
    expect(runPair(0, 2 * KPH, "t-bone", BRIEF), "a harder bullet is the first's run").not.toBe(first);
  });
});
