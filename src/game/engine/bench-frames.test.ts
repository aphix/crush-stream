import { describe, expect, it } from "vitest";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { scavengesDuring } from "../kernel/gc.test-util.ts";
import { analyzeFrames, BUCKET_MS, FRAME_COLUMNS, FrameRecord, SERIES_COLUMNS, SPIKE_CAP, type FrameSources } from "./bench-frames.ts";
import { FRAME } from "./bench-hitch.ts";
import { PHASE, PHASE_COUNT, WORK, WORK_COUNT } from "./sim-phases.ts";
import { tabulate, wireCard } from "./bench-card.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** Bytes a recorded frame may allocate: the sampling profiler's read of code that allocates nothing is zero, one boxed double a frame is 16. */
const BOUND_B = 16;

/** A block of frames the recorder, the rig and the profiler are warm on, and the blocks one allocation read spans. */
const BLOCK_FRAMES = 10_000;
const READ_BLOCKS = 100;
/** Blocks the zero-collection row runs before its window, so the watched loop is already optimised. */
const WARM_BLOCKS = 10;

/** A bench whose frames a test writes: the frame row, the pacer, the phase clock and counters, the ragdoll posts, the wrecks. */
function source(): { from: FrameSources; row: Float64Array; work: Float64Array; ms: Float64Array; traffic: { messages: number }; pace: { steps: number }; wrecks: { n: number } } {
  const row = new Float64Array(FRAME.fields);
  const work = new Float64Array(WORK_COUNT);
  const ms = new Float64Array(PHASE_COUNT);
  const traffic = { messages: 0 };
  const pace = { steps: 0 };
  const wrecks = { n: 0 };
  return { from: { row, pace, phases: { ms, work }, traffic, crashed: () => wrecks.n }, row, work, ms, traffic, pace, wrecks };
}

/** A window of `frames` frames of `intervalMs`, where `spikes` (frame index to ms) are slow: a slow frame has `contacts` pair contacts and its wreck phase takes the time. */
function window(frames: number, intervalMs: number, spikes: Map<number, number>, contacts: number, cap = frames): { rec: FrameRecord } {
  const s = source();
  const rec = new FrameRecord(cap, s.from);
  rec.begin();
  for (let i = 0; i < frames; i++) {
    const slow = spikes.get(i);
    s.row[FRAME.interval] = slow ?? intervalMs;
    s.row[FRAME.cpu] = (slow ?? intervalMs) / 2;
    s.row[FRAME.sim] = (slow ?? intervalMs) / 4;
    s.row[FRAME.draw] = (slow ?? intervalMs) / 8;
    s.pace.steps = 2;
    s.wrecks.n = slow ? 5 : 1;
    s.work[WORK.pairContacts] = s.work[WORK.pairContacts]! + (slow ? contacts : 1);
    s.ms[PHASE.wreck] = s.ms[PHASE.wreck]! + (slow ?? 1) / 5;
    s.ms[PHASE.drive] = s.ms[PHASE.drive]! + 0.1;
    rec.push();
  }
  return { rec };
}

