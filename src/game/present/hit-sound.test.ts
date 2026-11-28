import { describe, expect, it, vi } from "vitest";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { MATERIALS, MAT } from "../kernel/material-ids.ts";
import { SURFACE_IDS } from "../world/catalog.ts";
import type { Within } from "../kernel/alloc-sample.test-util.ts";
import { HitSound, propSoundMat, surfaceSoundMat, type HitEvent, type SoundMat } from "./hit-sound.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { FakeContext, FakeNode, centroidOf, mixRecording, peakOf, ringSeconds, rmsOf } from "./hit-sound.test-util.ts";
import { BANK_RATE, bankKey, hitGain, hitSamples, hitSize, HIT_MAX, renderHit, renderScrapeLoop, scrapeKind, scrapeSamples, SOUND_MATS, TICK_MAX, type HitSize } from "./hit-synth.ts";

/** The frame budget (ms) the sound renders its bank within, and what a sample of it costs on the test's clock. */
const BUILD_BUDGET_MS = 2;
const MS_PER_SAMPLE = 0.0001;
/** Calls a read drives, and the bytes a call may allocate: a hit passes a few non-integer numbers to the audio API, each a boxed double (16 B) the API's own calls need. */
const CALLS = 4000;
const HIT_BOUND_B = 128;
const FRAME_BOUND_B = 16;
const SCRAPE_BOUND_B = 16;

const SIZES: readonly HitSize[] = [0, 1, 2];

/** A hit of `a` on `b` at `impulse` m/s, `x` m from a listener at the origin. */
function event(impulse: number, a: SoundMat, b: SoundMat, x = 4, z = 0): HitEvent {
  return { impulse, x, y: 0, z, a, b };
}

/** A recording context with a sound on it, its listener at the origin. */
function recorded(): { ctx: FakeContext; sound: HitSound } {
  const ctx = new FakeContext(true);
  const sound = new HitSound(ctx, new FakeNode(true));
  while (!sound.bankReady) sound.frame(0, 0, 0, 0);
  return { ctx, sound };
}

function renderOf(a: SoundMat, b: SoundMat, size: HitSize, variation = 0): Float32Array {
  const out = new Float32Array(hitSamples(size, BANK_RATE));
  renderHit(a, b, size, variation, BANK_RATE, out);
  return out;
}

/** One hit heard alone, mixed at the bank's rate over 1.2 s. */
function heard(impulse: number, a: SoundMat, b: SoundMat, x = 4): Float32Array {
  const { ctx, sound } = recorded();
  sound.hit(event(impulse, a, b, x), 0, 0, 0);
  return mixRecording(ctx, 1.2, BANK_RATE);
}

describe("given the catalog's materials and the ground's surfaces", () => {
  const expected: Record<string, SoundMat> = { TYRE: "rubber", HAY: "hay", CRATE_WOOD: "wood", GLASS: "glass", DUMPSTER_STEEL: "steel", JERSEY_CONCRETE: "concrete", ROAD_MUD: "mud", TERRAIN_GRAVEL: "gravel", CONIFER_FOLIAGE: "foliage", ROCK: "stone", WATER: "water", ROAD_ASPHALT: "asphalt", PATCH_SAND: "sand", ROAD_GRASS: "grass", ROAD_DIRT: "dirt", CONE_BODY: "plastic", BUMPER_CHROME: "steel" };

  it("when named, then known materials sound as what they are made of", () => {
    for (const [name, mat] of Object.entries(expected)) expect(propSoundMat(name), name).toBe(mat);
  });

  it("when every material is mapped, then each role of the catalog has a sound of its own, and only plain plastic falls back to plastic", () => {
    const plasticRoles = new Set(["none", "plastic", "paper"]);
    for (const name of Object.keys(MAT)) {
      const role = MATERIALS[MAT[name as keyof typeof MAT]]![2];
      const mat = propSoundMat(name);
      expect(SOUND_MATS, name).toContain(mat);
      if (!plasticRoles.has(role)) expect(mat, `${name} (${role}) is not the plastic fallback`).not.toBe("plastic");
    }
    expect(propSoundMat("NOT_A_MATERIAL"), "unknown name").toBe("plastic");
  });

  it("when each ground surface is named, then it sounds as its own material, cobble as stone", () => {
    for (const id of SURFACE_IDS) expect(surfaceSoundMat(id), id).toBe(id === "cobble" ? "stone" : id);
  });
});

