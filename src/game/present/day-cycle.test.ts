import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { dayGradeAt, lightElevation, makeDayGrade, REFERENCE_HEIGHT, SUN_HOP_METRES, sunHopTolerance, sunNeedsHop, wrapHour, type DayGrade } from "./day-cycle.ts";

/** Game minutes in a game day, and an hour's. */
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;
const DEG = Math.PI / 180;
/** The sun's lowest and highest elevations the stage lights with, and the moon's (rad): where the day's light lies between (`WorldStage`). */
const LOWEST = 12 * DEG;
const HIGHEST = 58.6 * DEG;
const MOON = 35.5 * DEG;
/** The most a channel of the grade may change in one game minute: a fade a viewer reads as continuous (the stage sets it once a game minute). */
const STEP_MAX = 0.035;
/** A hop is asked for when the tip is `SUN_HOP_METRES` off; the check is once a game minute, so the low sun, whose tip moves a third of a metre a minute, overshoots by at most this many times it. */
const HOP_OVERSHOOT_MAX = 2.2;
/** Hops a game day may take, bounds that tell a cadence of minutes (about one in five, every minute or two at the low sun) from every minute or every hour. */
const HOPS_PER_DAY = { least: 150, most: 450 };

const channels = (grade: DayGrade): number[] => [grade.night, grade.warm, grade.lamps, grade.sunHeight];

/** The tip of the shadow of a building `height` tall, at an elevation (m from its foot). */
const tipAt = (height: number, elevation: number): number => height / Math.tan(elevation);

describe("given the day's grade by the game hour", () => {
  // mutation: sed -i 's/const DUSK = { from: 17.5, to: 20 } as const;/const DUSK = { from: 17.5, to: 17.6 } as const;/' src/game/present/day-cycle.ts
  it("when the grade is read every game minute round the clock, then no channel moves more than a fade's step and each stays between 0 and 1", () => {
    const grade = makeDayGrade();
    let before = channels(dayGradeAt(0, grade));
    let worst = 0;
    for (let minute = 1; minute <= MINUTES_PER_DAY; minute++) {
      const now = channels(dayGradeAt(minute / MINUTES_PER_HOUR, grade));
      for (const [at, value] of now.entries()) {
        worst = Math.max(worst, Math.abs(value - before[at]!));
        expect(value >= 0 && value <= 1, `channel ${at} at minute ${minute}: ${value}`).toBe(true);
      }
      before = now;
    }
    expect(worst, "the largest change of any channel in one game minute").toBeLessThanOrEqual(STEP_MAX);
  });

  // mutation: sed -i 's/const SUN_UP = { rise: 6, set: 18 } as const;/const SUN_UP = { rise: 6, set: 6.5 } as const;/' src/game/present/day-cycle.ts
  it("when noon, dusk and midnight are read, then noon is bright and plain, dusk warm and half dark with the lamps coming on, midnight dark with the lamps full", () => {
    const grade = makeDayGrade();
    const noon = { ...dayGradeAt(12, grade) };
    const dusk = { ...dayGradeAt(18.5, grade) };
    const midnight = { ...dayGradeAt(0, grade) };
    expect(noon.night, "noon's darkness").toBe(0);
    expect(noon.warm, "noon's warmth").toBe(0);
    expect(noon.lamps, "noon's lamps").toBe(0);
    expect(noon.sunHeight, "noon's sun").toBeCloseTo(1, 9);
    expect(dusk.warm, "dusk's warmth").toBeGreaterThan(0.9);
    expect(dusk.night, "dusk's darkness").toBeGreaterThan(0.2);
    expect(dusk.night, "dusk's darkness").toBeLessThan(0.6);
    expect(dusk.lamps, "dusk's lamps").toBeGreaterThan(0.2);
    expect(midnight.night, "midnight's darkness").toBe(1);
    expect(midnight.lamps, "midnight's lamps").toBe(1);
    expect(midnight.warm, "midnight's warmth").toBe(0);
    expect(midnight.sunHeight, "midnight's sun").toBe(0);
  });

  // mutation: sed -i 's/  const h = wrapHour(hour);/  const h = hour;/' src/game/present/day-cycle.ts
  it("when an hour past the day's end or before its start is read, then it is the same hour of another day", () => {
    const grade = makeDayGrade();
    for (const hour of [0.5, 6.25, 12, 18.75, 23.9]) {
      const plain = channels(dayGradeAt(hour, grade));
      for (const shifted of [hour + 24, hour - 24, hour + 48]) expect(firstMismatch(channels(dayGradeAt(shifted, grade)), plain, 1e-12), `${shifted} against ${hour}`).toBeUndefined();
    }
    expect(wrapHour(-1), "the hour before midnight").toBe(23);
    expect(wrapHour(25.5), "an hour past the day").toBe(1.5);
  });

  // mutation: sed -i 's/const LAMPS_ON = { from: 0.35, to: 0.85 } as const;/const LAMPS_ON = { from: 0.05, to: 0.1 } as const;/' src/game/present/day-cycle.ts
  it("when the evening is read, then the lamps come on after the light has begun to go and are full before the night is", () => {
    const grade = makeDayGrade();
    const first = (test: (g: DayGrade) => boolean): number => {
      for (let minute = 12 * MINUTES_PER_HOUR; minute <= 24 * MINUTES_PER_HOUR; minute++) if (test(dayGradeAt(minute / MINUTES_PER_HOUR, grade))) return minute / MINUTES_PER_HOUR;
      return Infinity;
    };
    const lampsOn = first((g) => g.lamps > 0);
    const lampsFull = first((g) => g.lamps >= 1);
    const darkening = first((g) => g.night > 0);
    const dark = first((g) => g.night >= 1);
    expect(lampsOn, "the lamps' first light").toBeGreaterThan(darkening);
    expect(lampsFull, "the lamps' full strength").toBeLessThan(dark);
    expect(lampsFull - lampsOn, "game hours the lamps take to come on").toBeGreaterThan(0.5);
  });
});

