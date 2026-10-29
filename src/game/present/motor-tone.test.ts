import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { REV_IDLE, VEHICLE_CLASS_IDS, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { accelLoad, channelGains, damageTone, MOTOR_OUTPUT_GAIN, MOTOR_SOUND_CREDIT, motorLoad, motorRev, motorRpm, TONE_COUNT, toneMessage, toneMessages, toneOptions } from "./motor-tone.ts";

const EPS = 1e-9;
const SAMPLE_RATE = 48000;
const SEDAN: VehicleClassId = "sedan";

/** The keys the vendored processor reads off a port message (`kernels/motor/motor-processor.js`, `applyMessage`). */
function processorMessageKeys(): string[] {
  const source = readFileSync(new URL("../../../kernels/motor/motor-processor.js", import.meta.url), "utf8");
  const applied = source.slice(source.indexOf("applyMessage (parameters)"), source.indexOf("static get parameterDescriptors"));
  return [...applied.matchAll(/parameters\["([a-z_]+)"\]/g)].map((m) => m[1]!).sort();
}

describe("given each vehicle class's engine", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    const idleRpm = motorRpm(cls, REV_IDLE, 1);
    const redlineRpm = motorRpm(cls, 1, 1);
    it(`when ${cls} idles, then its rpm is above zero and under its redline`, () => {
      expect(idleRpm > 0 && idleRpm < redlineRpm).toBeTruthy();
    });
    it(`when ${cls} is in slow-mo at the pitch floor, then its redline drops to a quarter`, () => {
      expect(Math.abs(motorRpm(cls, 1, 0.032) - 0.25 * redlineRpm)).toBeLessThan(EPS);
    });
    it(`when ${cls} is in slow-mo below the floor, then the pitch stops at the floor`, () => {
      expect(motorRpm(cls, 1, 0)).toBe(motorRpm(cls, 1, 0.25));
    });
  }
  const pitch = [
    { cls: "sedan", idle: 850, redline: 6800 },
    { cls: "police", idle: 800, redline: 7000 },
    { cls: "muscle", idle: 700, redline: 6200 },
    { cls: "truck", idle: 650, redline: 5000 },
    { cls: "monster", idle: 600, redline: 5500 },
  ] as const;
  for (const c of pitch) {
    it(`when ${c.cls} sits at the idle and the redline of the gauge, then the rpm is ${c.idle} and ${c.redline}`, () => {
      expect(Math.abs(motorRpm(c.cls, REV_IDLE, 1) - c.idle)).toBeLessThan(EPS);
      expect(Math.abs(motorRpm(c.cls, 1, 1) - c.redline)).toBeLessThan(EPS);
    });
  }
});

describe("given the revs the gas lifts", () => {
  const testCases = [
    { name: "a standing car under full gas", gauge: REV_IDLE, load: 1, expected: REV_IDLE + 0.35 },
    { name: "a fast car with no gas", gauge: 0.9, load: 0, expected: 0.9 },
    { name: "a standing car with no gas", gauge: REV_IDLE, load: 0, expected: REV_IDLE },
  ];
  for (const c of testCases) {
    it(`when ${c.name}, then the revs are ${c.expected}`, () => {
      expect(Math.abs(motorRev(c.gauge, c.load) - c.expected)).toBeLessThan(EPS);
    });
  }
});

describe("given the engine load", () => {
  const testCases = [
    { name: "no pedal and no acceleration", throttle: 0, boost: 0, accel: 0, expected: 0 },
    { name: "full reverse", throttle: -1, boost: 0, accel: 0, expected: 1 },
    { name: "full boost thrust with a lifted pedal", throttle: 0, boost: 1, accel: 0, expected: 1 },
    { name: "half the pedal", throttle: 0.5, boost: 0, accel: 0.2, expected: 0.5 },
    { name: "no pedal but 4 m/s gained in 1 s (a netplay client's car)", throttle: 0, boost: 0, accel: accelLoad(4, 0, 1), expected: 1 },
    { name: "no pedal but 2 m/s gained in 1 s", throttle: 0, boost: 0, accel: accelLoad(2, 0, 1), expected: 0.5 },
    { name: "no pedal and slowing down", throttle: 0, boost: 0, accel: accelLoad(0, 4, 1), expected: 0 },
  ];
  for (const c of testCases) {
    it(`when ${c.name}, then the load is ${c.expected}`, () => {
      expect(Math.abs(motorLoad(c.throttle, c.boost, c.accel) - c.expected)).toBeLessThan(EPS);
    });
  }
});