describe("given every pair of materials rendered at every size", () => {
  it("when each is rendered, then it is audible, finite, whole and under clipping after its loudest gain", () => {
    for (let a = 0; a < SOUND_MATS.length; a++) {
      for (let b = a; b < SOUND_MATS.length; b++) {
        for (const size of SIZES) {
          const x = renderOf(SOUND_MATS[a]!, SOUND_MATS[b]!, size);
          const label = `${SOUND_MATS[a]}/${SOUND_MATS[b]} size ${size}`;
          expect(x.every(Number.isFinite), `${label}: finite`).toBe(true);
          expect(rmsOf(x), `${label}: rms`).toBeGreaterThan(0.02);
          expect(peakOf(x) * hitGain(1e6), `${label}: loudest peak`).toBeLessThan(1);
        }
      }
    }
  });

  it("when steel, concrete, dirt and hay hit themselves, then their spectral centroids fall in that order at every size", () => {
    for (const size of SIZES) {
      const centroid = (mat: SoundMat): number => centroidOf(renderOf(mat, mat, size), BANK_RATE);
      const [steel, concrete, dirt, hay] = [centroid("steel"), centroid("concrete"), centroid("dirt"), centroid("hay")];
      expect(steel, `size ${size}: steel over concrete`).toBeGreaterThan(concrete);
      expect(concrete, `size ${size}: concrete over dirt`).toBeGreaterThan(dirt);
      expect(dirt, `size ${size}: dirt over hay`).toBeGreaterThan(hay);
    }
  });

  it("when glass is hit, then it is the brightest of the four and mud the darkest of the soft ones", () => {
    const centroid = (mat: SoundMat): number => centroidOf(renderOf(mat, mat, 1), BANK_RATE);
    expect(centroid("glass")).toBeGreaterThan(centroid("steel"));
    expect(centroid("mud")).toBeLessThan(centroid("hay"));
  });

  it("when the same pair is rendered three times, then it is the same each time, and its three variations differ", () => {
    const first = renderOf("steel", "concrete", 1, 0);
    expect(firstMismatch(renderOf("steel", "concrete", 1, 0), first), "rendered again").toBeUndefined();
    expect(firstMismatch(renderOf("steel", "concrete", 1, 1), first), "variation 1").toBeDefined();
    expect(firstMismatch(renderOf("steel", "concrete", 1, 2), renderOf("steel", "concrete", 1, 1)), "variation 2").toBeDefined();
  });
});

describe("given a pair no bank holds", () => {
  it("when wood meets concrete, then it borrows a rubber bank with the harder side, and pairs with a car's side keep their own", () => {
    expect(bankKey("wood", "concrete")).toEqual(["rubber", "concrete"]);
    expect(bankKey("rubber", "hay")).toEqual(["rubber", "hay"]);
    expect(bankKey("concrete", "steel")).toEqual(["steel", "concrete"]);
    expect(bankKey("plastic", "rubber")).toEqual(["plastic", "rubber"]);
  });
});

