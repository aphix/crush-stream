import { describe, expect, it } from "vitest";
import { pistonAhead, pistonBearing, pistonToGo } from "./engine-pistons.ts";
import { PistonRig } from "../scenes/piston-rig.ts";

const STEP = Math.PI / 4;

describe("given the piston loop of the sandbox (the camera hops from ram to ram, paced by its orbit)", () => {
  it("when each piston's camera bearing is read, then the camera stands behind its ram, looking down its axis", () => {
    for (const h of new PistonRig().heads) {
      const want = Math.atan2(-h.nx, -h.nz);
      expect(Math.abs(Math.sin(pistonBearing(h.index) - want)) < 1e-9 && Math.cos(pistonBearing(h.index) - want) > 0, h.id).toBeTruthy();
    }
  });

  it("when the next ram is picked from the camera's bearing, then it is the next one in the orbit's direction, not the next index, including unwrapped orbit angles", () => {
    // Just past the front ram (bearing 0): front-right comes next, then right.
    expect(pistonAhead(0.01, 0)).toBe(2);
    expect(pistonAhead(STEP + 0.01, 0)).toBe(3);
    // Camera already behind the rear-left corner: rear-left is passed, left (−90°) is next.
    expect(pistonAhead(-3 * STEP + 0.05, 0)).toBe(7);
    // Unwrapped orbit angles (the camera keeps counting turns).
    expect(pistonAhead(0.01 + 4 * Math.PI, 0)).toBe(2);
    expect(pistonAhead(0.01 - 6 * Math.PI, 0)).toBe(2);
  });

  it("when the camera reaches a ram too soon to park the car for it, then a lead skips that ram and picks the following one", () => {
    expect(pistonAhead(STEP - 0.05, 0)).toBe(2);
    expect(pistonAhead(STEP - 0.05, 0.12)).toBe(3);
  });

  it("when the orbit approaches and passes a ram, then the angle to go shrinks to zero and then goes negative, and the next ram is always within 45° ahead", () => {
    const i = pistonAhead(0.3, 0);
    expect(Math.abs(pistonToGo(i, 0.3) - (STEP - 0.3))).toBeLessThan(1e-9);
    expect(Math.abs(pistonToGo(i, STEP))).toBeLessThan(1e-9);
    expect(pistonToGo(i, STEP + 0.01)).toBeLessThan(0);
    // One hop per eighth of a turn at any orbit offset: the next ram is always within 45° ahead.
    for (let b = -7; b < 7; b += 0.137) {
      const t = pistonToGo(pistonAhead(b, 0), b);
      expect(t > 0 && t <= STEP + 1e-9, `bearing ${b}: ${t}`).toBeTruthy();
    }
  });
});
