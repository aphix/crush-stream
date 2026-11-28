import { distanceGain } from "./hit-synth.ts";

/** The loudest the music slider goes, whatever the share link says (the bus sits a further `MUSIC_TRIM` under it). Engines must stay audible above it. */
export const MUSIC_MAX_GAIN = 0.6;
/** How far the player's engine at full load pulls the music down: x(1 - 0.35). */
const ENGINE_DUCK_DEPTH = 0.35;
/** The slow-mo lowpass on the engine bus: closed to `SLOWMO_FLOOR_HZ` at standstill, open (20 kHz) at normal speed, following the square root of the rate. */
const SLOWMO_FLOOR_HZ = 700;
const SLOWMO_SPAN_HZ = 19300;

/**
 * The engine bus gain at a full slider: unity. A redline voice peaks near -12 dBFS at unity (`MOTOR_OUTPUT_GAIN`), so a full slider
 * is the loudest a lone engine gets before the master chain; the 0.25 default is x0.25 (-12 dB).
 */
const ENGINE_FULL_GAIN = 1;

/** The engine bus gain: the slider (0..1), linear to `ENGINE_FULL_GAIN`. */
export function engineBusGain(volume: number): number {
  return Math.min(1, Math.max(0, volume)) * ENGINE_FULL_GAIN;
}

/**
 * Master chain: a gentle glue compressor (2:1, wide soft knee, slow enough to keep transients), a peak limiter, then a ceiling that
 * no sample passes. A browser compressor adds its own make-up gain (about +3.6 dB for `MASTER_GLUE`), which `GLUE_TRIM` takes back
 * so the glue changes dynamics, not loudness.
 */
export const MASTER_GLUE = { threshold: -12, knee: 12, ratio: 2, attack: 0.02, release: 0.3 } as const;
export const GLUE_TRIM = 0.66;
export const MASTER_LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 } as const;
/** The output ceiling: -1 dBFS. */
export const CEILING = 10 ** (-1 / 20);
/** The ceiling curve is linear up to this share of the ceiling, then bends smoothly (tanh) onto it: no hard clip edge. */
const CEILING_KNEE = 0.8;

/**
 * The buses that have no slider sit at fixed trims under the master chain: `hits` (HitSound, at the level the old single crash sound had), `ambient` (AmbientBed) and `ui`
 * (UiSound). Each also feeds the one shared reverb at its `SEND`; engines and music are dry.
 */
export const BUS = { hits: 0.42, ambient: 0.5, ui: 0.7 } as const;
export const SEND = { hits: 0.3, ambient: 0.06, ui: 0.12 } as const;

/** The one shared reverb: a stereo impulse `seconds` long, bright at the start and `dampHz` at its end, `wet` of the dry level; `earlyMs` taps of `earlyGain` give a room its first reflections. */
export const REVERB = { seconds: 0.9, wet: 0.5, brightHz: 6000, dampHz: 1500, seed: 0x2f6e2b1, earlyMs: [7, 13, 23, 31, 41, 53], earlyGain: 0.35 } as const;

/**
 * The crash duck of music (`musicDb`) and ambience (`ambientDb`): a hit under `minImpulse` (closing m/s) ducks nothing, one at `fullImpulse` ducks them fully. The
 * duck holds `holdS` s at full depth and lets go with time constant `releaseTauS`, so a pile-up's last hit sets how long it lasts.
 */
export const DUCK = { minImpulse: 4, fullImpulse: 40, musicDb: -6, ambientDb: -4.5, holdS: 0.45, releaseTauS: 0.35, attackTauS: 0.02 } as const;

/** The voices each bus lets sound at once, desktop and phone, and how many scrapes a frame passes on. */
export const VOICES = { hitsDesktop: 10, hitsPhone: 6, ui: 2, scrapes: 3 } as const;
/** A new voice must outrank the weakest running one by this factor to displace it. */
const STEAL_RATIO = 1.5;

/** A hit heard from further than this (m) is not admitted at all. */
const HEARD_MAX_M = 400;

/** A hit's impulse (closing m/s) as the listener hears it, from the offset (dx, dy, dz) m: scaled by distance, 0 beyond `HEARD_MAX_M`. */
export function audibleImpulse(impulse: number, dx: number, dy: number, dz: number): number {
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return distance > HEARD_MAX_M ? 0 : impulse * distanceGain(distance);
}

/** A gunshot: a noise burst through a band-pass (`hz` by gun), `s` s long, at `gain`, from the shared noise buffer. */
export const SHOT = { s: 0.09, gain: 0.45, q: 0.8, attackS: 0.012, noiseS: 0.55, hz: { pistol: 1800, shotgun: 700, rifle: 2600 } } as const;

