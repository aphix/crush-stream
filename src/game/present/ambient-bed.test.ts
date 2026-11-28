import { describe, expect, it, vi } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { AmbientBed } from "./ambient-bed.ts";
import { fakeAudio } from "./ambient-fake-context.test-util.ts";
import { bedLevels, LEVEL, LEVEL_COUNT, type AmbientPlace } from "./ambient-levels.ts";
import { Biquad, filtered, rngOf, seamlessLoop, whiteNoise } from "./ambient-dsp.ts";
import { LAYER, LAYERS } from "./ambient-loops.ts";
import { EMITTERS, SHOT_RATE } from "./ambient-shots.ts";
import { layerLoop, measure, peakOf, RENDER_RATE, renderBed, rms, shotOf, writeRender } from "./ambient-render.test-util.ts";

const PLACES: readonly AmbientPlace[] = ["city", "track", "dirt", "arena", "openworld"];
const HOURS = [0, 6, 12, 18, 21] as const;
const LANE = "AudioAmbient";

function levelsAt(place: AmbientPlace, hour: number, speed = 0, indoors = false, cheer = 0): Float32Array {
  const out = new Float32Array(LEVEL_COUNT);
  bedLevels(place, hour, speed, indoors, cheer, out);
  return out;
}

describe("given every place and hour of the ambient bed", () => {
  for (const place of PLACES) {
    it(`when the ${place} bed is rendered at each hour, then it is audible and clips nowhere`, () => {
      for (const hour of HOURS) {
        const bed = renderBed(place, hour, 0, false, 8);
        expect(rms(bed.l), `${place} ${hour}h left rms`).toBeGreaterThan(0.004);
        expect(rms(bed.r), `${place} ${hour}h right rms`).toBeGreaterThan(0.004);
        expect(Math.max(peakOf(bed.l), peakOf(bed.r)), `${place} ${hour}h peak`).toBeLessThan(0.9);
      }
    });
  }

  it("when each place is rendered at noon and midnight for 20 s, then the renders are written for listening", () => {
    for (const place of PLACES) {
      for (const [name, hour] of [["noon", 12], ["midnight", 0]] as const) {
        const bed = renderBed(place, hour, 0, false, 20);
        writeRender(LANE, `${place}-${name}`, RENDER_RATE, bed.l, bed.r);
      }
    }
    const fast = renderBed("city", 12, 45, false, 20);
    writeRender(LANE, "city-noon-45ms", RENDER_RATE, fast.l, fast.r);
    const inside = renderBed("city", 12, 0, true, 20);
    writeRender(LANE, "city-noon-indoors", RENDER_RATE, inside.l, inside.r);
    const roar = renderBed("arena", 12, 0, false, 20, 1);
    writeRender(LANE, "arena-noon-cheer", RENDER_RATE, roar.l, roar.r);
    for (const kind of EMITTERS) writeRender(LANE, `shot-${kind}`, SHOT_RATE, shotOf(kind, 0));
    expect(rms(inside.l)).toBeGreaterThan(0);
  });
});

/** The wrap step of `loop` (last sample to first) against the loop's rms step. */
function seamSteps(loop: Float32Array): number {
  let steps = 0;
  for (let i = 1; i < loop.length; i++) steps += (loop[i]! - loop[i - 1]!) ** 2;
  return Math.abs(loop[0]! - loop[loop.length - 1]!) / Math.sqrt(steps / loop.length);
}

