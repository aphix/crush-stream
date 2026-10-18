import { FRAME } from "./bench-hitch.ts";
import { PHASE_COUNT, PHASE_NAMES, WORK, WORK_COUNT, WORK_NAMES } from "./sim-phases.ts";

/** The names of the frame columns that other files name too (the card's spike line, the counters): one place for each. */
export const NAME = { interval: "intervalMs", cpu: "cpuMs", sim: "simMs", draw: "drawMs", steps: "steps", crashed: "crashed", ragdoll: "ragdollMessages", atS: "atS" } as const;

/**
 * Every frame of the bench's measured window, as one row of a flat `Float32Array` sized once (boot time is free; nothing allocates in a frame): the frame's wall interval, the
 * engine's ms in it (cpu, of which sim and draw), the pacer's steps, the wrecks, the ragdoll posts, then what the sim did in the frame as the difference of its work counters
 * (`WORK_NAMES`) and its ms in each phase (`PHASE_NAMES`). The stats.js way: a frame's cost is read where the frame ends, and the page looks at it only when the run is over (`analyzeFrames`).
 */
export const FRAME_COLUMNS = [NAME.interval, NAME.cpu, NAME.sim, NAME.draw, NAME.steps, NAME.crashed, NAME.ragdoll, ...WORK_NAMES, ...PHASE_NAMES.map((name) => `${name}Ms`)] as const;
const FRAME_COLUMN_COUNT = FRAME_COLUMNS.length;
/** Decimals each column keeps on the wire: ms to 0.01, counts whole, the phases' ms to 0.001. */
const FRAME_DECIMALS: readonly number[] = FRAME_COLUMNS.map((_, k) => (k < 4 ? 2 : k < 7 + WORK_COUNT ? 0 : 3));

const COL = { interval: 0, cpu: 1, sim: 2, draw: 3, steps: 4, crashed: 5, ragdoll: 6, work: 7, phase: 7 + WORK_COUNT } as const;

/** What a frame's recorder reads: the bench's frame row, the pacer, the sim's phase clock and counters, the ragdoll worker's posts and the wreck count. */
export interface FrameSources {
  row: Float64Array;
  pace: { readonly steps: number };
  phases: { readonly ms: Float64Array; readonly work: Float64Array };
  traffic: { readonly messages: number };
  crashed(): number;
}

export class FrameRecord {
  readonly cap: number;
  readonly data: Float32Array;
  n = 0;
  private readonly from: FrameSources;
  private readonly lastWork = new Float64Array(WORK_COUNT);
  private readonly lastPhase = new Float64Array(PHASE_COUNT);
  private lastMessages = 0;

  constructor(cap: number, from: FrameSources) {
    this.cap = cap;
    this.from = from;
    this.data = new Float32Array(cap * FRAME_COLUMN_COUNT);
  }

  /** The counters as they stand now: the first frame's differences start here. */
  begin(): void {
    this.lastWork.set(this.from.phases.work.subarray(0, WORK_COUNT));
    this.lastPhase.set(this.from.phases.ms.subarray(0, PHASE_COUNT));
    this.lastMessages = this.from.traffic.messages;
    this.n = 0;
  }

  /** The frame the bench just ran (its row is read, so nothing is passed): a frame past the capacity is dropped. */
  push(): void {
    if (this.n >= this.cap) return;
    const { row, pace, phases, traffic } = this.from;
    const d = this.data;
    const o = this.n++ * FRAME_COLUMN_COUNT;
    d[o + COL.interval] = row[FRAME.interval]!;
    d[o + COL.cpu] = row[FRAME.cpu]!;
    d[o + COL.sim] = row[FRAME.sim]!;
    d[o + COL.draw] = row[FRAME.draw]!;
    d[o + COL.steps] = pace.steps;
    d[o + COL.crashed] = this.from.crashed();
    d[o + COL.ragdoll] = traffic.messages - this.lastMessages;
    this.lastMessages = traffic.messages;
    for (let k = 0; k < WORK_COUNT; k++) {
      d[o + COL.work + k] = phases.work[k]! - this.lastWork[k]!;
      this.lastWork[k] = phases.work[k]!;
    }
    for (let k = 0; k < PHASE_COUNT; k++) {
      d[o + COL.phase + k] = phases.ms[k]! - this.lastPhase[k]!;
      this.lastPhase[k] = phases.ms[k]!;
    }
  }
}

/** A frame is a spike when its interval is over this many times the window's median (and at least `SPIKE_MIN_MS`). */
const SPIKE_FACTOR = 3;
const SPIKE_MIN_MS = 25;
/** Spikes the card lists in full (the worst, in time order); their count is whole. */
export const SPIKE_CAP = 64;
/** The share of the slowest frames a low is the mean of: 1 % and 0.1 %. */
const LOW_SHARES = [0.01, 0.001] as const;