describe("given the frames of a window recorded as the bench runs them", () => {
  it("when N frames are rendered, then N frames are recorded, each with the row it was given, and a frame past the capacity is dropped", () => {
    const { rec } = window(300, 10, new Map(), 0);
    expect(rec.n).toBe(300);
    const s = source();
    const small = new FrameRecord(100, s.from);
    small.begin();
    for (let i = 0; i < 250; i++) small.push();
    expect(small.n, "capacity").toBe(100);
  });

  it("when a million frames are recorded, then a frame allocates no more than the bound: the recorder allocates nothing in a frame", () => {
    const s = source();
    const rec = new FrameRecord(BLOCK_FRAMES, s.from);
    const bytesPerFrame = untilQuiet(
      () =>
        allocatedBytes(() => {
          for (let block = 0; block < READ_BLOCKS; block++) {
            rec.begin();
            for (let i = 0; i < BLOCK_FRAMES; i++) {
              s.row[FRAME.interval] = 10 + (i % 7);
              s.work[WORK.pairContacts] = s.work[WORK.pairContacts]! + 3.5;
              s.ms[PHASE.wreck] = s.ms[PHASE.wreck]! + 0.25;
              rec.push();
            }
          }
        }) /
        (READ_BLOCKS * BLOCK_FRAMES),
      BOUND_B,
    );
    expect(bytesPerFrame, `${bytesPerFrame.toFixed(1)} B a recorded frame, over ${BOUND_B} B`).toBeLessThanOrEqual(BOUND_B);
  });

  it("when a million frames are recorded, then the garbage collector never runs (a collection is a frozen frame)", async () => {
    const s = source();
    const rec = new FrameRecord(BLOCK_FRAMES, s.from);
    const record = (blocks: number): void => {
      for (let block = 0; block < blocks; block++) {
        rec.begin();
        for (let i = 0; i < BLOCK_FRAMES; i++) {
          s.row[FRAME.interval] = 10 + (i % 7);
          s.work[WORK.pairContacts] = s.work[WORK.pairContacts]! + 3.5;
          s.ms[PHASE.wreck] = s.ms[PHASE.wreck]! + 0.25;
          rec.push();
        }
      }
    };
    // The same loop first, so it runs optimised in the window: the interpreter boxes the rig's own doubles, garbage of the test's, not the recorder's.
    record(WARM_BLOCKS);
    const minor = await scavengesDuring(() => record(READ_BLOCKS));
    expect(minor, `${minor} minor collections across ${READ_BLOCKS * BLOCK_FRAMES} recorded frames`).toBe(0);
  });

  it("when 1000 frames of 10 ms hold ten of 50 ms, then the median, percentiles, lows and spike count are those frames'", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 10; k++) spikes.set(50 + k * 97, 50);
    const stats = analyzeFrames(window(1000, 10, spikes, 40).rec);
    expect(stats.n).toBe(1000);
    expect(stats.medianMs).toBe(10);
    expect(stats.p95Ms).toBe(10);
    expect(stats.p999Ms).toBe(50);
    expect(stats.maxMs).toBe(50);
    expect(Math.abs(stats.fpsLow1 - 20), `1 % low ${stats.fpsLow1}: the worst 10 frames are 50 ms`).toBeLessThan(1e-6);
    expect(Math.abs(stats.fpsLow01 - 20), `0.1 % low ${stats.fpsLow01}: the worst frame is 50 ms`).toBeLessThan(1e-6);
    expect(stats.spikes.count).toBe(10);
    expect(stats.spikes.thresholdMs, "3 x the median of 10 ms").toBe(30);
  });

  it("when the spike frames are the ones with many pair contacts and a long wreck phase, then the activity says so: more contacts and wrecks in the spikes, a high correlation, the wreck phase dominant", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 10; k++) spikes.set(50 + k * 97, 50);
    const { spikes: found } = analyzeFrames(window(1000, 10, spikes, 40).rec);
    const at = (name: string): number => found.activity.cols.indexOf(name);
    expect(found.activity.inSpikes[at("pairContacts")]).toBe(40);
    expect(found.activity.otherwise[at("pairContacts")]).toBe(1);
    expect(found.activity.inSpikes[at("crashed")]).toBe(5);
    expect(found.activity.otherwise[at("crashed")]).toBe(1);
    expect(found.activity.correlation[at("pairContacts")]!, `contacts against the frame interval: ${found.activity.correlation[at("pairContacts")]}`).toBeGreaterThan(0.9);
    expect(found.dominantPhase[PHASE.wreck], "every spike's largest phase").toBe(10);
  });

  it("when there are more spikes than the card lists, then it lists the worst, in time order, and counts them all", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 100; k++) spikes.set(10 + k * 9, 40 + k);
    const { spikes: found } = analyzeFrames(window(1000, 10, spikes, 5).rec);
    expect(found.count).toBe(100);
    expect(found.rows.n).toBe(SPIKE_CAP);
    const interval = found.rows.data[found.rows.cols.indexOf("intervalMs")]!;
    expect(Math.min(...interval), "the least listed is the 64th worst").toBe(40 + 100 - SPIKE_CAP);
    const atS = found.rows.data[0]!;
    expect(atS.every((t, i) => i === 0 || t > atS[i - 1]!), "in time order").toBeTruthy();
  });

  it("when the window is bucketed, then each bucket is 200 ms of frames, with the frames' mean and max, the wrecks' largest and the counters summed", () => {
    const spikes = new Map<number, number>([[55, 60]]);
    const { series } = analyzeFrames(window(500, 10, spikes, 7).rec);
    const col = (name: string): number[] => series.data[series.cols.indexOf(name)]!;
    expect(series.cols.length, "a column of values for every name").toBe(series.data.length);
    expect(series.data.every((c) => c.length === series.n)).toBeTruthy();
    const worst = col("maxMs").indexOf(60);
    expect(col("crashed")[worst], "the bucket with the slow frame holds its wreck count").toBe(5);
    expect(col("crashed")[0]).toBe(1);
    expect(col("frames")[0]!, "20 frames of 10 ms to a 200 ms bucket").toBeLessThanOrEqual(BUCKET_MS / 10 + 1);
    expect(col("pairContacts").reduce((a, b) => a + b, 0), "every frame's contacts are in a bucket: 499 ordinary and the slow one's 7").toBe(499 + 7);
    expect(series.cols[0]).toBe("atS");
    expect(SERIES_COLUMNS.length).toBe(series.cols.length);
    expect(FRAME_COLUMNS.length, "the frame columns name the sim's counters and phases").toBeGreaterThan(20);
  });
});

describe("given the card's lists of records as the wire carries them", () => {
  it("when switches and hitch rows are tabulated, then the keys are written once and each record is one array of values", () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ stretch: "fx", arm: i % 2 ? "high" : "minimal", round: 1 + (i >> 1), settled: i % 3 !== 0, settleS: 3.25, causes: ["focus", "crash"] }));
    const table = tabulate(records);
    expect(firstMismatch(table.keys, ["stretch", "arm", "round", "settled", "settleS", "causes"])).toBeUndefined();
    expect(table.rows.length).toBe(30);
    expect(table.rows[0]![5], "a list of names is joined").toBe("focus+crash");
    const json = JSON.stringify(table);
    expect(json.split("settleS").length - 1, "the key appears once").toBe(1);
  });

  it("when a result is put on the wire, then switches, page entries and hitch rows are tables and nothing else changed", () => {
    const result = { switches: [{ stretch: "fx", arm: "high", settleS: 3.14159 }], pageEvents: [{ phase: "warm", atS: 0, visible: true }], hitches: { count: 1, rows: [{ ms: 10.123, causes: [] as string[] }] }, sweepHitches: { count: 0, rows: [] }, extra: 90.123456 };
    const wire = wireCard(result) as typeof result & { switches: { keys: string[] }; pageEvents: { keys: string[] }; hitches: { count: number; rows: { keys: string[] } } };
    expect(firstMismatch(wire.switches.keys, ["stretch", "arm", "settleS"])).toBeUndefined();
    expect(firstMismatch(wire.pageEvents.keys, ["phase", "atS", "visible"])).toBeUndefined();
    expect(firstMismatch(wire.hitches.rows.keys, ["ms", "causes"])).toBeUndefined();
    expect(wire.hitches.count).toBe(1);
    expect(wire.extra, "a key with no decimals is left whole").toBe(90.123456);
  });
});