describe("given the loops of each layer", () => {
  for (const layer of ["rumble", "hum"] as const) {
    it(`when the ${layer} loop (smooth enough that a jump shows) wraps from its last sample to its first, then the step is within the loop's own steps`, () => {
      for (const ear of [0, 1] as const) expect(seamSteps(layerLoop(layer, ear)), `${layer} ear ${ear}: seam step in rms steps`).toBeLessThan(4);
    });
  }

  it("when a low-passed noise is looped with and without the crossfade, then the plain cut jumps by many steps and the crossfaded wrap by few", () => {
    const rng = rngOf(7);
    const render = (n: number): Float32Array => filtered(whiteNoise(n, rng), Biquad.low(110, 8000), Biquad.low(110, 8000));
    const raw = render(8000 * 26 + 8000 * 2);
    const plain = raw.slice(0, 8000 * 26);
    expect(seamSteps(plain), "cut without a crossfade").toBeGreaterThan(8);
    expect(seamSteps(seamlessLoop(() => raw, 8000, 26)), "crossfaded").toBeLessThan(4);
  });

  it("when the two ears of a layer are compared, then their lengths differ by seconds and their samples are not the same noise", () => {
    for (const layer of LAYERS) {
      const left = layerLoop(layer, 0);
      const right = layerLoop(layer, 1);
      expect(right.length, `${layer}: right longer than left`).toBeGreaterThan(left.length);
      let same = 0;
      for (let i = 50000; i < 90000; i++) if (left[i] === right[i] && left[i] !== 0) same++;
      expect(same, `${layer}: equal nonzero samples in a 40000-sample span`).toBeLessThan(40);
    }
  });
});

describe("given the city bed", () => {
  it("when it is rendered at midnight and at noon, then the night is under three quarters of the day", () => {
    expect(rms(renderBed("city", 0, 0, false, 12).l)).toBeLessThan(0.75 * rms(renderBed("city", 12, 0, false, 12).l));
    expect(rms(renderBed("openworld", 0, 0, false, 12).l)).toBeLessThan(0.75 * rms(renderBed("openworld", 12, 0, false, 12).l));
  });

  it("when the hour sweeps through a day, then the traffic peaks at the rush hours and the night crickets ease in over dusk", () => {
    const rumble = (hour: number): number => levelsAt("city", hour)[LAYER.rumble]!;
    expect(rumble(8), "morning rush over midday").toBeGreaterThan(rumble(12) * 1.1);
    expect(rumble(3), "night under midday").toBeLessThan(rumble(12) * 0.5);
    const crickets = (hour: number): number => levelsAt("openworld", hour)[LAYER.insects]!;
    expect(crickets(19.25), "mid dusk is between day and night").toBeGreaterThan(crickets(12));
    expect(crickets(19.25), "mid dusk is between day and night").toBeLessThan(crickets(0));
  });

  it("when night falls in the open world, then the crickets rise as the traffic falls", () => {
    const insects = LAYER.insects;
    const rumble = LAYER.rumble;
    expect(levelsAt("openworld", 0)[insects]!, "night crickets").toBeGreaterThan(5 * levelsAt("openworld", 12)[insects]!);
    expect(levelsAt("openworld", 0)[rumble]!, "night traffic").toBeLessThan(0.5 * levelsAt("openworld", 12)[rumble]!);
  });
});

describe("given speed, indoors and a cheer", () => {
  it("when the car goes 45 m/s, then the wind layer's level, its low-pass and the bed's rendered level all rise", () => {
    const wind = LAYER.wind;
    const still = levelsAt("city", 12, 0);
    const fast = levelsAt("city", 12, 45);
    expect(fast[wind]!, "wind level").toBeGreaterThan(4 * still[wind]!);
    expect(fast[LEVEL.windHz]!, "wind low-pass").toBeGreaterThan(2 * still[LEVEL.windHz]!);
    expect(rms(renderBed("city", 12, 45, false, 8).l), "rendered bed").toBeGreaterThan(1.4 * rms(renderBed("city", 12, 0, false, 8).l));
  });

  it("when the listener is indoors, then the bed is quieter and what is left is under 800 Hz", () => {
    const outside = measure(renderBed("city", 12, 0, false, 8).l, RENDER_RATE);
    const inside = measure(renderBed("city", 12, 0, true, 8).l, RENDER_RATE);
    expect(inside.peak, "peak").toBeLessThan(outside.peak);
    expect(inside.centroidHz, "centroid").toBeLessThan(outside.centroidHz);
    expect(inside.bands[3]! + inside.bands[4]!, "share over 2.5 kHz").toBeLessThan(0.1 * (outside.bands[3]! + outside.bands[4]!) + 0.001);
  });

  it("when the arena crowd cheers, then the cheer layer opens and the arena renders louder", () => {
    expect(levelsAt("arena", 12, 0, false, 0)[LAYER.cheer], "silent without a cheer").toBe(0);
    expect(levelsAt("arena", 12, 0, false, 1)[LAYER.cheer]!, "open with one").toBeGreaterThan(0.1);
    expect(rms(renderBed("arena", 12, 0, false, 8, 1).l)).toBeGreaterThan(1.4 * rms(renderBed("arena", 12, 0, false, 8).l));
  });
});