describe("given a sound bank built on a recording context", () => {
  it("when it is built, then it holds under 20 MB", () => {
    expect(recorded().sound.bankBytes / 1e6, "MB of buffers").toBeLessThan(20);
  });

  it("when the same pair hits at 1.5, 6 and 20 m/s, then each is louder and rings longer than the one before", () => {
    const [tick, hit, crash] = [heard(1.5, "steel", "concrete"), heard(6, "steel", "concrete"), heard(20, "steel", "concrete")];
    expect([hitSize(1.5), hitSize(6), hitSize(20)]).toEqual([0, 1, 2]);
    expect(peakOf(hit), "hit over tick: peak").toBeGreaterThan(peakOf(tick));
    expect(peakOf(crash), "crash over hit: peak").toBeGreaterThan(peakOf(hit));
    expect(rmsOf(crash), "crash over hit: rms").toBeGreaterThan(rmsOf(hit));
    expect(ringSeconds(hit, BANK_RATE), "hit over tick: length").toBeGreaterThan(ringSeconds(tick, BANK_RATE));
    expect(ringSeconds(crash, BANK_RATE), "crash over hit: length").toBeGreaterThan(ringSeconds(hit, BANK_RATE));
  });

  it("when impulses straddle each size boundary, then the level never falls as the impulse rises", () => {
    let last = 0;
    for (let impulse = 0.4; impulse < 40; impulse += 0.1) {
      expect(hitGain(impulse), `at ${impulse.toFixed(1)}`).toBeGreaterThanOrEqual(last);
      last = hitGain(impulse);
    }
    expect([hitSize(TICK_MAX - 0.01), hitSize(TICK_MAX), hitSize(HIT_MAX - 0.01), hitSize(HIT_MAX)]).toEqual([0, 1, 1, 2]);
  });

  it("when a hit is heard from 200 m, then it is quieter, later and darker than from 5 m", () => {
    const near = heard(12, "steel", "steel", 5);
    const far = heard(12, "steel", "steel", 200);
    expect(rmsOf(far), "far rms").toBeLessThan(rmsOf(near) * 0.2);
    expect(centroidOf(far.subarray(0, near.length), BANK_RATE), "far centroid").toBeLessThan(centroidOf(near, BANK_RATE));
    const firstSound = (x: Float32Array): number => x.findIndex((v) => Math.abs(v) > 1e-4);
    expect(firstSound(far) / BANK_RATE, "the far hit starts a speed of sound later").toBeGreaterThan(0.5);
    expect(firstSound(near) / BANK_RATE, "the near hit starts at once").toBeLessThan(0.05);
  });

  it("when the same hit is struck below the smallest impulse, or from beyond earshot, then nothing is played", () => {
    const { ctx, sound } = recorded();
    sound.hit(event(0.2, "steel", "steel"), 0, 0, 0);
    sound.hit(event(30, "steel", "steel", 900), 0, 0, 0);
    expect(ctx.sources).toHaveLength(0);
  });
});

describe("given a pile-up of twenty cars", () => {
  /** `cars` cars each landing `hits` hits at once, at their own spots, `impulse` m/s each. */
  function pileUp(sound: HitSound, cars: number, hits: number, impulse: number): void {
    for (let car = 0; car < cars; car++) {
      for (let hit = 0; hit < hits; hit++) sound.hit(event(impulse + hit * 0.3, hit % 2 === 0 ? "steel" : "glass", "steel", 3 + car * 1.7, 2 + hit * 1.3), 0, 0, 0);
    }
  }

  it("when 20 cars land ten hits each in one frame, then no more than 24 voices sound and the quietest are the ones dropped", () => {
    const { ctx, sound } = recorded();
    pileUp(sound, 20, 10, 6);
    expect(ctx.sounding(), "sources sounding").toBeLessThanOrEqual(24);
    expect(sound.activeVoices(), "voices held").toBeLessThanOrEqual(24);
    sound.hit(event(30, "steel", "steel", 2, 1), 0, 0, 0);
    expect(ctx.sources.some((source) => source.buffer!.duration > 0.8), "the big crash took a voice from the quiet ones").toBe(true);
    expect(ctx.sounding(), "still capped").toBeLessThanOrEqual(24);
  });

  it("when the pile-up goes on for three seconds, then every frame stays within the cap and the mix stays finite and audible", () => {
    const { ctx, sound } = recorded();
    for (let frame = 0; frame < 180; frame++) {
      ctx.currentTime = frame / 60;
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
      if (frame % 6 === 0) pileUp(sound, 20, 2, 4 + (frame % 11));
      expect(ctx.sounding(), `frame ${frame}`).toBeLessThanOrEqual(24);
    }
    const mix = mixRecording(ctx, 3.5, BANK_RATE);
    expect(mix.every(Number.isFinite)).toBe(true);
    expect(rmsOf(mix)).toBeGreaterThan(0.02);
    expect(peakOf(mix), "the unlimited pile-up stays within the master limiter's reach").toBeLessThan(1.6);
  });

  it("when twenty hits of one pair and size land at twenty places, then at least fifteen differ in buffer, pitch or level", () => {
    const { ctx, sound } = recorded();
    for (let car = 0; car < 20; car++) sound.hit(event(7, "steel", "steel", 3 + car * 2.1, car * 0.7), 0, 0, 0);
    const seen = new Set<string>();
    for (const source of ctx.sources) seen.add(`${source.buffer!.data[40]!.toFixed(5)}|${source.playbackRate.value.toFixed(4)}|${source.sentTo!.gain.at(1).toFixed(4)}`);
    expect(seen.size).toBeGreaterThanOrEqual(15);
  });

  it("when a held contact calls the same hit every step, then it sounds once, and a harder one in the same place sounds again", () => {
    const { ctx, sound } = recorded();
    for (let step = 0; step < 5; step++) {
      ctx.currentTime = step * 0.008;
      sound.hit(event(5, "steel", "concrete"), 0, 0, 0);
    }
    expect(ctx.sources, "one hit for the held contact").toHaveLength(1);
    sound.hit(event(15, "steel", "concrete"), 0, 0, 0);
    expect(ctx.sources.length, "the harder hit sounds").toBeGreaterThan(1);
  });
});

