import { writeFileSync } from "node:fs";
import { FRAME_HZ } from "../kernel/constants.ts";
import { BUS, ceilingCurve, DUCK, duckGain, engineBusGain, engineDuck, GLUE_TRIM, HitMix, MASTER_GLUE, MASTER_LIMITER, musicGain, REVERB, reverbImpulse, SEND } from "./audio-mix.ts";

/** Offline model of the game's mix (no browser): the buses' gains and ducks from `audio-mix`, the shared reverb, and the master chain as the browser's compressor behaves, approximated. */
export const SAMPLE_RATE = 44100;
/** The duck is stepped at the game's frame rate. */
const FRAME_S = 1 / FRAME_HZ;
/** The music's duck follows the player's engine and the crash with these time constants (s): `GameAudio`'s `DUCK_TAU_S`, and `DUCK.attackTauS` while a hit presses it down. */
const FOLLOW_TAU_S = 0.1;
/** The browser compressor's look-ahead (s). */
const PREDELAY_S = 0.006;

export type Stems = { engines: Float32Array; hits: Float32Array; ambient: Float32Array; ui: Float32Array; music: Float32Array };
export type BusName = keyof Stems;
export const BUS_NAMES: readonly BusName[] = ["engines", "hits", "ambient", "ui", "music"];

/** A hit as the feed reports it: when (s) and how hard (closing m/s). */
export type TimedHit = { t: number; impulse: number };

/** The hits the hit bus admits (`HitMix`), in order, and the crash duck's level at each frame. */
export function admitHits(hits: readonly TimedHit[], seconds: number, voices: number): { admitted: TimedHit[]; duck: Float64Array } {
  const mix = new HitMix(voices);
  const order = [...hits].sort((a, b) => a.t - b.t);
  const frames = Math.ceil(seconds / FRAME_S);
  const duck = new Float64Array(frames);
  const admitted: TimedHit[] = [];
  let next = 0;
  for (let f = 0; f < frames; f++) {
    const now = f * FRAME_S;
    while (next < order.length && order[next]!.t <= now) {
      if (mix.admit(order[next]!.t, order[next]!.impulse)) admitted.push(order[next]!);
      next++;
    }
    duck[f] = mix.duck.level;
    mix.duck.step(FRAME_S);
  }
  return { admitted, duck };
}

/** A first-order smoothing of `target(sample)` toward each new value with time constant `tau` (`tauDown` when the value falls), as `setTargetAtTime` follows its target. */
function follow(count: number, target: (i: number) => number, tau: number, tauDown = tau): Float64Array {
  const out = new Float64Array(count);
  let g = target(0);
  for (let i = 0; i < count; i++) {
    const t = target(i);
    g += (t - g) * (1 - Math.exp(-1 / (SAMPLE_RATE * (t < g ? tauDown : tau))));
    out[i] = g;
  }
  return out;
}

export type MixLevels = { musicVolume: number; engineVolume: number; playerEngineLevel: number; hitVoices: number };

/** Each bus after its gain: the sliders, the engine duck of the music, and the crash duck of the music and ambience. */
export function busGains(stems: Stems, duck: Float64Array, levels: MixLevels): Record<BusName, Float32Array> {
  const n = stems.hits.length;
  const duckAt = (i: number): number => duck[Math.min(duck.length - 1, Math.floor(i / SAMPLE_RATE / FRAME_S))]!;
  const scaled = (stem: Float32Array, gain: Float64Array | number): Float32Array => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (stem[i] ?? 0) * (typeof gain === "number" ? gain : gain[i]!);
    return out;
  };
  const music = follow(n, (i) => musicGain(levels.musicVolume, engineDuck(levels.playerEngineLevel), duckGain(duckAt(i), DUCK.musicDb)), DUCK.attackTauS, FOLLOW_TAU_S);
  const ambient = follow(n, (i) => BUS.ambient * duckGain(duckAt(i), DUCK.ambientDb), DUCK.attackTauS, FOLLOW_TAU_S);
  return { engines: scaled(stems.engines, engineBusGain(levels.engineVolume)), hits: scaled(stems.hits, BUS.hits), ambient: scaled(stems.ambient, ambient), ui: scaled(stems.ui, BUS.ui), music: scaled(stems.music, music) };
}