/** The activity columns the spikes are read against (names of `FRAME_COLUMNS`): what a frame's sim was doing. */
const ACTIVITY_COLUMNS = [NAME.crashed, NAME.ragdoll, WORK_NAMES[WORK.wreckCarSlices], WORK_NAMES[WORK.asleepCarSlices], WORK_NAMES[WORK.frozenCarSlices], WORK_NAMES[WORK.pairContacts], WORK_NAMES[WORK.partContacts], WORK_NAMES[WORK.freezes], WORK_NAMES[WORK.thaws], NAME.steps] as const;

/** A table of numbers by column: the names once, the decimals each column was rounded to, and one plain number array a column. */
interface Columns {
  cols: string[];
  dp: number[];
  n: number;
  data: number[][];
}

/** Width of a series bucket (ms): short enough that a drop of a few frames is its own bucket, 5 buckets a second. */
export const BUCKET_MS = 200;

/** The series' columns: the bucket's start (s into the window), its frames, the frame interval's mean and max (ms), the engine's mean cpu, sim and draw ms a frame, then each other frame column summed over the bucket (`crashed`: its largest). */
export const SERIES_COLUMNS = [NAME.atS, "frames", "meanMs", "maxMs", NAME.cpu, NAME.sim, NAME.draw, ...FRAME_COLUMNS.slice(4)] as const;
const SERIES_DECIMALS: readonly number[] = [1, 0, 2, 2, 2, 2, 2, ...FRAME_DECIMALS.slice(4)];

/** What a window's frames say about themselves, worked out where they were recorded so a reader needs no raw series. */
export interface FrameStats {
  n: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  /** The mean fps of the slowest 1 % and 0.1 % of the frames (at least one frame each). */
  fpsLow1: number;
  fpsLow01: number;
  /** The window in `BUCKET_MS` buckets, columns `SERIES_COLUMNS`: where a drop is and what the sim was doing in it. */
  series: Columns;
  spikes: {
    count: number;
    factor: number;
    minMs: number;
    thresholdMs: number;
    /** The worst `SPIKE_CAP`, in time order: `atS` (seconds into the window) then every `FRAME_COLUMNS` column. */
    rows: Columns;
    /** For the `ACTIVITY_COLUMNS` in order: the mean over the spike frames, the mean over the other frames, and the correlation of the frame interval with it across all frames. */
    activity: { cols: string[]; inSpikes: number[]; otherwise: number[]; correlation: number[] };
    /** How many spike frames each phase was the largest part of (`PHASE_NAMES` order). */
    dominantPhase: number[];
  };
}

/** The values of `data` (stride `FRAME_COLUMN_COUNT`) of column `k` over the first `n` rows, rounded to `dp` decimals. */
function column(data: Float32Array, n: number, k: number, dp: number): number[] {
  const scale = 10 ** dp;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(data[i * FRAME_COLUMN_COUNT + k]! * scale) / scale;
  return out;
}

const meanOf = (values: ArrayLike<number>, n = values.length): number => {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i]!;
  return n ? sum / n : 0;
};

