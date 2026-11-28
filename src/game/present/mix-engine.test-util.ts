import { readFileSync } from "node:fs";
import vm from "node:vm";
import type { DamageStage, VehicleClassId } from "../vehicle/vehicle-classes.ts";
import { channelGains, motorRpm, MOTOR_OUTPUT_GAIN, toneMessage, toneOptions } from "./motor-tone.ts";
import { SAMPLE_RATE } from "./mix-render.test-util.ts";

/** The shipped motor worklet run block by block in node, for the mix render's engine stems (the same harness shape as `motor-level.test-util`). */
const BLOCK = 128;
const WORKLET = readFileSync(new URL("../../../public/audio/motor-worklet.js", import.meta.url), "utf8");
/** The wasm generator seeds its noise from the clock in whole seconds; a fixed second makes a render the same every run. */
const NOISE_CLOCK_MS = 1760002068 * 1000;

interface Processor {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: unknown[], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
type ProcessorClass = new (options: { processorOptions: unknown }) => Processor;

function loadProcessor(): { Processor: ProcessorClass; scope: { currentFrame: number }; ready: Promise<void> } {
  let registered: ProcessorClass | null = null;
  let runtimeIn: () => void = () => {};
  const ready = new Promise<void>((resolve) => (runtimeIn = resolve));
  const scope = {
    AudioWorkletProcessor: class {
      port = { onmessage: null };
    },
    registerProcessor: (_name: string, processor: ProcessorClass) => {
      registered = processor;
    },
    sampleRate: SAMPLE_RATE,
    currentFrame: 0,
    console,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    setTimeout,
    performance,
    URL,
    Date: { now: () => NOISE_CLOCK_MS },
    Module: { onRuntimeInitialized: () => runtimeIn() },
  };
  vm.createContext(scope);
  vm.runInContext(WORKLET, scope);
  if (!registered) throw new Error("the worklet registered no processor");
  return { Processor: registered, scope, ready };
}

/** `seconds` of one voice of class `cls` at damage `stage`, its dial rev (0..1) following `revAt(t)`, as the worklet sums and tilts it. */
export async function renderEngine(cls: VehicleClassId, stage: DamageStage, seconds: number, revAt: (t: number) => number): Promise<Float32Array> {
  const { Processor, scope, ready } = loadProcessor();
  const processor = new Processor({ processorOptions: toneOptions(cls, SAMPLE_RATE) });
  const out = [[new Float32Array(BLOCK)], [new Float32Array(BLOCK)], [new Float32Array(BLOCK)]];
  const idle = { rpm: new Float32Array(BLOCK), throttle: new Float32Array(BLOCK) };
  await ready;
  processor.process([], out, idle);
  processor.port.onmessage?.({ data: toneMessage(cls, stage, SAMPLE_RATE) });
  const tilt = new Float64Array(3);
  channelGains(tilt, cls);
  const samples = new Float32Array(Math.floor((seconds * SAMPLE_RATE) / BLOCK) * BLOCK);
  for (let block = 0; block * BLOCK < samples.length; block++) {
    const parameters = { rpm: new Float32Array(BLOCK).fill(motorRpm(cls, revAt((block * BLOCK) / SAMPLE_RATE), 1)), throttle: idle.throttle };
    scope.currentFrame += BLOCK;
    processor.process([], out, parameters);
    for (let i = 0; i < BLOCK; i++) samples[block * BLOCK + i] = (out[0]![0]![i]! * tilt[0]! + out[1]![0]![i]! * tilt[1]! + out[2]![0]![i]! * tilt[2]!) * MOTOR_OUTPUT_GAIN;
  }
  return samples;
}
