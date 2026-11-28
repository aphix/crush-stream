import { Biquad, fadedOut, filtered, rngOf, scaledToPeak, whiteNoise, withReverb } from "./ambient-dsp.ts";

/** The UI sounds, each a short layered synthesis (FM bells, chirps, noise ticks, brass stabs) rendered once: sharp attacks and a dark hall tail, in the spirit of the MGS2 menu sounds. */
export type UiName = keyof typeof SOUND;

/** Sample rate (Hz) of every UI sound. */
export const UI_RATE = 44100;
/** The dry sound is faded to 0 over this many seconds before the reverb, so no bell is cut mid-decay into the tail. */
const DRY_FADE_S = 0.01;
/** A buffer's end is cut where it falls below this share of its peak. */
const TAIL_FLOOR = 0.003;
/** A bell's modulator decays this much faster than its carrier, so the bite fades before the ring. */
const BITE_DECAY = 0.4;

const NOTE = { e5: 659.3, a5: 880, b5: 987.8, cs6: 1108.7, g6: 1568, e6: 1318.5, a6: 1760, b6: 1975.5, c7: 2093, e7: 2637, g7: 3136 } as const;

/** An FM bell: a sine at `hz` phase-modulated by one at `hz * ratio`, the modulation index starting at `index` and dying faster than the ring. */
function bell(out: Float32Array, start: number, hz: number, ratio: number, index: number, decayS: number, amp: number): void {
  const first = Math.round(start * UI_RATE);
  for (let i = first; i < Math.min(out.length, first + Math.round(decayS * 6 * UI_RATE)); i++) {
    const t = (i - first) / UI_RATE;
    const bite = index * Math.exp(-t / (decayS * BITE_DECAY));
    out[i] = out[i]! + amp * Math.min(1, t / 0.0015) * Math.exp(-t / decayS) * Math.sin(2 * Math.PI * hz * t + bite * Math.sin(2 * Math.PI * hz * ratio * t));
  }
}

/** A sine sweeping `from` to `to` Hz over `length` s, quick attack, exponential decay. */
function chirp(out: Float32Array, start: number, from: number, to: number, length: number, amp: number): void {
  const first = Math.round(start * UI_RATE);
  let phase = 0;
  for (let i = 0; i < length * UI_RATE && first + i < out.length; i++) {
    const t = i / UI_RATE / length;
    phase += (from * Math.pow(to / from, t)) / UI_RATE;
    out[first + i] = out[first + i]! + amp * Math.min(1, i / (0.002 * UI_RATE)) * Math.exp(-4 * t) * Math.sin(2 * Math.PI * phase);
  }
}

/** A burst of noise between `low` and `high` Hz, decaying over `length` s. */
function hiss(out: Float32Array, start: number, low: number, high: number, length: number, amp: number, seed: number): void {
  const burst = filtered(whiteNoise(Math.round(length * UI_RATE), rngOf(seed)), Biquad.high(low, UI_RATE), Biquad.low(high, UI_RATE));
  const first = Math.round(start * UI_RATE);
  for (let i = 0; i < burst.length && first + i < out.length; i++) out[first + i] = out[first + i]! + amp * Math.exp((-5 * i) / burst.length) * burst[i]!;
}

/** A brass-like chord: detuned saws at each of `notes` Hz through a low-pass, swelling in over `attack` s and out over `release` s from `length`. */
function brass(out: Float32Array, start: number, notes: readonly number[], length: number, attack: number, release: number, lowHz: number, amp: number): void {
  const first = Math.round(start * UI_RATE);
  const wash = Biquad.low(lowHz, UI_RATE);
  for (let i = 0; i < (length + release) * UI_RATE && first + i < out.length; i++) {
    const t = i / UI_RATE;
    let s = 0;
    for (const hz of notes) s += 2 * ((t * hz) % 1) - 1 + 2 * ((t * hz * 1.004) % 1) - 1;
    const swell = Math.min(1, t / attack) * (t < length ? 1 : Math.max(0, 1 - (t - length) / release));
    out[first + i] = out[first + i]! + (amp * swell * wash.tick(s)) / notes.length;
  }
}

function finish(out: Float32Array): void {
  brass(out, 0, [220, 277.2, 329.6], 0.32, 0.06, 0.08, 1800, 0.5);
  brass(out, 0.36, [220, 277.2, 329.6, 440, 554.4], 0.9, 0.12, 0.7, 2400, 0.7);
  for (const [at, hz] of [[0.36, NOTE.e6], [0.44, NOTE.a6], [0.52, 2217]] as const) bell(out, at, hz, 2.76, 2, 0.5, 0.35);
  hiss(out, 0.36, 5000, 11000, 0.5, 0.18, 61);
}

