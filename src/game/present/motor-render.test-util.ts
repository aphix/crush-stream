import { channelGains, MOTOR_OUTPUT_GAIN, motorRpm, toneMessage, toneOptions } from "./motor-tone.ts";
import { harness, SAMPLE_RATE, BLOCK, SETTLE_BLOCKS } from "./motor-level.test-util.ts";
import type { DspTone } from "./motor-layers.ts";
import type { DamageStage, VehicleClassId } from "../vehicle/vehicle-classes.ts";

/** What a voice is told for one block: the dial's revs, the engine load, and a shift trigger (0 none, 0..1 the strength). */
export interface BlockPlan {
  rev: number;
  load: number;
  shift?: number;
}

/** The voice's raw mono output (the class-tilted sum x `MOTOR_OUTPUT_GAIN`) for `blocks` blocks of `plan(block)`, after the generator's settle time; `tune` overrides the class's layer tuning, `raw` (three arrays) takes the channels before the tilt. */
export async function renderVoice(cls: VehicleClassId, stage: DamageStage, blocks: number, plan: (block: number) => BlockPlan, tune: Partial<DspTone> = {}, raw?: Float32Array[]): Promise<Float32Array> {
  const { Processor, scope, ready } = harness;
  const processor = new Processor({ processorOptions: toneOptions(cls, SAMPLE_RATE) });
  const out = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const idle = { rpm: new Float32Array(BLOCK), throttle: new Float32Array(BLOCK), shift: new Float32Array(1) };
  await ready;
  processor.process([], out.map((channel) => [channel]), idle);
  const message = toneMessage(cls, stage, SAMPLE_RATE);
  Object.assign(message.dsp, tune);
  processor.port.onmessage?.({ data: message });
  const tilt = new Float64Array(3);
  channelGains(tilt, cls);
  const mix = new Float32Array(blocks * BLOCK);
  const parameters = { rpm: new Float32Array(BLOCK), throttle: new Float32Array(BLOCK), shift: new Float32Array(1) };
  for (let block = -SETTLE_BLOCKS; block < blocks; block++) {
    const p = plan(Math.max(0, block));
    parameters.rpm.fill(motorRpm(cls, p.rev, 1));
    parameters.throttle.fill(p.load);
    parameters.shift[0] = block >= 0 ? (p.shift ?? 0) : 0;
    scope.currentFrame += BLOCK;
    processor.process([], out.map((channel) => [channel]), parameters);
    if (block < 0) continue;
    for (let i = 0; i < BLOCK; i++) {
      mix[block * BLOCK + i] = (out[0]![i]! * tilt[0]! + out[1]![i]! * tilt[1]! + out[2]![i]! * tilt[2]!) * MOTOR_OUTPUT_GAIN;
      if (raw) for (let c = 0; c < 3; c++) raw[c]![block * BLOCK + i] = out[c]![i]!;
    }
  }
  return mix;
}

/** In-place radix-2 FFT of `re`, `im` (length a power of two). */
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

/** The band edges (Hz) `bandEnergy` reports: sub, low, mid, upper-mid, air. */
export const BANDS = [[20, 80], [80, 250], [250, 1000], [1000, 4000], [4000, SAMPLE_RATE / 2]] as const;

/** Energy of the last `size` samples of `x` per band of `BANDS`, in dB re full scale RMS (a sine of amplitude 1 is -3 dB). */
export function bandEnergy(x: Float32Array, size = 16384): number[] {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const start = x.length - size;
  let window = 0;
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = x[start + i]! * w;
    window += w * w;
  }
  fft(re, im);
  const energy = BANDS.map(() => 0);
  for (let k = 1; k < size / 2; k++) {
    const hz = (k * SAMPLE_RATE) / size;
    const band = BANDS.findIndex(([lo, hi]) => hz >= lo && hz < hi);
    if (band >= 0) energy[band]! += (2 * (re[k]! * re[k]! + im[k]! * im[k]!)) / (size * window);
  }
  return energy.map((e) => 10 * Math.log10(e + 1e-20));
}

/** Peak (absolute) and RMS of `x`, linear. */
export function peakRms(x: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let squares = 0;
  for (let i = 0; i < x.length; i++) {
    peak = Math.max(peak, Math.abs(x[i]!));
    squares += x[i]! * x[i]!;
  }
  return { peak, rms: Math.sqrt(squares / x.length) };
}

/** `x` as a 16-bit mono WAV at the test's rate. */
export function wavOf(x: Float32Array): Buffer {
  const data = Buffer.alloc(44 + x.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + x.length * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SAMPLE_RATE, 24);
  data.writeUInt32LE(SAMPLE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2);
  return data;
}
