import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { AmbientBed } from "./ambient-bed.ts";
import { fakeAudio } from "./ambient-fake-context.test-util.ts";
import { bedLevels, LEVEL, LEVEL_COUNT, type AmbientPlace } from "./ambient-levels.ts";
import { LAYER, LAYERS, layerLoop } from "./ambient-loops.ts";
import { EMITTERS, SHOT_RATE, shotOf } from "./ambient-shots.ts";
import { measure, peakOf, RENDER_RATE, renderBed, rms, writeRender } from "./ambient-render.test-util.ts";

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

describe("given the loops of each layer", () => {
  for (const layer of LAYERS) {
    it(`when the ${layer} loop wraps from its last sample to its first, then the step is no bigger than the loop's own steps`, () => {
      for (const ear of [0, 1] as const) {
        const loop = layerLoop(layer, ear);
        let steps = 0;
        let worst = 0;
        for (let i = 1; i < loop.length; i++) {
          steps += (loop[i]! - loop[i - 1]!) ** 2;
          worst = Math.max(worst, Math.abs(loop[i]! - loop[i - 1]!));
        }
        const seam = Math.abs(loop[0]! - loop[loop.length - 1]!);
        expect(seam, `${layer} ear ${ear}: seam step against the loop's largest step`).toBeLessThanOrEqual(worst);
        expect(seam / Math.sqrt(steps / loop.length), `${layer} ear ${ear}: seam step in rms steps`).toBeLessThan(4);
      }
    });
  }

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

describe("given an AmbientBed on a recording context", () => {
  it("when a city noon is set and frames run, then every loop of the place is started once, one ear a frame, and the one-shots match the offline schedule", () => {
    const { fake, ctx, out } = fakeAudio();
    const bed = new AmbientBed(ctx, out);
    bed.set("city", 12, 0, false);
    bed.frame(1 / FRAME_HZ);
    expect(fake.loopsStarted(), "one ear on the first frame").toBe(1);
    for (let f = 0; f < 60 * 120; f++) bed.frame(1 / FRAME_HZ);
    const wanted = LAYERS.filter((_, l) => levelsAt("city", 12)[l]! > 0.002);
    expect(fake.loopsStarted(), "two ears of each wanted layer").toBe(2 * wanted.length);
    expect(fake.shotsStarted(), "one-shots over 120 s").toBe(renderBed("city", 12, 0, false, 120).fired);
    expect(fake.shotsStarted(), "a city has some in two minutes").toBeGreaterThan(2);
  });

  it("when speed rises and then the listener goes indoors, then the wind layer's gain and low-pass follow, and the bed low-pass closes", () => {
    const { fake, ctx, out } = fakeAudio();
    const bed = new AmbientBed(ctx, out);
    bed.set("track", 12, 0, false);
    for (let f = 0; f < 600; f++) bed.frame(1 / FRAME_HZ);
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

  it("when a cheer is added and left, then the cheer layer opens and fades away", () => {
    const { fake, ctx, out } = fakeAudio();
    const bed = new AmbientBed(ctx, out);
    bed.set("arena", 12, 0, false);
    for (let f = 0; f < 60; f++) bed.frame(1 / FRAME_HZ);
    const cheer = fake.nodes[3 + LAYER.cheer]!;
    expect(cheer.gain.value, "quiet before").toBe(0);
    bed.cheer(1);
    for (let f = 0; f < 120; f++) bed.frame(1 / FRAME_HZ);
    const open = cheer.gain.value;
    expect(open, "open after").toBeGreaterThan(0.1);
    for (let f = 0; f < 60 * 20; f++) bed.frame(1 / FRAME_HZ);
    expect(cheer.gain.value, "faded").toBeLessThan(0.1 * open);
  });
});