describe("given the channel levels ahead of the output gain (the demo's 100% each, tilted per class)", () => {
  const out = new Float64Array(3);
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when ${cls} is tuned, then every channel is audible and no louder than 1.5 (the output gain scales the sum)`, () => {
      channelGains(out, cls);
      for (const level of out) expect(level > 0 && level <= 1.5).toBeTruthy();
    });
  }
  it("when the sedan is tuned, then it is lighter than the demo: the block and the outlet sit under the demo's 100%", () => {
    channelGains(out, SEDAN);
    expect(out[1]! < 1 && out[2]! < 1 && out[0]! > 1).toBeTruthy();
  });
  it("when the monster is tuned, then its outlet is louder than the sedan's", () => {
    channelGains(out, SEDAN);
    const sedan = out[2]!;
    channelGains(out, "monster");
    expect(out[2]!).toBeGreaterThan(sedan);
  });
  it("when the output gain is set, then it is at most the demo's own 10% default (the summed channels swing to +-7: nothing clips them)", () => {
    expect(MOTOR_OUTPUT_GAIN > 0 && MOTOR_OUTPUT_GAIN <= 0.1).toBeTruthy();
  });
});

describe("given the class tweaks", () => {
  const sedan = toneOptions(SEDAN, 44100);
  for (const cls of VEHICLE_CLASS_IDS) {
    if (cls === SEDAN) continue;
    it(`when ${cls} is compared with the sedan, then at least two of cylinders, idle, redline and straight pipe differ`, () => {
      const options = toneOptions(cls, 44100);
      const differs = [
        options.cylinders !== sedan.cylinders,
        motorRpm(cls, REV_IDLE, 1) !== motorRpm(SEDAN, REV_IDLE, 1),
        motorRpm(cls, 1, 1) !== motorRpm(SEDAN, 1, 1),
        options.straightPipeWaveguideLength !== sedan.straightPipeWaveguideLength,
      ];
      expect(differs.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("given the class table against the demo's defaults (4 cylinders, waveguides 100, straight pipe 128, outlet 5, ignition 0.016, action 0.1)", () => {
  const testCases = [
    { cls: "sedan", cylinders: 4, intake: 90, exhaust: 90, straightPipe: 109, outlet: 4, ignition: 0.0144, action: 0.09 },
    { cls: "police", cylinders: 4, intake: 95, exhaust: 100, straightPipe: 134, outlet: 5, ignition: 0.0152, action: 0.1 },
    { cls: "muscle", cylinders: 4, intake: 105, exhaust: 110, straightPipe: 154, outlet: 6, ignition: 0.0176, action: 0.11 },
    { cls: "truck", cylinders: 4, intake: 120, exhaust: 125, straightPipe: 192, outlet: 8, ignition: 0.02, action: 0.085 },
    { cls: "monster", cylinders: 6, intake: 130, exhaust: 140, straightPipe: 230, outlet: 10, ignition: 0.0224, action: 0.12 },
  ] as const;
  for (const c of testCases) {
    const o = toneOptions(c.cls, 44100);
    it(`when ${c.cls} is built at 44.1 kHz, then each part is the demo's value times its class factor`, () => {
      expect(o.cylinders).toBe(c.cylinders);
      expect(o.intakeWaveguideLength).toBe(c.intake);
      expect(o.exhaustWaveguideLength).toBe(c.exhaust);
      expect(o.straightPipeWaveguideLength).toBe(c.straightPipe);
      expect(o.outletWaveguideLength).toBe(c.outlet);
      expect(Math.abs(o.ignitionTime - c.ignition)).toBeLessThan(EPS);
      expect(Math.abs(o.action - c.action)).toBeLessThan(EPS);
    });
  }
});

