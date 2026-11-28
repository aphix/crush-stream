import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { REV_IDLE, VEHICLE_CLASS_IDS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { CABIN_RADIUS_M, distanceCutoff, dspTone, type DspTone, PERSPECTIVE_NAMES, PERSPECTIVES, perspectiveFor, perspectiveGains, SHIFT_CUT_S, SHIFT_GAP_S, shiftKind, shiftStrength } from "./motor-layers.ts";
import { type BlockPlan, bandEnergy, peakRms, renderVoice } from "./motor-render.test-util.ts";
import { BLOCK, SAMPLE_RATE } from "./motor-level.test-util.ts";
import { motorRpm } from "./motor-tone.ts";

const rms = (x: Float32Array, from: number, to: number): number => peakRms(x.subarray(from, to)).rms;
const db = (x: number): number => 20 * Math.log10(x + 1e-12);

/** The two renders `a` and `b` of one voice (same wasm noise, same layer noise), subtracted: what the tuning that differs between them adds. */
async function added(cls: VehicleClassId, blocks: number, plan: (block: number) => BlockPlan, tune: Partial<DspTone>, without: Partial<DspTone>): Promise<Float32Array> {
  const [a, b] = [await renderVoice(cls, "healthy", blocks, plan, tune), await renderVoice(cls, "healthy", blocks, plan, without)];
  return a.map((v, i) => v - b[i]!);
}

/** Load 1 for `lead` blocks, then 0: a lift-off at a steady rev. */
const lift = (rev: number, lead: number) => (block: number): BlockPlan => ({ rev, load: block < lead ? 1 : 0 });

/** Frequency (Hz) of the strongest line of `x` between `from` and `to` Hz. */
function strongestLine(x: Float32Array, from: number, to: number): number {
  const size = 16384;
  const bins = new Float64Array(size / 2);
  for (let k = Math.floor((from * size) / SAMPLE_RATE); k < Math.ceil((to * size) / SAMPLE_RATE); k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < size; i += 2) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      const phase = (-2 * Math.PI * k * i) / size;
      re += x[x.length - size + i]! * w * Math.cos(phase);
      im += x[x.length - size + i]! * w * Math.sin(phase);
    }
    bins[k] = re * re + im * im;
  }
  return (bins.indexOf(Math.max(...bins)) * SAMPLE_RATE) / size;
}

describe("given the voice layers' tuning and the worklet that reads it", () => {
  it("when the worklet's reads are compared with the tuning's fields, then each field is read by name and each name read is a field", () => {
    const source = readFileSync(new URL("../../../kernels/motor/motor-layers.js", import.meta.url), "utf8");
    const read = new Set([...source.matchAll(/\bc\.([a-zA-Z]+)/g)].map((m) => m[1]!));
    expect([...read].sort().join()).toBe(Object.keys(dspTone("sedan", "healthy", 4, 850, 6000)).sort().join());
  });

  it("when the classes are compared, then the heavy ones thump lower and longer than the light ones, and only the sporty ones pop", () => {
    const body = (cls: VehicleClassId): DspTone => dspTone(cls, "healthy", 4, 800, 6000);
    expect(body("monster").bodyHz, "monster under truck").toBeLessThan(body("truck").bodyHz);
    expect(body("truck").bodyHz, "truck under sedan").toBeLessThan(body("sedan").bodyHz);
    expect(body("sedan").bodyHz, "sedan under hatch").toBeLessThan(body("hatch").bodyHz);
    expect(body("monster").bodyTauS, "monster rings longer than hatch").toBeGreaterThan(body("hatch").bodyTauS);
    expect(body("muscle").burbleRate, "muscle pops").toBeGreaterThan(5);
    expect(body("hatch").burbleRate, "hatch pops").toBeGreaterThan(5);
    expect(body("truck").burbleRate, "truck does not").toBe(0);
    expect(body("suv").burbleRate, "suv does not").toBe(0);
    expect(body("hatch").blowoffGain, "hatch blows off").toBeGreaterThan(0);
    expect(body("sedan").whineGain, "sedan has no induction").toBe(0);
    expect(body("muscle").whineCrank, "muscle's whine follows the crank").toBeGreaterThan(0);
  });

  it("when an engine is damaged, then its whine weakens and it backfires more", () => {
    const healthy = dspTone("hatch", "healthy", 4, 800, 6000);
    const limping = dspTone("hatch", "limping", 4, 800, 6000);
    expect(limping.whineGain).toBeLessThan(healthy.whineGain);
    expect(limping.burbleRate).toBeGreaterThan(healthy.burbleRate);
  });
});

