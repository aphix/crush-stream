import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Biquad, filtered, nextDraw } from "./ambient-dsp.ts";
import { bedLevels, emitterRate, LEVEL, LEVEL_COUNT, SCHEDULE_SEED, SHOT_GAIN, SHOT_GAP_S, SHOT_PAN, type AmbientPlace } from "./ambient-levels.ts";
import { LAYER_RATE, LAYERS, renderLoop } from "./ambient-loops.ts";
import { EMITTERS, renderShot, SHOT_RATE, SHOT_VARIANTS } from "./ambient-shots.ts";

const loops = new Map<string, Float32Array>();
const shots = new Map<string, Float32Array>();

/** The loop of `layer` for `ear`, rendered once per test run. */
export function layerLoop(layer: (typeof LAYERS)[number], ear: 0 | 1): Float32Array {
  const key = `${layer}:${ear}`;
  if (!loops.has(key)) loops.set(key, renderLoop(layer, ear));
  return loops.get(key)!;
}

/** One variant of a one-shot, rendered once per test run. */
export function shotOf(kind: (typeof EMITTERS)[number], variant: number): Float32Array {
  const key = `${kind}:${variant}`;
  if (!shots.has(key)) shots.set(key, renderShot(kind, variant));
  return shots.get(key)!;
}

/** Test harness: the ambient bed rendered offline to samples (the same levels and schedule the node graph uses), a WAV writer and an FFT-band analyser. */
export const RENDER_RATE = 44100;
/** Where listening renders go when `AUDIO_RENDERS` is set in the environment. */
export const RENDER_DIR = process.env.AUDIO_RENDERS ?? null;

export interface Stereo {
  l: Float32Array;
  r: Float32Array;
}

/** A mono loop read at `rate` Hz output with linear interpolation, repeating, into `out`, added with gains `gl`, `gr` into the stereo pair. */
function addLoop(into: Stereo, data: Float32Array, dataRate: number, gl: number, gr: number): void {
  const step = dataRate / RENDER_RATE;
  for (let i = 0; i < into.l.length; i++) {
    const at = i * step;
    const k = Math.floor(at);
    const frac = at - k;
    const v = data[k % data.length]! * (1 - frac) + data[(k + 1) % data.length]! * frac;
    into.l[i] = into.l[i]! + v * gl;
    into.r[i] = into.r[i]! + v * gr;
  }
}

