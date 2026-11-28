export type SoundMat = "steel" | "glass" | "plastic" | "rubber" | "concrete" | "asphalt" | "gravel" | "sand" | "dirt" | "mud" | "grass" | "wood" | "hay" | "foliage" | "stone" | "water";

export const SOUND_MATS: readonly SoundMat[] = ["steel", "glass", "plastic", "rubber", "concrete", "asphalt", "gravel", "sand", "dirt", "mud", "grass", "wood", "hay", "foliage", "stone", "water"];

export const MAT_INDEX: Record<SoundMat, number> = Object.fromEntries(SOUND_MATS.map((mat, at) => [mat, at])) as Record<SoundMat, number>;

/** The sample rate banks are rendered at: sharp hits keep their energy under 10 kHz, and half the rate is half the memory. */
export const BANK_RATE = 22050;
export const HIT_VARIATIONS = 3;
export type HitSize = 0 | 1 | 2;
export const HIT_SIZE_LIST: readonly HitSize[] = [0, 1, 2];

const SIZE_SECONDS = [0.12, 0.32, 0.85] as const;
/** Closing speeds (m/s) where a tick becomes a hit and a hit a crash. */
export const TICK_MAX = 2.5;
export const HIT_MAX = 9;
/** Below this closing speed (m/s) nothing is heard. */
export const MIN_IMPULSE = 0.35;
const FULL_IMPULSE = 25;
const PEAK_AT_FULL = 0.9;
const LOUDNESS_EXPONENT = 0.6;
const REFERENCE_DISTANCE = 12;
const DISTANCE_EXPONENT = 1.3;
const CLEAR_CUTOFF_HZ = 20000;
const FAR_CUTOFF_FALL_M = 60;
const FAR_CUTOFF_FLOOR_HZ = 700;

export function hitSize(impulse: number): HitSize {
  return impulse < TICK_MAX ? 0 : impulse < HIT_MAX ? 1 : 2;
}

/** Peak level (0-1) of a hit at `impulse`; rises with it everywhere, so a bigger hit is never quieter. */
export function hitGain(impulse: number): number {
  const level = PEAK_AT_FULL * Math.pow(impulse / FULL_IMPULSE, LOUDNESS_EXPONENT);
  return level > PEAK_AT_FULL ? PEAK_AT_FULL : level;
}

/** Gain left of a sound heard from `distance` m. */
export function distanceGain(distance: number): number {
  return 1 / (1 + Math.pow(distance / REFERENCE_DISTANCE, DISTANCE_EXPONENT));
}

/** Lowpass cutoff (Hz) of a sound heard from `distance` m: air takes the top first. */
export function distanceCutoff(distance: number): number {
  const hz = CLEAR_CUTOFF_HZ * Math.exp(-distance / FAR_CUTOFF_FALL_M);
  return hz < FAR_CUTOFF_FLOOR_HZ ? FAR_CUTOFF_FLOOR_HZ : hz;
}

export function hitSamples(size: HitSize, rate: number): number {
  return Math.round(SIZE_SECONDS[size] * rate);
}

/** Two words mixed into one unsigned 32-bit hash. */
export function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return h >>> 0;
}

/** xorshift32: the same sequence in every browser and in node. */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.state;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x;
    return x / 4294967296;
  }
  /** Log-uniform between `lo` and `hi`. */
  log(lo: number, hi: number): number {
    return lo * Math.pow(hi / lo, this.next());
  }
}

type Mode = readonly [hz: number, amp: number, tau: number];
type DebrisKind = "grit" | "ping" | "tinkle" | "rustle" | "splash" | "bubble";
interface Debris {
  kind: DebrisKind;
  level: number;
  lo: number;
  hi: number;
  /** Seconds over which the grain rate has fallen to a third. */
  tau: number;
  /** Grains a second at the start (a crash's). */
  rate: number;
  /** Shortest and longest ring (s) of one grain. */
  ping: readonly [number, number];
  /** Share of a rustle's amplitude that flutters. */
  rough: number;
}
interface Spec {
  /** 0 soft to 1 hard: how bright and sharp the contact is. */
  hard: number;
  /** Body note (Hz). */
  body: number;
  /** 0 ringing to 1 dead: how fast the body note dies. */
  damp: number;
  crack: readonly [number, number];
  ring: number;
  modes: readonly Mode[];
  debris: Debris | null;
}