describe("given the light's hops", () => {
  /** The elevation of the light at an hour as the stage has it: the sun's arc and the moon, the day's 58.6 degrees, the evening's lowest 12. */
  const elevationAt = (hour: number, grade: DayGrade): number => lightElevation(dayGradeAt(hour, grade), LOWEST, HIGHEST, MOON);

  // mutation: sed -i 's/export const SUN_HOP_METRES = 0.3;/export const SUN_HOP_METRES = 0.001;/' src/game/present/day-cycle.ts
  it("when a game day is run minute by minute, then the light hops a few hundred times, never farther than its tolerance, and never leaves the tip within a hop of the truth", () => {
    const grade = makeDayGrade();
    let applied = elevationAt(0, grade);
    let hops = 0;
    let worstTip = 0;
    let worstOff = 0;
    for (let minute = 1; minute <= MINUTES_PER_DAY; minute++) {
      const target = elevationAt(minute / MINUTES_PER_HOUR, grade);
      if (sunNeedsHop(applied, target)) {
        hops++;
        worstTip = Math.max(worstTip, Math.abs(tipAt(REFERENCE_HEIGHT, target) - tipAt(REFERENCE_HEIGHT, applied)));
        applied = target;
      }
      worstOff = Math.max(worstOff, Math.abs(tipAt(REFERENCE_HEIGHT, target) - tipAt(REFERENCE_HEIGHT, applied)));
    }
    expect(hops, "hops in a game day").toBeGreaterThanOrEqual(HOPS_PER_DAY.least);
    expect(hops, "hops in a game day").toBeLessThanOrEqual(HOPS_PER_DAY.most);
    expect(worstTip, "the farthest a shadow tip jumps at a hop (m)").toBeLessThanOrEqual(SUN_HOP_METRES * HOP_OVERSHOOT_MAX);
    expect(worstOff, "the farthest a shadow tip is from where the clock puts it (m)").toBeLessThanOrEqual(SUN_HOP_METRES * HOP_OVERSHOOT_MAX);
  });

  it("when the tolerance is read at the lowest and the highest sun, then the low sun hops over fewer degrees and a hop moves the tip about as far at either", () => {
    const low = sunHopTolerance(LOWEST);
    const high = sunHopTolerance(HIGHEST);
    expect(low, "the low sun's tolerance (rad)").toBeLessThan(high / 4);
    for (const elevation of [LOWEST, 25 * DEG, HIGHEST]) {
      const tolerance = sunHopTolerance(elevation);
      const jump = Math.abs(tipAt(REFERENCE_HEIGHT, elevation + tolerance) - tipAt(REFERENCE_HEIGHT, elevation));
      expect(jump / SUN_HOP_METRES, `a hop's tip jump at ${(elevation / DEG).toFixed(0)} degrees over the metres asked`).toBeGreaterThan(0.7);
      expect(jump / SUN_HOP_METRES, `a hop's tip jump at ${(elevation / DEG).toFixed(0)} degrees over the metres asked`).toBeLessThan(1.4);
    }
  });
});