describe("given the perspectives", () => {
  it("when the followed car is heard from inside versus behind, then the cabin leans on the block and the intake with the exhaust far behind, and boom and close the highs", () => {
    expect(PERSPECTIVES.cabin.outlet).toBeLessThan(PERSPECTIVES.chase.outlet);
    expect(PERSPECTIVES.cabin.block).toBeGreaterThan(PERSPECTIVES.chase.block);
    expect(PERSPECTIVES.cabin.boomDb).toBeGreaterThan(PERSPECTIVES.chase.boomDb);
    expect(PERSPECTIVES.cabin.openHz).toBeLessThan(PERSPECTIVES.chase.openHz);
    expect(PERSPECTIVES.chase.outlet, "the chase car's exhaust has weight").toBeGreaterThan(PERSPECTIVES.other.outlet);
    expect(CABIN_RADIUS_M).toBeGreaterThan(0.5);
  });

  it("when a camera is placed against the followed car, then it is the cabin inside the radius and the chase outside it; any other car is heard from afar", () => {
    const named = (priority: boolean, metres: number): string => PERSPECTIVE_NAMES[perspectiveFor(priority, metres * metres)]!;
    expect(named(true, CABIN_RADIUS_M * 0.8)).toBe("cabin");
    expect(named(true, CABIN_RADIUS_M * 1.2)).toBe("chase");
    expect(named(true, 6)).toBe("chase");
    expect(named(false, 0.5)).toBe("other");
  });

  it("when the class gains meet a perspective, then each channel is the class's times the perspective's", () => {
    const out = new Float64Array(3);
    perspectiveGains(out, [1, 2, 3], "cabin");
    expect(firstMismatch(out, [PERSPECTIVES.cabin.intake, 2 * PERSPECTIVES.cabin.block, 3 * PERSPECTIVES.cabin.outlet])).toBeUndefined();
  });

  it("when a car is farther, then the highs it carries fall: open inside 8 m, closing with each doubling, never under the floor", () => {
    expect(distanceCutoff(3)).toBe(20000);
    expect(distanceCutoff(16)).toBeLessThan(distanceCutoff(8));
    expect(distanceCutoff(60)).toBeLessThan(distanceCutoff(16));
    expect(distanceCutoff(1e6)).toBeGreaterThan(1000);
  });
});

