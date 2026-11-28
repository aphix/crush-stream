import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { approach, audibleImpulse, CEILING, ceilingCurve, CrashDuck, DUCK, duckDepth, duckGain, engineBusGain, engineDuck, MASTER_LIMITER, musicGain, REVERB, reverbImpulse, slowmoCutoff, squealHz, squealLevel, thudGain, TYRE, VOICES, VoiceBudget } from "./audio-mix.ts";

const EPS = 1e-9;

describe("given the music bus gain (the slider, capped at 0.6, x0.5 trim, under the engine duck and the crash duck)", () => {
  const testCases = [
    { name: "the default slider (0.15), no ducking", volume: 0.15, engineDuck: 1, crash: 1, expected: 0.075 },
    { name: "a full slider is capped", volume: 1, engineDuck: 1, crash: 1, expected: 0.3 },
    { name: "a wild slider is capped", volume: 5, engineDuck: 1, crash: 1, expected: 0.3 },
    { name: "the cap under full engine duck (x0.65)", volume: 0.6, engineDuck: engineDuck(1), crash: 1, expected: 0.195 },
    { name: "the cap under a crash duck (x0.4)", volume: 0.6, engineDuck: 1, crash: 0.4, expected: 0.12 },
  ];
  for (const c of testCases) {
    it(`when the music is ${c.name}, then the bus gain is ${c.expected}`, () => {
      expect(Math.abs(musicGain(c.volume, c.engineDuck, c.crash) - c.expected)).toBeLessThan(EPS);
    });
  }
});

describe("given the engine bus gain (the slider, linear to unity: the 0.25 default is x0.25)", () => {
  const testCases = [
    { name: "the default slider", volume: 0.25, expected: 0.25 },
    { name: "a full slider", volume: 1, expected: 1 },
    { name: "a muted slider", volume: 0, expected: 0 },
    { name: "a wild slider is capped", volume: 5, expected: 1 },
    { name: "a negative slider is floored", volume: -1, expected: 0 },
  ];
  for (const c of testCases) {
    it(`when the engines are ${c.name}, then the bus gain is ${c.expected}`, () => {
      expect(engineBusGain(c.volume)).toBe(c.expected);
    });
  }
});

describe("given the master limiter", () => {
  it("when the limiter is set up, then it limits (at least 10:1) instead of the old 4:1 squeeze", () => {
    expect(MASTER_LIMITER.ratio).toBeGreaterThanOrEqual(10);
  });
  it("when the limiter is set up, then it grabs a peak within 5 ms and lets go within a quarter second", () => {
    expect(MASTER_LIMITER.attack <= 0.005 && MASTER_LIMITER.release <= 0.25).toBeTruthy();
  });
});

describe("given the -1 dBFS ceiling curve", () => {
  const curve = ceilingCurve(4097);
  it("when any input up to full scale is shaped, then no output passes -1 dBFS", () => {
    let peak = 0;
    for (let i = 0; i < curve.length; i++) peak = Math.max(peak, Math.abs(curve[i]!));
    expect(peak, `peak ${peak} over ${CEILING}`).toBeLessThanOrEqual(CEILING + 1e-6);
  });
  it("when a signal sits under the knee (half scale), then it passes untouched", () => {
    const i = Math.round((0.5 + 1) / 2 * (curve.length - 1));
    expect(Math.abs(curve[i]! - 0.5), `0.5 became ${curve[i]}`).toBeLessThan(1e-6);
  });
  it("when the input rises, then the output never falls (no fold-back distortion)", () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]!, `curve falls at ${i}`).toBeGreaterThanOrEqual(curve[i - 1]!);
  });
});

describe("given the engine duck of the music", () => {
  const testCases = [
    { name: "an idle player", level: 0, expected: 1 },
    { name: "a player at full load and revs", level: 1, expected: 0.65 },
    { name: "a player at half level", level: 0.5, expected: 0.825 },
  ];
  for (const c of testCases) {
    it(`when ${c.name}, then the duck is ${c.expected}`, () => {
      expect(Math.abs(engineDuck(c.level) - c.expected)).toBeLessThan(EPS);
    });
  }
});

describe("given the depth of a crash duck by the hit's impulse", () => {
  const testCases = [
    { name: "a touch (2 m/s)", impulse: 2, expected: 0 },
    { name: "the duck's floor (4 m/s)", impulse: DUCK.minImpulse, expected: 0 },
    { name: "half way (22 m/s)", impulse: 22, expected: 0.5 },
    { name: "the full duck (40 m/s)", impulse: DUCK.fullImpulse, expected: 1 },
    { name: "a harder hit than full", impulse: 120, expected: 1 },
  ];
  for (const c of testCases) {
    it(`when the hit is ${c.name}, then the depth is ${c.expected}`, () => {
      expect(Math.abs(duckDepth(c.impulse) - c.expected)).toBeLessThan(EPS);
    });
  }
  it("when the duck is at full depth, then the music sits 6 dB under and the ambience 4.5 dB under; at none, unity", () => {
    expect(duckGain(1, DUCK.musicDb)).toBeCloseTo(10 ** (-6 / 20), 9);
    expect(duckGain(1, DUCK.ambientDb)).toBeCloseTo(10 ** (-4.5 / 20), 9);
    expect(duckGain(0, DUCK.musicDb)).toBe(1);
  });
});

