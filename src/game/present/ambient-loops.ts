import { Biquad, filtered, rngOf, scaledToRms, seamlessLoop, whiteNoise } from "./ambient-dsp.ts";

/** The ambient bed's looping layers, in the order `bedLevels` fills its output. */
export const LAYER = { rumble: 0, hum: 1, wind: 2, murmur: 3, roar: 4, cheer: 5, insects: 6 } as const;
export type Layer = keyof typeof LAYER;
export const LAYERS = Object.keys(LAYER) as Layer[];

/** Each layer's own sample rate (Hz): enough for each layer's band; the loops are rendered in a worker. */
export const LAYER_RATE: Record<Layer, number> = { rumble: 8000, hum: 8000, wind: 16000, murmur: 11025, roar: 11025, cheer: 11025, insects: 16000 };
/** Loop lengths (s) of a layer's left and right copies: unequal, so the pair repeats only every 26 x 31 s. */
const LOOP_SECONDS = [26, 31] as const;
/** Every loop is scaled to this RMS, so the layer gains in `bedLevels` are comparable. */
export const LOOP_RMS = 0.25;

type Rng = () => number;
type Crowd = { voices: number; noise: number; pitch: readonly [number, number]; mouth: readonly [number, number]; syllableHz: number; noiseBand: readonly [number, number] };

const CROWDS: Record<"murmur" | "roar" | "cheer", Crowd> = {
  murmur: { voices: 8, noise: 0.9, pitch: [95, 240], mouth: [550, 1800], syllableHz: 3.5, noiseBand: [350, 2200] },
  roar: { voices: 14, noise: 1.8, pitch: [90, 260], mouth: [600, 1900], syllableHz: 1.6, noiseBand: [300, 3200] },
  cheer: { voices: 12, noise: 0.6, pitch: [190, 340], mouth: [750, 1350], syllableHz: 0.7, noiseBand: [1500, 4500] },
};

function shaped(n: number, rng: Rng, gain: number, ...chain: Biquad[]): Float32Array {
  return scaledToRms(filtered(whiteNoise(n, rng), ...chain), gain);
}

function addInto(out: Float32Array, part: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = out[i]! + part[i]!;
  return out;
}

/** `x` times 1 plus slow swells whose cycle counts are whole numbers over the loop, so the modulation closes on itself. */
function swelled(x: Float32Array, seconds: number, rate: number, rng: Rng, depth: number, cycles: readonly [number, number]): Float32Array {
  const terms = 4;
  const count = new Float64Array(terms);
  const phase = new Float64Array(terms);
  for (let k = 0; k < terms; k++) {
    count[k] = Math.round(cycles[0] + rng() * (cycles[1] - cycles[0]));
    phase[k] = rng() * 2 * Math.PI;
  }
  for (let i = 0; i < x.length; i++) {
    let m = 0;
    for (let k = 0; k < terms; k++) m += Math.sin((2 * Math.PI * count[k]! * i) / x.length + phase[k]!);
    x[i] = x[i]! * Math.max(0.05, 1 + (depth * m) / Math.sqrt(terms));
  }
  return scaledToRms(x, LOOP_RMS);
}

function rumble(rate: number, seconds: number, rng: Rng): Float32Array {
  const loop = seamlessLoop((n) => addInto(shaped(n, rng, 1, Biquad.low(110, rate), Biquad.low(110, rate)), shaped(n, rng, 0.9, Biquad.high(70, rate), Biquad.low(420, rate))), rate, seconds);
  return swelled(loop, seconds, rate, rng, 0.35, [1, 9]);
}

/** Mains hum and a fan: tones on whole cycles of the loop, so they close without a fade. */
function hum(rate: number, seconds: number, rng: Rng): Float32Array {
  const length = Math.round(seconds * rate);
  const out = seamlessLoop((n) => shaped(n, rng, 0.3, Biquad.band(320, 2, rate)), rate, seconds);
  for (const [hz, amp] of [[60, 1], [120, 0.8], [180, 0.3], [240, 0.18]] as const) {
    const cycles = Math.round(hz * seconds);
    const phase = rng() * 2 * Math.PI;
    for (let i = 0; i < length; i++) out[i] = out[i]! + amp * 0.25 * Math.sin((2 * Math.PI * cycles * i) / length + phase);
  }
  return swelled(out, seconds, rate, rng, 0.06, [1, 4]);
}

