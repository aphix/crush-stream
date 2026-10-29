import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { scavengesDuring } from "../kernel/gc.test-util.ts";
import { analyzeFrames, BUCKET_MS, FRAME_COLUMNS, FrameRecord, SERIES_COLUMNS, SPIKE_CAP, type FrameSources } from "./bench-frames.ts";
import { FRAME } from "./bench-hitch.ts";
import { PHASE, PHASE_COUNT, WORK, WORK_COUNT } from "./sim-phases.ts";
import { tabulate, wireCard } from "./bench-card.ts";

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
    assert.equal(rec.n, 300);
    const s = source();
    const small = new FrameRecord(100, s.from);
    small.begin();
    for (let i = 0; i < 250; i++) small.push();
    assert.equal(small.n, 100, "capacity");
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
    assert.ok(bytesPerFrame <= BOUND_B, `${bytesPerFrame.toFixed(1)} B a recorded frame, over ${BOUND_B} B`);
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
    assert.equal(minor, 0, `${minor} minor collections across ${READ_BLOCKS * BLOCK_FRAMES} recorded frames`);
  });

  it("when 1000 frames of 10 ms hold ten of 50 ms, then the median, percentiles, lows and spike count are those frames'", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 10; k++) spikes.set(50 + k * 97, 50);
    const stats = analyzeFrames(window(1000, 10, spikes, 40).rec);
    assert.equal(stats.n, 1000);
    assert.equal(stats.medianMs, 10);
    assert.equal(stats.p95Ms, 10);
    assert.equal(stats.p999Ms, 50);
    assert.equal(stats.maxMs, 50);
    assert.ok(Math.abs(stats.fpsLow1 - 20) < 1e-6, `1 % low ${stats.fpsLow1}: the worst 10 frames are 50 ms`);
    assert.ok(Math.abs(stats.fpsLow01 - 20) < 1e-6, `0.1 % low ${stats.fpsLow01}: the worst frame is 50 ms`);
    assert.equal(stats.spikes.count, 10);
    assert.equal(stats.spikes.thresholdMs, 30, "3 x the median of 10 ms");
  });

  it("when the spike frames are the ones with many pair contacts and a long wreck phase, then the activity says so: more contacts and wrecks in the spikes, a high correlation, the wreck phase dominant", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 10; k++) spikes.set(50 + k * 97, 50);
    const { spikes: found } = analyzeFrames(window(1000, 10, spikes, 40).rec);
    const at = (name: string): number => found.activity.cols.indexOf(name);
    assert.equal(found.activity.inSpikes[at("pairContacts")], 40);
    assert.equal(found.activity.otherwise[at("pairContacts")], 1);
    assert.equal(found.activity.inSpikes[at("crashed")], 5);
    assert.equal(found.activity.otherwise[at("crashed")], 1);
    assert.ok(found.activity.correlation[at("pairContacts")]! > 0.9, `contacts against the frame interval: ${found.activity.correlation[at("pairContacts")]}`);
    assert.equal(found.dominantPhase[PHASE.wreck], 10, "every spike's largest phase");
  });

  it("when there are more spikes than the card lists, then it lists the worst, in time order, and counts them all", () => {
    const spikes = new Map<number, number>();
    for (let k = 0; k < 100; k++) spikes.set(10 + k * 9, 40 + k);
    const { spikes: found } = analyzeFrames(window(1000, 10, spikes, 5).rec);
    assert.equal(found.count, 100);
    assert.equal(found.rows.n, SPIKE_CAP);
    const interval = found.rows.data[found.rows.cols.indexOf("intervalMs")]!;
    assert.equal(Math.min(...interval), 40 + 100 - SPIKE_CAP, "the least listed is the 64th worst");
    const atS = found.rows.data[0]!;
    assert.ok(atS.every((t, i) => i === 0 || t > atS[i - 1]!), "in time order");
  });

  it("when the window is bucketed, then each bucket is BUCKET_MS of frames, with the frames' mean and max, the wrecks' largest and the counters summed", () => {
    const spikes = new Map<number, number>([[55, 60]]);
    const { series } = analyzeFrames(window(500, 10, spikes, 7).rec);
    const col = (name: string): number[] => series.data[series.cols.indexOf(name)]!;
    assert.equal(series.cols.length, series.data.length, "a column of values for every name");
    assert.ok(series.data.every((c) => c.length === series.n));
    const worst = col("maxMs").indexOf(60);
    assert.equal(col("crashed")[worst], 5, "the bucket with the slow frame holds its wreck count");
    assert.equal(col("crashed")[0], 1);
    assert.ok(col("frames")[0]! <= BUCKET_MS / 10 + 1, "20 frames of 10 ms to a 200 ms bucket");
    assert.equal(col("pairContacts").reduce((a, b) => a + b, 0), 499 + 7, "every frame's contacts are in a bucket: 499 ordinary and the slow one's 7");
    assert.equal(series.cols[0], "atS");
    assert.equal(SERIES_COLUMNS.length, series.cols.length);
    assert.ok(FRAME_COLUMNS.length > 20, "the frame columns name the sim's counters and phases");
  });
});

describe("given the card's lists of records as the wire carries them", () => {
  it("when switches and hitch rows are tabulated, then the keys are written once and each record is one array of values", () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ stretch: "fx", arm: i % 2 ? "high" : "minimal", round: 1 + (i >> 1), settled: i % 3 !== 0, settleS: 3.25, causes: ["focus", "crash"] }));
    const table = tabulate(records);
    assert.deepEqual(table.keys, ["stretch", "arm", "round", "settled", "settleS", "causes"]);
    assert.equal(table.rows.length, 30);
    assert.equal(table.rows[0]![5], "focus+crash", "a list of names is joined");
    const json = JSON.stringify(table);
    assert.equal(json.split("settleS").length - 1, 1, "the key appears once");
  });

  it("when a result is put on the wire, then switches, page entries and hitch rows are tables and nothing else changed", () => {
    const result = { switches: [{ stretch: "fx", arm: "high", settleS: 3.14159 }], pageEvents: [{ phase: "warm", atS: 0, visible: true }], hitches: { count: 1, rows: [{ ms: 10.123, causes: [] as string[] }] }, sweepHitches: { count: 0, rows: [] }, extra: 90.123456 };
    const wire = wireCard(result) as typeof result & { switches: { keys: string[] }; pageEvents: { keys: string[] }; hitches: { count: number; rows: { keys: string[] } } };
    assert.deepEqual(wire.switches.keys, ["stretch", "arm", "settleS"]);
    assert.deepEqual(wire.pageEvents.keys, ["phase", "atS", "visible"]);
    assert.deepEqual(wire.hitches.rows.keys, ["ms", "causes"]);
    assert.equal(wire.hitches.count, 1);
    assert.equal(wire.extra, 90.123456, "a key with no decimals is left whole");
  });
});
