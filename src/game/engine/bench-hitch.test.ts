import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PerformanceObserver } from "node:perf_hooks";
import { setImmediate as nextTurn } from "node:timers/promises";
import { CAUSE, FRAME, HITCH, HitchLog } from "./bench-hitch.ts";

const STEADY_MS = 6;
const row = new Float64Array(FRAME.fields);

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
    assert.equal(table.frames, 400, "frames");
    assert.equal(table.count, 2, "hitches");
    assert.deepEqual(table.rows.map((r) => r.ms), [90, 40], "rows, in order");
    assert.equal(Math.round(table.excessMs), 90 - STEADY_MS + 40 - STEADY_MS, "ms over the median");
  });

  it("when a long frame comes before the history holds enough frames to know a median, then it is not called a hitch", () => {
    const log = new HitchLog();
    feed(log, 100, { 3: 500 });
    assert.equal(log.table().count, 0);
  });

  it("when a hitch carries cause bits, then its row names them, and a hitch with none has an empty list", () => {
    const log = new HitchLog();
    feed(log, 200, { 100: 80, 150: 80 }, { 100: CAUSE.settingSwitch | CAUSE.gpuResources });
    const [first, second] = log.table().rows;
    assert.deepEqual(first!.causes, ["setting-switch", "gpu-resources"], "named causes");
    assert.deepEqual(second!.causes, [], "no visible cause");
    assert.equal(first!.cpuMs, 2, "the engine's ms in it");
    assert.equal(first!.phase, 1, "its stretch");
  });

  it("when more hitches come than the table holds, then the shortest are dropped, the count stays whole, and the longest are kept", () => {
    const log = new HitchLog();
    const spikes: Record<number, number> = {};
    for (let k = 0; k < HITCH.cap + 20; k++) spikes[100 + 12 * k] = 100 + k;
    feed(log, 100 + 12 * (HITCH.cap + 20) + 10, spikes);
    const table = log.table();
    assert.equal(table.count, HITCH.cap + 20, "every hitch counted");
    assert.equal(table.rows.length, HITCH.cap, "rows held");
    assert.equal(Math.min(...table.rows.map((r) => r.ms)), 120, "the 20 shortest were dropped");
    assert.equal(Math.max(...table.rows.map((r) => r.ms)), 100 + HITCH.cap + 19, "the longest stays");
  });
});

describe("given the hitch log called a million times", () => {
  it("when frames are logged with hitches stored and dropped, then the engine's garbage collector never runs (nothing is allocated per frame)", async () => {
    const log = new HitchLog();
    feed(log, 500, { 300: 90 });
    const collections: string[] = [];
    const observer = new PerformanceObserver((list) => void collections.push(...list.getEntries().map((e) => e.name)));
    observer.observe({ entryTypes: ["gc"] });
    const calls = 1_000_000;
    for (let i = 0; i < calls; i++) {
      row[FRAME.interval] = i % 9973 === 0 ? 200 + (i % 7) : STEADY_MS;
      row[FRAME.atS] = i * 0.006;
      log.frame(row, 2, i & 7);
    }
    await nextTurn();
    collections.push(...observer.takeRecords().map((e) => e.name));
    observer.disconnect();
    assert.ok(log.table().count > 50, "the control: hitches were stored and dropped during the run");
    assert.equal(collections.length, 0, `${collections.length} collections in ${calls} frames`);
  });
});