describe("given the crash duck's level over time", () => {
  /** The duck's level after a hit of `impulse` and `seconds` of 1/60 s steps. */
  function levelAfter(impulse: number, seconds: number): number {
    const duck = new CrashDuck();
    duck.hit(impulse);
    for (let t = 0; t < seconds - 1e-9; t += 1 / FRAME_HZ) duck.step(1 / FRAME_HZ);
    return duck.level;
  }
  it("when a big hit lands, then the duck is full at once and still full 0.4 s on, then recovers: under a tenth of it by 1.5 s, gone by 4 s", () => {
    expect(levelAfter(40, 0)).toBe(1);
    expect(levelAfter(40, 0.4)).toBe(1);
    expect(levelAfter(40, 1.5), "1.5 s").toBeLessThan(0.1);
    expect(levelAfter(40, 4), "4 s").toBe(0);
  });
  it("when a hit is half as hard, then its duck is half as deep and lets go sooner than a full one", () => {
    expect(levelAfter(22, 0)).toBeCloseTo(0.5, 9);
    expect(levelAfter(22, 0.7)).toBeLessThan(levelAfter(40, 0.7));
  });
  it("when a touch hits, then nothing ducks; when a weaker hit follows a strong one, then the strong duck stays", () => {
    expect(levelAfter(2, 0)).toBe(0);
    const duck = new CrashDuck();
    duck.hit(40);
    duck.hit(10);
    expect(duck.level).toBe(1);
  });
});

describe("given a voice budget of three", () => {
  it("when three voices are booked and a fourth of the same priority asks, then it is refused until one has ended", () => {
    const budget = new VoiceBudget(3);
    for (let i = 0; i < 3; i++) expect(budget.take(0, 10, 1)).toBe(true);
    expect(budget.take(0.5, 10, 1), "full").toBe(false);
    expect(budget.take(1.01, 10, 1), "one ended").toBe(true);
  });
  it("when it is full, then a voice 1.5 times the weakest running one's priority displaces it and a lesser one does not", () => {
    const budget = new VoiceBudget(2);
    budget.take(0, 10, 1);
    budget.take(0, 20, 1);
    expect(budget.take(0.1, 14, 1), "under 1.5x of 10").toBe(false);
    expect(budget.take(0.1, 16, 1), "over 1.5x of 10").toBe(true);
  });
  it("when the hit bus is sized, then a phone has fewer voices than a desktop", () => {
    expect(VOICES.hitsPhone).toBeLessThan(VOICES.hitsDesktop);
  });
});

describe("given a hit's audible impulse", () => {
  it("when the hit is beside the listener, then it is the impulse itself; at 12 m it is halved at most; past 400 m it is nothing", () => {
    expect(audibleImpulse(30, 0, 0, 0)).toBeCloseTo(30, 9);
    expect(audibleImpulse(30, 12, 0, 0)).toBeCloseTo(15, 9);
    expect(audibleImpulse(30, 0, 0, 401)).toBe(0);
  });
  it("when the hit moves away along any axis, then it only gets quieter, by the same distance whichever axis", () => {
    expect(audibleImpulse(30, 0, 40, 0)).toBeCloseTo(audibleImpulse(30, 40, 0, 0), 9);
    expect(audibleImpulse(30, 80, 0, 0)).toBeLessThan(audibleImpulse(30, 40, 0, 0));
  });
});
describe("given the shared reverb's impulse", () => {
  const [left, right] = reverbImpulse(8000, REVERB.seconds, REVERB.seed);
  const energy = (h: Float32Array, from: number, to: number): number => {
    let e = 0;
    for (let i = Math.floor(from * h.length); i < Math.floor(to * h.length); i++) e += h[i]! * h[i]!;
    return e;
  };
  it("when it is made twice from its seed, then it is the same, and the two ears differ", () => {
    const again = reverbImpulse(8000, REVERB.seconds, REVERB.seed);
    expect(firstMismatch(again[0].subarray(0, 64), left.subarray(0, 64))).toBeUndefined();
    expect(firstMismatch(left.subarray(100, 164), right.subarray(100, 164))).toBeDefined();
  });
  it("when it is measured, then each ear has unit energy and the last tenth holds under a thousandth of the first tenth's", () => {
    expect(energy(left, 0, 1)).toBeCloseTo(1, 4);
    expect(energy(right, 0, 1)).toBeCloseTo(1, 4);
    expect(energy(left, 0.9, 1)).toBeLessThan(energy(left, 0, 0.1) * 1e-3);
  });
});

