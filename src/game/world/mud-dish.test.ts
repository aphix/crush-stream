import { describe, expect, it } from "vitest";
import { SURFACES } from "./catalog.ts";
import { SURFACE } from "./constants.ts";
import { Track } from "./track.ts";
import { CLASSES, tyreGrip, tyreRoll } from "../vehicle/vehicle-classes.ts";
import { dishEight, dishSquare, heightAcross } from "./dish.test-util.ts";

/** Arc length (m) on `square`'s straight x = 0 side, 30 m from its first node. */
const STRAIGHT_S = 30;
/** The parabola is stamped on 1 m nodes and read through the crease: its chords stand 2 mm off it inside the road (the edge's kink, within a cell of it, rounds by up to 5 cm). */
const DISH_TOL = 0.01;

describe("given a road surfaced in mud", () => {
  it("when the ground under its centreline is read, then it is mud, and a road tyre (the sedan's) takes 0.9 of mud's 0.45 grip at its 0.45 rolling floor while an all-terrain (the pickup's) takes 1.15 of it at mud's own 0.10", () => {
    const track = new Track(dishSquare(0, SURFACE.mud));
    const pt = track.pointAt(STRAIGHT_S, { x: 0, y: 0, z: 0, tx: 0, tz: 1, half: 0 });
    const under = SURFACES[track.ground().surfaceAt(pt.x, pt.z)];
    expect(under).toBe(SURFACES.mud);
    expect(tyreGrip(CLASSES.sedan.tyre, under)).toBeCloseTo(0.45 * 0.9, 12);
    expect(tyreRoll(CLASSES.sedan.tyre, under)).toBe(0.45);
    expect(tyreGrip(CLASSES.truck.tyre, under)).toBeCloseTo(0.45 * 1.15, 12);
    expect(tyreRoll(CLASSES.truck.tyre, under)).toBe(0.1);
  });
});

describe("given a road dished 1 m (its edges 1 m over its centre) and 22 m wide", () => {
  const track = new Track(dishSquare(1));

  it("when the ground is read across it, then it stands at the centreline's height in the middle, a quarter metre up half way out, (10 / 11)² m up a metre in from each edge and the full metre held over the runoff", () => {
    const centre = heightAcross(track, STRAIGHT_S, 0);
    const rows: [number, number][] = [
      [0, 0],
      [5.5, 0.25],
      [-5.5, 0.25],
      [10, 100 / 121],
      [-10, 100 / 121],
      [12.5, 1],
      [-12.5, 1],
    ];
    for (const [lat, rise] of rows) expect(Math.abs(heightAcross(track, STRAIGHT_S, lat) - centre - rise), `lateral ${lat} m`).toBeLessThan(DISH_TOL);
  });
});

describe("given a figure-8 dished 1 m, 24 m wide, its strands crossing at 90° through the origin", () => {
  it("when the ground over the crossing is read (a 0.5 m lattice over the square both roads share), then it is the lower of the two roads' dishes there, the nearer centreline's: one valley, the centre of the X its floor", () => {
    const track = new Track(dishEight(30, 90, 24, 1));
    const ground = track.ground();
    const half = 12;
    const misses: string[] = [];
    for (let x = -11; x <= 11; x += 0.5) {
      for (let z = -11; z <= 11; z += 0.5) {
        // Laterals off the two strands (along (±1, 1) / √2).
        const a = Math.abs(x - z) / Math.SQRT2;
        const b = Math.abs(x + z) / Math.SQRT2;
        if (a > half - 1 || b > half - 1) continue;
        const want = (Math.min(a, b) / half) ** 2;
        const got = ground.heightAt(x, z, 2);
        if (Math.abs(got - want) > DISH_TOL) misses.push(`(${x}, ${z}): ${got.toFixed(3)} m, the nearer dish ${want.toFixed(3)}`);
      }
    }
    expect(misses).toEqual([]);
  });
});