/** The (left, right) gains of a mono source at pan -1..1, as a StereoPannerNode. */
function panGains(pan: number): [number, number] {
  const angle = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

function silence(seconds: number): Stereo {
  return { l: new Float32Array(Math.round(seconds * RENDER_RATE)), r: new Float32Array(Math.round(seconds * RENDER_RATE)) };
}

function addInto(out: Stereo, part: Stereo): void {
  for (let i = 0; i < out.l.length; i++) {
    out.l[i] = out.l[i]! + part.l[i]!;
    out.r[i] = out.r[i]! + part.r[i]!;
  }
}

/** The loop layers at their levels, the wind through its speed low-pass. */
function layersOf(levels: Float32Array, seconds: number): Stereo {
  const mix = silence(seconds);
  for (let l = 0; l < LAYERS.length; l++) {
    if (levels[l]! <= 0) continue;
    const layer = silence(seconds);
    for (const ear of [0, 1] as const) {
      const [gl, gr] = panGains(ear === 0 ? -0.85 : 0.85);
      addLoop(layer, layerLoop(LAYERS[l]!, ear), LAYER_RATE[LAYERS[l]!], gl * levels[l]!, gr * levels[l]!);
    }
    if (LAYERS[l] === "wind") {
      filtered(layer.l, Biquad.low(levels[LEVEL.windHz]!, RENDER_RATE));
      filtered(layer.r, Biquad.low(levels[LEVEL.windHz]!, RENDER_RATE));
    }
    addInto(mix, layer);
  }
  return mix;
}

/** The one-shots the schedule fires over `seconds` at 60 steps a second, mixed at their start times; `fired` counts them. */
function shotsOf(place: AmbientPlace, hour: number, seconds: number): { mix: Stereo; fired: number } {
  const mix = silence(seconds);
  const rng = Uint32Array.of(SCHEDULE_SEED);
  const since = new Float32Array(EMITTERS.length).fill(Infinity);
  const step = 1 / FRAME_HZ;
  let fired = 0;
  for (let f = 0; f < seconds * FRAME_HZ; f++) {
    for (let k = 0; k < EMITTERS.length; k++) {
      since[k] = since[k]! + step;
      if (since[k]! < SHOT_GAP_S[k]! || nextDraw(rng) >= (emitterRate(place, k, hour) * step) / 60) continue;
      since[k] = 0;
      fired++;
      const variant = Math.floor(nextDraw(rng) * SHOT_VARIANTS);
      const [gl, gr] = panGains((nextDraw(rng) * 2 - 1) * SHOT_PAN);
      const gain = SHOT_GAIN[k]! * (0.5 + 0.5 * nextDraw(rng));
      const data = shotOf(EMITTERS[k]!, variant);
      const first = Math.round(f * step * RENDER_RATE);
      for (let i = 0; i < data.length * (RENDER_RATE / SHOT_RATE) && first + i < mix.l.length; i++) {
        const v = data[Math.floor(i * (SHOT_RATE / RENDER_RATE))]! * gain;
        mix.l[first + i] = mix.l[first + i]! + v * gl;
        mix.r[first + i] = mix.r[first + i]! + v * gr;
      }
    }
  }
  return { mix, fired };
}

/** The bed at steady state for `seconds`: loops, wind low-pass, one-shots, then the indoors low-pass and gain; `fired` is how many one-shots the schedule started. */
export function renderBed(place: AmbientPlace, hour: number, speed: number, indoors: boolean, seconds: number, cheer = 0): Stereo & { fired: number } {
  const levels = new Float32Array(LEVEL_COUNT);
  bedLevels(place, hour, speed, indoors, cheer, levels);
  const mix = layersOf(levels, seconds);
  const shots = shotsOf(place, hour, seconds);
  addInto(mix, shots.mix);
  for (const channel of [mix.l, mix.r]) {
    if (levels[LEVEL.bedHz]! < 16000) filtered(channel, Biquad.low(levels[LEVEL.bedHz]!, RENDER_RATE));
    for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * levels[LEVEL.bedGain]!;
  }
  return { ...mix, fired: shots.fired };
}

export function rms(x: Float32Array): number {
  let squares = 0;
  for (let i = 0; i < x.length; i++) squares += x[i]! * x[i]!;
  return Math.sqrt(squares / x.length);
}

export function peakOf(x: Float32Array): number {
  let top = 0;
  for (let i = 0; i < x.length; i++) top = Math.max(top, Math.abs(x[i]!));
  return top;
}

/** In-place radix-2 FFT of (re, im); both lengths are a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const vi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** Share of the energy in each band: under 200 Hz, 200-800, 800-2500, 2500-6000, over 6000. */
export const BAND_EDGES = [200, 800, 2500, 6000] as const;

export interface Measure {
  peak: number;
  /** Milliseconds from the first sample over 1 % of the peak to the peak. */
  attackMs: number;
  /** Seconds from the peak to the last sample over -30 dB of it (smoothed over a 20 ms window). */
  tailS: number;
  lengthS: number;
  centroidHz: number;
  bands: number[];
}

/** The reference analyser's numbers (peak, attack, tail, centroid, band shares) for a mono sound. */
export function measure(x: Float32Array, rate: number): Measure {
  const peak = peakOf(x);
  let top = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) >= peak) top = i;
  let start = 0;
  while (Math.abs(x[start]!) < peak * 0.01) start++;
  const window = Math.round(rate * 0.02);
  let sum = 0;
  let last = top;
  for (let i = 0; i < x.length; i++) {
    sum += Math.abs(x[i]!);
    if (i >= window) sum -= Math.abs(x[i - window]!);
    if (i > top && sum / window > peak * 0.0316) last = i;
  }
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  fft(re, im);
  const bands = [0, 0, 0, 0, 0];
  let total = 0;
  let weighted = 0;
  for (let k = 1; k < n / 2; k++) {
    const hz = (k * rate) / n;
    const energy = re[k]! * re[k]! + im[k]! * im[k]!;
    total += energy;
    weighted += energy * hz;
    const band = BAND_EDGES.findIndex((edge) => hz < edge);
    bands[band === -1 ? BAND_EDGES.length : band]! += energy;
  }
  return { peak, attackMs: ((top - start) / rate) * 1000, tailS: (last - top) / rate, lengthS: x.length / rate, centroidHz: weighted / total, bands: bands.map((b) => b / total) };
}

/** Writes `channels` (one mono or two stereo arrays) as a 16-bit WAV in `RENDER_DIR`/`lane`; does nothing unless `AUDIO_RENDERS` is set. */
export function writeRender(lane: string, name: string, rate: number, ...channels: Float32Array[]): void {
  if (RENDER_DIR === null) return;
  const dir = path.join(RENDER_DIR, lane);
  mkdirSync(dir, { recursive: true });
  const frames = channels[0]!.length;
  const data = Buffer.alloc(44 + frames * channels.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + frames * channels.length * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(channels.length, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * channels.length * 2, 28);
  data.writeUInt16LE(channels.length * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * channels.length * 2, 40);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels.length; c++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c]![i]!)) * 32767), 44 + (i * channels.length + c) * 2);
  }
  writeFileSync(path.join(dir, `${name}.wav`), data);
}
