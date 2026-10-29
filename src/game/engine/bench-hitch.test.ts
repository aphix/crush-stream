import { describe, expect, it } from "vitest";
import { scavengesDuring } from "../kernel/gc.test-util.ts";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { CAUSE, FRAME, HITCH, HitchLog } from "./bench-hitch.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const STEADY_MS = 6;
const row = new Float64Array(FRAME.fields);
/** Bytes a frame may allocate: the sampling profiler's read of a loop that allocates nothing is zero, and one boxed double a frame is 16 (as the other allocation rows hold). */
const BOUND_B = 16;

/** One frame of `intervalMs` (the engine's ms in it 2, sim 1, draw 1, `atS` seconds into the stretch) into `log`, phase `phase`. */
function push(log: HitchLog, atS: number, phase: number, intervalMs: number, causes: number): void {
  row[FRAME.interval] = intervalMs;
  row[FRAME.cpu] = 2;
  row[FRAME.sim] = 1;
  row[FRAME.draw] = 1;
  row[FRAME.atS] = atS;
  log.frame(row, phase, causes);
}

/** `frames` steady frames into `log` (phase 1), with the frame at each index of `spikes` taking that ms. */
function feed(log: HitchLog, frames: number, spikes: Readonly<Record<number, number>> = {}, causes: Readonly<Record<number, number>> = {}): void {
  for (let i = 0; i < frames; i++) push(log, i * 0.006, 1, spikes[i] ?? STEADY_MS, causes[i] ?? 0);
}

describe("given a run of frames at 6 ms with a few long ones", () => {
  it("when a 90 ms frame, a 40 ms frame and a 20 ms frame (over 3x the median but under the 25 ms floor) come after the history fills, then the first two are hitches and the third is not", () => {
    const log = new HitchLog();
    feed(log, 400, { 200: 90, 250: 40, 300: 20 });
    const table = log.table();
    expect(table.frames, "frames").toBe(400);
    expect(table.count, "hitches").toBe(2);
    expect(firstMismatch(table.rows.map((r) => r.ms), [90, 40]), "rows, in order").toBeUndefined();
    expect(Math.round(table.excessMs), "ms over the median").toBe(90 - STEADY_MS + 40 - STEADY_MS);
  });

  it("when a long frame comes before the history holds enough frames to know a median, then it is not called a hitch", () => {
    const log = new HitchLog();
    feed(log, 100, { 3: 500 });
    expect(log.table().count).toBe(0);
  });

  it("when a hitch carries cause bits, then its row names them, and a hitch with none has an empty list", () => {
    const log = new HitchLog();
    feed(log, 200, { 100: 80, 150: 80 }, { 100: CAUSE.settingSwitch | CAUSE.gpuResources });
    const [first, second] = log.table().rows;
    expect(firstMismatch(first!.causes, ["setting-switch", "gpu-resources"]), "named causes").toBeUndefined();
    expect(second!.causes, "no visible cause").toHaveLength(0);
    expect(first!.cpuMs, "the engine's ms in it").toBe(2);
    expect(first!.phase, "its stretch").toBe(1);
  });

  it("when more hitches come than the table holds, then the shortest are dropped, the count stays whole, and the longest are kept", () => {
    const log = new HitchLog();
    const spikes: Record<number, number> = {};
    for (let k = 0; k < HITCH.cap + 20; k++) spikes[100 + 12 * k] = 100 + k;
    feed(log, 100 + 12 * (HITCH.cap + 20) + 10, spikes);
    const table = log.table();
    expect(table.count, "every hitch counted").toBe(HITCH.cap + 20);
    expect(table.rows.length, "rows held").toBe(HITCH.cap);
    expect(Math.min(...table.rows.map((r) => r.ms)), "the 20 shortest were dropped").toBe(120);
    expect(Math.max(...table.rows.map((r) => r.ms)), "the longest stays").toBe(100 + HITCH.cap + 19);
  });
});

describe("given the hitch log called a million times", () => {
  it("when frames are logged with hitches stored and dropped, then a frame allocates no more than the bound (nothing is allocated per frame)", () => {
    const log = new HitchLog();
    feed(log, 500, { 300: 90 });
    const calls = 1_000_000;
    const bytesPerFrame = untilQuiet(
      () =>
        allocatedBytes(() => {
          for (let i = 0; i < calls; i++) {
            row[FRAME.interval] = i % 9973 === 0 ? 200 + (i % 7) : STEADY_MS;
            row[FRAME.atS] = i * 0.006;
            log.frame(row, 2, i & 7);
          }
        }) / calls,
      BOUND_B,
    );
    expect(log.table().count, "the control: hitches were stored and dropped during the run").toBeGreaterThan(50);
    expect(bytesPerFrame, `${bytesPerFrame.toFixed(1)} B a frame, over ${BOUND_B} B`).toBeLessThanOrEqual(BOUND_B);
  });

  it("when frames are logged with hitches stored and dropped, then the engine's garbage collector never runs (a collection is a frozen frame)", async () => {
    const log = new HitchLog();
    feed(log, 500, { 300: 90 });
    const calls = 1_000_000;
    const logFrames = (count: number): void => {
      for (let i = 0; i < count; i++) {
        row[FRAME.interval] = i % 9973 === 0 ? 200 + (i % 7) : STEADY_MS;
        row[FRAME.atS] = i * 0.006;
        log.frame(row, 2, i & 7);
      }
    };
    // The same loop first, so it runs optimised in the window: the interpreter boxes the loop's own doubles, garbage of the test's, not the log's.
    logFrames(calls / 10);
    const minor = await scavengesDuring(() => logFrames(calls));
    expect(minor, `${minor} minor collections in ${calls} frames`).toBe(0);
  });
});
