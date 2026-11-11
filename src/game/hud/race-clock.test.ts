import { describe, expect, it } from "vitest";
import { fmtClock12 } from "./race-clock.ts";

describe("given a game minute of the day", () => {
  // mutation: sed -i 's/h % 12 === 0 ? 12 : h % 12/h % 12/' src/game/hud/race-clock.ts
  it("when it is formatted as a 12-hour clock, then midnight and noon read 12 and the half of the day is named", () => {
    expect([0, 60, 720, 750, 1265, 1439].map(fmtClock12)).toEqual(["12:00 AM", "1:00 AM", "12:00 PM", "12:30 PM", "9:05 PM", "11:59 PM"]);
  });
});
