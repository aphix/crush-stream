import { mulberry32 } from "../world/placements.ts";
import { Biquad, filtered, scaledToPeak, withReverb } from "./ambient-dsp.ts";

/** The ambient bed's sparse one-shots, each rendered once: far horns, sirens, dogs, birds and a PA voice. */
export const EMITTERS = ["horn", "siren", "dog", "bird", "pa"] as const;
type Emitter = (typeof EMITTERS)[number];

/** Sample rate (Hz) of every one-shot. */
export const SHOT_RATE = 22050;
/** Variants rendered of each kind: the scheduler picks one, so a repeat is a different sound. */
export const SHOT_VARIANTS = 3;
/** A one-shot's peak before the bed scales it. */
const SHOT_PEAK = 0.5;

type Rng = () => number;

/** The note's amplitude at `t` s: a linear attack and release around a flat body. */
function gate(t: number, length: number, attack: number, release: number): number {
  return Math.min(1, t / attack, (length - t) / release);
}

/** A harmonic stack (partials 1..count at 1/k) at `hz`, added to `out` from `start` s for `length` s. */
function addReed(out: Float32Array, start: number, length: number, hz: number, count: number, amp: number): void {
  const first = Math.round(start * SHOT_RATE);
  const last = Math.min(out.length, first + Math.round(length * SHOT_RATE));
  for (let i = first; i < last; i++) {
    const t = (i - first) / SHOT_RATE;
    let s = 0;
    for (let k = 1; k <= count; k++) s += Math.sin(2 * Math.PI * hz * k * t) / k;
    out[i] = out[i]! + amp * s * Math.max(0, gate(t, length, 0.012, 0.03));
  }
}

function horn(variant: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.round(2 * SHOT_RATE));
  const base = 380 + rng() * 120;
  const notes = [[[0, 0.55]], [[0, 0.18], [0.3, 0.32]], [[0, 0.12], [0.2, 0.12], [0.4, 0.4]]][variant % 3]!;
  for (const [start, length] of notes) {
    addReed(out, start!, length!, base, 7, 0.5);
    addReed(out, start!, length!, base * 1.26, 7, 0.4);
  }
  return withReverb(filtered(out, Biquad.low(2200, SHOT_RATE)), SHOT_RATE, 1.2, 0.5);
}

function siren(variant: number, rng: Rng): Float32Array {
  const seconds = 7;
  const out = new Float32Array(seconds * SHOT_RATE);
  const period = [3.2, 4.4, 0.55][variant % 3]!;
  const low = 620 + rng() * 80;
  const span = variant % 3 === 2 ? 700 : 500;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SHOT_RATE;
    phase += (low + span * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period))) / SHOT_RATE;
    const approach = Math.sin((Math.PI * t) / seconds) ** 1.4;
    out[i] = approach * Math.tanh(2.5 * Math.sin(2 * Math.PI * phase));
  }
  return withReverb(filtered(out, Biquad.low(3000, SHOT_RATE)), SHOT_RATE, 1.5, 0.4);
}

function dog(variant: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.round(2.4 * SHOT_RATE));
  const mouth = [Biquad.band(850, 2.5, SHOT_RATE), Biquad.band(1700, 3, SHOT_RATE)];
  for (let bark = 0; bark < 2 + variant; bark++) {
    const start = Math.round((bark * 0.38 + rng() * 0.05) * SHOT_RATE);
    const pitch = 480 + rng() * 120;
    let phase = 0;
    for (let i = 0; i < 0.22 * SHOT_RATE; i++) {
      const t = i / SHOT_RATE;
      phase = (phase + (pitch * (1 - 1.1 * t)) / SHOT_RATE) % 1;
      const source = 2 * phase - 1 + 0.4 * (rng() * 2 - 1);
      out[start + i] = out[start + i]! + Math.min(1, t / 0.006) * Math.exp(-t / 0.08) * (mouth[0]!.tick(source) + 0.5 * mouth[1]!.tick(source));
    }
  }
  return withReverb(filtered(out, Biquad.low(3000, SHOT_RATE)), SHOT_RATE, 1, 0.5);
}

function bird(variant: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.round(2.4 * SHOT_RATE));
  let at = 0.05;
  for (let chirp = 0; chirp < 3 + 2 * variant; chirp++) {
    const length = 0.07 + rng() * 0.05;
    const from = 2800 + rng() * 1800;
    const to = from * (rng() < 0.5 ? 0.7 : 1.35);
    const trill = 30 + rng() * 40;
    let phase = 0;
    for (let i = 0; i < length * SHOT_RATE; i++) {
      const t = i / length / SHOT_RATE;
      phase += (from + (to - from) * t) / SHOT_RATE;
      const shape = Math.sin(Math.PI * t) ** 2;
      out[Math.round(at * SHOT_RATE) + i] = shape * Math.sin(2 * Math.PI * phase + 2 * Math.sin(2 * Math.PI * trill * t * length));
    }
    at += length + 0.05 + rng() * 0.08;
  }
  return withReverb(filtered(out, Biquad.low(7000, SHOT_RATE)), SHOT_RATE, 0.5, 0.3);
}

/** A mumbled announcement: a monotone buzz through a fresh vowel each syllable, band-limited and clipped like a PA horn, then slapped back off the stands. */
function pa(variant: number, rng: Rng): Float32Array {
  const out = new Float32Array(Math.round(3.6 * SHOT_RATE));
  const pitch = 105 + variant * 14;
  let at = 0.1;
  let phase = 0;
  while (at < 3.2) {
    const length = 0.16 + rng() * 0.14;
    const mouth = [Biquad.band(320 + rng() * 480, 5, SHOT_RATE), Biquad.band(900 + rng() * 1300, 6, SHOT_RATE)];
    for (let i = 0; i < length * SHOT_RATE; i++) {
      phase = (phase + (pitch * (1 + 0.06 * Math.sin(at * 2 + variant))) / SHOT_RATE) % 1;
      const source = 2 * phase - 1;
      const t = i / SHOT_RATE;
      out[Math.round(at * SHOT_RATE) + i] = Math.min(1, t / 0.02, (length - t) / 0.03) * (mouth[0]!.tick(source) + 0.6 * mouth[1]!.tick(source));
    }
    at += length + 0.03 + rng() * 0.05;
  }
  const horn = filtered(out, Biquad.high(380, SHOT_RATE), Biquad.low(3400, SHOT_RATE));
  for (let i = 0; i < horn.length; i++) horn[i] = Math.tanh(2 * horn[i]!);
  return withReverb(horn, SHOT_RATE, 1.8, 0.55);
}

const RENDER: Record<Emitter, (variant: number, rng: Rng) => Float32Array> = { horn, siren, dog, bird, pa };

const shots = new Map<string, Float32Array>();

/** One variant of one emitter, mono at `SHOT_RATE`, peaking at `SHOT_PEAK`; rendered on first use and kept. */
export function shotOf(kind: Emitter, variant: number): Float32Array {
  const key = `${kind}:${variant}`;
  let shot = shots.get(key);
  if (shot === undefined) {
    shot = scaledToPeak(RENDER[kind](variant, mulberry32(EMITTERS.indexOf(kind) * 31 + variant * 7 + 5)), SHOT_PEAK);
    shots.set(key, shot);
  }
  return shot;
}