const grit = (level: number, lo: number, hi: number, tau: number, rate: number, ping: readonly [number, number]): Debris => ({ kind: "grit", level, lo, hi, tau, rate, ping, rough: 0 });
const rustle = (level: number, lo: number, hi: number, tau: number, rough: number): Debris => ({ kind: "rustle", level, lo, hi, tau, rate: 0, ping: [0, 0], rough });

/** Engineering guesses, tuned against measured centroids and decays of the renders, not published constants. */
const SPEC: Record<SoundMat, Spec> = {
  steel: { hard: 1, body: 120, damp: 0.3, crack: [2500, 9500], ring: 1, modes: [[410, 0.55, 0.22], [690, 0.45, 0.18], [1210, 0.6, 0.14], [1830, 0.75, 0.1], [2890, 0.8, 0.08], [4400, 0.7, 0.05], [6700, 0.5, 0.03]], debris: { kind: "ping", level: 0.3, lo: 1500, hi: 7000, tau: 0.35, rate: 35, ping: [0.02, 0.08], rough: 0 } },
  glass: { hard: 0.95, body: 240, damp: 0.6, crack: [4000, 10500], ring: 0.95, modes: [[1850, 1, 0.1], [2750, 0.8, 0.08], [4100, 0.6, 0.06], [5900, 0.4, 0.045], [8300, 0.25, 0.03]], debris: { kind: "tinkle", level: 0.45, lo: 3000, hi: 10000, tau: 0.4, rate: 120, ping: [0.012, 0.05], rough: 0 } },
  plastic: { hard: 0.6, body: 180, damp: 0.7, crack: [1800, 6000], ring: 0.55, modes: [[720, 1, 0.05], [1480, 0.6, 0.035], [2400, 0.4, 0.02]], debris: null },
  rubber: { hard: 0.22, body: 85, damp: 0.9, crack: [400, 1800], ring: 0.08, modes: [[420, 1, 0.04]], debris: null },
  concrete: { hard: 0.7, body: 95, damp: 0.75, crack: [1200, 4500], ring: 0.35, modes: [[520, 1, 0.05], [1100, 0.7, 0.03], [2000, 0.5, 0.02]], debris: grit(0.3, 800, 4000, 0.25, 90, [0.0008, 0.0025]) },
  asphalt: { hard: 0.55, body: 80, damp: 0.8, crack: [800, 4200], ring: 0.12, modes: [[520, 1, 0.04], [1100, 0.6, 0.025]], debris: grit(0.35, 1000, 4500, 0.3, 90, [0.0008, 0.003]) },
  gravel: { hard: 0.4, body: 100, damp: 0.85, crack: [1200, 5000], ring: 0, modes: [], debris: grit(0.6, 1200, 5500, 0.4, 220, [0.0006, 0.002]) },
  sand: { hard: 0.15, body: 70, damp: 0.92, crack: [500, 2200], ring: 0, modes: [], debris: rustle(0.35, 400, 2200, 0.22, 0.4) },
  dirt: { hard: 0.35, body: 65, damp: 0.92, crack: [400, 2200], ring: 0, modes: [], debris: grit(0.45, 600, 3600, 0.22, 80, [0.001, 0.004]) },
  mud: { hard: 0.1, body: 55, damp: 0.96, crack: [200, 900], ring: 0, modes: [], debris: { kind: "bubble", level: 0.5, lo: 150, hi: 600, tau: 0.25, rate: 40, ping: [0.02, 0.05], rough: 0 } },
  grass: { hard: 0.1, body: 60, damp: 0.95, crack: [400, 1800], ring: 0, modes: [], debris: rustle(0.3, 500, 2600, 0.15, 0.7) },
  wood: { hard: 0.6, body: 150, damp: 0.6, crack: [700, 3200], ring: 0.85, modes: [[280, 1, 0.09], [640, 0.75, 0.06], [1150, 0.5, 0.04], [1900, 0.3, 0.03]], debris: grit(0.15, 2000, 5000, 0.15, 30, [0.002, 0.008]) },
  hay: { hard: 0.06, body: 50, damp: 0.97, crack: [200, 900], ring: 0, modes: [], debris: rustle(0.3, 200, 1200, 0.25, 0.9) },
  foliage: { hard: 0.05, body: 45, damp: 0.97, crack: [500, 2500], ring: 0, modes: [], debris: rustle(0.35, 600, 3200, 0.3, 0.6) },
  stone: { hard: 0.92, body: 110, damp: 0.65, crack: [2000, 8500], ring: 0.7, modes: [[900, 1, 0.12], [2100, 0.7, 0.08], [3700, 0.5, 0.05]], debris: grit(0.25, 2000, 7000, 0.2, 50, [0.001, 0.004]) },
  water: { hard: 0.02, body: 90, damp: 0.95, crack: [400, 2000], ring: 0, modes: [], debris: { kind: "splash", level: 0.5, lo: 500, hi: 3800, tau: 0.3, rate: 60, ping: [0.02, 0.04], rough: 0.5 } },
};