/** In-place radix-2 FFT of `re`, `im` (length a power of two); `inverse` also divides by the length. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
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
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = im[i]! / n;
  }
}

/** `signal` convolved with `impulse`, as long as the signal. */
export function convolve(signal: Float32Array, impulse: Float32Array): Float32Array {
  let size = 1;
  while (size < signal.length + impulse.length) size <<= 1;
  const ar = new Float64Array(size);
  const ai = new Float64Array(size);
  const br = new Float64Array(size);
  const bi = new Float64Array(size);
  ar.set(signal);
  br.set(impulse);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < size; i++) {
    const r = ar[i]! * br[i]! - ai[i]! * bi[i]!;
    ai[i] = ar[i]! * bi[i]! + ai[i]! * br[i]!;
    ar[i] = r;
  }
  fft(ar, ai, true);
  return Float32Array.from(ar.subarray(0, signal.length));
}

type Compressor = { threshold: number; knee: number; ratio: number; attack: number; release: number };

const dbOf = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));

/** The static curve's output level (dB) for an input level (dB): linear to the threshold, then a soft knee `knee` dB wide that bends to `ratio`:1. */
function curveDb(p: Compressor, inDb: number): number {
  if (inDb <= p.threshold) return inDb;
  const slope = 1 / p.ratio;
  const over = inDb - p.threshold;
  if (over >= p.knee) return p.threshold + over * slope;
  const u = over / p.knee;
  return p.threshold + over * (1 - (1 - slope) * u * u * (3 - 2 * u));
}

/** The browser compressor's automatic make-up gain: the static curve's loss at full scale, to the power 0.6. */
function makeupOf(p: Compressor): number {
  return (10 ** (-curveDb(p, 0) / 20)) ** 0.6;
}

/** A feed-forward compressor on the loudest of the channels, gain smoothed in dB at the attack and release, with a look-ahead and the make-up gain. */
function compress(channels: Float32Array[], p: Compressor): Float32Array[] {
  const n = channels[0]!.length;
  const delay = Math.round(PREDELAY_S * SAMPLE_RATE);
  const out = channels.map(() => new Float32Array(n));
  const makeup = makeupOf(p);
  const attack = 1 - Math.exp(-1 / (SAMPLE_RATE * p.attack));
  const release = 1 - Math.exp(-1 / (SAMPLE_RATE * p.release));
  let reduction = 0;
  const ahead = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const c of channels) peak = Math.max(peak, Math.abs(c[i]!));
    ahead[i] = curveDb(p, dbOf(peak)) - dbOf(peak);
  }
  for (let i = 0; i < n; i++) {
    // The gain is read `delay` samples before the audio it is applied to: the look-ahead.
    let want = 0;
    for (let k = 0; k <= delay && i + k < n; k += 8) want = Math.min(want, ahead[i + k]!);
    reduction += (want - reduction) * (want < reduction ? attack : release);
    const gain = 10 ** (reduction / 20) * makeup;
    for (let c = 0; c < channels.length; c++) out[c]![i] = channels[c]![i]! * gain;
  }
  return out;
}

export type Render = { left: Float32Array; right: Float32Array; buses: Record<BusName, Float32Array>; wet: Float32Array[]; preCeilingPeak: number; duck: Float64Array };