/** Open wind with a faint whistle; its band is wide on purpose, the bed's low-pass closes it with speed. */
function wind(rate: number, seconds: number, rng: Rng): Float32Array {
  const loop = seamlessLoop((n) => addInto(shaped(n, rng, 1, Biquad.high(160, rate), Biquad.low(6500, rate)), shaped(n, rng, 0.12, Biquad.band(900, 12, rate))), rate, seconds);
  return swelled(loop, seconds, rate, rng, 0.5, [2, 14]);
}

function crowd(kind: keyof typeof CROWDS, rate: number, seconds: number, rng: Rng): Float32Array {
  const spec = CROWDS[kind];
  const loop = seamlessLoop((n) => {
    const out = shaped(n, rng, spec.noise * 0.15, Biquad.band((spec.noiseBand[0] * spec.noiseBand[1]) ** 0.5, 0.8, rate));
    for (let v = 0; v < spec.voices; v++) talkInto(out, rate, rng, spec);
    return out;
  }, rate, seconds);
  return swelled(loop, seconds, rate, rng, kind === "roar" ? 0.25 : 0.15, [1, 7]);
}

/** One voice added into `out`: a vibrato saw through two vowel formants, switched on and off by random syllables. */
function talkInto(out: Float32Array, rate: number, rng: Rng, spec: Crowd): void {
  const n = out.length;
  const f0 = spec.pitch[0] + rng() * (spec.pitch[1] - spec.pitch[0]);
  const f1 = Biquad.band(spec.mouth[0] * (0.8 + rng() * 0.4), 5, rate);
  const f2 = Biquad.band(spec.mouth[1] * (0.8 + rng() * 0.4), 6, rate);
  const vibratoHz = 4 + rng() * 3;
  const syllable = (spec.syllableHz * (0.6 + rng() * 0.8)) / rate;
  let phase = rng();
  let level = 0;
  let want = 0;
  for (let i = 0; i < n; i++) {
    if (rng() < syllable) want = rng() < 0.55 ? 0.4 + rng() * 0.6 : 0;
    level += (want - level) * ((spec.syllableHz * 6) / rate);
    phase = (phase + (f0 * (1 + 0.025 * Math.sin((2 * Math.PI * vibratoHz * i) / rate))) / rate) % 1;
    const glottal = 2 * phase - 1;
    out[i] = out[i]! + level * (f1.tick(glottal) + 0.7 * f2.tick(glottal));
  }
}

/** Crickets: pulsed chirp trains on tones whose cycles and chirp periods are whole over the loop. */
function insects(rate: number, seconds: number, rng: Rng): Float32Array {
  const length = Math.round(seconds * rate);
  const out = new Float32Array(length);
  for (let voice = 0; voice < 6; voice++) {
    const carrier = Math.round((3600 + rng() * 1400) * seconds);
    const chirps = Math.round(seconds * (1.6 + rng() * 1.2));
    const offset = rng() * 0.2;
    const amp = 0.4 + rng() * 0.6;
    const pulse = 0.011;
    const gap = 0.03;
    for (let i = 0; i < length; i++) {
      const inChirp = (((i / length) * chirps + offset) % 1) * (seconds / chirps);
      const k = inChirp % gap;
      if (inChirp > 4 * gap || k > pulse) continue;
      const shape = Math.sin((Math.PI * k) / pulse);
      out[i] = out[i]! + amp * shape * shape * Math.sin((2 * Math.PI * carrier * i) / length);
    }
  }
  return scaledToRms(out, LOOP_RMS);
}

const RENDER: Record<Layer, (rate: number, seconds: number, rng: Rng) => Float32Array> = {
  rumble,
  hum,
  wind,
  murmur: (rate, seconds, rng) => crowd("murmur", rate, seconds, rng),
  roar: (rate, seconds, rng) => crowd("roar", rate, seconds, rng),
  cheer: (rate, seconds, rng) => crowd("cheer", rate, seconds, rng),
  insects,
};

/** The loop of `layer` for one ear (0 left, 1 right): mono, seamless, `LOOP_RMS`, at `LAYER_RATE`. Each call renders anew; the caller keeps the result. */
export function renderLoop(layer: Layer, ear: 0 | 1): Float32Array {
  const rate = LAYER_RATE[layer];
  const seconds = LOOP_SECONDS[ear];
  return RENDER[layer](rate, seconds, rngOf(LAYER[layer] * 977 + ear * 131 + 17));
}
