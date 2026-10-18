import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BENCH, type BenchParts, type Tap } from "./bench-measure.ts";
import { alternate, newBeat, type Beat, type FrameEngine } from "./bench-frame.ts";
import { CAUSE_NAMES } from "./bench-hitch.ts";
import { SETTLE } from "./bench-settle.ts";

const STEADY_MS = 6;
/** The engine's ms in a steady frame; `advance` adds half of what a frame ran over `STEADY_MS`, so a hang costs the engine too. */
const STEADY_SIM_MS = 3;
/** The clock's float rounding in a mean of 500 frames' sim ms. */
const SIM_TOLERANCE_MS = 1e-3;
/** A block ends on the frame that carries its wall time past `blockS`: the float sum of the frames' times puts that frame within one of the exact count. */
const FRAME_COUNT_SLACK = 1;
/** The stretch (`PAGE_PHASES` index) the rig's frames are logged under. */
const STRETCH = 4;

/** What the page's rAF hands the bench: the interval of each frame (ms) from a script of the frames since the arm's switch. */
class Display {
  private clock = 1000;
  private since = 0;
  private script: (sinceSwitch: number) => number = () => STEADY_MS;
  /** A fresh page: the clock at 1000 ms (the beat's first stamp), steady frames. */
  reset(): void {
    this.clock = 1000;
    this.use(() => STEADY_MS);
  }
  /** The frames from here on follow `script`, counted from 0. */
  use(script: (sinceSwitch: number) => number): void {
    this.script = script;
    this.since = 0;
  }
  next(): number {
    this.clock += this.script(this.since++);
    return this.clock;
  }
}

const display = new Display();
const originalFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
afterEach(() => {
  if (originalFrame) Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});

/** A bench with nothing to draw: the parts a frame reads, a tap whose sim ms `advance` fills, and the display's frames. */
function rig(): { engine: FrameEngine; parts: BenchParts; t: Tap; beat: Beat } {
  Object.defineProperty(globalThis, "requestAnimationFrame", { value: (callback: (stamp: number) => void) => void setImmediate(() => callback(display.next())), configurable: true });
  const info = { reset() {}, render: { calls: 1, triangles: 10 }, programs: [], memory: { textures: 0, geometries: 0 } };
  const parts = { renderer: { info }, live: () => [], ragdoll: { traffic: { messages: 0, bytes: 0 } }, world: { fineCuts: 0 } } as unknown as BenchParts;
  const t = { simMs: 0, drawMs: 0, simS: 100, timing: false, block: 0, blocks: 0, collect() {} } as unknown as Tap;
  const engine: FrameEngine = {
    pace: { steps: 1 },
    advance: (seconds) => void (t.simMs = STEADY_SIM_MS + Math.max(0, seconds * 1000 - STEADY_MS) / 2),
    reset() {},
    setLabPreset() {},
    flickLab() {},
  };
  display.reset();
  return { engine, parts, t, beat: newBeat(parts, 1000, null, STRETCH) };
}

const ui = { set() {} };

/** A hang of 400 ms that falls 20 % a frame back to a steady frame within 80 frames. */
const decaying = (since: number): number => (since < 80 ? STEADY_MS + 400 * 0.8 ** since : STEADY_MS);

describe("given an A/B whose second arm opens with a decaying hang (400 ms, falling 20 % a frame)", () => {
  it("when the arms are scored, then the hang arm's scored frames cost what the steady arm's do, and its hang is the switch's, not the arm's", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [
      { key: "steady", set: () => display.use(() => STEADY_MS) },
      { key: "hang", set: () => display.use(decaying) },
    ], 1);
    const steady = result.accs.get("steady")!;
    const hang = result.accs.get("hang")!;
    assert.ok(Math.abs(steady.sim / steady.frames - STEADY_SIM_MS) < SIM_TOLERANCE_MS, "the steady arm's sim ms a frame");
    assert.ok(Math.abs(hang.sim / hang.frames - STEADY_SIM_MS) < SIM_TOLERANCE_MS, "the hang arm's sim ms a frame: no frame of the hang was scored");
    assert.ok(Math.abs(hang.frames - steady.frames) <= FRAME_COUNT_SLACK, `frames scored in the block: ${hang.frames} against ${steady.frames}`);
    const [first, second] = result.switches;
    assert.ok(first!.longestMs < 2 * STEADY_MS, "the steady switch's longest frame is an ordinary one");
    assert.equal(second!.arm, "hang", "the second switch");
    assert.ok(second!.longestMs >= 400, `the hang is the switch's longest frame (${second!.longestMs} ms)`);
    assert.equal(second!.longestAt, 0, "at the first frame after the switch");
    assert.ok(second!.frames > 15, `${second!.frames} frames watched: the hang took more than ten frames to fall`);
    assert.equal(second!.settled, true, "settled");
  });

  it("when the arms are steady throughout, then every switch settles in two windows of frames and each arm scores the same frames", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [{ key: "a", set() {} }, { key: "b", set() {} }], 2);
    assert.equal(result.switches.length, 4, "two arms, two rounds");
    for (const s of result.switches) {
      assert.equal(s.settled, true, `${s.arm} round ${s.round} settled`);
      assert.equal(s.frames, 2 * SETTLE.frames, `${s.arm} round ${s.round} frames watched`);
    }
    const a = result.accs.get("a")!;
    const b = result.accs.get("b")!;
    assert.ok(Math.abs(a.frames - b.frames) <= 2 * FRAME_COUNT_SLACK, `frames scored by each arm: ${a.frames} against ${b.frames}`);
    assert.ok(Math.abs(a.frames - 2 * (BENCH.blockS / (STEADY_MS / 1000))) <= 2 * FRAME_COUNT_SLACK, `two blocks of 3 s at 6 ms: ${a.frames} frames`);
  });

  it("when a frame time never levels (it grows 10 % a frame), then the arm is scored after the cap and its switch says it never settled", async () => {
    const { engine, parts, t, beat } = rig();
    const result = await alternate(engine, parts, t, beat, ui, "fx", [{ key: "never", set: () => display.use((since) => STEADY_MS * 1.1 ** since) }], 1);
    const [only] = result.switches;
    assert.equal(only!.settled, false, "settled");
    assert.ok(only!.settleS >= SETTLE.capS, `${only!.settleS} s watched`);
  });

  it("when a hang falls inside the settle watch, then the hitch log holds it with the tier-switch cause and the stretch the arm ran in, and the scored block adds none", async () => {
    const { engine, parts, t, beat } = rig();
    await alternate(engine, parts, t, beat, ui, "fx", [{ key: "a", set: () => display.use((since) => (since === 45 ? 450 : STEADY_MS)) }], 1);
    const table = beat.hitches.table();
    assert.equal(table.count, 1, "hitches");
    assert.equal(table.rows[0]!.ms, 450, "the hang's ms");
    assert.equal(table.rows[0]!.phase, STRETCH, "its stretch");
    assert.ok(table.rows[0]!.causes.includes(CAUSE_NAMES[0]), "the setting-switch cause");
  });
});
