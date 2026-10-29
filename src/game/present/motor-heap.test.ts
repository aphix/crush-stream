import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { toneMessages, toneOptions } from "./motor-tone.ts";

const SAMPLE_RATE = 44100;
const BLOCK = 128;
const VOICES = 6;
const POSTS = 20_000;
const HEAP_BYTES = 16 * 1024 * 1024;
/** The heap may move this far after warm-up: a malloc of a page or two that no hole fits. */
const HEAP_SLACK = 1 << 16;
const WORKLET = readFileSync(new URL("../../../public/audio/motor-worklet.js", import.meta.url), "utf8");

interface Processor {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  soundGenerator: unknown;
  process(inputs: unknown[], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
type ProcessorClass = new (options: { processorOptions: unknown }) => Processor;
interface WasmModule {
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
}

/** Runs the shipped worklet file in a stub of an AudioWorkletGlobalScope: every voice of a context shares its one wasm heap. `ready` resolves when the wasm runtime is in (emscripten's `onRuntimeInitialized`). */
function loadWorklet(): { Processor: ProcessorClass; wasm: WasmModule; ready: Promise<void> } {
  let registered: ProcessorClass | null = null;
  let runtimeIn: () => void = () => {};
  const ready = new Promise<void>((resolve) => (runtimeIn = resolve));
  const seed: unknown = { onRuntimeInitialized: () => runtimeIn() };
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
    Module: seed,
  };
  vm.createContext(scope);
  vm.runInContext(WORKLET, scope);
  if (!registered) throw new Error("the worklet registered no processor");
  return { Processor: registered, wasm: scope.Module as WasmModule, ready };
}

describe("given six voices re-tuned over and over, as every pool swap, class change and damage stage does", () => {
  it(`when they post ${POSTS} tones from the ${VEHICLE_CLASS_IDS.length * 3} tunings, then the shared 16 MB heap neither aborts nor grows once every tuning is built`, async () => {
    const { Processor, wasm, ready } = loadWorklet();
    const tones = toneMessages(SAMPLE_RATE);
    const voices = Array.from({ length: VOICES }, () => new Processor({ processorOptions: toneOptions(VEHICLE_CLASS_IDS[0]!, SAMPLE_RATE) }));
    const out = [[new Float32Array(BLOCK)], [new Float32Array(BLOCK)], [new Float32Array(BLOCK)]];
    const params = { rpm: new Float32Array(BLOCK).fill(3000), throttle: new Float32Array(BLOCK) };
    await ready;
    // A processor builds its generator on the first block after the runtime is in.
    for (const voice of voices) {
      voice.process([], out, params);
      assert.notEqual(voice.soundGenerator, null, "the voice built its generator");
    }
    // A big malloc comes off the top of the heap (no hole is that large), and a leak only ever moves the top up.
    const heapTop = (): number => {
      const ptr = wasm._malloc(1 << 16);
      wasm._free(ptr);
      return ptr;
    };
    for (const voice of voices) for (const tone of tones) voice.port.onmessage?.({ data: tone });
    const warm = heapTop();
    for (let i = 0; i < POSTS; i++) {
      const voice = voices[i % VOICES]!;
      voice.port.onmessage?.({ data: tones[(i * 7) % tones.length] });
      voice.process([], out, params);
    }
    assert.equal(wasm.HEAPU8.length, HEAP_BYTES);
    assert.ok(heapTop() <= warm + HEAP_SLACK, `the heap top moved ${heapTop() - warm} bytes`);
  });
});