const SIZE_ENERGY = [0.35, 0.8, 1] as const;
const THUMP_PITCH = [1.5, 1.25, 1] as const;
const THUMP_TAU = [0.5, 1, 1.7] as const;
const CRACK_LEVEL = [1, 0.7, 0.5] as const;
const CRACK_TAU = [0.0025, 0.004, 0.006] as const;
const RING_LEVEL = [0.7, 1, 1] as const;
const RING_TAU = [0.6, 1, 1.5] as const;
const RING_PITCH = [1.08, 1, 0.9] as const;
const DEBRIS_LEVEL = [0.25, 0.7, 1] as const;
const DEBRIS_RATE = [0.3, 0.8, 1.2] as const;
const RING_AMP = 0.16;
const THUMP_AMP = 0.5;
const CRACK_AMP = 0.6;
const CRUNCH_AMP = 0.3;
const MAX_GRAINS = 400;
/** A grain stops being drawn once its ring has fallen this far below its start (-80 dB). */
const RING_FLOOR = 1e-4;

function onePole(hz: number, rate: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / rate);
}

/** Damped sine bursts at `hz` from sample `at`: r^n sin(wn) by recurrence, the same decay everywhere. */
function ringAt(out: Float32Array, rate: number, at: number, hz: number, amp: number, tau: number): void {
  if (hz >= rate * 0.45 || at >= out.length) return;
  const decay = Math.exp(-1 / (tau * rate));
  const w = (2 * Math.PI * hz) / rate;
  const c = 2 * decay * Math.cos(w);
  const d2 = decay * decay;
  let y2 = 0;
  let y1 = amp * decay * Math.sin(w);
  const end = Math.min(out.length, at + Math.ceil(tau * rate * -Math.log(RING_FLOOR)));
  if (at + 1 < out.length) out[at + 1]! += y1;
  for (let n = at + 2; n < end; n++) {
    const y = c * y1 - d2 * y2;
    out[n]! += y;
    y2 = y1;
    y1 = y;
  }
}

function noiseBand(out: Float32Array, rate: number, t0: number, dur: number, lo: number, hi: number, amp: number, tau: number, rng: Rng, rough: number): void {
  const at = Math.floor(t0 * rate);
  const n = Math.min(out.length - at, Math.floor(dur * rate));
  const high = onePole(hi, rate);
  const low = onePole(lo, rate);
  const flutter = onePole(70, rate);
  const scale = Math.min(12, Math.sqrt(((rate / 2) * 3) / Math.max(50, hi - lo)));
  const decay = Math.exp(-1 / (tau * rate));
  let a = 0;
  let b = 0;
  let base = 0;
  let wobble = 0;
  let env = amp * scale;
  for (let i = 0; i < n; i++) {
    a += high * (rng.next() * 2 - 1 - a);
    b += high * (a - b);
    base += low * (b - base);
    wobble += flutter * (rng.next() * 2 - 1 - wobble);
    const mod = rough > 0 ? 1 - rough + rough * Math.min(1, Math.abs(wobble) * 6) : 1;
    out[at + i]! += (b - base) * env * mod;
    env *= decay;
  }
}

function thump(out: Float32Array, rate: number, t0: number, from: number, to: number, glide: number, tau: number, amp: number): void {
  const at = Math.floor(t0 * rate);
  const n = Math.min(out.length - at, Math.ceil(tau * rate * 7));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (2 * Math.PI * (to + (from - to) * Math.exp(-t / glide))) / rate;
    const attack = i < 12 ? i / 12 : 1;
    out[at + i]! += Math.sin(phase) * amp * attack * Math.exp(-t / tau);
  }
}