describe("given the hit path after load", () => {
  /** Bytes a call of `within` allocates over a driven run, once V8 has compiled it. */
  function perCall(run: (sound: HitSound, ctx: FakeContext, call: number) => void, within: Within, bound: number): number {
    const ctx = new FakeContext(false);
    const sound = new HitSound(ctx, new FakeNode(false));
    while (!sound.bankReady) sound.frame(0, 0, 0, 0);
    let next = 0;
    return untilQuiet(() => {
      const from = next;
      next += CALLS;
      return allocatedBytes(() => {
        for (let call = from; call < next; call++) run(sound, ctx, call);
      }, within) / CALLS;
    }, bound);
  }

  const shared = event(9, "steel", "asphalt");

  const drive = (sound: HitSound, ctx: FakeContext, call: number): void => {
    ctx.currentTime = call * 0.05;
    shared.x = 3 + (call % 13);
    shared.z = (call % 7) * 2;
    shared.impulse = 1 + (call % 30);
    sound.hit(shared, 0, 0, 0);
    sound.frame(0.05, 0, 0, 0);
  };

  it("when hits and frames run on, then a hit costs only the boxed numbers it passes to the audio API, and a frame almost nothing", () => {
    expect(perCall(drive, { fn: "hit", file: "hit-sound.ts" }, HIT_BOUND_B), "bytes a hit").toBeLessThanOrEqual(HIT_BOUND_B);
    expect(perCall(drive, { fn: "frame", file: "hit-sound.ts" }, FRAME_BOUND_B), "bytes a frame").toBeLessThanOrEqual(FRAME_BOUND_B);
  });
});