describe("given the gear shift", () => {
  it("when the gear changes, then a hop up is an upshift and a hop down a downshift, and reverse, a standstill and a change too soon after the last are nothing", () => {
    expect(shiftKind(2, 3, 1), "up").toBe(1);
    expect(shiftKind(3, 2, 1), "down").toBe(-1);
    expect(shiftKind(2, 2, 1), "same gear").toBe(0);
    expect(shiftKind(0, 1, 1), "out of reverse").toBe(0);
    expect(shiftKind(1, 0, 1), "into reverse").toBe(0);
    expect(shiftKind(2, 3, SHIFT_GAP_S / 2), "chatter at a bucket's edge").toBe(0);
  });

  it("when a hard upshift is compared with a downshift, then the upshift thumps harder, and a harder pedal thumps harder", () => {
    expect(shiftStrength(1, true)).toBeGreaterThan(shiftStrength(1, false));
    expect(shiftStrength(1, true)).toBeGreaterThan(shiftStrength(0.2, true));
    expect(shiftStrength(1, true)).toBeLessThanOrEqual(1);
    expect(SHIFT_CUT_S).toBeGreaterThan(0.05);
  });

  it("when the trigger rises at block 150 of a steady engine, then nothing is added before it and a thump low in the band follows", async () => {
    const plan = (): BlockPlan => ({ rev: 0.6, load: 1 });
    const [steady, shifted] = [await renderVoice("sedan", "healthy", 400, plan), await renderVoice("sedan", "healthy", 400, (b) => ({ ...plan(), shift: b >= 150 && b < 160 ? 1 : 0 }))];
    const thump = shifted.map((v, i) => v - steady[i]!);
    expect(peakRms(thump.subarray(0, 150 * BLOCK)).peak, "before the trigger").toBe(0);
    const after = thump.subarray(150 * BLOCK, 150 * BLOCK + 8192);
    expect(rms(after, 0, after.length), "the thump (rms)").toBeGreaterThan(0.01);
    const [sub, low, , upper] = bandEnergy(thump.subarray(150 * BLOCK, 150 * BLOCK + 16384));
    expect(Math.max(sub!, low!), "the thump lives below 250 Hz").toBeGreaterThan(upper! + 6);
  });

  it("when a truck and a hatch are shifted, then the truck's thump is lower and rings longer", async () => {
    const shifting = (b: number): BlockPlan => ({ rev: 0.6, load: 1, shift: b >= 150 && b < 160 ? 1 : 0 });
    const still = (): BlockPlan => ({ rev: 0.6, load: 1 });
    const lengths: number[] = [];
    for (const cls of ["truck", "hatch"] as const) {
      const [on, off] = [await renderVoice(cls, "healthy", 400, shifting), await renderVoice(cls, "healthy", 400, still)];
      const thump = on.map((v, i) => v - off[i]!).subarray(150 * BLOCK);
      let ring = 0;
      for (let i = 0; i < thump.length; i += 64) if (Math.abs(thump[i]!) > 0.002) ring = i;
      lengths.push(ring);
    }
    expect(lengths[0]!, "truck rings longer").toBeGreaterThan(lengths[1]!);
  });
});

describe("given the firing-locked body thump", () => {
  for (const rev of [0.4, 0.8]) {
    it(`when only the thump is heard at dial ${rev}, then the signal repeats at the firing period`, async () => {
      const cls = "sedan";
      const base = { lope: 0, blockDrive: 1, blockDriveLoad: 0 };
      const x = await added(cls, 500, () => ({ rev, load: 1 }), { ...base, bodyGain: 1 }, { ...base, bodyGain: 0 });
      const cylinders = 4;
      const period = (SAMPLE_RATE * 120) / (motorRpm(cls, rev, 1) * cylinders);
      const tail = x.subarray(x.length - 16384);
      const correlation = (lag: number): number => {
        let ab = 0;
        let aa = 0;
        for (let i = 0; i + lag < tail.length; i++) {
          ab += tail[i]! * tail[i + lag]!;
          aa += tail[i]! * tail[i]!;
        }
        return ab / aa;
      };
      expect(correlation(Math.round(period)), "at the firing period").toBeGreaterThan(0.9);
      expect(correlation(Math.round(period * 0.7)), "off the period").toBeLessThan(0.7);
    });
  }
});

describe("given the exhaust's crack at every firing", () => {
  it("when the sedan runs at dial 0.6, then the crack is silent off the pedal, rings in the mids on it, and grows with the pedal", async () => {
    const crack = (load: number) => added("sedan", 500, () => ({ rev: 0.6, load }), {}, { barkGain: 0 });
    expect(peakRms(await crack(0)).peak, "off the pedal").toBe(0);
    const [half, full] = [await crack(0.5), await crack(1)];
    const [sub, , mid, , air] = bandEnergy(full);
    expect(mid, "mids over sub").toBeGreaterThan(sub! + 6);
    expect(mid, "mids over air").toBeGreaterThan(air! + 6);
    expect(db(rms(full, 0, full.length)) - db(rms(half, 0, half.length)), "wide open over half pedal (dB)").toBeGreaterThan(3);
  });
});