function chirp(out: Float32Array, rate: number, t0: number, from: number, to: number, dur: number, amp: number): void {
  const at = Math.floor(t0 * rate);
  const n = Math.min(out.length - at, Math.floor(dur * rate));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (2 * Math.PI * (from + (to - from) * u)) / rate;
    out[at + i]! += Math.sin(phase) * amp * Math.sin(Math.PI * u) * (1 - u);
  }
}

function crumple(out: Float32Array, rate: number, rng: Rng, count: number, amp: number): void {
  for (let k = 0; k < count; k++) noiseBand(out, rate, 0.01 + rng.next() * 0.15, 0.04, 600, 4000, amp * (0.4 + 0.6 * rng.next()), 0.012, rng, 0);
}

function grains(out: Float32Array, rate: number, debris: Debris, size: HitSize, rng: Rng): void {
  const seconds = Math.min(out.length / rate, debris.tau * 4);
  const perSecond = debris.rate * DEBRIS_RATE[size];
  const amp = debris.level * DEBRIS_LEVEL[size] * RING_AMP * 2;
  let t = 0;
  for (let count = 0; count < MAX_GRAINS; count++) {
    const lambda = perSecond * Math.exp(-t / debris.tau);
    if (lambda < 1) return;
    t += -Math.log(1 - rng.next()) / lambda;
    if (t >= seconds) return;
    const level = amp * (0.3 + 0.7 * rng.next() * rng.next());
    const at = Math.floor(t * rate);
    if (debris.kind === "bubble") chirp(out, rate, t, rng.log(debris.lo, debris.hi), rng.log(debris.lo, debris.hi) * 2.5, rng.log(debris.ping[0], debris.ping[1]), level * 1.5);
    else ringAt(out, rate, at, rng.log(debris.lo, debris.hi), level, rng.log(debris.ping[0], debris.ping[1]));
  }
}

function debrisLayer(out: Float32Array, rate: number, debris: Debris, size: HitSize, rng: Rng): void {
  const level = debris.level * DEBRIS_LEVEL[size];
  if (debris.kind === "rustle" || debris.kind === "splash") {
    noiseBand(out, rate, 0.004, debris.tau * 4, debris.lo, debris.hi, level * 0.45, debris.tau, rng, debris.rough);
    if (debris.kind === "splash") grains(out, rate, { ...debris, kind: "bubble", lo: 300, hi: 1200 }, size, rng);
    return;
  }
  grains(out, rate, debris, size, rng);
}

function ringLayer(out: Float32Array, rate: number, spec: Spec, partnerHard: number, size: HitSize, rng: Rng): void {
  const level = RING_AMP * spec.ring * (0.3 + 0.7 * partnerHard) * RING_LEVEL[size];
  const stretch = (0.55 + 0.45 * partnerHard) * RING_TAU[size];
  for (let k = 0; k < spec.modes.length; k++) {
    const [hz, amp, tau] = spec.modes[k]!;
    ringAt(out, rate, 0, hz * RING_PITCH[size] * (1 + (rng.next() - 0.5) * 0.05), level * amp, tau * stretch);
  }
}

function finish(out: Float32Array, rate: number): void {
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const fade = Math.max(Math.floor(0.012 * rate), Math.floor(out.length * 0.1));
  const gain = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < out.length; i++) {
    const left = out.length - i;
    out[i]! *= gain * (left < fade ? Math.sin((Math.PI / 2) * (left / fade)) : 1);
  }
}

