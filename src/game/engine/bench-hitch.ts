/**
 * Every frame of a bench run that took `HITCH.factor` times the running median interval (and at least `HITCH.minMs`), kept with when it
 * happened, in which stretch of the run (`PAGE_PHASES`), what the engine spent in it and what else changed in it (`CAUSE`). The log is flat
 * typed arrays sized once: a frame is a few indexed writes, nothing allocates, and the card's rows are built when the run ends (`rows`).
 */
export const HITCH = { factor: 3, minMs: 25, cap: 48, historyFrames: 128, medianEvery: 8, minHistory: 32 } as const;

/** The slots of a bench frame's row (`Beat.frame`): the rAF stamp, the capped wall time since the last (s), the engine's ms in the frame of which sim and draw, the uncapped interval since the last rAF (ms), and seconds into the run's stretch. */
export const FRAME = { now: 0, dt: 1, cpu: 2, sim: 3, draw: 4, interval: 5, atS: 6, fields: 7 } as const;

/** What changed in a frame, one bit each (`CAUSE_NAMES` in the same order). A hitch with no bit set has no cause the bench can see (GC, the OS, another process). */
export const CAUSE = { settingSwitch: 1, focus: 2, crash: 4, ragdoll: 8, shader: 16, gpuResources: 32, cold: 64 } as const;
export const CAUSE_NAMES = ["setting-switch", "focus", "crash", "ragdoll-post", "shader", "gpu-resources", "cold"] as const;

/** One hitch as the card carries it. */
interface Hitch {
  /** Seconds into its stretch of the run. */
  atS: number;
  phase: number;
  ms: number;
  cpuMs: number;
  simMs: number;
  drawMs: number;
  causes: string[];
}

/** The log's totals and its worst `HITCH.cap` hitches in time order. */
export interface HitchTable {
  factor: number;
  minMs: number;
  frames: number;
  /** Frames over the threshold (the table holds the worst of them), and the ms they ran over the median in all. */
  count: number;
  excessMs: number;
  rows: Hitch[];
}

export class HitchLog {
  private readonly history = new Float64Array(HITCH.historyFrames);
  private readonly scratch = new Float64Array(HITCH.historyFrames);
  private filled = 0;
  private median = 0;
  frames = 0;
  count = 0;
  excessMs = 0;
  private stored = 0;
  private readonly atS = new Float64Array(HITCH.cap);
  private readonly phase = new Uint8Array(HITCH.cap);
  private readonly ms = new Float64Array(HITCH.cap);
  private readonly cpuMs = new Float64Array(HITCH.cap);
  private readonly simMs = new Float64Array(HITCH.cap);
  private readonly drawMs = new Float64Array(HITCH.cap);
  private readonly causes = new Uint16Array(HITCH.cap);

  /**
   * One frame, read from `row` (the bench loop's own frame array, slots `FRAME`): its interval, the engine's ms in it of which sim and draw, and seconds into
   * `phase`; `causes` the `CAUSE` bits that changed in it. Numbers travel in the typed array, never as call arguments (a double passed to a call that is
   * not inlined is boxed: an allocation a frame).
   */
  frame(row: Float64Array, phase: number, causes: number): void {
    this.frames++;
    const intervalMs = row[FRAME.interval]!;
    const median = this.median;
    if (this.filled >= HITCH.minHistory && intervalMs > HITCH.factor * median && intervalMs > HITCH.minMs) this.keep(row, phase, causes, median);
    this.history[(this.frames - 1) % HITCH.historyFrames] = intervalMs;
    if (this.filled < HITCH.historyFrames) this.filled++;
    if (this.frames % HITCH.medianEvery === 0 && this.filled >= HITCH.minHistory) this.median = this.medianOfHistory();
  }

  /** The median of the frames held. The scratch is sorted whole (the unfilled tail is Infinity, which sorts last), so no view is made. */
  private medianOfHistory(): number {
    const n = this.filled;
    for (let i = 0; i < n; i++) this.scratch[i] = this.history[i]!;
    for (let i = n; i < HITCH.historyFrames; i++) this.scratch[i] = Infinity;
    this.scratch.sort();
    return n % 2 === 1 ? this.scratch[n >> 1]! : (this.scratch[n / 2 - 1]! + this.scratch[n / 2]!) / 2;
  }

  /** Counts the hitch and stores it: in a free row, else over the smallest stored one when it is longer. Runs on a hitch only. */
  private keep(frame: Float64Array, phase: number, causes: number, median: number): void {
    const ms = frame[FRAME.interval]!;
    this.count++;
    this.excessMs += ms - median;
    let row = this.stored;
    if (row < HITCH.cap) this.stored++;
    else {
      row = 0;
      for (let i = 1; i < HITCH.cap; i++) if (this.ms[i]! < this.ms[row]!) row = i;
      if (this.ms[row]! >= ms) return;
    }
    this.atS[row] = frame[FRAME.atS]!;
    this.phase[row] = phase;
    this.ms[row] = ms;
    this.cpuMs[row] = frame[FRAME.cpu]!;
    this.simMs[row] = frame[FRAME.sim]!;
    this.drawMs[row] = frame[FRAME.draw]!;
    this.causes[row] = causes;
  }

  /** The table for the card, rows in the order they happened (phase, then time). Built once, when the run ends. */
  table(): HitchTable {
    const order = Array.from({ length: this.stored }, (_, i) => i).sort((a, b) => this.phase[a]! - this.phase[b]! || this.atS[a]! - this.atS[b]!);
    const rows = order.map((i): Hitch => ({
      atS: this.atS[i]!,
      phase: this.phase[i]!,
      ms: this.ms[i]!,
      cpuMs: this.cpuMs[i]!,
      simMs: this.simMs[i]!,
      drawMs: this.drawMs[i]!,
      causes: CAUSE_NAMES.filter((_, bit) => (this.causes[i]! & (1 << bit)) !== 0),
    }));
    return { factor: HITCH.factor, minMs: HITCH.minMs, frames: this.frames, count: this.count, excessMs: this.excessMs, rows };
  }
}
