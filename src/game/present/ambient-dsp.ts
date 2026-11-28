/** Offline synthesis primitives for the ambient beds and the UI sounds: seeded, allocation-happy, run once at load. */

/** The highest frequency any synthesized filter or ring is set to, as a share of the sample rate: safely under Nyquist (0.5). */
export const TOP_SHARE = 0.45;

/** The next draw in [0, 1) of the generator whose one word of state is `state[0]` (mulberry32). No allocation. */
export function nextDraw(state: Uint32Array): number {
  const a = (state[0]! + 0x6d2b79f5) >>> 0;
  state[0] = a;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A seeded generator of uniform draws in [0, 1). */
export function rngOf(seed: number): () => number {
  const state = Uint32Array.of(seed);
  return () => nextDraw(state);
}

/** A direct-form RBJ biquad, one sample at a time. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private set(type: "low" | "high" | "band", hz: number, q: number, rate: number): this {
    const w = (2 * Math.PI * Math.min(hz, rate * TOP_SHARE)) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === "low") {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else if (type === "high") {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  static low(hz: number, rate: number, q = Math.SQRT1_2): Biquad {
    return new Biquad().set("low", hz, q, rate);
  }

  static high(hz: number, rate: number, q = Math.SQRT1_2): Biquad {
    return new Biquad().set("high", hz, q, rate);
  }

  /** A constant-0-dB-peak band-pass. */
  static band(hz: number, q: number, rate: number): Biquad {
    return new Biquad().set("band", hz, q, rate);
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** `x` run through each filter in turn, in place. */
export function filtered(x: Float32Array, ...chain: Biquad[]): Float32Array {
  for (let i = 0; i < x.length; i++) {
    let v = x[i]!;
    for (const stage of chain) v = stage.tick(v);
    x[i] = v;
  }
  return x;
}

export function whiteNoise(n: number, rng: () => number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng() * 2 - 1;
  return x;
}

function rmsOf(x: Float32Array): number {
  let squares = 0;
  for (let i = 0; i < x.length; i++) squares += x[i]! * x[i]!;
  return Math.sqrt(squares / Math.max(1, x.length));
}

/** `x` scaled in place to this RMS. */
export function scaledToRms(x: Float32Array, rms: number): Float32Array {
  const k = rms / Math.max(1e-9, rmsOf(x));
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * k;
  return x;
}

/** `x` scaled in place so its largest sample is this. */
export function scaledToPeak(x: Float32Array, peak: number): Float32Array {
  let top = 1e-9;
  for (let i = 0; i < x.length; i++) top = Math.max(top, Math.abs(x[i]!));
  const k = peak / top;
  for (let i = 0; i < x.length; i++) x[i] = x[i]! * k;
  return x;
}

/** The overlap (s) a loop's tail is crossfaded into its head over; longer than any filter memory used. */
const LOOP_FADE_S = 2;

/** A seamless loop of `seconds` from a stochastic `render(n)`: n + overlap samples, the overlap equal-power-faded into the head, so the last sample runs on into the first. */
export function seamlessLoop(render: (n: number) => Float32Array, rate: number, seconds: number): Float32Array {
  const length = Math.round(seconds * rate);
  const fade = Math.round(LOOP_FADE_S * rate);
  const raw = render(length + fade);
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const turn = ((i + 0.5) / fade) * (Math.PI / 2);
    out[i] = raw[i]! * Math.sin(turn) + raw[length + i]! * Math.cos(turn);
  }
  return out;
}

/** `x` followed by a dark Schroeder reverb tail of `tailS` seconds: four damped combs and two all-passes, `wet` of the sum added to the dry sound. */
export function withReverb(x: Float32Array, rate: number, tailS: number, wet: number): Float32Array {
  const out = new Float32Array(x.length + Math.round(tailS * rate));
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => ({ buf: new Float32Array(Math.round(s * rate)), at: 0, damp: 0 }));
  const feedback = Math.pow(0.001, 0.0371 / tailS);
  const passes = [0.005, 0.0017].map((s) => ({ buf: new Float32Array(Math.round(s * rate)), at: 0 }));
  for (let i = 0; i < out.length; i++) {
    const dry = i < x.length ? x[i]! : 0;
    let sum = 0;
    for (const comb of combs) {
      const echo = comb.buf[comb.at]!;
      comb.damp = echo * 0.6 + comb.damp * 0.4;
      comb.buf[comb.at] = dry + comb.damp * feedback;
      comb.at = (comb.at + 1) % comb.buf.length;
      sum += echo;
    }
    let v = sum * 0.25;
    for (const pass of passes) {
      const held = pass.buf[pass.at]!;
      const next = v + held * 0.5;
      pass.buf[pass.at] = next;
      v = held - next * 0.5;
      pass.at = (pass.at + 1) % pass.buf.length;
    }
    out[i] = dry + v * wet;
  }
  return out;
}

/** The last `seconds` of `x` faded linearly to 0 in place, so a sound cut mid-decay does not click. */
export function fadedOut(x: Float32Array, rate: number, seconds: number): Float32Array {
  const span = Math.min(x.length, Math.round(seconds * rate));
  for (let i = 0; i < span; i++) x[x.length - 1 - i] = x[x.length - 1 - i]! * (i / span);
  return x;
}
