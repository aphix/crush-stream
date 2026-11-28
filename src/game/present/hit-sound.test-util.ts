/** A Web Audio stand-in that records what a `HitSound` schedules and mixes it offline, so hits and scrapes can be measured and written to a WAV in node. */

type Event = { kind: "set" | "target"; value: number; time: number; tau: number };

export class FakeParam {
  value = 0;
  readonly events: Event[] = [];
  private readonly log: boolean;
  constructor(log: boolean) {
    this.log = log;
  }
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    if (this.log) this.events.push({ kind: "set", value, time, tau: 0 });
    return this;
  }
  setTargetAtTime(value: number, time: number, tau: number): this {
    if (this.log) this.events.push({ kind: "target", value, time, tau });
    this.value = value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
  /** The value at `time`, replaying the recorded events in order. */
  at(time: number): number {
    let value = this.events.length > 0 ? this.events[0]!.value : this.value;
    let goal = value;
    let from = 0;
    let tau = 0;
    for (const e of this.events) {
      if (e.time > time) break;
      if (tau > 0) value = goal + (value - goal) * Math.exp(-(e.time - from) / tau);
      if (e.kind === "set") {
        value = e.value;
        goal = value;
        tau = 0;
      } else {
        goal = e.value;
        tau = e.tau;
      }
      from = e.time;
    }
    return tau > 0 ? goal + (value - goal) * Math.exp(-(time - from) / tau) : value;
  }
}

export class FakeNode {
  to: FakeNode | null = null;
  /** Where it was last connected, kept after a disconnect so a recording can be mixed whole. */
  sentTo: FakeNode | null = null;
  frequency: FakeParam;
  gain: FakeParam;
  type: BiquadFilterType = "lowpass";
  constructor(log: boolean) {
    this.frequency = new FakeParam(log);
    this.gain = new FakeParam(log);
  }
  connect(node: FakeNode): FakeNode {
    this.to = node;
    this.sentTo = node;
    return node;
  }
  disconnect(): void {
    this.to = null;
  }
}

export class FakeBuffer {
  readonly data: Float32Array;
  readonly length: number;
  readonly sampleRate: number;
  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate: FakeParam;
  startAt = -1;
  offset = 0;
  stopAt = Infinity;
  constructor(log: boolean) {
    super(log);
    this.playbackRate = new FakeParam(log);
    this.playbackRate.value = 1;
  }
  start(when: number, offset = 0): void {
    this.startAt = when;
    this.offset = offset;
  }
  stop(when = 0): void {
    this.stopAt = Math.min(this.stopAt, when);
  }
  reset(): void {
    this.to = null;
    this.buffer = null;
    this.loop = false;
    this.playbackRate.value = 1;
    this.startAt = -1;
    this.stopAt = Infinity;
  }
}

/** `record`: keep every source and automation event (for mixing); off, sources are recycled from a pool so a measured call allocates only what the code under test does. */
export class FakeContext {
  currentTime = 0;
  readonly listener = { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } };
  readonly sources: FakeSource[] = [];
  private readonly pool: FakeSource[] = [];
  private poolNext = 0;
  private readonly record: boolean;
  constructor(record: boolean) {
    this.record = record;
    if (!record) for (let at = 0; at < 256; at++) this.pool.push(new FakeSource(false));
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate);
  }
  createGain(): FakeNode {
    return new FakeNode(this.record);
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode(this.record);
  }
  createBufferSource(): FakeSource {
    if (!this.record) {
      const source = this.pool[this.poolNext++ % this.pool.length]!;
      source.reset();
      return source;
    }
    const source = new FakeSource(true);
    this.sources.push(source);
    return source;
  }
  /** Sources started and not yet over at the current time. */
  sounding(): number {
    let count = 0;
    for (const source of this.sources) if (source.startAt >= 0 && source.stopAt > this.currentTime && (source.loop || source.startAt + source.buffer!.duration / source.playbackRate.value > this.currentTime)) count++;
    return count;
  }
}

/** The recorded `sources` (all by default) summed to mono at `rate` for `seconds` from context time `from`: linear resampling at the recorded playback rate, the voice's gain and a one-pole lowpass at its cutoff. */
export function mixRecording(ctx: FakeContext, seconds: number, rate: number, from = 0, sources: readonly FakeSource[] = ctx.sources): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  const BLOCK = 64;
  for (const source of sources) {
    if (source.startAt < 0 || !source.buffer || !source.sentTo) continue;
    const gainNode = source.sentTo;
    const filter = gainNode.sentTo;
    const data = source.buffer.data;
    const step = source.buffer.sampleRate / rate;
    let position = source.offset * source.buffer.sampleRate;
    let low = 0;
    const first = Math.floor((source.startAt - from) * rate);
    for (let block = first; block < out.length; block += BLOCK) {
      const time = from + block / rate;
      if (time >= source.stopAt) break;
      const gain = gainNode.gain.at(time);
      const cutoff = filter ? filter.frequency.at(time) : 20000;
      const tone = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
      const advance = step * source.playbackRate.at(time);
      for (let at = Math.max(block, first, 0); at < Math.min(block + BLOCK, out.length); at++) {
        if (source.loop && position >= data.length) position -= data.length;
        const i = Math.floor(position);
        if (!source.loop && i >= data.length - 1) {
          block = out.length;
          break;
        }
        const frac = position - i;
        const next = source.loop && i === data.length - 1 ? 0 : i + 1;
        low += tone * ((data[i]! * (1 - frac) + data[next]! * frac) * gain - low);
        out[at]! += low;
        position += advance;
      }
    }
  }
  return out;
}

/** Magnitude-weighted spectral centroid (Hz) of `x` at `rate`, as the audio analyser reports it. */
export function centroidOf(x: Float32Array, rate: number): number {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j]!, re[i]!];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const vr = re[b]! * cr - im[b]! * ci;
        const vi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a]! += vr;
        im[a]! += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    const magnitude = Math.hypot(re[k]!, im[k]!);
    weighted += ((k * rate) / n) * magnitude;
    total += magnitude;
  }
  return weighted / total;
}

export function peakOf(x: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  return peak;
}

export function rmsOf(x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / Math.max(1, x.length));
}

/** Seconds from the start until the last 10 ms window whose RMS is above `floor` of the peak. */
export function ringSeconds(x: Float32Array, rate: number, floor = 0.0316): number {
  const window = Math.round(rate * 0.01);
  const peak = peakOf(x);
  let last = 0;
  for (let start = 0; start + window <= x.length; start += window) if (rmsOf(x.subarray(start, start + window)) > peak * floor) last = start + window;
  return last / rate;
}

/** A 16-bit mono WAV file's bytes. */
export function wavBytes(x: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + x.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + x.length * 2, true);
  tag(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), true);
  return bytes;
}
