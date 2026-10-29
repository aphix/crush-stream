import { describe, expect, it } from "vitest";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { classStats } from "../vehicle/vehicle-classes.ts";
import { brakeCueAt } from "./brake-cue.ts";

const oval = new Track(TRACKS[0]);
const path = oval.path;
const sedan = classStats("sedan");
/** Arc length (m) of path sample `k`. */
const arc = (k: number) => (k / path.count) * path.length;
// The oval's sharpest bend (sample 112, corner speed ≈ 33 m/s for a sedan) and the middle of its back straight.
const HAIRPIN = arc(112);
const STRAIGHT = arc(350);

describe("given the oval and a sedan", () => {
  it("when it does 50 m/s 25 m before the sharpest bend, then the cue is on", () => {
    expect(brakeCueAt(path, sedan, HAIRPIN - 25, 50, 1)).toBeGreaterThan(0);
  });
  // The plan allows ≈ 46 m/s there (0.72 of the 28 m/s² sedan brake over 25 m into a 33 m/s corner); the cue is full 30 % over it, from 60 m/s (measured 0.9975 at 60, 1 at 62).
  it("when it does 65 m/s at the same point, then the cue is full", () => {
    expect(brakeCueAt(path, sedan, HAIRPIN - 25, 65, 1)).toBe(1);
  });
  it("when it does 8 m/s at the same point, then the cue is 0", () => {
    expect(brakeCueAt(path, sedan, HAIRPIN - 25, 8, 1)).toBe(0);
  });
  it("when it does 50 m/s mid-straight with no bend in braking reach, then the cue is 0", () => {
    expect(brakeCueAt(path, sedan, STRAIGHT, 50, 1)).toBe(0);
  });
  it("when its speed climbs through the plan's, then the cue rises from 0 to 1 and never falls or jumps", () => {
    const STEP = 0.05;
    let prev = 0;
    let seenPartial = false;
    for (let v = 8; v <= 70; v += STEP) {
      const cue = brakeCueAt(path, sedan, HAIRPIN - 25, v, 1);
      expect(cue, `cue fell at ${v.toFixed(2)} m/s: ${prev} -> ${cue}`).toBeGreaterThanOrEqual(prev);
      expect(cue - prev, `cue jumped at ${v.toFixed(2)} m/s: ${prev} -> ${cue}`).toBeLessThanOrEqual(0.1);
      if (cue > 0 && cue < 1) seenPartial = true;
      prev = cue;
    }
    expect(seenPartial, "the cue went from 0 to 1 with nothing between").toBeTruthy();
    expect(prev).toBe(1);
  });
});