describe("given the classes ordered light to deep", () => {
  const order = ["sedan", "police", "muscle", "truck", "monster"] as const;
  for (let i = 1; i < order.length; i++) {
    const lighter = toneOptions(order[i - 1]!, 44100);
    const deeper = toneOptions(order[i]!, 44100);
    it(`when ${order[i]} is compared with ${order[i - 1]}, then its exhaust, straight pipe and ignition are no shorter`, () => {
      expect(deeper.exhaustWaveguideLength).toBeGreaterThanOrEqual(lighter.exhaustWaveguideLength);
      expect(deeper.straightPipeWaveguideLength).toBeGreaterThanOrEqual(lighter.straightPipeWaveguideLength);
      expect(deeper.ignitionTime).toBeGreaterThanOrEqual(lighter.ignitionTime);
    });
  }
});

describe("given the generator options of each class at 48 kHz", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    const o = toneOptions(cls, SAMPLE_RATE);
    const lengths = [o.intakeWaveguideLength, o.exhaustWaveguideLength, o.extractorWaveguideLength, o.outletWaveguideLength, ...o.mufflerElementsLength];
    it(`when ${cls} is built, then the cylinders are 1-8 and the waveguide lengths are whole samples in 1-200`, () => {
      expect(o.cylinders >= 1 && o.cylinders <= 8 && Number.isInteger(o.cylinders)).toBeTruthy();
      for (const length of lengths) expect(Number.isInteger(length) && length >= 1 && length <= 200).toBeTruthy();
    });
    it(`when ${cls} is built, then the straight pipe is 1-500, the ignition 0.01-0.5 and the action 0-0.2`, () => {
      expect(Number.isInteger(o.straightPipeWaveguideLength) && o.straightPipeWaveguideLength >= 1 && o.straightPipeWaveguideLength <= 500).toBeTruthy();
      expect(o.ignitionTime >= 0.01 && o.ignitionTime <= 0.5).toBeTruthy();
      expect(o.action >= 0 && o.action <= 0.2).toBeTruthy();
    });
    it(`when ${cls} is built, then the reflection factors are in 0-1`, () => {
      const factors = [o.intakeOpenReflectionFactor, o.intakeClosedReflectionFactor, o.exhaustOpenReflectionFactor, o.exhaustClosedReflectionFactor, o.straightPipeReflectionFactor, o.outletReflectionFactor];
      for (const f of factors) expect(f >= 0 && f <= 1).toBeTruthy();
    });
  }
  it("when the sedan is built at 48 kHz, then its 90-sample waveguide (0.9 x the demo's 100) scales by 48000/44100 and rounds", () => {
    expect(toneOptions(SEDAN, 48000).intakeWaveguideLength).toBe(Math.round((90 * 48000) / 44100));
  });
  it("when a length would round to zero, then it stays at least one sample", () => {
    expect(toneOptions(SEDAN, 1000).outletWaveguideLength).toBe(1);
  });
});