describe("given a car sliding on the ground", () => {
  /** A contact `id` sliding at `speed` and `force` for `seconds`, called each frame, mixed. */
  function slid(a: SoundMat, b: SoundMat, speed: number, force: number, seconds = 1.5): Float32Array {
    const { ctx, sound } = recorded();
    for (let frame = 0; frame < seconds * 60; frame++) {
      ctx.currentTime = frame / 60;
      sound.scrape(7, speed, force, 5, 0, 0, a, b);
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
    }
    return mixRecording(ctx, seconds, BANK_RATE).subarray(Math.round(0.7 * BANK_RATE));
  }

  it("when steel scrapes concrete at 3, 8 and 15 m/s, then it is louder and brighter the faster it goes", () => {
    const [slow, mid, fast] = [3, 8, 15].map((speed) => slid("steel", "concrete", speed, 1));
    expect(rmsOf(mid!), "8 over 3: level").toBeGreaterThan(rmsOf(slow!));
    expect(rmsOf(fast!), "15 over 8: level").toBeGreaterThan(rmsOf(mid!));
    expect(centroidOf(fast!, BANK_RATE), "15 over 3: brightness").toBeGreaterThan(centroidOf(slow!, BANK_RATE));
  });

  it("when steel scrapes concrete at 10 m/s with 500 N and then 6000 N, then the harder press is louder", () => {
    expect(rmsOf(slid("steel", "concrete", 10, 1))).toBeGreaterThan(rmsOf(slid("steel", "concrete", 10, 0.25)) * 1.3);
  });

  it("when the contact stops being called, then its loop fades and is stopped within a third of a second", () => {
    const { ctx, sound } = recorded();
    sound.scrape(3, 10, 1, 5, 0, 0, "steel", "concrete");
    const loop = ctx.sources[0]!;
    const gain = loop.sentTo!.gain;
    for (let frame = 0; frame < 30; frame++) {
      ctx.currentTime = frame / 60;
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
    }
    expect(loop.stopAt, "stopped").toBeLessThan(Infinity);
    expect(gain.at(0.5), "faded to nothing").toBeLessThan(1e-3);
  });

  it("when two contacts slide, then each has its own loop and a repeated id keeps its loop", () => {
    const { ctx, sound } = recorded();
    for (let frame = 0; frame < 3; frame++) {
      sound.scrape(1, 8, 0.7, 5, 0, 0, "steel", "concrete");
      sound.scrape(2, 8, 0.7, 6, 0, 0, "rubber", "gravel");
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
    }
    expect(ctx.sources, "two loops").toHaveLength(2);
  });

  it("when scrape calls run with the contact sliding, then they allocate nothing a call", () => {
    const ctx = new FakeContext(false);
    const sound = new HitSound(ctx, new FakeNode(false));
    while (!sound.bankReady) sound.frame(0, 0, 0, 0);
    const run = (call: number): void => {
      ctx.currentTime = call / 60;
      sound.scrape(1, 4 + (call % 9), 0.3 + 0.1 * (call % 5), 5, 0, 0, "rubber", "gravel");
      sound.scrape(2, 6 + (call % 5), 0.5, 6, 0, 0, "steel", "asphalt");
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
    };
    let next = 0;
    const bytes = untilQuiet(() => {
      const from = next;
      next += 2000;
      return allocatedBytes(() => {
        for (let call = from; call < next; call++) run(call);
      }, { fn: "scrape", file: "hit-sound.ts" }) / 4000;
    }, SCRAPE_BOUND_B);
    expect(bytes, "bytes a scrape call").toBeLessThanOrEqual(SCRAPE_BOUND_B);
  });
});

describe("given the scrape loops", () => {
  const rate = BANK_RATE;

  function loopOf(a: SoundMat, b: SoundMat): Float32Array {
    const out = new Float32Array(scrapeSamples(rate));
    renderScrapeLoop(scrapeKind(a, b), 0, rate, out);
    return out;
  }

  /** How much the 5 ms envelope varies: the spread over the mean of the window RMS. */
  function burstiness(x: Float32Array): number {
    const window = Math.round(rate * 0.005);
    const levels: number[] = [];
    for (let start = 0; start + window <= x.length; start += window) levels.push(rmsOf(x.subarray(start, start + window)));
    const mean = levels.reduce((sum, v) => sum + v, 0) / levels.length;
    return Math.sqrt(levels.reduce((sum, v) => sum + (v - mean) ** 2, 0) / levels.length) / mean;
  }

  it("when each pair class is looked up, then metal on pavement stick-slips, rubber on loose ground rumbles, and glass and plants have their own", () => {
    expect(scrapeKind("steel", "concrete")).toBe(scrapeKind("steel", "asphalt"));
    expect(scrapeKind("rubber", "gravel")).toBe(scrapeKind("rubber", "dirt"));
    expect(new Set([scrapeKind("steel", "concrete"), scrapeKind("steel", "gravel"), scrapeKind("rubber", "gravel"), scrapeKind("rubber", "asphalt"), scrapeKind("glass", "steel"), scrapeKind("hay", "steel"), scrapeKind("wood", "steel")]).size).toBe(7);
  });

  it("when steel on concrete is rendered, then its envelope bursts far more than rubber on gravel's rumble", () => {
    expect(burstiness(loopOf("steel", "concrete")), "stick-slip bursts").toBeGreaterThan(burstiness(loopOf("rubber", "gravel")) * 1.5);
  });

  it("when every loop is rendered, then it is audible, finite and has no step at its seam", () => {
    for (const [a, b] of [["steel", "concrete"], ["steel", "gravel"], ["rubber", "gravel"], ["rubber", "asphalt"], ["glass", "steel"], ["hay", "steel"], ["wood", "steel"]] as const) {
      const x = loopOf(a, b);
      expect(x.every(Number.isFinite), `${a}/${b}: finite`).toBe(true);
      expect(rmsOf(x), `${a}/${b}: rms`).toBeGreaterThan(0.02);
      const seam = Math.abs(x[x.length - 1]! - x[0]!);
      expect(seam, `${a}/${b}: step at the seam against the loop's rms`).toBeLessThan(rmsOf(x) * 6);
    }
  });
});