describe("given the slow-mo cutoff of the engine bus", () => {
  const testCases = [
    { name: "normal speed", rate: 1, expected: 20000 },
    { name: "a standstill", rate: 0, expected: 700 },
    { name: "a rate above normal is clamped", rate: 3, expected: 20000 },
    { name: "a negative rate is clamped", rate: -1, expected: 700 },
    { name: "a quarter speed", rate: 0.25, expected: 700 + 19300 * 0.5 },
  ];
  for (const c of testCases) {
    it(`when the time rate is ${c.name}, then the cutoff is ${c.expected} Hz`, () => {
      expect(Math.abs(slowmoCutoff(c.rate) - c.expected)).toBeLessThan(EPS);
    });
  }
});

describe("given a first-order lag", () => {
  it("when one time constant passes, then it covers 63% of the way", () => {
    expect(Math.abs(approach(0, 1, 0.3, 0.3) - (1 - Math.exp(-1)))).toBeLessThan(EPS);
  });
  it("when no time passes, then it stays put", () => {
    expect(approach(0.4, 1, 0, 0.3)).toBe(0.4);
  });
  it("when it is at the target, then it stays there", () => {
    expect(approach(1, 1, 0.5, 0.3)).toBe(1);
  });
});


describe("given the tyre squeal level (slide, lock, spin, ground speed, wheels down)", () => {
  const testCases = [
    { name: "a straight cruise", slide: 0, lock: 0, spin: 0, speed: 30, grounded: true, expected: 0 },
    { name: "a slide under the threshold", slide: TYRE.slideFrom, lock: 0, spin: 0, speed: 30, grounded: true, expected: 0 },
    { name: "a full slide at speed", slide: 1, lock: 0, spin: 0, speed: 30, grounded: true, expected: 1 },
    { name: "a full slide in the air", slide: 1, lock: 0, spin: 0, speed: 30, grounded: false, expected: 0 },
    { name: "a full slide at a crawl", slide: 1, lock: 0, spin: 0, speed: 1, grounded: true, expected: 0 },
    { name: "a full lock-up braking", slide: 0, lock: 1, spin: 0, speed: 30, grounded: true, expected: TYRE.lockShare },
    { name: "a burnout from rest", slide: 0, lock: 0, spin: 1, speed: 0, grounded: true, expected: TYRE.spinShare },
    { name: "a lock-up in the air", slide: 0, lock: 1, spin: 1, speed: 30, grounded: false, expected: 0 },
  ];
  for (const c of testCases) {
    it(`when the car is in ${c.name}, then the squeal is ${c.expected}`, () => {
      expect(Math.abs(squealLevel(c.slide, c.lock, c.spin, c.speed, c.grounded) - c.expected)).toBeLessThan(EPS);
    });
  }
  it("when the slide deepens past the threshold, then the squeal rises and never falls", () => {
    let last = 0;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const level = squealLevel(s, 0, 0, 30, true);
      expect(level, `falls at slide ${s}`).toBeGreaterThanOrEqual(last);
      last = level;
    }
    expect(squealLevel(0.6, 0, 0, 30, true) > 0 && squealLevel(0.6, 0, 0, 30, true) < 1).toBeTruthy();
  });
  it("when the speed rises through the gate, then the same slide gets louder", () => {
    expect(squealLevel(1, 0, 0, 5, true) > 0 && squealLevel(1, 0, 0, 5, true) < squealLevel(1, 0, 0, 8, true)).toBeTruthy();
  });
});

describe("given the tyre squeal pitch and fade", () => {
  it("when the car is stopped and at speed, then the band sits at 1 kHz and 2.5 kHz and never leaves them", () => {
    expect(squealHz(0)).toBe(TYRE.hzLow);
    expect(squealHz(TYRE.hzFullSpeed)).toBe(TYRE.hzHigh);
    expect(squealHz(1000)).toBe(TYRE.hzHigh);
    expect(TYRE.hzLow >= 1000 && TYRE.hzHigh <= 2500).toBeTruthy();
  });
  it("when the gain follows its time constant, then 95% is there within 60-100 ms", () => {
    const t95 = -TYRE.fadeTau * Math.log(0.05);
    expect(t95 >= 0.06 && t95 <= 0.1, `${t95} s`).toBeTruthy();
  });
});

describe("given the landing thud gain", () => {
  it("when the fall is zero or upward, then it is silent", () => {
    expect(thudGain(0)).toBe(0);
    expect(thudGain(-4)).toBe(0);
  });
  it("when the fall grows, then the thud grows up to its cap and no further", () => {
    expect(thudGain(5) > 0 && thudGain(5) < thudGain(10)).toBeTruthy();
    expect(thudGain(100)).toBe(TYRE.thudMax);
  });
  it("when the thud is shaped, then it is a 60-to-35 Hz sine about 0.25 s long", () => {
    expect(TYRE.thudStartHz === 60 && TYRE.thudEndHz === 35 && TYRE.thudS === 0.25).toBeTruthy();
  });
});