/** Renders one hit of `a` on `b` into `out` (zeroed, `hitSamples(size, rate)` long), peak 1: crack, body thump, ring, then debris; glass adds a shatter. */
export function renderHit(a: SoundMat, b: SoundMat, size: HitSize, variation: number, rate: number, out: Float32Array): void {
  const first = SPEC[a];
  const second = SPEC[b];
  const rng = new Rng(hash32(hash32(MAT_INDEX[a] * 16 + MAT_INDEX[b], size * 8 + variation), 0x5eed1));
  out.fill(0);
  const hard = Math.sqrt(first.hard * second.hard);
  const damp = Math.max(first.damp, second.damp);
  const body = Math.sqrt(first.body * second.body) * THUMP_PITCH[size] * (0.92 + 0.16 * rng.next());
  const thumpTau = (0.09 - 0.068 * damp) * THUMP_TAU[size];
  thump(out, rate, 0, body * 1.7, body, 0.025, thumpTau, THUMP_AMP * (0.5 + 0.5 * (1 - hard)) * SIZE_ENERGY[size] * 2);
  if (size === 2) thump(out, rate, 0.012, body * 1.05, body * 0.7, 0.05, 0.15 * (1 - 0.5 * damp), THUMP_AMP);
  const sharper = first.hard >= second.hard ? first : second;
  if (hard > 0.05) noiseBand(out, rate, 0, 0.03, sharper.crack[0], sharper.crack[1] * (0.5 + 0.5 * hard), CRACK_AMP * Math.pow(hard, 1.3) * CRACK_LEVEL[size], CRACK_TAU[size], rng, 0);
  if (size > 0) {
    noiseBand(out, rate, 0, 0.15, 250, 2000, CRUNCH_AMP * (0.3 + 0.7 * hard) * (size === 2 ? 1 : 0.4), 0.07, rng, 0);
    if (hard > 0.4) crumple(out, rate, rng, size === 2 ? 5 : 2, CRUNCH_AMP * hard);
  }
  ringLayer(out, rate, first, second.hard, size, rng);
  ringLayer(out, rate, second, first.hard, size, rng);
  if (first.debris !== null) debrisLayer(out, rate, first.debris, size, rng);
  if (second.debris !== null) debrisLayer(out, rate, second.debris, size, rng);
  if ((a === "glass" || b === "glass") && size > 0) noiseBand(out, rate, 0.002, 0.12, 3000, 10000, 0.5 * (size === 2 ? 1 : 0.6), 0.04, rng, 0.4);
  finish(out, rate);
}

type ScrapeKind = number;
export const SCRAPE_KINDS = 7;
const KIND_SLIP = 0;
const KIND_GRIND = 1;
const KIND_RUMBLE = 2;
const KIND_SKID = 3;
const KIND_GLASS = 4;
const KIND_RUSTLE = 5;
const KIND_CREAK = 6;

const LOOSE: Partial<Record<SoundMat, true>> = { gravel: true, sand: true, dirt: true, mud: true };
const VEGETATION: Partial<Record<SoundMat, true>> = { hay: true, foliage: true, grass: true, water: true };

/** Which loop two sliding materials grind with. */
export function scrapeKind(a: SoundMat, b: SoundMat): ScrapeKind {
  if (a === "glass" || b === "glass") return KIND_GLASS;
  if (VEGETATION[a] === true || VEGETATION[b] === true) return KIND_RUSTLE;
  if (a === "wood" || b === "wood") return KIND_CREAK;
  if (a === "rubber" || b === "rubber") return LOOSE[a] === true || LOOSE[b] === true ? KIND_RUMBLE : KIND_SKID;
  return LOOSE[a] === true || LOOSE[b] === true ? KIND_GRIND : KIND_SLIP;
}

interface ScrapeSpec {
  bed: readonly [lo: number, hi: number, level: number];
  rumble: number;
  stick: { count: number; lo: number; hi: number; tau: number; level: number };
  grit: { rate: number; lo: number; hi: number; level: number };
  /** Cutoff (Hz) at full speed, and the gain at full speed and force. */
  cutoff: number;
  gain: number;
}

const SCRAPE: Record<number, ScrapeSpec> = {
  [KIND_SLIP]: { bed: [900, 5500, 0.05], rumble: 0, stick: { count: 26, lo: 1200, hi: 3200, tau: 0.015, level: 1 }, grit: { rate: 0, lo: 0, hi: 0, level: 0 }, cutoff: 9000, gain: 0.5 },
  [KIND_GRIND]: { bed: [600, 4500, 0.16], rumble: 0.1, stick: { count: 0, lo: 0, hi: 0, tau: 0, level: 0 }, grit: { rate: 320, lo: 1200, hi: 5000, level: 0.4 }, cutoff: 6000, gain: 0.5 },
  [KIND_RUMBLE]: { bed: [300, 1600, 0.1], rumble: 0.5, stick: { count: 0, lo: 0, hi: 0, tau: 0, level: 0 }, grit: { rate: 260, lo: 800, hi: 3500, level: 0.25 }, cutoff: 2500, gain: 0.55 },
  [KIND_SKID]: { bed: [1500, 5500, 0.14], rumble: 0.08, stick: { count: 14, lo: 700, hi: 1500, tau: 0.03, level: 0.25 }, grit: { rate: 0, lo: 0, hi: 0, level: 0 }, cutoff: 6000, gain: 0.35 },
  [KIND_GLASS]: { bed: [3000, 9500, 0.12], rumble: 0, stick: { count: 30, lo: 3500, hi: 8000, tau: 0.008, level: 0.35 }, grit: { rate: 160, lo: 4000, hi: 9500, level: 0.3 }, cutoff: 11000, gain: 0.3 },
  [KIND_RUSTLE]: { bed: [600, 4500, 0.2], rumble: 0, stick: { count: 0, lo: 0, hi: 0, tau: 0, level: 0 }, grit: { rate: 140, lo: 1500, hi: 4500, level: 0.15 }, cutoff: 4500, gain: 0.35 },
  [KIND_CREAK]: { bed: [500, 3000, 0.1], rumble: 0.05, stick: { count: 10, lo: 300, hi: 1200, tau: 0.03, level: 0.4 }, grit: { rate: 40, lo: 1500, hi: 4000, level: 0.1 }, cutoff: 4000, gain: 0.35 },
};

