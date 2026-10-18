import { newBeat, type Beat, type FrameEngine } from "./bench-frame.ts";
import type { BenchParts, Tap } from "./bench-measure.ts";

export const STEADY_MS = 6;
/** The engine's ms in a steady frame; `advance` adds half of what a frame ran over `STEADY_MS`, so a hang costs the engine too. */
export const STEADY_SIM_MS = 3;
/** The stretch (`PAGE_PHASES` index) the rig's frames are logged under. */
export const STRETCH = 4;

/** What the page's rAF hands the bench: the interval of each frame (ms) from a script of the frames since the arm's switch. */
class Display {
  private clock = 1000;
  private since = 0;
  /** Frames the page has been handed since the last `reset`: a frame the engine splits into steps is still one. */
  shown = 0;
  private script: (sinceSwitch: number) => number = () => STEADY_MS;
  private cost: (sinceSwitch: number) => number = () => 1;
  /** A fresh page: the clock at 1000 ms (the beat's first stamp), steady frames. */
  reset(): void {
    this.clock = 1000;
    this.shown = 0;
    this.use(() => STEADY_MS);
  }
  /** The frames from here on follow `script`, counted from 0; `cost` weighs each frame's sim ms. */
  use(script: (sinceSwitch: number) => number, cost: (sinceSwitch: number) => number = () => 1): void {
    this.script = script;
    this.cost = cost;
    this.since = 0;
  }
  next(): number {
    this.shown++;
    this.clock += this.script(this.since);
    return this.clock;
  }
  /** The sim's cost weight of the frame being advanced (the one `next` just stamped). */
  weight(): number {
    return this.cost(this.since++);
  }
}

export const display = new Display();
const originalFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");

/** Puts the page's own `requestAnimationFrame` back (a test file's `afterEach`). */
export function restoreFrame(): void {
  if (originalFrame) Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
}

/** A bench with nothing to draw: the parts a frame reads, a tap whose sim ms `advance` fills, and the display's frames. */
export function rig(): { engine: FrameEngine; parts: BenchParts; t: Tap; beat: Beat } {
  Object.defineProperty(globalThis, "requestAnimationFrame", { value: (callback: (stamp: number) => void) => void setImmediate(() => callback(display.next())), configurable: true });
  const info = { reset() {}, render: { calls: 1, triangles: 10 }, programs: [], memory: { textures: 0, geometries: 0 } };
  const parts = { renderer: { info }, live: () => [], ragdoll: { traffic: { messages: 0, bytes: 0 } }, world: { fineCuts: 0 } } as unknown as BenchParts;
  const t = { simMs: 0, drawMs: 0, simS: 100, timing: false, block: 0, blocks: 0, collect() {} } as unknown as Tap;
  const engine: FrameEngine = {
    pace: { steps: 1 },
    advance: (seconds) => {
      t.simMs = (STEADY_SIM_MS + Math.max(0, seconds * 1000 - STEADY_MS) / 2) * display.weight();
      t.simS += seconds;
    },
    reset() {},
    setLabPreset() {},
    flickLab() {},
  };
  display.reset();
  return { engine, parts, t, beat: newBeat(parts, 1000, null, STRETCH) };
}