describe("given the sound's frame-built bank", () => {
  it("when the sound is made, then its constructor renders nothing, each frame renders within the budget, and once crash buffers begin each frame renders one alone", () => {
    const sound = new HitSound(new FakeContext(true), new FakeNode(true));
    expect(sound.bankBytes, "bytes before any frame").toBe(0);
    // A clock that moves only with the work done: a sample rendered costs a fixed time, whatever the box is doing.
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (sound.bankBytes / 4) * MS_PER_SAMPLE);
    const overshootSamples = BUILD_BUDGET_MS / MS_PER_SAMPLE + Math.max(hitSamples(1, BANK_RATE), scrapeSamples(BANK_RATE));
    const crashBytes = hitSamples(2, BANK_RATE) * 4;
    let frames = 0;
    let crashFrames = 0;
    try {
      while (!sound.bankReady) {
        const before = sound.bankBytes;
        sound.frame(0, 0, 0, 0);
        const delta = sound.bankBytes - before;
        frames++;
        if (crashFrames === 0 && delta !== crashBytes) {
          expect(delta / 4, `samples rendered in frame ${frames}`).toBeLessThanOrEqual(overshootSamples);
          continue;
        }
        crashFrames++;
        expect(delta, `crash frame ${frames} renders one crash buffer and nothing else`).toBe(crashBytes);
      }
    } finally {
      clock.mockRestore();
    }
    expect(frames, "frames to finish").toBeGreaterThan(20);
    expect(crashFrames, "frames of one crash buffer each").toBeGreaterThan(40);
    expect(sound.bankBytes / 1e6, "MB of buffers").toBeLessThan(20);
  });

  it("when a phone's sound is made, then its bank is smaller than a desktop's", () => {
    const bytesOf = (desktop: boolean): number => {
      const sound = new HitSound(new FakeContext(true), new FakeNode(true), desktop);
      while (!sound.bankReady) sound.frame(0, 0, 0, 0);
      return sound.bankBytes;
    };
    expect(bytesOf(false)).toBeLessThan(bytesOf(true) * 0.8);
  });

  it("when a hit lands before the bank is rendered, then nothing plays, and the same hit plays once it is", () => {
    const ctx = new FakeContext(true);
    const sound = new HitSound(ctx, new FakeNode(true));
    sound.hit(event(6, "steel", "steel"), 0, 0, 0);
    expect(ctx.sources, "before the bank").toHaveLength(0);
    while (!sound.bankReady) sound.frame(0, 0, 0, 0);
    sound.hit(event(6, "steel", "steel"), 0, 0, 0);
    expect(ctx.sources, "after the bank").toHaveLength(1);
  });
});

describe("given voices held by crashes", () => {
  /** A crash of `impulse` m/s 5 m from the listener, round the compass by `turn`. */
  const crashAt = (turn: number, impulse = 20): HitEvent => event(impulse, "steel", "steel", 5 * Math.cos(turn), 5 * Math.sin(turn));

  it("when sixty crashes fill the voices and an equal crash lands 0.5 s later, then it takes a voice from the fading ones", () => {
    const { ctx, sound } = recorded();
    for (let car = 0; car < 60; car++) sound.hit(crashAt(car * 0.45), 0, 0, 0);
    const before = ctx.sources.length;
    ctx.currentTime = 0.5;
    sound.hit(crashAt(0.2), 0, 0, 0);
    expect(ctx.sources.length, "the fresh crash was played").toBeGreaterThan(before);
  });

  it("when a louder hit takes a full voice, then the old sound fades within milliseconds and the new one starts 10 ms after the steal", () => {
    const { ctx, sound } = recorded();
    for (let car = 0; car < 30; car++) sound.hit(event(1, "steel", "steel", 5 * Math.cos(car), 5 * Math.sin(car)), 0, 0, 0);
    ctx.currentTime = 0.01;
    const before = ctx.sources.length;
    sound.hit(crashAt(0.3, 25), 0, 0, 0);
    const fresh = ctx.sources[before]!;
    expect(fresh.startAt, "the new sound waits out the fade").toBeGreaterThanOrEqual(0.02);
    const faded = ctx.sources.find((source) => Math.abs(source.stopAt - 0.02) < 1e-9)!;
    expect(faded.sentTo!.gain.at(0.016), "the old sound's gain 6 ms in").toBeLessThan(0.01);
  });

  it("when hay hits hay and steel hits steel at the same speed, then the hay is quieter", () => {
    expect(rmsOf(heard(9, "hay", "hay"))).toBeLessThan(rmsOf(heard(9, "steel", "steel")));
  });
});