/** Pearson correlation of two series of `n` (0 when either is constant). */
function correlation(a: ArrayLike<number>, b: ArrayLike<number>, n: number): number {
  const ma = meanOf(a, n);
  const mb = meanOf(b, n);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** The mean of the slowest `share` of the sorted-ascending `sorted` (at least the worst one). */
function worstMean(sorted: Float32Array, share: number): number {
  const count = Math.max(1, Math.ceil(sorted.length * share));
  let sum = 0;
  for (let i = sorted.length - count; i < sorted.length; i++) sum += sorted[i]!;
  return sum / count;
}

/** The window's frames in `BUCKET_MS` buckets by the time each frame ended, as `SERIES_COLUMNS` columns. */
function bucketSeries(rec: FrameRecord, intervals: ArrayLike<number>): Columns {
  const n = rec.n;
  const cols = [...SERIES_COLUMNS];
  const data: number[][] = cols.map(() => []);
  const crashedAt = FRAME_COLUMNS.indexOf(NAME.crashed) - 4;
  const sums = new Float64Array(FRAME_COLUMN_COUNT - 4);
  let clock = 0;
  let bucket = 0;
  let frames = 0;
  let sumMs = 0;
  let maxMs = 0;
  let cpu = 0;
  let sim = 0;
  let draw = 0;
  const flush = (): void => {
    if (frames === 0) return;
    const row = [(bucket * BUCKET_MS) / 1000, frames, sumMs / frames, maxMs, cpu / frames, sim / frames, draw / frames, ...sums];
    for (let k = 0; k < row.length; k++) data[k]!.push(Math.round(row[k]! * 10 ** SERIES_DECIMALS[k]!) / 10 ** SERIES_DECIMALS[k]!);
    frames = 0;
    sumMs = maxMs = cpu = sim = draw = 0;
    sums.fill(0);
  };
  for (let i = 0; i < n; i++) {
    clock += intervals[i]!;
    const b = Math.floor(clock / BUCKET_MS);
    if (b !== bucket) {
      flush();
      bucket = b;
    }
    const o = i * FRAME_COLUMN_COUNT;
    frames++;
    sumMs += intervals[i]!;
    maxMs = Math.max(maxMs, intervals[i]!);
    cpu += rec.data[o + COL.cpu]!;
    sim += rec.data[o + COL.sim]!;
    draw += rec.data[o + COL.draw]!;
    for (let k = 4; k < FRAME_COLUMN_COUNT; k++) sums[k - 4] = k - 4 === crashedAt ? Math.max(sums[k - 4]!, rec.data[o + k]!) : sums[k - 4]! + rec.data[o + k]!;
  }
  flush();
  return { cols, dp: [...SERIES_DECIMALS], n: data[0]!.length, data };
}

/** The percentiles, the lows and the spikes of the recorded frames, with the sim's activity in each spike. Built when the window is over (it allocates). */
export function analyzeFrames(rec: FrameRecord): FrameStats {
  const n = rec.n;
  const intervals = column(rec.data, n, COL.interval, 4);
  const sorted = Float32Array.from(intervals).sort();
  const at = (q: number): number => (n ? sorted[Math.min(n - 1, Math.floor(q * n))]! : 0);
  const medianMs = at(0.5);
  const thresholdMs = Math.max(SPIKE_FACTOR * medianMs, SPIKE_MIN_MS);
  const over: number[] = [];
  for (let i = 0; i < n; i++) if (intervals[i]! > thresholdMs) over.push(i);
  const worst = [...over].sort((a, b) => intervals[b]! - intervals[a]!).slice(0, SPIKE_CAP).sort((a, b) => a - b);
  let clock = 0;
  const atS = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    clock += intervals[i]!;
    atS[i] = clock / 1000;
  }
  const spikeCols = [NAME.atS, ...FRAME_COLUMNS];
  const spikeData: number[][] = [worst.map((i) => Math.round(atS[i]! * 1000) / 1000)];
  for (let k = 0; k < FRAME_COLUMN_COUNT; k++) spikeData.push(worst.map((i) => Math.round(rec.data[i * FRAME_COLUMN_COUNT + k]! * 10 ** FRAME_DECIMALS[k]!) / 10 ** FRAME_DECIMALS[k]!));
  const isSpike = new Uint8Array(n);
  for (const i of over) isSpike[i] = 1;
  const activity = { cols: [...ACTIVITY_COLUMNS], inSpikes: [] as number[], otherwise: [] as number[], correlation: [] as number[] };
  for (const name of ACTIVITY_COLUMNS) {
    const k = FRAME_COLUMNS.indexOf(name);
    const values = new Float64Array(n);
    let spikeSum = 0;
    let otherSum = 0;
    for (let i = 0; i < n; i++) {
      values[i] = rec.data[i * FRAME_COLUMN_COUNT + k]!;
      if (isSpike[i]) spikeSum += values[i]!;
      else otherSum += values[i]!;
    }
    const round = (v: number): number => Math.round(v * 100) / 100;
    activity.inSpikes.push(round(over.length ? spikeSum / over.length : 0));
    activity.otherwise.push(round(n > over.length ? otherSum / (n - over.length) : 0));
    activity.correlation.push(round(correlation(intervals, values, n)));
  }
  const dominantPhase = new Array<number>(PHASE_COUNT).fill(0);
  for (const i of over) {
    let top = 0;
    for (let p = 1; p < PHASE_COUNT; p++) if (rec.data[i * FRAME_COLUMN_COUNT + COL.phase + p]! > rec.data[i * FRAME_COLUMN_COUNT + COL.phase + top]!) top = p;
    dominantPhase[top] = dominantPhase[top]! + 1;
  }
  const series = bucketSeries(rec, intervals);
  const lowFps = (share: number): number => {
    const ms = worstMean(sorted, share);
    return ms > 0 ? 1000 / ms : 0;
  };
  return {
    n,
    medianMs,
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    p999Ms: at(0.999),
    maxMs: n ? sorted[n - 1]! : 0,
    fpsLow1: lowFps(LOW_SHARES[0]),
    fpsLow01: lowFps(LOW_SHARES[1]),
    series,
    spikes: {
      count: over.length,
      factor: SPIKE_FACTOR,
      minMs: SPIKE_MIN_MS,
      thresholdMs,
      rows: { cols: spikeCols, dp: [3, ...FRAME_DECIMALS], n: worst.length, data: spikeData },
      activity,
      dominantPhase,
    },
  };
}
