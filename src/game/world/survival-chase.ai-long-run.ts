import { beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import { chase, type Chase } from "./survival-players.test-util.ts";
import { FRAME, course } from "./race-world.test-util.ts";
import { StuckWatch } from "./stuck-canary.test-util.ts";

/**
 * Full-sanity run, not the per-commit suite: a player that holds the throttle and steers only round solids, the whole Survival stack (the pack, the rules) against it,
 * is watched for leaving the map and for a stuck car until the run ends (at most 120 s). What pins the rim in the per-commit suite is `survival-chase.test.ts`
 * (the flood fill and the 60 m/s launches at every kind of place on the rim).
 */
const SECONDS = 120;
/** The whole Survival field: the player and the pack's units. */
const FIELD = 32;

describe("given Havana's Survival course, a closed city with a ring of stucco blocks round it, and a player that holds the throttle and steers only round solids", () => {
  let c: Chase;
  const watch = new StuckWatch("Survival pursuit, seed 1", FIELD);
  beforeAll(() => {
    c = chase("flee", 1, SECONDS, undefined, {
      pair: (a, b) => watch.pair(a, b),
      each: (w, time) => {
        if (time <= 0) return;
        const cars = w.live();
        watch.step(cars, time, FRAME, (i) => cars[i]!.group.visible && cars[i]!.deform.drivetrainAlive);
      },
    });
  });

  it("when the pack hunts it, then it stays on the map", (t) => {
    const b = course("havana").bounds;
    t.annotate(`reach x ${c.reach.minX.toFixed(0)}…${c.reach.maxX.toFixed(0)}, z ${c.reach.minZ.toFixed(0)}…${c.reach.maxZ.toFixed(0)}; ended ${c.cause} at ${c.time.toFixed(1)} s`);
    assert.ok(c.reach.minX > b.minX && c.reach.maxX < b.maxX, `drove to x ${c.reach.minX.toFixed(0)}…${c.reach.maxX.toFixed(0)}`);
    assert.ok(c.reach.minZ > b.minZ && c.reach.maxZ < b.maxZ, `drove to z ${c.reach.minZ.toFixed(0)}…${c.reach.maxZ.toFixed(0)}`);
  });

  it("when the pack hunts it, then no live car asks for drive yet stays put outside a pile", (t) => {
    t.annotate(`${watch.episodes.length} stuck windows${watch.episodes.length ? `\n${watch.episodes.join("\n")}` : ""}`);
    assert.deepEqual(watch.episodes, []);
  });
});