describe("given scrape calls with changing arguments", () => {
  /** Calls scrape for contact 1 once a frame with the given materials, `frames` times from frame `from`. */
  function scraping(sound: HitSound, ctx: FakeContext, a: SoundMat, b: SoundMat, from: number, frames: number): void {
    for (let frame = from; frame < from + frames; frame++) {
      ctx.currentTime = frame / FRAME_HZ;
      sound.scrape(1, 8, 0.8, 5, 0, 0, a, b);
      sound.frame(1 / FRAME_HZ, 0, 0, 0);
    }
  }

  it("when a contact id's materials change and stay changed, then after three frames the new pair's loop starts and the old one fades out within 15 ms", () => {
    const { ctx, sound } = recorded();
    scraping(sound, ctx, "steel", "concrete", 0, 5);
    scraping(sound, ctx, "rubber", "gravel", 5, 2);
    expect(ctx.sources, "the old loop still plays after two frames").toHaveLength(1);
    scraping(sound, ctx, "rubber", "gravel", 7, 1);
    expect(ctx.sources, "two loops").toHaveLength(2);
    const old = ctx.sources[0]!;
    expect(old.stopAt, "stops 15 ms after the switch").toBeCloseTo(7 / FRAME_HZ + 0.015, 6);
    expect(old.sentTo!.gain.at(7 / FRAME_HZ + 0.012), "faded by then").toBeLessThan(0.05 * old.sentTo!.gain.at(7 / FRAME_HZ));
    expect(ctx.sources[1]!.buffer, "another loop").not.toBe(old.buffer);
  });

  it("when a contact flips between two kinds every frame, then it keeps its one loop", () => {
    const { ctx, sound } = recorded();
    for (let frame = 0; frame < 40; frame++) scraping(sound, ctx, frame % 2 === 0 ? "steel" : "rubber", frame % 2 === 0 ? "concrete" : "gravel", frame, 1);
    expect(ctx.sources).toHaveLength(1);
  });

  it("when the id is negative, then nothing plays", () => {
    const { ctx, sound } = recorded();
    sound.scrape(-1, 8, 0.8, 5, 0, 0, "steel", "concrete");
    expect(ctx.sources).toHaveLength(0);
  });

  it("when the same scrape is heard from 5 m and from 155 m by the listener frame() was given, then the far one is quieter", () => {
    const level = (listenerX: number): number => {
      const { ctx, sound } = recorded();
      for (let frame = 0; frame < 90; frame++) {
        ctx.currentTime = frame / FRAME_HZ;
        sound.frame(1 / FRAME_HZ, listenerX, 0, 0);
        sound.scrape(2, 12, 1, 5, 0, 0, "steel", "concrete");
      }
      return rmsOf(mixRecording(ctx, 1.5, BANK_RATE).subarray(Math.round(0.7 * BANK_RATE)));
    };
    expect(level(155)).toBeLessThan(level(0) * 0.5);
  });
});

describe("given the bank is still being built", () => {
  it("when a 20 m/s hit lands after the ticks and hits are rendered but before the crashes are, then it sounds as a hit-size buffer", () => {
    const ctx = new FakeContext(true);
    const sound = new HitSound(ctx, new FakeNode(true));
    let spoken = false;
    while (!sound.bankReady && !spoken) {
      sound.frame(0, 0, 0, 0);
      sound.hit(event(20, "steel", "steel"), 0, 0, 0);
      spoken = ctx.sources.length > 0;
    }
    expect(sound.bankReady, "heard before the bank was done").toBe(false);
    expect(ctx.sources[0]!.buffer!.duration, "a hit-size buffer (0.32 s)").toBeLessThan(0.4);
  });
});
