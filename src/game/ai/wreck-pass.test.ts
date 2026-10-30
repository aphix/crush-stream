import { describe, expect, it } from "vitest";
import { WreckPass } from "./wreck-pass.ts";

/** A road with 4 m of room either side of the centre line, a 60 m look-ahead, a class that brakes at 7 m/s² and tops out at 50 m/s, lanes moving at 3 m/s. */
const ROOM = 4;
const LOOK = 60;
const DECEL = 7;
const TOP = 50;
const RATE = 3;

describe("given a racer passing stopped cars in the road ahead", () => {
  it("when a stopped car pulls up 6 m ahead in the lane it committed to round a wreck, with a free lane beside it, then it takes the free lane", () => {
    const pass = new WreckPass();
    pass.begin(0, 0);
    pass.note(30, 0, false);
    const committed = pass.choose(0, 0, 0, ROOM, LOOK, DECEL, TOP, RATE);
    pass.begin(0, 0.1);
    pass.note(29, 0, false);
    pass.note(6, committed, false);
    const next = pass.choose(0, 0, committed, ROOM, LOOK, DECEL, TOP, RATE);
    expect(Math.abs(next - committed), `committed to ${committed.toFixed(2)} m, now ${next.toFixed(2)} m`).toBeGreaterThanOrEqual(3.3);
  });

  it("when every lane it can take is held by stopped cars 10 m on, then the speed it allows still stops 6 m short of them", () => {
    const pass = new WreckPass();
    pass.begin(0, 0);
    for (const lateral of [-ROOM, -2, 0, 2, ROOM]) pass.note(10, lateral, false);
    pass.choose(0, 0, 0, ROOM, LOOK, DECEL, TOP, RATE);
    // From 10 m, 6 m short at 7 m/s²: √(2 · 7 · 4).
    expect(pass.speedCap, `allows ${pass.speedCap.toFixed(1)} m/s`).toBeLessThanOrEqual(Math.sqrt(2 * DECEL * 4) + 1e-9);
  });
});
