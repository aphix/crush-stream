import { describe, expect, it } from "vitest";
import { Obstacles } from "./obstacles.ts";
import type { PropCollider } from "../world/placements.ts";

/** A solid building box at (x, z) with half sizes hx (along x) and hz (along z). Heading 0 is +z (north), π/2 is +x (east). */
const box = (index: number, x: number, z: number, hx: number, hz: number): PropCollider => ({ index, prefab: "building", body: "solid", x, z, yaw: 0, kind: "box", r: Math.hypot(hx, hz), hx, hz, mass: 0, base: 0, top: 14, ends: 3 });
const EAST = Math.PI / 2;
/** Angle (rad) between two headings. */
const apart = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const STEP = Math.PI / 12;

describe("given the way out from a target for a 60 m run-up (Obstacles.way)", () => {
  it("when nothing stands near the target, then the way is the unit's own bearing (to the compass step)", () => {
    const way = new Obstacles([]).way(0, 0, 0.6, 60);
    expect(apart(way, 0.6), `way ${way.toFixed(3)} vs bearing 0.6`).toBeLessThanOrEqual(STEP / 2 + 1e-9);
  });

  it("when one building stands 30 m north and the unit bears east, then the way stays east, not the one line opposite the building", () => {
    const way = new Obstacles([box(0, 0, 30, 10, 2)]).way(0, 0, EAST, 60);
    expect(apart(way, EAST), `way ${((way * 180) / Math.PI).toFixed(0)} deg vs east`).toBeLessThanOrEqual(STEP);
  });

  it("when walls close the north and the south and the unit bears north-north-east, then the way is out through the nearer opening, the east", () => {
    const way = new Obstacles([box(0, 0, 12, 40, 1), box(1, 0, -12, 40, 1)]).way(0, 0, (20 * Math.PI) / 180, 60);
    expect(apart(way, EAST), `way ${((way * 180) / Math.PI).toFixed(0)} deg vs east`).toBeLessThanOrEqual(2 * STEP);
  });

  it("when walls close every side and the east one stands farthest, then the way is the longest run, east", () => {
    const walls = [box(0, 0, 15, 45, 1), box(1, 0, -15, 45, 1), box(2, -15, 0, 1, 45), box(3, 40, 0, 1, 45)];
    const way = new Obstacles(walls).way(0, 0, 0, 60);
    expect(apart(way, EAST), `way ${((way * 180) / Math.PI).toFixed(0)} deg vs east`).toBeLessThanOrEqual(STEP + 1e-9);
  });
});