/** The whole mix of `stems` and the hits' ducks: buses, the shared reverb, glue, trim, limiter, ceiling. */
export function mixDown(stems: Stems, hits: readonly TimedHit[], levels: MixLevels): Render {
  const n = stems.hits.length;
  const { duck } = admitHits(hits, n / SAMPLE_RATE, levels.hitVoices);
  const buses = busGains(stems, duck, levels);
  const dry = new Float32Array(n);
  for (const name of BUS_NAMES) for (let i = 0; i < n; i++) dry[i] = dry[i]! + buses[name][i]!;
  const sendOf = new Float32Array(n);
  for (let i = 0; i < n; i++) sendOf[i] = buses.hits[i]! * SEND.hits + buses.ambient[i]! * SEND.ambient + buses.ui[i]! * SEND.ui;
  const [irL, irR] = reverbImpulse(SAMPLE_RATE, REVERB.seconds, REVERB.seed);
  const wet = [convolve(sendOf, irL), convolve(sendOf, irR)];
  const channels = wet.map((w) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dry[i]! + w[i]! * REVERB.wet;
    return out;
  });
  const glued = compress(channels, MASTER_GLUE).map((c) => c.map((v) => v * GLUE_TRIM));
  const limited = compress(glued, MASTER_LIMITER);
  const curve = ceilingCurve(4097);
  const shape = (x: number): number => {
    const p = ((Math.max(-1, Math.min(1, x)) + 1) / 2) * (curve.length - 1);
    const i = Math.min(curve.length - 2, Math.floor(p));
    return curve[i]! + (curve[i + 1]! - curve[i]!) * (p - i);
  };
  let preCeilingPeak = 0;
  for (const c of limited) for (let i = 0; i < n; i++) preCeilingPeak = Math.max(preCeilingPeak, Math.abs(c[i]!));
  const [left, right] = limited.map((c) => c.map(shape));
  return { left: left!, right: right!, buses, wet, preCeilingPeak, duck };
}

/** Peak and RMS (dBFS) of `x` over samples [from, to). */
export function level(x: Float32Array, from = 0, to = x.length): { peakDb: number; rmsDb: number } {
  let peak = 0;
  let sum = 0;
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, Math.abs(x[i]!));
    sum += x[i]! * x[i]!;
  }
  return { peakDb: dbOf(peak), rmsDb: dbOf(Math.sqrt(sum / Math.max(1, to - from))) };
}

/** 16-bit PCM WAV of `channels` at `SAMPLE_RATE`, to `path`. */
export function writeWav(path: string, channels: readonly Float32Array[]): void {
  const frames = channels[0]!.length;
  const data = Buffer.alloc(44 + frames * channels.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + frames * channels.length * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(channels.length, 22);
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * channels.length * 2, 28);
  data.writeUInt16LE(channels.length * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * channels.length * 2, 40);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const c of channels) {
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i]!)) * 32767), at);
      at += 2;
    }
  }
  writeFileSync(path, data);
}

/** A seeded white-noise sample stream in -1..1. */
export function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/** `x` through a band-pass biquad at `hz`, `q` (the Web Audio band-pass: constant 0 dB peak gain). */
export function bandpass(x: Float32Array, hz: number, q: number): Float32Array {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i]! + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Adds `burst` into `stem` from second `t`. */
export function mixAt(stem: Float32Array, t: number, burst: Float32Array, gain = 1): void {
  const from = Math.round(t * SAMPLE_RATE);
  for (let i = 0; i < burst.length && from + i < stem.length; i++) stem[from + i] = stem[from + i]! + burst[i]! * gain;
}

/**
 * A stand-in for the hit voices (the real ones are `HitSound`'s): a sine thump falling 65 to 28 Hz under a dark noise burst, shaped by the impulse as the game's old single crash sound was:
 * the thump up to 0.7, the noise up to 0.45. It lets the mix be judged before `HitSound` lands.
 */
export function standInHit(impulse: number): Float32Array {
  const thumpS = 0.35 + Math.min(0.4, impulse * 0.01);
  const noiseS = 0.5;
  const out = new Float32Array(Math.round(Math.max(thumpS, noiseS) * SAMPLE_RATE));
  const thumpGain = Math.min(0.7, 0.22 + impulse * 0.012);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if (t >= thumpS) break;
    phase += (2 * Math.PI * 65 * Math.pow(28 / 65, t / thumpS)) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * thumpGain * Math.pow(0.001 / thumpGain, t / thumpS);
  }
  const rand = noise(1234);
  const raw = new Float32Array(Math.round(noiseS * SAMPLE_RATE));
  for (let i = 0; i < raw.length; i++) raw[i] = rand() * (1 - i / raw.length);
  const band = bandpass(raw, 300, 0.8);
  const noiseGain = Math.min(0.45, 0.12 + impulse * 0.008);
  for (let i = 0; i < band.length; i++) {
    const t = i / SAMPLE_RATE;
    const attack = Math.min(1, t / 0.012);
    out[i] = out[i]! + band[i]! * noiseGain * attack * Math.pow(0.001 / noiseGain, t / noiseS);
  }
  return out;
}