describe("given the damage stages", () => {
  it("when the stages worsen, then the misfires rise from none", () => {
    expect(damageTone("healthy").misfirePerS).toBe(0);
    expect(damageTone("damaged").misfirePerS).toBeGreaterThan(damageTone("healthy").misfirePerS);
    expect(damageTone("limping").misfirePerS).toBeGreaterThan(damageTone("damaged").misfirePerS);
  });
  it("when the stages worsen, then the muffling lowpass closes", () => {
    expect(damageTone("limping").cutoffHz).toBeLessThan(damageTone("damaged").cutoffHz);
    expect(damageTone("damaged").cutoffHz).toBeLessThan(damageTone("healthy").cutoffHz);
  });
  const ignitionFactors = [
    { stage: "limping", factor: 1.6 },
    { stage: "damaged", factor: 1.25 },
  ] as const;
  for (const cls of VEHICLE_CLASS_IDS) {
    for (const c of ignitionFactors) {
      it(`when ${cls} is ${c.stage}, then its ignition time is ${c.factor} x the healthy one`, () => {
        const stageIgnition = toneMessage(cls, c.stage, SAMPLE_RATE).ignition_time;
        const healthy = toneMessage(cls, "healthy", SAMPLE_RATE).ignition_time;
        expect(Math.abs(stageIgnition - c.factor * healthy)).toBeLessThan(EPS);
      });
    }
    it(`when ${cls} limps, then its ignition time stays inside the generator's range`, () => {
      const ignition = toneMessage(cls, "limping", SAMPLE_RATE).ignition_time;
      expect(ignition >= 0.01 && ignition <= 0.5).toBeTruthy();
    });
    it(`when ${cls} wears, then its muffler action is 0.8 x (damaged) and 0.6 x (limping) the healthy one`, () => {
      const healthy = toneMessage(cls, "healthy", SAMPLE_RATE).action;
      expect(Math.abs(toneMessage(cls, "damaged", SAMPLE_RATE).action - 0.8 * healthy)).toBeLessThan(EPS);
      expect(Math.abs(toneMessage(cls, "limping", SAMPLE_RATE).action - 0.6 * healthy)).toBeLessThan(EPS);
    });
  }
  it("when a tone message is built, then it carries exactly the settings the engine-sound worklet reads", () => {
    expect(Object.keys(toneMessage(SEDAN, "healthy", SAMPLE_RATE)).sort().join()).toBe(processorMessageKeys().join());
  });
  it("when a tone message is built, then its cylinder count and waveguide and muffler lengths match the class tuning", () => {
    const o = toneOptions("muscle", SAMPLE_RATE);
    const m = toneMessage("muscle", "healthy", SAMPLE_RATE);
    expect(m.cylinder_count).toBe(o.cylinders);
    expect(m.exhaust_waveguide_length).toBe(o.exhaustWaveguideLength);
    expect(m.muffler_elements_length.join()).toBe(o.mufflerElementsLength.join());
  });
  const tuning = [
    { stage: "healthy", toneIndex: 0 },
    { stage: "dented", toneIndex: 0 },
    { stage: "damaged", toneIndex: 1 },
    { stage: "limping", toneIndex: 2 },
    { stage: "dead", toneIndex: 2 },
  ] as const;
  for (const c of tuning) {
    it(`when a car is ${c.stage}, then it plays tuning ${c.toneIndex} (a dented engine is not re-tuned)`, () => {
      expect(damageTone(c.stage).toneIndex).toBe(c.toneIndex);
    });
  }
  it("when every tuning message is prebuilt, then each class has one per tuning in class order and each matches its stage", () => {
    const all = toneMessages(SAMPLE_RATE);
    expect(all.length).toBe(VEHICLE_CLASS_IDS.length * TONE_COUNT);
    for (const [c, cls] of VEHICLE_CLASS_IDS.entries()) {
      expect(all[c * TONE_COUNT]!.ignition_time).toBe(toneMessage(cls, "healthy", SAMPLE_RATE).ignition_time);
      expect(all[c * TONE_COUNT + damageTone("damaged").toneIndex]!.ignition_time).toBe(toneMessage(cls, "damaged", SAMPLE_RATE).ignition_time);
      expect(all[c * TONE_COUNT + damageTone("limping").toneIndex]!.ignition_time).toBe(toneMessage(cls, "limping", SAMPLE_RATE).ignition_time);
    }
  });
});

describe("given the engine sound's credit", () => {
  it("when the credit is compared with the vendored licence, then the licence carries its copyright notice and the MIT name", () => {
    const licence = readFileSync(new URL("../../../kernels/motor/LICENSE", import.meta.url), "utf8");
    expect(licence.includes(MOTOR_SOUND_CREDIT.notice)).toBeTruthy();
    expect(licence.includes("MIT")).toBeTruthy();
  });
});