/** Runs frames of `bed` until `done()` holds, letting its renders arrive between them (a frame never waits for one). */
async function framesUntil(bed: AmbientBed, done: () => boolean): Promise<void> {
  for (let f = 0; f < 4000 && !done(); f++) {
    bed.frame(1 / FRAME_HZ);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(done(), "the renders arrived").toBe(true);
}

/** The bed in `place` at `hour`, framed until everything the place needs has arrived and its layers play. */
async function loadedBed(place: AmbientPlace, hour: number, speed = 0, indoors = false) {
  const audio = fakeAudio();
  const bed = new AmbientBed(audio.ctx, audio.out);
  bed.set(place, hour, speed, indoors);
  await framesUntil(bed, () => bed.pending === 0 && audio.fake.loopsStarted() >= 2 * LAYERS.filter((_, l) => levelsAt(place, hour)[l]! > 0.002).length);
  return { ...audio, bed };
}

describe("given an AmbientBed on a recording context", () => {
  it("when a city noon is set, then no frame renders anything, the loops start once they arrive, and the one-shots follow the schedule", async () => {
    const audio = fakeAudio();
    const bed = new AmbientBed(audio.ctx, audio.out);
    bed.set("city", 12, 0, false);
    bed.frame(1 / FRAME_HZ);
    expect(audio.fake.buffers.length, "nothing rendered on the first frame").toBe(0);
    expect(audio.fake.loopsStarted(), "nothing playing yet").toBe(0);
    expect(bed.pending, "renders asked of the worker").toBeGreaterThan(10);
    await framesUntil(bed, () => bed.pending === 0);
    for (let f = 0; f < 5; f++) bed.frame(1 / FRAME_HZ);
    const wanted = LAYERS.filter((_, l) => levelsAt("city", 12)[l]! > 0.002);
    expect(audio.fake.loopsStarted(), "two ears of each wanted layer").toBe(2 * wanted.length);
    for (let f = 0; f < FRAME_HZ * 120; f++) bed.frame(1 / FRAME_HZ);
    const fired = renderBed("city", 12, 0, false, 120).fired;
    expect(audio.fake.shotsStarted(), "one-shots over 120 s against the offline schedule").toBeGreaterThanOrEqual(Math.floor(fired / 2));
    expect(audio.fake.shotsStarted(), "one-shots over 120 s against the offline schedule").toBeLessThanOrEqual(2 * fired + 2);
    expect(audio.fake.shotsStarted(), "a city has some in two minutes").toBeGreaterThan(2);
  });

  it("when speed rises and then the listener goes indoors, then the wind layer's gain and low-pass follow, and the bed low-pass closes", async () => {
    const { fake, bed } = await loadedBed("track", 12);
    const windGain = fake.nodes[3 + LAYER.wind]!;
    const windFilter = fake.nodes[2]!;
    const bedFilter = fake.nodes[1]!;
    const calm = windGain.gain.value;
    const calmHz = windFilter.frequency.value;
    bed.set("track", 12, 50, false);
    for (let f = 0; f < 600; f++) bed.frame(1 / FRAME_HZ);
    expect(windGain.gain.value, "wind gain at speed").toBeGreaterThan(3 * calm);
    expect(windFilter.frequency.value, "wind low-pass at speed").toBeGreaterThan(2 * calmHz);
    expect(bedFilter.frequency.value, "outdoors the bed is open").toBeGreaterThan(10000);
    bed.set("track", 12, 50, true);
    for (let f = 0; f < 600; f++) bed.frame(1 / FRAME_HZ);
    expect(bedFilter.frequency.value, "indoors the bed is closed").toBeLessThan(1000);
  });

  it("when a cheer is added in the arena and left, then the cheer layer, loaded beforehand, opens at once and fades away", async () => {
    const { fake, bed } = await loadedBed("arena", 12);
    const cheer = fake.nodes[3 + LAYER.cheer]!;
    expect(cheer.gain.value, "quiet before").toBe(0);
    expect(bed.pending, "its ears were in before any cheer").toBe(0);
    bed.cheer(1);
    for (let f = 0; f < 120; f++) bed.frame(1 / FRAME_HZ);
    const open = cheer.gain.value;
    expect(open, "open after").toBeGreaterThan(0.1);
    expect(fake.nodes.filter((node) => node.loop && node.started > 0).length, "cheer ears running").toBeGreaterThan(0);
    for (let f = 0; f < FRAME_HZ * 20; f++) bed.frame(1 / FRAME_HZ);
    expect(cheer.gain.value, "faded").toBeLessThan(0.1 * open);
  });

  it("when a layer's target falls to nothing, then its sources stop, and when it comes back they start again from the kept buffers without a render", async () => {
    const { fake, bed } = await loadedBed("city", 0);
    const running = fake.loopsStarted();
    const built = fake.buffers.length;
    bed.set("city", 12, 0, false);
    for (let f = 0; f < FRAME_HZ * 20; f++) bed.frame(1 / FRAME_HZ);
    expect(fake.nodes.filter((node) => node.loop && node.stopped > 0).length, "the two cricket ears stopped by day").toBe(2);
    bed.set("city", 0, 0, false);
    for (let f = 0; f < FRAME_HZ * 5; f++) bed.frame(1 / FRAME_HZ);
    expect(fake.buffers.length, "no buffer made again").toBe(built);
    expect(fake.loopsStarted(), "two sources started again").toBe(running + 2);
  });

  it("when the bed has the audio levels sent, then a settled bed sets no parameter on a frame", async () => {
    const { fake, bed } = await loadedBed("track", 12);
    for (let f = 0; f < FRAME_HZ * 30; f++) bed.frame(1 / FRAME_HZ);
    const writes = vi.fn();
    for (const node of fake.nodes) {
      for (const param of [node.gain, node.frequency]) {
        let held = param.value;
        Object.defineProperty(param, "value", { get: () => held, set: (v: number) => (writes(), (held = v)) });
      }
    }
    for (let f = 0; f < 30; f++) bed.frame(1 / FRAME_HZ);
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("given what each place holds in memory", () => {
  it("when each place is loaded, then its audio buffers are small, and all five together stay under the sum of their parts", async () => {
    const MB = 1024 * 1024;
    let sum = 0;
    const report: string[] = [];
    for (const place of PLACES) {
      const { fake, bed } = await loadedBed(place, 12);
      const bytes = fake.residentBytes();
      sum += bytes;
      report.push(`${place} ${(bytes / MB).toFixed(1)} MB`);
      expect(bytes / MB, `${place} resident MB`).toBeLessThan(14);
      bed.dispose();
    }
    console.log(`resident audio buffers: ${report.join(", ")}, all places ${(sum / MB).toFixed(1)} MB`);
    expect(sum / MB, "all places").toBeLessThan(40);
  });

  it("when the place changes, then what the old place alone used is dropped and only the new place's sounds are asked for", async () => {
    const { fake, bed } = await loadedBed("arena", 12);
    bed.set("dirt", 12, 0, false);
    bed.frame(1 / FRAME_HZ);
    expect(bed.pending, "dirt's own loops and one-shots asked for").toBeGreaterThan(0);
    expect(bed.pending, "its insects (2 ears) and its dog and bird (3 variants each)").toBe(8);
    await framesUntil(bed, () => bed.pending === 0);
    expect(fake.nodes.some((node) => node.loop && node.stopped > 0), "arena's crowd stopped").toBe(true);
  });
});