/**
 * The focus car's tyres (masterclass 22:48, 31:18, 32:30), both through the engine bus so the Engines slider, the pause fade and the slow-mo
 * lowpass carry them. Squeal: a looped noise through a bandpass (`bandQ`) centred `hzLow`..`hzHigh` by ground speed, wobbled `wobbleCents` at `wobbleHz`,
 * at up to `squealGain`; `fadeTau` s is the gain's time constant (95% in 3x: ~75 ms). It starts at `slideFrom` of `drive.slide` (full at
 * `slideTo`), `speedFrom`..`speedTo` m/s gates a slide by speed, and a locked brake or wheelspin squeal at `lockShare` / `spinShare` of their 0..1.
 * Thud: a sine `thudStartHz` -> `thudEndHz` over `thudS` plus a lowpassed noise burst (`noiseHz`, `noiseS`, `noiseShare` of the sine), at
 * `thudPerMs` per m/s of the fall, at most `thudMax`.
 */
export const TYRE = {
  squealGain: 0.06,
  hzLow: 1000,
  hzHigh: 2500,
  hzFullSpeed: 40,
  bandQ: 3,
  wobbleHz: 6,
  wobbleCents: 70,
  fadeTau: 0.025,
  slideFrom: 0.3,
  slideTo: 0.9,
  speedFrom: 2,
  speedTo: 8,
  lockShare: 0.8,
  spinShare: 0.8,
  thudStartHz: 60,
  thudEndHz: 35,
  thudS: 0.25,
  noiseHz: 400,
  noiseS: 0.12,
  noiseShare: 0.4,
  thudPerMs: 0.015,
  thudMax: 0.2,
} as const;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * The squeal's level (0..1) from the car's drive state: `slide` (drift or sideways slip, 0..1) past `slideFrom`, only at speed; `lock` (brakes
 * locked) and `spin` (wheelspin) as they come. The loudest of the three; none with a wheel off the ground.
 */
export function squealLevel(slide: number, lock: number, spin: number, speed: number, grounded: boolean): number {
  if (!grounded) return 0;
  const s = clamp01((slide - TYRE.slideFrom) / (TYRE.slideTo - TYRE.slideFrom)) * clamp01((speed - TYRE.speedFrom) / (TYRE.speedTo - TYRE.speedFrom));
  return clamp01(Math.max(s, TYRE.lockShare * lock, TYRE.spinShare * spin));
}

/** The squeal's bandpass centre (Hz): `hzLow` at a standstill to `hzHigh` at `hzFullSpeed` m/s of ground speed. */
export function squealHz(speed: number): number {
  return TYRE.hzLow + (TYRE.hzHigh - TYRE.hzLow) * clamp01(speed / TYRE.hzFullSpeed);
}

/** The landing thud's peak gain for a landing at `fall` m/s of vertical speed. */
export function thudGain(fall: number): number {
  return Math.min(TYRE.thudMax, Math.max(0, fall) * TYRE.thudPerMs);
}

/** The ceiling's WaveShaper curve over inputs -1..1 (`n` points): unity below the knee, never past `CEILING`. */
export function ceilingCurve(n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(n * 4));
  const k = CEILING * CEILING_KNEE;
  const span = CEILING - k;
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    const a = Math.abs(x);
    out[i] = Math.sign(x) * (a <= k ? a : k + span * Math.tanh((a - k) / span));
  }
  return out;
}

/** NCS masters run hot (near 0 dBFS RMS on the loud sections), so the music bus sits 6 dB under its slider. */
const MUSIC_TRIM = 0.5;

/** The music bus gain: the slider, capped, trimmed, under the engine duck and the crash duck (each 0..1). */
export function musicGain(volume: number, engineDuck: number, crashDuck: number): number {
  return Math.min(MUSIC_MAX_GAIN, volume) * MUSIC_TRIM * engineDuck * crashDuck;
}

/** The music's duck for the player's engine at `playerLevel` (load x revs, 0..1). */
export function engineDuck(playerLevel: number): number {
  return 1 - ENGINE_DUCK_DEPTH * playerLevel;
}

/** The duck's depth (0..1) of a hit of `impulse` (closing m/s): none under `DUCK.minImpulse`, full from `DUCK.fullImpulse`. */
export function duckDepth(impulse: number): number {
  return clamp01((impulse - DUCK.minImpulse) / (DUCK.fullImpulse - DUCK.minImpulse));
}

