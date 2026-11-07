import { describe, expect, it } from "vitest";
import { WreckPass } from "./wreck-pass.ts";

/** A road with 4 m of room either side of the centre line and a 60 m look-ahead. */
const ROOM = 4;
const LOOK = 60;

describe("given a racer passing stopped cars in the road ahead", () => {
  it("when a stopped car pulls up 6 m ahead in the lane it committed to round a wreck, with a free lane beside it, then it takes the free lane", () => {
    const pass = new WreckPass();
    pass.begin(0, 0);
    pass.note(30, 0, false);
    const committed = pass.choose(0, 0, 0, ROOM, LOOK);
    pass.begin(0, 0.1);
    pass.note(29, 0, false);
    pass.note(6, committed, false);
    const next = pass.choose(0, 0, committed, ROOM, LOOK);
    expect(Math.abs(next - committed), `committed to ${committed.toFixed(2)} m, now ${next.toFixed(2)} m`).toBeGreaterThanOrEqual(3.3);
  });

  it("when every lane is held by stopped cars 10 m on, with the biggest gap between the ones at 0 and 4 m, then it goes for that gap on the gas: never a stop short (owner: a blockade is gassed through at its biggest gap)", () => {
    const pass = new WreckPass();
    pass.begin(0, 0);
    for (const lateral of [-ROOM, -2.5, -1, 0, ROOM]) pass.note(10, lateral, false);
    const lane = pass.choose(0, 0, 0, ROOM, LOOK);
    expect(pass.blockaded, "every lane is held").toBe(true);
    expect(lane > 0 && lane < ROOM, `took ${lane.toFixed(2)} m, the gap between 0 and ${ROOM} m`).toBe(true);
    expect(pass.speedCap, `allows ${pass.speedCap.toFixed(1)} m/s`).toBe(Infinity);
  });

  it("when a stopped car is 12 m ahead on the centre line and the only free lanes are the road's edges, 0.7 m beyond the 3.3 m a pass keeps clear (a tight margin), then it takes one and allows no speed cap: the gas stays on", () => {
    const pass = new WreckPass();
    pass.begin(0, 0);
    pass.note(12, 0, false);
    const lane = pass.choose(0, 0, 0, ROOM, LOOK);
    expect(Math.abs(lane), `took ${lane.toFixed(2)} m`).toBe(ROOM);
    expect(pass.speedCap, `a free lane is capped at ${pass.speedCap.toFixed(1)} m/s`).toBe(Infinity);
  });
});