describe("given the load", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when the ${cls} is held at mid revs on and off the pedal, then the pedal adds at least 1.5 dB between 250 Hz and 4 kHz: the saturation and the breath`, async () => {
      const [off, on] = [await renderVoice(cls, "healthy", 600, () => ({ rev: 0.5, load: 0 })), await renderVoice(cls, "healthy", 600, () => ({ rev: 0.5, load: 1 }))];
      const [, , midOff, upperOff] = bandEnergy(off);
      const [, , midOn, upperOn] = bandEnergy(on);
      expect(Math.max(midOn - midOff, upperOn - upperOff), `${cls} 250 Hz-4 kHz (${(midOn - midOff).toFixed(1)}, ${(upperOn - upperOff).toFixed(1)} dB)`).toBeGreaterThan(1.5);
    });
  }
});

describe("given a lift off the pedal at high revs", () => {
  for (const cls of ["muscle", "hatch", "monster"] as const) {
    it(`when the ${cls} lifts, then it pops and burbles after the lift and never before it`, async () => {
      const lead = 150;
      const x = await added(cls, 700, lift(0.75, lead), {}, { burbleRate: 0, popGain: 0 });
      expect(peakRms(x.subarray(0, lead * BLOCK)).peak, "on the pedal").toBe(0);
      expect(db(rms(x, (lead + 50) * BLOCK, 700 * BLOCK)), "after the lift (dB rms)").toBeGreaterThan(-60);
    });
  }

  for (const cls of ["sedan", "truck", "suv"] as const) {
    it(`when the ${cls} lifts, then it has no more than the faintest crackle`, async () => {
      const x = await added(cls, 700, lift(0.75, 150), {}, { burbleRate: 0, popGain: 0 });
      const tuning = dspTone(cls, "healthy", 4, 800, 6000);
      if (tuning.burbleRate === 0) expect(peakRms(x).peak).toBe(0);
      else expect(db(rms(x, 200 * BLOCK, 700 * BLOCK))).toBeLessThan(-45);
    });
  }

  it("when the hatch lifts after full boost, then the blow-off hiss runs above 2 kHz and dies away", async () => {
    const lead = 200;
    const x = await added("hatch", 700, lift(0.8, lead), {}, { blowoffGain: 0 });
    expect(peakRms(x.subarray(0, lead * BLOCK)).peak, "on the pedal").toBe(0);
    const [, low, , upper, air] = bandEnergy(x.subarray(lead * BLOCK, (lead + 140) * BLOCK), 16384);
    expect(Math.max(upper!, air!), "the hiss is up high").toBeGreaterThan(low!);
    expect(rms(x, (lead + 20) * BLOCK, (lead + 60) * BLOCK), "the hiss dies away").toBeGreaterThan(rms(x, 650 * BLOCK, 700 * BLOCK));
  });
});

describe("given the induction whine", () => {
  it("when the muscle car's supercharger runs at 0.8 dial, then its whine sits at the crank's frequency times the supercharger's ratio", async () => {
    const x = await added("muscle", 600, () => ({ rev: 0.8, load: 1 }), {}, { whineGain: 0 });
    const tuning = dspTone("muscle", "healthy", 4, 800, 6000);
    const expected = (tuning.whineCrank * motorRpm("muscle", 0.8, 1)) / 60;
    expect(Math.abs(strongestLine(x, 300, 4000) / expected - 1), `strongest line against ${expected.toFixed(0)} Hz`).toBeLessThan(0.03);
  });

  it("when the whine is measured off the pedal, then it has died away to the boost lag's floor: the boost, not the revs, makes it", async () => {
    const [on, off] = [await added("muscle", 600, () => ({ rev: 0.8, load: 1 }), {}, { whineGain: 0 }), await added("muscle", 600, () => ({ rev: 0.8, load: 0 }), {}, { whineGain: 0 })];
    expect(db(rms(on, 300 * BLOCK, 600 * BLOCK)) - db(rms(off, 300 * BLOCK, 600 * BLOCK))).toBeGreaterThan(15);
  });

  it("when a sedan without induction runs, then nothing is added", async () => {
    const x = await added("sedan", 300, () => ({ rev: REV_IDLE + 0.4, load: 1 }), {}, { whineGain: 0, blowoffGain: 0 });
    expect(peakRms(x).peak).toBe(0);
  });
});
