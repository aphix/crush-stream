import { describe, expect, it } from "vitest";
import { bookTierWork, takeTierWork, tierWorkStart, timeTierWork } from "./tier-work.ts";

/** Ms a booking is made to have taken: its start is this far back. */
const WORKED_MS = 5;

describe("given tier-gated present work that books its time", () => {
  it("when nothing reads the tier work, then its clock reads nothing and a booking adds none", () => {
    takeTierWork();
    const start = tierWorkStart();
    expect(start, "the clock it starts at").toBe(0);
    bookTierWork(start);
    expect(takeTierWork(), "ms booked").toBe(0);
  });

  it("when the Auto FX tier reads the tier work, then a booking adds the ms since its start, once, and a take empties it", () => {
    timeTierWork(true);
    try {
      takeTierWork();
      const start = tierWorkStart();
      expect(start, "the control: the clock reads").toBeGreaterThan(0);
      bookTierWork(start - WORKED_MS);
      const booked = takeTierWork();
      expect(booked, "ms booked").toBeGreaterThanOrEqual(WORKED_MS);
      expect(booked, "ms booked, not an epoch").toBeLessThan(WORKED_MS + 1000);
      expect(takeTierWork(), "ms taken again").toBe(0);
    } finally {
      timeTierWork(false);
    }
  });
});