/** A bus gain under a duck of `level` (0..1) that reaches `db` at full depth. */
export function duckGain(level: number, db: number): number {
  return 1 - level * (1 - 10 ** (db / 20));
}

/** The crash duck: a hit sets `level` to its depth, held for `DUCK.holdS`, then released with `DUCK.releaseTauS`; a weaker hit never shortens a stronger one's duck. */
export class CrashDuck {
  level = 0;
  private holdLeftS = 0;

  hit(impulse: number): void {
    const depth = duckDepth(impulse);
    if (depth <= 0) return;
    this.level = Math.max(this.level, depth);
    this.holdLeftS = Math.max(this.holdLeftS, DUCK.holdS * depth);
  }

  step(dt: number): void {
    if (this.holdLeftS > 0) {
      this.holdLeftS = Math.max(0, this.holdLeftS - dt);
      return;
    }
    this.level = this.level < 1e-4 ? 0 : approach(this.level, 0, dt, DUCK.releaseTauS);
  }
}

/** At most `size` voices at once; a new voice only displaces the weakest running one when it outranks it by `STEAL_RATIO`. Allocates nothing. */
export class VoiceBudget {
  private readonly until: Float64Array;
  private readonly weight: Float64Array;

  constructor(size: number) {
    this.until = new Float64Array(size);
    this.weight = new Float64Array(size);
  }

  /** Whether a voice of `priority` that sounds for `lifeS` from `now` may start, and books its slot. */
  take(now: number, priority: number, lifeS: number): boolean {
    let slot = -1;
    let weakest = -1;
    for (let i = 0; i < this.until.length; i++) {
      if (this.until[i]! <= now) {
        slot = i;
        break;
      }
      if (weakest < 0 || this.weight[i]! < this.weight[weakest]!) weakest = i;
    }
    if (slot < 0) {
      if (weakest < 0 || priority <= this.weight[weakest]! * STEAL_RATIO) return false;
      slot = weakest;
    }
    this.until[slot] = now + lifeS;
    this.weight[slot] = priority;
    return true;
  }
}

/** A hit voice is booked this long (s) at the least, and this much longer per m/s of impulse, to at most `maxS`. */
const HIT_LIFE = { baseS: 0.3, perImpulseS: 0.02, maxS: 1.2 } as const;

/** What a hit does to the mix: it needs a hit voice, and once admitted it ducks the music and ambience; both go by the hit's audible impulse (`audibleImpulse`), not its raw one. */
export class HitMix {
  readonly duck = new CrashDuck();
  private readonly budget: VoiceBudget;

  constructor(voices: number) {
    this.budget = new VoiceBudget(voices);
  }

  admit(now: number, impulse: number): boolean {
    if (!this.budget.take(now, impulse, Math.min(HIT_LIFE.maxS, HIT_LIFE.baseS + impulse * HIT_LIFE.perImpulseS))) return false;
    this.duck.hit(impulse);
    return true;
  }
}

/** The shared reverb's impulse (stereo, unit energy per channel): early taps, then seeded noise decaying -60 dB at `seconds` and darkening as it goes. */
export function reverbImpulse(sampleRate: number, seconds: number, seed: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.round(sampleRate * seconds);
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const h = out[c]!;
    let s = (seed + c * 0x632be5ab) >>> 0 || 1;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const white = s / 2147483648 - 1;
      const t = i / n;
      const fc = REVERB.brightHz * (1 - t) + REVERB.dampHz * t;
      lp += (1 - Math.exp((-2 * Math.PI * fc) / sampleRate)) * (white - lp);
      h[i] = lp * Math.exp(-6.9 * t);
    }
    for (let k = 0; k < REVERB.earlyMs.length; k++) h[Math.round(((REVERB.earlyMs[k]! + c * 3.7) / 1000) * sampleRate)]! += REVERB.earlyGain * (k % 2 === 0 ? 1 : -1);
    let energy = 0;
    for (let i = 0; i < n; i++) energy += h[i]! * h[i]!;
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) h[i] = h[i]! * scale;
  }
  return out;
}

/** The engine bus lowpass cutoff (Hz) at the presented-time `rate` (1 = normal, clamped to 0..1). */
export function slowmoCutoff(rate: number): number {
  return SLOWMO_FLOOR_HZ + SLOWMO_SPAN_HZ * Math.sqrt(Math.min(1, Math.max(0, rate)));
}

/** `current` moved toward `target` by `dt` seconds of a first-order lag with time constant `tauS`. */
export function approach(current: number, target: number, dt: number, tauS: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tauS));
}