export function scrapeCutoff(kind: ScrapeKind): number {
  return SCRAPE[kind]!.cutoff;
}

export function scrapeGain(kind: ScrapeKind): number {
  return SCRAPE[kind]!.gain;
}

const SCRAPE_SECONDS = 1;
export const SCRAPE_VARIATIONS = 2;

export function scrapeSamples(rate: number): number {
  return Math.round(SCRAPE_SECONDS * rate);
}

/** Wraps a ringing event past the loop's end back to its start, so the loop has no seam. */
function loopRing(out: Float32Array, rate: number, at: number, hz: number, amp: number, tau: number, scratch: Float32Array): void {
  scratch.fill(0);
  ringAt(scratch, rate, at, hz, amp, tau);
  for (let i = 0; i < scratch.length; i++) out[i]! += scratch[i]!;
  for (let i = out.length; i < scratch.length; i++) out[i - out.length]! += scratch[i]!;
}

/** Renders one seamless second of a sliding sound into `out` (`scrapeSamples` long), peak 1: a noise bed, a low rumble, stick-slip bursts and grit. */
export function renderScrapeLoop(kind: ScrapeKind, variation: number, rate: number, out: Float32Array): void {
  const spec = SCRAPE[kind]!;
  const rng = new Rng(hash32(0x5c4a9e + kind, variation + 1));
  const n = out.length;
  const pass = new Float32Array(n * 2);
  noiseBand(pass, rate, 0, 2 * SCRAPE_SECONDS, spec.bed[0], spec.bed[1], spec.bed[2], 1e9, rng, 0.5);
  if (spec.rumble > 0) noiseBand(pass, rate, 0, 2 * SCRAPE_SECONDS, 50, 320, spec.rumble, 1e9, rng, 0.8);
  for (let i = 0; i < n; i++) out[i] = pass[n + i]!;
  const tail = new Float32Array(n * 2);
  const { stick, grit: pits } = spec;
  for (let k = 0; k < stick.count; k++) {
    const at = Math.floor(((k + 0.3 * rng.next()) / stick.count) * n);
    loopRing(out, rate, at, rng.log(stick.lo, stick.hi), stick.level * (0.4 + 0.6 * rng.next()), stick.tau * (0.6 + 0.8 * rng.next()), tail);
  }
  const grains = Math.round(pits.rate * SCRAPE_SECONDS);
  for (let k = 0; k < grains; k++) loopRing(out, rate, Math.floor(rng.next() * n), rng.log(pits.lo, pits.hi), pits.level * (0.3 + 0.7 * rng.next() * rng.next()), rng.log(0.0008, 0.003), tail);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const gain = peak > 0 ? 1 / peak : 0;
  for (let i = 0; i < n; i++) out[i]! *= gain;
}

/** The sides a recorded hit always has: a car's steel or glass, a tyre's rubber. Every pair with one of them has its own bank; other pairs borrow. */
const BODY_SIDES: Partial<Record<SoundMat, true>> = { steel: true, rubber: true, glass: true };

/** The bank pair that sounds for `a` on `b`: itself when a car's side is in it, else a rubber thump with the harder of the two. */
export function bankKey(a: SoundMat, b: SoundMat): readonly [SoundMat, SoundMat] {
  if (BODY_SIDES[a] === true || BODY_SIDES[b] === true) return MAT_INDEX[a] <= MAT_INDEX[b] ? [a, b] : [b, a];
  return bankKey("rubber", SPEC[a].hard >= SPEC[b].hard ? a : b);
}