function wrecked(out: Float32Array): void {
  chirp(out, 0, 150, 42, 0.4, 1);
  brass(out, 0, [110, 116.5, 164.8], 0.5, 0.02, 0.9, 900, 0.7);
  bell(out, 0.06, 880, 1.41, 3, 0.8, 0.3);
  bell(out, 0.06, 1046.5, 1.41, 3, 0.8, 0.22);
  hiss(out, 0, 300, 2500, 0.25, 0.5, 77);
}

const SOUND = {
  select: (o) => {
    bell(o, 0, 1760, 3.5, 2.5, 0.1, 0.8);
    hiss(o, 0, 4500, 7000, 0.02, 0.4, 1);
  },
  confirm: (o) => {
    bell(o, 0, NOTE.e6, 2.76, 3, 0.2, 0.7);
    bell(o, 0.07, NOTE.b6, 2.76, 3, 0.3, 0.8);
  },
  back: (o) => {
    chirp(o, 0, 1900, 950, 0.09, 0.6);
    bell(o, 0.03, 1174.7, 2.76, 2, 0.12, 0.5);
  },
  open: (o) => {
    for (const [at, hz] of [[0, 6300], [0.025, 8200], [0.05, 9800]] as const) bell(o, at, hz, 1.41, 1.5, 0.3, 0.55);
    hiss(o, 0, 6000, 11000, 0.4, 0.4, 3);
  },
  close: (o) => {
    for (const [at, hz] of [[0, 5200], [0.03, 3900], [0.06, 2600]] as const) bell(o, at, hz, 1.41, 1.5, 0.16, 0.6);
  },
  equip: (o) => {
    bell(o, 0, NOTE.e7, 2.76, 3, 0.06, 0.8);
    chirp(o, 0, 2000, 4200, 0.04, 0.5);
  },
  pickup: (o) => {
    for (const [at, hz] of [[0, NOTE.g6], [0.06, NOTE.c7], [0.12, NOTE.g7]] as const) bell(o, at, hz, 2.76, 2, 0.3, 0.6);
    bell(o, 0.12, 7040, 1.41, 1, 0.25, 0.8);
    hiss(o, 0.1, 7000, 11000, 0.3, 1, 4);
  },
  alert: (o) => {
    for (const [at, hz] of [[0, 1100], [0.12, 1480], [0.24, 1100]] as const) bell(o, at, hz, 1, 4, 0.07, 0.7);
  },
  countdown: (o) => {
    bell(o, 0, NOTE.e6, 2, 1.5, 0.1, 0.8);
    hiss(o, 0, 3000, 6000, 0.015, 0.3, 5);
  },
  go: (o) => {
    for (const hz of [NOTE.e6, NOTE.a6, NOTE.e7]) bell(o, 0, hz, 2.76, 2.5, 0.45, 0.6);
    hiss(o, 0, 6000, 11000, 0.35, 0.3, 6);
  },
  finish,
  wrecked,
} satisfies Record<string, (out: Float32Array) => void>;

/** Per-sound length (s) of the buffer before the reverb tail, the tail (s) and its wet share, and the peak. */
const SHAPE: Record<UiName, readonly [number, number, number, number]> = {
  select: [0.3, 0.2, 0.2, 0.45],
  confirm: [0.7, 0.3, 0.3, 0.5],
  back: [0.3, 0.2, 0.25, 0.45],
  open: [0.8, 0.5, 0.35, 0.45],
  close: [0.5, 0.3, 0.3, 0.45],
  equip: [0.25, 0.2, 0.25, 0.5],
  pickup: [0.7, 0.5, 0.35, 0.5],
  alert: [0.55, 0.2, 0.2, 0.55],
  countdown: [0.3, 0.2, 0.2, 0.5],
  go: [1, 0.6, 0.35, 0.6],
  finish: [2.2, 1.2, 0.4, 0.6],
  wrecked: [2.2, 1.4, 0.5, 0.6],
};

/** Every UI sound. */
export const UI_NAMES = Object.keys(SOUND) as UiName[];

/** The sound `name` before its reverb: faded to 0 at its end. */
function uiDry(name: UiName): Float32Array {
  const dry = new Float32Array(Math.round(SHAPE[name][0] * UI_RATE));
  SOUND[name](dry);
  return fadedOut(dry, UI_RATE, DRY_FADE_S);
}

/** The sound `name`, mono at `UI_RATE`, with its reverb tail (`reverb` false: the dry sound alone, faded to 0 at its end). Each call renders anew; the caller keeps the result. */
export function renderUi(name: UiName, reverb = true): Float32Array {
  if (!reverb) return uiDry(name);
  const [, tail, wet, peak] = SHAPE[name];
  const out = scaledToPeak(withReverb(uiDry(name), UI_RATE, tail, wet), peak);
  let end = out.length;
  while (end > 1 && Math.abs(out[end - 1]!) < TAIL_FLOOR * peak) end--;
  return out.slice(0, end);
}
