import { describe, expect, it } from "vitest";
import { CEILING, VOICES } from "./audio-mix.ts";
import { admitHits, level, mixDown, mixAt, noise, SAMPLE_RATE, standInHit, type MixLevels, type Stems, type TimedHit } from "./mix-render.test-util.ts";

const SECONDS = 7;
const LEVELS: MixLevels = { musicVolume: 0.6, engineVolume: 1, playerEngineLevel: 1, hitVoices: VOICES.hitsDesktop };

/** Loud, steady stems on every bus but the hits: the worst case the hits land on. */
function stems(): Stems {
  const n = SECONDS * SAMPLE_RATE;
  const rand = noise(7);
  const make = (fill: (i: number) => number): Float32Array => Float32Array.from({ length: n }, (_, i) => fill(i));
  return {
    engines: make((i) => 0.25 * (Math.sin((2 * Math.PI * 90 * i) / SAMPLE_RATE) + 0.5 * Math.sin((2 * Math.PI * 180 * i) / SAMPLE_RATE))),
    hits: new Float32Array(n),
    ambient: make(() => 0.4 * rand()),
    ui: new Float32Array(n),
    music: make((i) => 0.7 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.7 + 0.3 * rand()),
  };
}

/** The hits' stem for `hits`: what the budget admits, each as the stand-in voice. */
function withHits(base: Stems, hits: readonly TimedHit[]): Stems {
  const { admitted } = admitHits(hits, SECONDS, LEVELS.hitVoices);
  const out = { ...base, hits: new Float32Array(base.hits.length) };
  for (const h of admitted) mixAt(out.hits, h.t, standInHit(h.impulse));
  return out;
}

const PILE_UP: TimedHit[] = Array.from({ length: 16 }, (_, k) => ({ t: 2 + k * 0.02, impulse: 45 }));
const slice = (seconds: [number, number]): [number, number] => [Math.round(seconds[0] * SAMPLE_RATE), Math.round(seconds[1] * SAMPLE_RATE)];

describe("given a pile-up: sixteen 45 m/s hits in a third of a second over loud engines, music and ambience", () => {
  const render = mixDown(withHits(stems(), PILE_UP), PILE_UP, LEVELS);

  it("when it is mixed down, then no output sample passes the -1 dBFS ceiling and the pile-up is not flat-topped on it", () => {
    let over = 0;
    let atCeiling = 0;
    for (const channel of [render.left, render.right]) {
      for (let i = 0; i < channel.length; i++) {
        over = Math.max(over, Math.abs(channel[i]!) - CEILING);
        if (Math.abs(channel[i]!) > CEILING - 1e-3) atCeiling++;
      }
    }
    expect(over, "samples over the ceiling").toBeLessThanOrEqual(1e-6);
    expect(atCeiling / (2 * render.left.length), "share of samples on the ceiling").toBeLessThan(0.002);
  });

  it("when the limiter has acted, then the pile-up's peak ahead of the ceiling is under full scale", () => {
    expect(render.preCeilingPeak).toBeLessThan(1);
  });

  it("when the hits land, then the music bus is 4.5 to 7.5 dB under where it was just before, and back within 0.7 dB five seconds later", () => {
    const quiet = level(render.buses.music, ...slice([1.5, 1.9])).rmsDb;
    const ducked = level(render.buses.music, ...slice([2.4, 2.6])).rmsDb;
    const after = level(render.buses.music, ...slice([6.2, 6.9])).rmsDb;
    expect(ducked - quiet, "ducked by (dB)").toBeLessThan(-4.5);
    expect(ducked - quiet, "ducked by (dB)").toBeGreaterThan(-7.5);
    expect(Math.abs(after - quiet), "recovered to within (dB)").toBeLessThan(0.7);
  });

  it("when the hits land, then the ambient bus ducks less than the music (4.5 dB at most 6)", () => {
    const quiet = level(render.buses.ambient, ...slice([1.5, 1.9])).rmsDb;
    const ducked = level(render.buses.ambient, ...slice([2.4, 2.6])).rmsDb;
    expect(ducked - quiet).toBeLessThan(-3);
    expect(ducked - quiet).toBeGreaterThan(-5.5);
  });
});

describe("given the engine slider at full and at half", () => {
  it("when the same stems are mixed, then the engine bus is 6 dB lower at half and the music bus does not move", () => {
    const base = stems();
    const full = mixDown(base, [], LEVELS);
    const half = mixDown(base, [], { ...LEVELS, engineVolume: 0.5 });
    const range = slice([1, 3]);
    expect(level(half.buses.engines, ...range).rmsDb - level(full.buses.engines, ...range).rmsDb).toBeCloseTo(-6.02, 1);
    expect(level(half.buses.music, ...range).rmsDb).toBeCloseTo(level(full.buses.music, ...range).rmsDb, 3);
  });

  it("when the music slider is at half, then the music bus is 6 dB lower and the engine bus does not move", () => {
    const base = stems();
    const full = mixDown(base, [], { ...LEVELS, musicVolume: 0.4 });
    const half = mixDown(base, [], { ...LEVELS, musicVolume: 0.2 });
    const range = slice([1, 3]);
    expect(level(half.buses.music, ...range).rmsDb - level(full.buses.music, ...range).rmsDb).toBeCloseTo(-6.02, 1);
    expect(level(half.buses.engines, ...range).rmsDb).toBeCloseTo(level(full.buses.engines, ...range).rmsDb, 3);
  });
});
