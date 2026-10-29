import { describe, expect, it } from "vitest";
import { REV_IDLE, VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { easeLoad, engineLawDb, engineLawGain, naturalDb } from "./engine-law.ts";
import { voiceLevels } from "./motor-level.test-util.ts";

const LOADS = [0, 0.15, 0.3, 0.5, 0.75, 1] as const;
const REVS = [REV_IDLE, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
/** Redline's peak band (`motor-level.test.ts`) and the -6 dBFS voice cap: the law must not push a voice past either. */
const REDLINE_PEAK_MIN = 0.12;
const REDLINE_PEAK_MAX = 0.4;
const VOICE_PEAK_LIMIT = 0.5;
const db = (x: number): number => 20 * Math.log10(x);

describe("given an engine's loudness over its whole rev and pedal range", () => {
  it("when the pedal is up versus wide open at the same revs, then coast sits 6-10 dB under full load (the lift is heard, the lifted engine is not lost)", () => {
    for (const rev of REVS) {
      const gap = engineLawDb(rev, 1) - engineLawDb(rev, 0);
      expect(gap >= 6 && gap <= 10, `rev ${rev}: wide open is ${gap.toFixed(1)} dB over coast`).toBeTruthy();
    }
  });

  it("when the engine runs from idle coast to redline wide open, then the range is about 18 dB (the M5's idle at its top, -18 dB) and redline wide open is the 0 dB reference", () => {
    const range = engineLawDb(1, 1) - engineLawDb(REV_IDLE, 0);
    expect(Math.abs(range - 18), `idle to redline is ${range.toFixed(1)} dB`).toBeLessThanOrEqual(1);
    expect(engineLawDb(1, 1)).toBe(0);
  });

  it("when the revs climb at any pedal load, then the loudness never falls, and a deeper pedal never makes it quieter at any revs", () => {
    for (const load of LOADS) {
      for (let i = 1; i < REVS.length; i++) expect(engineLawDb(REVS[i]!, load), `load ${load}, rev ${REVS[i]}`).toBeGreaterThan(engineLawDb(REVS[i - 1]!, load));
    }
    for (const rev of REVS) {
      for (let i = 1; i < LOADS.length; i++) expect(engineLawDb(rev, LOADS[i]!), `rev ${rev}, load ${LOADS[i]}`).toBeGreaterThanOrEqual(engineLawDb(rev, LOADS[i - 1]!));
    }
  });

  it("when the pedal is barely pressed versus half down, then the loudness stays flat under 0.15 load and gains a third of its span at half load", () => {
    expect(engineLawDb(0.6, 0.1)).toBe(engineLawDb(0.6, 0));
    const half = (engineLawDb(0.6, 0.5) - engineLawDb(0.6, 0)) / (engineLawDb(0.6, 1) - engineLawDb(0.6, 0));
    expect(Math.abs(half - 8 / 22), `half load is ${half.toFixed(3)} of the span`).toBeLessThan(1e-9);
  });

  it("when the pedal goes down and then lifts, then the release takes longer than the attack", () => {
    const halfTime = (from: number, to: number): number => {
      let load = from;
      let t = 0;
      while (Math.abs(load - to) > 0.5) {
        load = easeLoad(load, to, 0.01);
        t += 0.01;
      }
      return t;
    };
    const attack = halfTime(0, 1);
    const release = halfTime(1, 0);
    expect(release, `attack ${attack.toFixed(2)} s, release ${release.toFixed(2)} s`).toBeGreaterThan(2 * attack);
  });
});

describe("given each vehicle class's engine voice at every rev and pedal position, with the engine's loudness law applied", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when the ${cls} runs through revs and loads, then its level follows the law and stays inside the caps`, async () => {
      const levels = await voiceLevels(cls, "healthy", REVS);
      const redline = levels.at(-1)!;
      expect(redline.peak >= REDLINE_PEAK_MIN && redline.peak <= REDLINE_PEAK_MAX, `${cls} redline peak ${redline.peak.toFixed(3)}`).toBeTruthy();
      for (let i = 0; i < REVS.length; i++) {
        const rev = REVS[i]!;
        const level = levels[i]!;
        // The grid is interpolated: its knots (idle, 1 and every 1/8 of the span) match the render, the revs between within 2 dB.
        expect(Math.abs(db(level.rms / redline.rms) - naturalDb(cls, rev)), `${cls} rev ${rev}: render ${db(level.rms / redline.rms).toFixed(1)} dB, table ${naturalDb(cls, rev).toFixed(1)}`).toBeLessThanOrEqual(2);
        for (const load of LOADS) {
          const gain = engineLawGain(cls, rev, load, true);
          const combined = db((level.rms * gain) / redline.rms);
          expect(Math.abs(combined - engineLawDb(rev, load)), `${cls} rev ${rev} load ${load}: ${combined.toFixed(1)} dB, law ${engineLawDb(rev, load).toFixed(1)}`).toBeLessThanOrEqual(2);
          expect(level.peak * gain, `${cls} rev ${rev} load ${load} peaks ${(level.peak * gain).toFixed(3)}`).toBeLessThanOrEqual(VOICE_PEAK_LIMIT);
        }
      }
      expect(engineLawGain(cls, 1, 1, true)).toBe(1);
    });
  }
});
