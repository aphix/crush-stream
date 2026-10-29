import { describe, expect, it } from "vitest";
import { checkPlateaus, plateauHeight, type Plateau } from "./terrain.ts";
import { Track } from "./track.ts";
import { square } from "./track.test-util.ts";

/**
 * The terrain features the heightfield adds after the roads (terrain.ts): a plateau with a sharp-crested top and planar sides, and
 * surface paint. The `square` course's infield (x 8..112, z 8..125 clear of road and runoff) holds them.
 */

const HILL: Plateau = { x: 60, z: 60, halfX: 10, halfZ: 15, height: 3, run: [8, 8, 10, 10], round: 3, top: "concrete" };

describe("given a plateau (a raised platform with a sharp-crested flat top and planar sides)", () => {
  it("when its height is read across the top, beyond the feet and on a side, then the top is flat, the ground beyond the feet is zero, and each side is one rising plane at height over run", () => {
    // The flat top ends 3 m (the rounding) inside the nominal edges: |dx| ≤ 7, |dz| ≤ 12.
    for (const [dx, dz] of [[0, 0], [6.9, 11.9], [-6.9, -11.9], [0, 11.9], [-6.9, 0]] as const) expect(plateauHeight(HILL, HILL.x + dx, HILL.z + dz), `top at (${dx}, ${dz})`).toBe(3);
    for (const [dx, dz] of [[10 + 8 + 3.1, 0], [0, 15 + 10 + 3.1], [-(10 + 8 + 3.1), 0], [0, -(15 + 10 + 3.1)], [40, 40]] as const) expect(plateauHeight(HILL, HILL.x + dx, HILL.z + dz), `ground at (${dx}, ${dz})`).toBe(0);
    // The +z side: a 3 m rise over 10 m, 0.3 m per metre between the roundings (3 m either side of the crest at z+15 and of the foot at z+25).
    const h = (dz: number) => plateauHeight(HILL, HILL.x, HILL.z + dz);
    expect(Math.abs(h(18.5) - h(19.5) - 0.3) < 1e-9 && Math.abs(h(19.5) - h(20.5) - 0.3) < 1e-9, "the plane's grade is height / run").toBeTruthy();
    expect(Math.abs(h(20) - 1.5), "its middle is half the height").toBeLessThan(1e-9);
  });

  it("when the height is walked along lines across it, then it never climbs faster than height over run and the crest and foot are bends, not corners", () => {
    let steepest = 0;
    let kink = 0;
    for (const [ax, az, bx, bz] of [[30, 60, 90, 60], [60, 25, 60, 95], [35, 30, 85, 90], [85, 30, 35, 90]] as const) {
      const n = 600;
      let prev = -1;
      let prevGrade = 0;
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        const h = plateauHeight(HILL, x, z);
        const len = Math.hypot(bx - ax, bz - az) / n;
        if (prev >= 0) {
          const grade = (h - prev) / len;
          steepest = Math.max(steepest, Math.abs(grade));
          // The grade changes by a bounded amount per centimetre-scale step: no corner.
          kink = Math.max(kink, Math.abs(grade - prevGrade));
          prevGrade = grade;
        }
        prev = h;
      }
    }
    expect(steepest, `steepest grade ${steepest.toFixed(3)} against ${(HILL.height / 8).toFixed(3)} on the shortest run`).toBeLessThanOrEqual(HILL.height / 8 + 1e-6);
    expect(kink, `a corner: the grade jumps ${kink.toFixed(4)} between 10 cm steps`).toBeLessThan(0.02);
  });

  it("when the crest has no rounding, then the grade jumps by the whole slope across 10 cm, where a rounded crest changes grade a little at a time", () => {
    const grade = (p: Plateau, dz: number) => (plateauHeight(p, HILL.x, HILL.z + dz + 0.05) - plateauHeight(p, HILL.x, HILL.z + dz - 0.05)) / 0.1;
    expect(Math.abs(grade({ ...HILL, round: 0 }, 15.1) - grade({ ...HILL, round: 0 }, 14.9) + 0.3), "flat, then 0.3 m per metre down").toBeLessThan(1e-9);
    expect(Math.abs(grade(HILL, 15.1) - grade(HILL, 14.9)), "the rounded crest changes grade a little at a time").toBeLessThan(0.02);
  });
});

describe("given a course (the square course) with a plateau and a lawn painted over concrete terrain", () => {
  const plain = square({ environment: { terrain: "concrete", plateaus: [HILL], paint: [{ surface: "grass", poly: [[30, 30], [90, 30], [90, 90], [30, 90]] }] } });

  it("when the ground is read there, then the plateau top is raised in concrete, its sides are grass falling at the planned grade, and the road is untouched", () => {
    const g = new Track(plain).ground();
    expect(g.heightAt(60, 60)).toBe(3);
    expect(g.surfaceAt(60, 60)).toBe("concrete");
    expect(g.surfaceAt(60, 80), "the slope is the lawn painted under it").toBe("grass");
    expect(Math.abs(g.heightAt(60, 80) - 1.5), `half way down ${g.heightAt(60, 80)}`).toBeLessThan(0.02);
    expect(g.heightAt(60, 95)).toBe(0);
    expect(g.heightAt(0, 30), "the road is flat as before").toBe(0);
    expect(g.surfaceAt(0, 30)).toBe("asphalt");
    const n = g.normalAt(60, 80, { x: 0, y: 0, z: 0 });
    expect(Math.abs(Math.atan2(Math.hypot(n.x, n.z), n.y) - Math.atan(0.3)), `the slope's normal is tilted ${JSON.stringify(n)}`).toBeLessThan(0.02);
  });

  it("when the lawn polygon is painted, then it covers bare terrain only, never a road or what lies outside it", () => {
    const g = new Track(plain).ground();
    expect(g.surfaceAt(40, 50)).toBe("grass");
    expect(g.surfaceAt(20, 50), "outside the polygon the terrain stays").toBe("concrete");
    expect(g.frictionAt(40, 50)).toBe(0.5);
    const road = new Track(square({ environment: { terrain: "concrete", paint: [{ surface: "grass", poly: [[-20, -20], [140, -20], [140, 160], [-20, 160]] }] } })).ground();
    expect(road.surfaceAt(0, 30), "a polygon over the road leaves the road its surface").toBe("asphalt");
    expect(road.surfaceAt(-10, 30)).toBe("grass");
  });

  it("when a plateau is placed reaching a road or past the baked ground, then the course is refused with the reason", () => {
    expect(() => new Track(square({ environment: { plateaus: [{ ...HILL, x: 400, z: 60 }] } })).ground()).toThrow(/reaches past the baked ground/);
    expect(() => new Track(square({ environment: { plateaus: [{ ...HILL, x: 12, z: 60 }] } }))).toThrow(/a road reaches the plateau/);
    // A street along z through the plateau's middle, sampled every metre as a path is.
    const street = (x: number) => ({ count: 61, x: Array(61).fill(x), z: Array.from({ length: 61 }, (_, i) => 30 + i), tx: Array(61).fill(0), tz: Array(61).fill(1), half: Array(61).fill(5), runL: Array(61).fill(2), runR: Array(61).fill(2) });
    expect(() => checkPlateaus("t", [HILL], [street(60)])).toThrow(/a road reaches the plateau/);
    expect(() => checkPlateaus("t", [HILL], [street(20)]), "a street beside the footprint is fine").not.toThrow();
  });
});
